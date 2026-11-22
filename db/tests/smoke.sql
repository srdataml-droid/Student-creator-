-- All assertions execute against a disposable PostgreSQL 17 CI service.
-- This does NOT simulate the full Supabase platform or provider storage.
\set ON_ERROR_STOP on
\echo 'Bootstrap fixtures and explicit test-only grants'
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('99999999-9999-4999-8999-999999999999');
insert into public.institutions(id,slug,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','uni-a','University A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','uni-b','University B');
insert into public.departments(id,institution_id,slug,name) values
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cs','Computer Science'),
 ('bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','math','Mathematics');
insert into public.courses(id,institution_id,department_id,code,title) values
 ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','CSC101','Programming'),
 ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb','MTH101','Calculus');
insert into public.student_profiles(user_id,institution_id,display_name,verified_at) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Alice',now()),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Bob',now());
insert into public.platform_staff(user_id,role) values('99999999-9999-4999-8999-999999999999','moderator');
insert into public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash) values
 ('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','Intro to coding',now(),'alice_first_draft_1234',repeat('a',64)),
 ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','Intro to calculus',now(),'bob_first_draft_12345',repeat('b',64));
insert into public.content_assets(content_id,private_object_key,mime_type,bytes,processing_status,scan_verdict) values
 ('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','private/alice/original.pdf','application/pdf',1234,'ready','clean'),
 ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','private/bob/pending.pdf','application/pdf',1234,'scanning','pending');

grant usage on schema auth,public to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
grant select on public.institutions,public.departments,public.courses,public.course_topics,
 public.student_profiles,public.content_items,public.orders,public.entitlements to authenticated;
grant select on public.institutions,public.departments,public.courses,public.course_topics,
 public.content_items to anon;
-- Service role receives explicit DB privileges and bypasses RLS in real Supabase.
grant all on all tables in schema public to service_role;

\echo 'Validate cross-institution FK cannot be bypassed even by the database owner'
do $$
begin
  begin
    insert into public.content_items(creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash)
      values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','Cross-campus fake',now(),'invalid_cross_1234',repeat('c',64));
    raise exception 'cross-institution content was accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

\echo 'Validate authenticated RLS and no content mutation privilege'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ declare n integer;
begin
  select count(*) into n from public.student_profiles;
  if n<>1 then raise exception 'RLS profile leak: % rows',n;end if;
  select count(*) into n from public.content_items;
  if n<>1 then raise exception 'RLS draft leak: % rows',n;end if;
  begin
    update public.content_items set status='published' where id='aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
    raise exception 'Client could publish without moderation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_content_for_review('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','draft');
    raise exception 'Client can invoke internal submission RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Validate server-only RPC, readiness, atomic audit and moderation transition'
set role service_role;
do $$ declare accepted boolean; n integer;
begin
  select public.submit_content_for_review('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','draft') into accepted;
  if not accepted then raise exception 'Valid creator submission was rejected';end if;
  select public.submit_content_for_review('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','draft') into accepted;
  if accepted then raise exception 'Duplicate submission succeeded';end if;
  select public.submit_content_for_review('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','draft') into accepted;
  if accepted then raise exception 'Unscanned media accepted';end if;
  select count(*) into n from public.audit_events where action='lesson.review.submitted';
  if n<>1 then raise exception 'Submission audit not atomic/exact: %',n;end if;
  update public.content_items set status='published',reviewer_id='99999999-9999-4999-8999-999999999999',
   review_reason='Checked original lesson and sources',reviewed_at=now(),published_at=now()
  where id='aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa' and status='in_review';
  select count(*) into n from public.audit_events where action='lesson.moderated.published';
  if n<>1 then raise exception 'Moderation audit not atomic/exact: %',n;end if;
end $$;
reset role;

\\echo 'Like RLS: actor ownership, published-only, deduplication and cross-campus public content'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into public.content_likes(user_id,content_id)
  values('11111111-1111-4111-8111-111111111111','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');
do $ declare n integer;
begin
  select count(*) into n from public.content_likes;
  if n<>1 then raise exception 'Own like not readable: %',n;end if;
  begin
    insert into public.content_likes(user_id,content_id)
      values('11111111-1111-4111-8111-111111111111','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');
    raise exception 'Duplicate like accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.content_likes(user_id,content_id)
      values('22222222-2222-4222-8222-222222222222','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');
    raise exception 'Like impersonation accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.content_likes(user_id,content_id)
      values('11111111-1111-4111-8111-111111111111','bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');
    raise exception 'Unapproved content like accepted';
  exception when insufficient_privilege then null;
  end;
end $;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $ declare n integer;
begin
  select count(*) into n from public.content_likes;
  if n<>0 then raise exception 'Other student can read likes: %',n;end if;
  delete from public.content_likes where user_id='11111111-1111-4111-8111-111111111111';
end $;
reset role;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set role authenticated;
do $ declare n integer;
begin
  select count(*) into n from public.content_likes;
  if n<>1 then raise exception 'Other student removed own like: %',n;end if;
  delete from public.content_likes where user_id='11111111-1111-4111-8111-111111111111';
  select count(*) into n from public.content_likes;
  if n<>0 then raise exception 'Own unlike did not delete';end if;
end $;
reset role;

\\echo 'Anonymous RLS shows only published public metadata, even if subject claim present'
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set role anon;
do $$ declare n integer;
begin
  select count(*) into n from public.content_items;
  if n<>1 then raise exception 'Public catalog leak: % rows',n;end if;
  begin
    perform 1 from public.content_assets;
    raise exception 'Anonymous role could read private content assets';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'PASS: disposable PostgreSQL schema, RLS, submission, audit and moderation contract'
