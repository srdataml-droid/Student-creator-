-- DESIGN DRAFT ONLY. NOT APPLIED. Review in isolated Supabase project first.
-- Requires PostgreSQL/Supabase auth.users and pgcrypto/gen_random_uuid().
-- Financial tables have RLS and deliberately NO client mutating policies.
-- All fulfillment MUST occur atomically through reviewed, server-only code.

create extension if not exists pgcrypto;

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  slug text not null,
  name text not null,
  unique(institution_id,slug),
  unique(id,institution_id)
);
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  department_id uuid not null,
  code text not null,
  title text not null,
  active boolean not null default true,
  foreign key(department_id,institution_id) references public.departments(id,institution_id),
  unique(institution_id,code),
  unique(id,institution_id)
);
create table public.course_topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  slug text not null,
  name text not null,
  unique(course_id,slug),
  unique(id,course_id)
);
create table public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  institution_id uuid references public.institutions(id),
  display_name text not null,
  verified_at timestamptz,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id,institution_id)
);
-- Staff privileges are server-managed: never derived from editable user_metadata.
create table public.platform_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check(role in ('moderator','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  institution_id uuid not null references public.institutions(id),
  method text not null check (method in ('school_email','manual_id')),
  status text not null check(status in ('pending','approved','rejected','revoked')) default 'pending',
  private_evidence_path text,
  reviewer_id uuid references auth.users(id),
  reviewed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id),
  institution_id uuid not null references public.institutions(id),
  course_id uuid not null references public.courses(id),
  topic_id uuid,
  title text not null check(length(title) between 3 and 160),
  description text not null default '' check(length(description) <= 2500),
  preview_text text not null default '' check(length(preview_text) <= 800),
  rights_attested_at timestamptz not null,
  -- A stable client-generated key prevents duplicate drafts on retry.
  creation_key text not null check(length(creation_key) between 16 and 128 and creation_key ~ '^[A-Za-z0-9_-]+$'),
  creation_hash text not null check(creation_hash ~ '^[0-9a-f]{64}$'),
  unique(creator_id, creation_key),
  status text not null check(status in ('draft','processing','in_review','rejected','published','taken_down','archived')) default 'draft',
  reviewer_id uuid references auth.users(id),
  review_reason text check (review_reason is null or length(review_reason) between 5 and 1000),
  reviewed_at timestamptz,
  published_at timestamptz,
  constraint published_has_review check (status <> 'published' or (reviewer_id is not null and review_reason is not null and reviewed_at is not null and published_at is not null)),
  created_at timestamptz not null default now(),
  unique(id,creator_id),
  -- Both the publishing student and course must belong to one institution.
  foreign key(creator_id,institution_id) references public.student_profiles(user_id,institution_id),
  foreign key(course_id,institution_id) references public.courses(id,institution_id),
  foreign key(topic_id,course_id) references public.course_topics(id,course_id)
);
create index content_by_course_topic on public.content_items(course_id,topic_id,status);
create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id),
  private_object_key text not null unique,
  mime_type text not null,
  bytes bigint not null check(bytes>=0),
  processing_status text not null check(processing_status in ('uploaded','scanning','transcoding','ready','failed')),
  scan_verdict text not null default 'pending' check(scan_verdict in ('pending','clean','malicious','inconclusive')),
  constraint ready_assets_must_be_clean check(processing_status <> 'ready' or scan_verdict = 'clean'),
  created_at timestamptz not null default now()
);
-- Authenticated students can like public approved content; likes remain private per actor.
-- A future aggregate/read API must use an audited server-side count, never expose liker identities.
create table public.content_likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,content_id)
);
create index content_likes_by_content on public.content_likes(content_id);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null,
  creator_id uuid not null,
  price_kobo bigint not null check(price_kobo >= 20000),
  currency text not null default 'NGN' check(currency='NGN'),
  state text not null check(state in ('active','paused','closed')) default 'active',
  created_at timestamptz not null default now(),
  foreign key(content_id,creator_id) references public.content_items(id,creator_id),
  unique(id,content_id,creator_id)
);
create unique index single_active_listing_per_content on public.listings(content_id) where state='active';
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id),
  listing_id uuid not null,
  content_id uuid not null,
  creator_id uuid not null,
  idempotency_key text not null check(length(idempotency_key) between 16 and 200),
  amount_kobo bigint not null check(amount_kobo >= 20000),
  currency text not null default 'NGN' check(currency='NGN'),
  platform_fee_bps integer not null check(platform_fee_bps between 0 and 10000),
  platform_fee_kobo bigint not null check(platform_fee_kobo >= 0),
  creator_gross_share_kobo bigint not null check(creator_gross_share_kobo >= 0),
  environment text not null check(environment in ('test','live')),
  status text not null check(status in ('created','pending','verification_pending','paid','failed','cancelled','expired','disputed','refund_pending','refunded','chargeback')) default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  unique(buyer_id,idempotency_key),
  unique(id,buyer_id,content_id),
  foreign key(listing_id,content_id,creator_id) references public.listings(id,content_id,creator_id),
  check(platform_fee_kobo + creator_gross_share_kobo=amount_kobo)
);
create index orders_by_buyer_created on public.orders(buyer_id,created_at desc);
create index orders_by_status_age on public.orders(status,created_at);
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null check(provider in ('paystack')),
  reference text not null,
  status text not null check(status in ('created','initialized','pending','success','failed','abandoned','reversed')),
  provider_transaction_id text,
  created_at timestamptz not null default now(),
  unique(provider,reference),
  unique(provider,provider_transaction_id)
);
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  stable_event_key text not null,
  payload_sha256 text not null,
  status text not null check(status in ('received','processing','processed','failed')),
  last_error_code text,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  received_at timestamptz not null default now(),
  unique(provider,stable_event_key)
);
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id),
  content_id uuid not null references public.content_items(id),
  order_id uuid not null unique,
  foreign key(order_id,buyer_id,content_id) references public.orders(id,buyer_id,content_id),
  state text not null check(state in ('active','revoked','suspended')) default 'active',
  granted_at timestamptz not null default now(),
  unique(buyer_id,content_id)
);
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  business_event_key text not null unique,
  kind text not null check(kind in ('creator_pending','platform_fee','gateway_fee','creator_payable','refund_adjustment','payout_adjustment')),
  amount_kobo bigint not null check(amount_kobo<>0),
  currency text not null default 'NGN' check(currency='NGN'),
  created_at timestamptz not null default now()
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  target_kind text not null,
  target_id uuid,
  correlation_id text,
  reason text,
  created_at timestamptz not null default now()
);

