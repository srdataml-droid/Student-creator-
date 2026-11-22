import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static contract guards only, not PostgreSQL execution or RLS penetration testing.
const sql = readFileSync(new URL('../../../db/migrations/0001_proposed_core.sql', import.meta.url), 'utf8');
const table = (name) => {
  const x = sql.match(new RegExp(String.raw`create table public\.${name} \(([\s\S]*?)\n\);`, 'i'));
  assert.ok(x, `Missing table ${name}`);
  return x[1];
};
test('content draft fields and database alignment', () => {
  assert.match(table('courses'), /active boolean not null default true/);
  assert.match(table('student_profiles'), /suspended boolean not null default false/);
  assert.match(table('content_items'), /institution_id uuid not null/);
  assert.match(table('content_items'), /foreign key\(creator_id,institution_id\) references public\.student_profiles\(user_id,institution_id\)/);
  assert.match(table('content_items'), /foreign key\(course_id,institution_id\) references public\.courses\(id,institution_id\)/);
  assert.match(table('content_items'), /length\(description\) <= 2500/);
  assert.match(table('content_items'), /length\(preview_text\) <= 800/);
  assert.match(table('content_assets'), /scan_verdict text not null/);
  assert.match(table('content_assets'), /ready_assets_must_be_clean/);
});
test('privileged tables have RLS but no broad client write grants', () => {
  for (const name of ['student_profiles','platform_staff','verification_requests','content_items','content_assets','orders','entitlements','ledger_entries','payment_attempts','webhook_events','audit_events']) {
    table(name);
    assert.ok(sql.includes(`alter table public.${name} enable row level security;`), `Missing RLS on ${name}`);
  }
  // Only nonfinancial owner-scoped social reactions may have narrow client writes.
  // This continues to reject any client writes on profiles, finance, moderation or media.
  const clientWrites=[...sql.matchAll(/create policy (\w+) on public\.(\w+) for (all|insert|update|delete) to (anon|authenticated)\b/gi)]
    .map(m=>[m[1],m[2],m[3].toLowerCase(),m[4].toLowerCase()]);
  assert.deepEqual(clientWrites,[
    ['own_content_likes_delete','content_likes','delete','authenticated'],
    ['verified_public_content_like','content_likes','insert','authenticated']
  ]);
  assert.match(sql,/create policy verified_public_content_like[\s\S]*?with check\(user_id=\(select auth\.uid\(\)\)[\s\S]*?p\.verified_at is not null and not p\.suspended[\s\S]*?c\.status='published' and cs\.active\)/);
  assert.match(sql,/alter table public\.content_likes enable row level security/);
});

test('draft creation is idempotent at the database boundary', () => {
  assert.match(table('content_items'), /creation_key text not null/);
  assert.match(table('content_items'), /creation_hash text not null/);
  assert.match(table('content_items'), /unique\(creator_id, creation_key\)/);
});

test('review transition SQL is service-only, rechecks clean assets atomically and has durable audit',()=>{
 assert.match(sql,/create function public\.submit_content_for_review\(/);
 assert.match(sql,/security invoker set search_path = ''/);
 assert.match(sql,/revoke all on function public\.submit_content_for_review\(uuid,uuid,text\) from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.submit_content_for_review\(uuid,uuid,text\) to service_role/);
 assert.match(sql,/select count\(\*\) from public\.content_assets/);
 assert.match(sql,/a\.processing_status<>'ready' or a\.scan_verdict<>'clean'/);
 assert.match(sql,/lesson\.review\.submitted/);
 assert.match(sql,/create trigger content_moderation_audit after update of status/);
});


test('anonymous public course catalog cannot read drafts despite a user-id claim',()=>{
 assert.match(sql,/create policy published_metadata_anon on public.content_items for select to anon\s+using\(status='published'\)/);
 assert.match(sql,/create policy published_or_own_metadata_authenticated on public.content_items for select to authenticated/);
 assert.doesNotMatch(sql,/for select to anon,authenticated\s+using\(status='published' or creator_id/i);
});