-- RLS enabled on EVERY table. Read-only public taxonomy is allowed; user-specific data is scoped.
-- Finance, verification, authorisation and media tables intentionally have no general client write policies.
alter table public.institutions enable row level security;
alter table public.departments enable row level security;
alter table public.courses enable row level security;
alter table public.course_topics enable row level security;
alter table public.student_profiles enable row level security;
alter table public.platform_staff enable row level security;
alter table public.verification_requests enable row level security;
alter table public.content_items enable row level security;
alter table public.content_assets enable row level security;
alter table public.content_likes enable row level security;
alter table public.listings enable row level security;
alter table public.orders enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.webhook_events enable row level security;
alter table public.entitlements enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_events enable row level security;

create policy institution_read on public.institutions for select to anon,authenticated using(true);
create policy department_read on public.departments for select to anon,authenticated using(true);
create policy course_read on public.courses for select to anon,authenticated using(true);
create policy topic_read on public.course_topics for select to anon,authenticated using(true);
create policy my_profile_read on public.student_profiles for select to authenticated using((select auth.uid())=user_id);
create policy my_verification_read on public.verification_requests for select to authenticated using((select auth.uid())=user_id);
-- Content rows contain ONLY public metadata, not actual lesson body or asset URLs.
create policy published_metadata_anon on public.content_items for select to anon
  using(status='published');
create policy published_or_own_metadata_authenticated on public.content_items for select to authenticated
  using(status='published' or creator_id=(select auth.uid()));
-- Likes never reveal who else reacted. Owner-only reads and deletes; verified students
-- can create a like only for published content in an active course.
create policy own_content_likes_read on public.content_likes for select to authenticated
  using(user_id=(select auth.uid()));
create policy own_content_likes_delete on public.content_likes for delete to authenticated
  using(user_id=(select auth.uid()));
create policy verified_public_content_like on public.content_likes for insert to authenticated
  with check(user_id=(select auth.uid())
    and exists (select 1 from public.student_profiles p
      where p.user_id=(select auth.uid()) and p.verified_at is not null and not p.suspended)
    and exists (select 1 from public.content_items c
      join public.courses cs on cs.id=c.course_id
      where c.id=content_id and c.status='published' and cs.active));
grant select,insert,delete on public.content_likes to authenticated;

create policy active_listing_read on public.listings for select to anon,authenticated
  using(state='active' and exists (
    select 1 from public.content_items c where c.id=content_id and c.status='published'
  ));
create policy own_orders_read on public.orders for select to authenticated using(buyer_id=(select auth.uid()));
create policy own_entitlements_read on public.entitlements for select to authenticated using(buyer_id=(select auth.uid()));
-- `content_assets`, `platform_staff`, ledger, payment attempts, webhook events and audit have NO browser policies.
-- EXPLICIT REVIEW GATE: until RLS and storage bucket policies are tested, DO NOT APPLY IN PRODUCTION.

-- Every moderation status transition is audited transactionally. This trigger
-- uses the privileges of the trusted server database connection; browser
-- actors have no UPDATE policy on content_items or INSERT on audit_events.
create function public.audit_moderation_transition() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'in_review' and new.status in ('published','rejected') then
    insert into public.audit_events(actor_id,action,target_kind,target_id,reason)
    values (new.reviewer_id,'lesson.moderated.' || new.status,'content_item',new.id,new.review_reason);
  end if;
  return new;
end;
$$;
create trigger content_moderation_audit after update of status on public.content_items
for each row when (old.status is distinct from new.status)
execute function public.audit_moderation_transition();

-- Internal server-only RPC: atomic asset readiness recheck and creator-owned
-- state transition. This is invoker-rights, not SECURITY DEFINER.
-- Called only from server using the service role; anonymous users have no EXECUTE.
create function public.submit_content_for_review(
  _content_id uuid, _creator_id uuid, _expected_status text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if _expected_status not in ('draft','rejected') then return false; end if;
  update public.content_items c
  set status='in_review', reviewer_id=null, review_reason=null,
      reviewed_at=null, published_at=null
  where c.id=_content_id and c.creator_id=_creator_id
    and c.status=_expected_status
    and (select count(*) from public.content_assets a where a.content_id=c.id) between 1 and 12
    and not exists (
      select 1 from public.content_assets a where a.content_id=c.id
      and (a.processing_status<>'ready' or a.scan_verdict<>'clean'
           or a.private_object_key not like 'private/%'
           or a.private_object_key like '%..%')
    );
  get diagnostics changed = row_count;
  return changed=1;
end;
$$;
revoke all on function public.submit_content_for_review(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.submit_content_for_review(uuid,uuid,text) to service_role;

-- Extend durable audit trigger to include submitted-for-review transitions.
create or replace function public.audit_moderation_transition() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.status in ('draft','rejected') and new.status='in_review' then
    insert into public.audit_events(actor_id,action,target_kind,target_id,reason)
    values(new.creator_id,'lesson.review.submitted','content_item',new.id,null);
  elsif old.status='in_review' and new.status in ('published','rejected') then
    insert into public.audit_events(actor_id,action,target_kind,target_id,reason)
    values(new.reviewer_id,'lesson.moderated.' || new.status,'content_item',new.id,new.review_reason);
  end if;
  return new;
end;
$$;
