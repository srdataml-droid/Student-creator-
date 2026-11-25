-- PRODUCTION ONLY. Never apply in the existing staging project or a database with payment history.
-- This is a separate production migration track, not a conversion of test money.
-- Requires base schema and current-session RLS. No checkout is enabled by installation.
DO $$ BEGIN
 IF to_regnamespace('week05_finance') IS NOT NULL OR EXISTS(SELECT 1 FROM public.orders) OR EXISTS(SELECT 1 FROM public.entitlements) THEN RAISE EXCEPTION 'LIVE_FINANCE_REQUIRES_CLEAN_PRODUCTION_DATABASE'; END IF;
END $$;
ALTER TABLE public.orders ADD CONSTRAINT production_orders_live_only CHECK(environment='live');
ALTER TABLE public.entitlements ADD COLUMN expires_at timestamptz NOT NULL;
create schema live_finance;
revoke all on schema live_finance from public,anon,authenticated;
grant usage on schema live_finance to service_role;

-- Explicit database-owner commercial approval is required for new live orders.
create table live_finance.runtime_gate (
 singleton boolean primary key check(singleton),
 allow_checkout boolean not null default false,
 terms_version text check(terms_version ~ '^[A-Za-z0-9._-]{3,128},
 refund_policy_version text check(length(refund_policy_version) between 3 and 128),
 platform_fee_bps integer check(platform_fee_bps between 0 and 10000),
 fee_bearer text check(fee_bearer in ('creator','platform')),
 license_seconds integer check(license_seconds between 60 and 315360000),
 approved_at timestamptz,
 check(not allow_checkout or (terms_version is not null and refund_policy_version is not null and platform_fee_bps is not null and fee_bearer is not null and license_seconds is not null and approved_at is not null))
);
insert into live_finance.runtime_gate(singleton) values(true);
alter table live_finance.runtime_gate enable row level security;

create table live_finance.order_terms (
 order_id uuid primary key references public.orders(id),
 buyer_email text not null check(length(buyer_email) between 3 and 254),
 terms_version text not null check(length(terms_version) between 3 and 128),
 refund_policy_version text not null check(length(refund_policy_version) between 3 and 128),
 platform_fee_bps integer not null check(platform_fee_bps between 0 and 10000),
 fee_bearer text not null check(fee_bearer in ('creator','platform')),
 license_seconds integer not null check(license_seconds between 60 and 315360000),
 created_at timestamptz not null default now()
);
create table live_finance.receipts (
 transaction_id text primary key check(transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 order_id uuid not null references live_finance.order_terms(order_id),
 reference text not null,
 amount_kobo bigint not null check(amount_kobo between 20000 and 9007199254740991),
 fee_kobo bigint check(fee_kobo between 0 and amount_kobo),
 duplicate boolean not null,
 received_at timestamptz not null default now(),
 unique(transaction_id,order_id)
);
create unique index live_one_primary_receipt on live_finance.receipts(order_id) where not duplicate;
create table live_finance.reversals (
 transaction_id text primary key check(transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 event_key text not null unique check(length(event_key) between 8 and 200),
 order_id uuid not null references live_finance.order_terms(order_id),
 reference text not null,
 amount_kobo bigint not null check(amount_kobo between 20000 and 9007199254740991),
 kind text not null check(kind in ('refund','chargeback')),
 received_at timestamptz not null default now()
);
-- Each row is one balanced debit/credit pair. The amount applies to both sides.
-- This is the canonical journal for NEW staged orders; never sum legacy ledger_entries.
create table live_finance.journal (
 event_key text primary key,
 transaction_id text not null references live_finance.receipts(transaction_id),
 order_id uuid not null references live_finance.order_terms(order_id),
 kind text not null check(kind in ('charge','duplicate_charge','provider_fee','reversal','duplicate_reversal','creator_allocation','platform_allocation','creator_allocation_reversal','platform_allocation_reversal')),
 debit_account text not null,
 credit_account text not null,
 amount_kobo bigint not null check(amount_kobo between 1 and 9007199254740991),
 currency text not null default 'NGN' check(currency='NGN'),
 created_at timestamptz not null default now(),
 unique(transaction_id,kind),
 foreign key(transaction_id,order_id) references live_finance.receipts(transaction_id,order_id),
 check((kind='charge' and debit_account='processor_clearing' and credit_account='gross_pending')
 or (kind='duplicate_charge' and debit_account='processor_clearing' and credit_account='duplicate_liability')
 or (kind='provider_fee' and debit_account in ('creator_pending','platform_pending','duplicate_liability') and credit_account='processor_clearing')
 or (kind='reversal' and debit_account='gross_pending' and credit_account='processor_clearing')
 or (kind='duplicate_reversal' and debit_account='duplicate_liability' and credit_account='processor_clearing')
 or (kind='creator_allocation' and debit_account='gross_pending' and credit_account='creator_pending')
 or (kind='platform_allocation' and debit_account='gross_pending' and credit_account='platform_pending')
 or (kind='creator_allocation_reversal' and debit_account='creator_pending' and credit_account='gross_pending')
 or (kind='platform_allocation_reversal' and debit_account='platform_pending' and credit_account='gross_pending'))
);
alter table live_finance.order_terms enable row level security;
alter table live_finance.receipts enable row level security;
alter table live_finance.reversals enable row level security;
alter table live_finance.journal enable row level security;
revoke all on all tables in schema live_finance from public,anon,authenticated,service_role;
-- Direct financial writes forbidden; backend uses service-only RPCs.
grant select on live_finance.runtime_gate to service_role;

create function live_finance.deny_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'APPEND_ONLY' using errcode='23514'; end $$;
revoke all on function live_finance.deny_mutation() from public,anon,authenticated;
create trigger terms_append_only before update or delete on live_finance.order_terms for each row execute function live_finance.deny_mutation();
create trigger receipts_append_only before update or delete on live_finance.receipts for each row execute function live_finance.deny_mutation();
create trigger reversals_append_only before update or delete on live_finance.reversals for each row execute function live_finance.deny_mutation();
create trigger journal_append_only before update or delete on live_finance.journal for each row execute function live_finance.deny_mutation();

-- Protect only orders created under this contract. Existing legacy rows are not migrated.
create function live_finance.immutable_terms() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from live_finance.order_terms where order_id=old.id) then
  if tg_op='DELETE' then raise exception 'IMMUTABLE_ORDER' using errcode='23514'; end if;
  if (to_jsonb(new)-array['status','paid_at','updated_at']) is distinct from
     (to_jsonb(old)-array['status','paid_at','updated_at']) then
   raise exception 'IMMUTABLE_ORDER' using errcode='23514';
  end if;
  if old.status in ('refunded','chargeback') and new.status is distinct from old.status then
   raise exception 'TERMINAL_ORDER' using errcode='23514';
  end if;
  if new.status='paid' and not exists(select 1 from live_finance.receipts r join live_finance.journal j on j.transaction_id=r.transaction_id and j.order_id=r.order_id and j.kind='charge' where r.order_id=old.id and not r.duplicate and r.amount_kobo=new.amount_kobo and j.amount_kobo=new.amount_kobo and not exists(select 1 from live_finance.reversals v where v.transaction_id=r.transaction_id)) then
   raise exception 'VERIFIED_JOURNAL_REQUIRED' using errcode='23514';
  end if;
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then
   raise exception 'IMMUTABLE_PAID_AT' using errcode='23514';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function live_finance.immutable_terms() from public,anon,authenticated;
create trigger live_order_snapshot before update or delete on public.orders for each row execute function live_finance.immutable_terms();

-- Block a direct active entitlement for managed orders without a matching paid
-- receipt and posted charge. The existing visibility policy still enforces
-- account, course and creator restrictions. Revocation never grants access.
create function live_finance.entitlement_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and exists(select 1 from live_finance.order_terms where order_id=old.order_id) then
  if (new.order_id,new.buyer_id,new.content_id,new.granted_at,new.expires_at) is distinct from (old.order_id,old.buyer_id,old.content_id,old.granted_at,old.expires_at) then
   raise exception 'IMMUTABLE_ENTITLEMENT' using errcode='23514';
  end if;
 end if;
 if new.state='active' and exists(select 1 from live_finance.order_terms where order_id=new.order_id)
 and not exists(select 1 from public.orders o join live_finance.receipts r on r.order_id=o.id and not r.duplicate
 join live_finance.journal j on j.transaction_id=r.transaction_id and j.order_id=o.id and j.kind='charge'
 where o.id=new.order_id and o.buyer_id=new.buyer_id and o.content_id=new.content_id and o.status='paid'
 and o.amount_kobo=r.amount_kobo and j.amount_kobo=o.amount_kobo
 and new.expires_at=o.paid_at+make_interval(secs=>(select license_seconds from live_finance.order_terms where order_id=o.id))
 and not exists(select 1 from live_finance.reversals v where v.transaction_id=r.transaction_id)) then
  raise exception 'VERIFIED_JOURNAL_REQUIRED' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function live_finance.entitlement_guard() from public,anon,authenticated;
create trigger live_entitlement_guard before insert or update on public.entitlements for each row execute function live_finance.entitlement_guard();

-- The caller derives buyer and email from trusted current Auth, not request JSON.
-- A buyer-wide advisory lock serializes checkout creation across different request keys.
create function public.live_create_order(p_buyer uuid,p_email text,p_content uuid,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; l public.listings%rowtype; ref text; policy live_finance.runtime_gate%rowtype; fee bigint;
begin
 if p_buyer is null or p_content is null or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 or p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
  raise exception 'INVALID_ORDER_REQUEST' using errcode='22023';
 end if;
 select * into policy from live_finance.runtime_gate where singleton and allow_checkout for share;
 if not found then raise exception 'LIVE_CHECKOUT_DISABLED' using errcode='42501'; end if;
 if not exists(select 1 from auth.users u where u.id=p_buyer and u.email_confirmed_at is not null and lower(trim(u.email))=lower(trim(p_email))) then raise exception 'NOT_ELIGIBLE' using errcode='42501';end if;
 if not public.affiliation_eligible(p_buyer) then raise exception 'NOT_ELIGIBLE' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('live:buyer:'||p_buyer::text,0));
 select * into o from public.orders where buyer_id=p_buyer and idempotency_key=p_key;
 if found and o.content_id<>p_content then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
 if not found then select * into o from public.orders where buyer_id=p_buyer and content_id=p_content order by created_at,id limit 1; end if;
 if o.id is not null then
  if not exists(select 1 from live_finance.order_terms where order_id=o.id and buyer_email=lower(trim(p_email))) then
   raise exception 'EXISTING_ORDER_REVIEW_REQUIRED' using errcode='23514';
  end if;
  select reference into strict ref from public.payment_attempts where order_id=o.id and provider='paystack';
  return jsonb_build_object('order_id',o.id,'reference',ref,'amount_kobo',o.amount_kobo,'currency',o.currency,'status',o.status,'replayed',true);
 end if;
 select x.* into l from public.listings x join public.content_items c on c.id=x.content_id
 join public.courses co on co.id=c.course_id join public.institutions i on i.id=c.institution_id
 where x.content_id=p_content and x.state='active' and c.status='published' and co.active and i.active
 and x.creator_id<>p_buyer and public.affiliation_eligible(x.creator_id)
 and not exists(select 1 from public.creator_restrictions r where r.creator_id=x.creator_id and r.viewer_id=p_buyer and r.deny_view)
 and x.price_kobo between 20000 and 9007199254740991;
 if not found then raise exception 'CHECKOUT_UNAVAILABLE' using errcode='42501'; end if;
 insert into public.orders(buyer_id,listing_id,content_id,creator_id,idempotency_key,amount_kobo,currency,platform_fee_bps,platform_fee_kobo,creator_gross_share_kobo,environment,status)
 values(p_buyer,l.id,l.content_id,l.creator_id,p_key,l.price_kobo,'NGN',policy.platform_fee_bps,round(l.price_kobo::numeric*policy.platform_fee_bps/10000)::bigint,l.price_kobo-round(l.price_kobo::numeric*policy.platform_fee_bps/10000)::bigint,'live','pending') returning * into o;
 insert into live_finance.order_terms(order_id,buyer_email,terms_version,refund_policy_version,platform_fee_bps,fee_bearer,license_seconds) values(o.id,lower(trim(p_email)),policy.terms_version,policy.refund_policy_version,policy.platform_fee_bps,policy.fee_bearer,policy.license_seconds);
 ref:='lc_'||replace(gen_random_uuid()::text,'-','');
 insert into public.payment_attempts(order_id,provider,reference,status) values(o.id,'paystack',ref,'created');
 insert into public.audit_events(actor_id,action,target_kind,target_id) values(p_buyer,'live.order.created','order',o.id);
 return jsonb_build_object('order_id',o.id,'reference',ref,'amount_kobo',o.amount_kobo,'currency','NGN','status','pending','replayed',false);
end $$;

-- Apply a VERIFIED successful provider response, never webhook or redirect data alone.
-- All charge / duplicate / fee / reversal movements, entitlement and audit commit together.
-- Late verified charges after a reversal are recorded but never reactivate access.
create function public.live_apply_charge(p_ref text,p_tx text,p_amount bigint,p_currency text,p_domain text,p_email text,p_fee bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; t live_finance.order_terms%rowtype; r live_finance.receipts%rowtype; rev live_finance.reversals%rowtype; dupe boolean;
begin
 if p_ref is null or p_tx is null or p_tx !~ '^[A-Za-z0-9_-]{1,128}$' or p_amount is null
 or p_currency is distinct from 'NGN' or p_domain is distinct from 'live' or p_email is null
 or (p_fee is not null and (p_fee<0 or p_fee>p_amount)) then raise exception 'INVALID_VERIFICATION' using errcode='22023'; end if;
 -- Serialize provider identity across DIFFERENT orders as well as callbacks for one order.
 perform pg_advisory_xact_lock(hashtextextended('live:tx:'||p_tx,0));
 -- Same order lock used by reversal, including early reversal before charge.
 select x.* into o from public.orders x join public.payment_attempts a on a.order_id=x.id
 where a.provider='paystack' and a.reference=p_ref for update of x;
 if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 select * into t from live_finance.order_terms where order_id=o.id;
 if not found or o.environment<>'live' or o.currency<>'NGN' or o.platform_fee_bps<>t.platform_fee_bps or o.platform_fee_kobo<>round(o.amount_kobo::numeric*t.platform_fee_bps/10000)::bigint
 or o.amount_kobo is distinct from p_amount or t.buyer_email is distinct from lower(trim(p_email)) then raise exception 'PAYMENT_MISMATCH' using errcode='23514'; end if;
 select * into r from live_finance.receipts where transaction_id=p_tx;
 if found then
  if r.order_id<>o.id or r.reference<>p_ref or r.amount_kobo<>p_amount or r.fee_kobo is distinct from p_fee then raise exception 'PAYMENT_REPLAY_CONFLICT' using errcode='23514'; end if;
  return jsonb_build_object('status',o.status,'replayed',true,'duplicate',r.duplicate);
 end if;
 select * into rev from live_finance.reversals where transaction_id=p_tx;
 if found and (rev.order_id<>o.id or rev.reference<>p_ref or rev.amount_kobo<>p_amount) then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 dupe:=exists(select 1 from live_finance.receipts where order_id=o.id and not duplicate);
 -- A verified charge on a canceled/expired/failed order must be reconciled separately;
 -- never silently grant access against a closed or disputed order.
 if not dupe and o.status not in ('created','pending','verification_pending','refunded','chargeback') then raise exception 'ORDER_REVIEW_REQUIRED' using errcode='23514'; end if;
 if not dupe and o.status in ('refunded','chargeback') and rev.transaction_id is null then raise exception 'ORDER_REVIEW_REQUIRED' using errcode='23514'; end if;
 insert into live_finance.receipts(transaction_id,order_id,reference,amount_kobo,fee_kobo,duplicate) values(p_tx,o.id,p_ref,p_amount,p_fee,dupe);
 insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
 values('charge:'||p_tx,p_tx,o.id,case when dupe then 'duplicate_charge' else 'charge' end,'processor_clearing',case when dupe then 'duplicate_liability' else 'gross_pending' end,p_amount);
 if not dupe then
  if o.creator_gross_share_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('creator:'||p_tx,p_tx,o.id,'creator_allocation','gross_pending','creator_pending',o.creator_gross_share_kobo); end if;
  if o.platform_fee_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('platform:'||p_tx,p_tx,o.id,'platform_allocation','gross_pending','platform_pending',o.platform_fee_kobo); end if;
 end if;
 if p_fee>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
 values('fee:'||p_tx,p_tx,o.id,'provider_fee',case when dupe then 'duplicate_liability' when t.fee_bearer='creator' then 'creator_pending' else 'platform_pending' end,'processor_clearing',p_fee); end if;
 if rev.transaction_id is not null then
  insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
  values('reverse:'||p_tx,p_tx,o.id,case when dupe then 'duplicate_reversal' else 'reversal' end,case when dupe then 'duplicate_liability' else 'gross_pending' end,'processor_clearing',p_amount);
  if not dupe then
  if o.creator_gross_share_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('reverse-creator:'||p_tx,p_tx,o.id,'creator_allocation_reversal','creator_pending','gross_pending',o.creator_gross_share_kobo);end if;
  if o.platform_fee_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('reverse-platform:'||p_tx,p_tx,o.id,'platform_allocation_reversal','platform_pending','gross_pending',o.platform_fee_kobo);end if;
 end if;
 end if;
 if not dupe then
  update public.payment_attempts set provider_transaction_id=p_tx,status=case when rev.transaction_id is null then 'success' else 'reversed' end where order_id=o.id and provider='paystack' and reference=p_ref;
  update public.orders set status=case when rev.transaction_id is null then 'paid' when rev.kind='refund' then 'refunded' else 'chargeback' end,paid_at=coalesce(paid_at,now()),updated_at=now() where id=o.id returning * into o;
  insert into public.entitlements(buyer_id,content_id,order_id,state,expires_at) values(o.buyer_id,o.content_id,o.id,case when rev.transaction_id is null then 'active' else 'revoked' end,o.paid_at+make_interval(secs=>t.license_seconds));
 end if;
 insert into public.audit_events(actor_id,action,target_kind,target_id,correlation_id) values(null,case when dupe then 'live.duplicate_charge.recorded' else 'live.verified_charge.recorded' end,'order',o.id,p_tx);
 return jsonb_build_object('status',o.status,'replayed',false,'duplicate',dupe);
end $$;

-- Only independently verified FULL reversal evidence is accepted. Partial refunds,
-- commercial refund policy and dispute resolutions are separate approval work.
create function public.live_record_reversal(p_ref text,p_tx text,p_event text,p_kind text,p_amount bigint,p_currency text,p_domain text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; r live_finance.receipts%rowtype; existing live_finance.reversals%rowtype;
begin
 if p_ref is null or p_tx is null or p_tx !~ '^[A-Za-z0-9_-]{1,128}$' or p_event is null or length(p_event) not between 8 and 200
 or p_kind is null or p_kind not in ('refund','chargeback') or p_amount is null or p_currency is distinct from 'NGN' or p_domain is distinct from 'live' then raise exception 'INVALID_REVERSAL' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('live:tx:'||p_tx,0));
 select x.* into o from public.orders x join public.payment_attempts a on a.order_id=x.id where a.reference=p_ref and a.provider='paystack' for update of x;
 if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 if not exists(select 1 from live_finance.order_terms where order_id=o.id) or o.environment<>'live' or o.amount_kobo is distinct from p_amount then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 select * into existing from live_finance.reversals where transaction_id=p_tx;
 if found then
  if existing.order_id<>o.id or existing.reference<>p_ref or existing.amount_kobo<>p_amount or existing.kind<>p_kind then raise exception 'REVERSAL_REVIEW_REQUIRED' using errcode='23514'; end if;
  return jsonb_build_object('status',o.status,'replayed',true);
 end if;
 select * into r from live_finance.receipts where transaction_id=p_tx;
 if found and (r.order_id<>o.id or r.reference<>p_ref or r.amount_kobo<>p_amount) then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 insert into live_finance.reversals(transaction_id,event_key,order_id,reference,amount_kobo,kind) values(p_tx,p_event,o.id,p_ref,p_amount,p_kind);
 if r.transaction_id is not null then
  insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
  values('reverse:'||p_tx,p_tx,o.id,case when r.duplicate then 'duplicate_reversal' else 'reversal' end,case when r.duplicate then 'duplicate_liability' else 'gross_pending' end,'processor_clearing',p_amount);
  if not r.duplicate then
  if o.creator_gross_share_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('reverse-creator:'||p_tx,p_tx,o.id,'creator_allocation_reversal','creator_pending','gross_pending',o.creator_gross_share_kobo);end if;
  if o.platform_fee_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('reverse-platform:'||p_tx,p_tx,o.id,'platform_allocation_reversal','platform_pending','gross_pending',o.platform_fee_kobo);end if;
 end if;
  if not r.duplicate then
   update public.orders set status=case when p_kind='refund' then 'refunded' else 'chargeback' end,updated_at=now() where id=o.id returning * into o;
   update public.entitlements set state='revoked' where order_id=o.id;
   update public.payment_attempts set status='reversed' where order_id=o.id and provider_transaction_id=p_tx;
  end if;
 end if;
 insert into public.audit_events(actor_id,action,target_kind,target_id,correlation_id) values(null,'live.verified_reversal.recorded','order',o.id,p_event);
 return jsonb_build_object('status',o.status,'replayed',false,'awaiting_charge',r.transaction_id is null);
end $$;

-- Restrict staged RPCs to backend service role; no browser payment mutations.
revoke all on function public.live_create_order(uuid,text,uuid,text),public.live_apply_charge(text,text,bigint,text,text,text,bigint),public.live_record_reversal(text,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.live_create_order(uuid,text,uuid,text),public.live_apply_charge(text,text,bigint,text,text,text,bigint),public.live_record_reversal(text,text,text,text,bigint,text,text) to service_role;
grant select on public.listings,public.content_items,public.courses to service_role;
revoke insert,update,delete on public.orders,public.payment_attempts,public.entitlements from service_role;
grant insert on public.audit_events to service_role;

CREATE OR REPLACE FUNCTION public.can_view_published_content(_content_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.content_items c JOIN public.courses co ON co.id=c.course_id JOIN public.institutions i ON i.id=c.institution_id
 WHERE c.id=_content_id AND c.status='published' AND co.active AND i.active AND public.creator_can_view_published(c.creator_id)
 AND (c.creator_id=(SELECT auth.uid()) OR NOT EXISTS(SELECT 1 FROM public.listings l WHERE l.content_id=c.id)
 OR EXISTS(SELECT 1 FROM public.entitlements e JOIN public.orders o ON o.id=e.order_id
 WHERE e.content_id=c.id AND e.buyer_id=(SELECT auth.uid()) AND e.state='active' AND e.expires_at>now()
 AND o.status='paid' AND o.content_id=c.id AND o.buyer_id=e.buyer_id AND o.currency='NGN' AND o.environment='live')));
$$;
REVOKE ALL ON FUNCTION public.can_view_published_content(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_published_content(uuid) TO authenticated,service_role;
),
 refund_policy_version text check(length(refund_policy_version) between 3 and 128),
 platform_fee_bps integer check(platform_fee_bps between 0 and 10000),
 fee_bearer text check(fee_bearer in ('creator','platform')),
 license_seconds integer check(license_seconds between 60 and 315360000),
 approved_at timestamptz,
 check(not allow_checkout or (terms_version is not null and refund_policy_version is not null and platform_fee_bps is not null and fee_bearer is not null and license_seconds is not null and approved_at is not null))
);
insert into live_finance.runtime_gate(singleton) values(true);
alter table live_finance.runtime_gate enable row level security;

create table live_finance.order_terms (
 order_id uuid primary key references public.orders(id),
 buyer_email text not null check(length(buyer_email) between 3 and 254),
 terms_version text not null check(length(terms_version) between 3 and 128),
 refund_policy_version text not null check(length(refund_policy_version) between 3 and 128),
 platform_fee_bps integer not null check(platform_fee_bps between 0 and 10000),
 fee_bearer text not null check(fee_bearer in ('creator','platform')),
 license_seconds integer not null check(license_seconds between 60 and 315360000),
 created_at timestamptz not null default now()
);
create table live_finance.receipts (
 transaction_id text primary key check(transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 order_id uuid not null references live_finance.order_terms(order_id),
 reference text not null,
 amount_kobo bigint not null check(amount_kobo between 20000 and 9007199254740991),
 fee_kobo bigint check(fee_kobo between 0 and amount_kobo),
 duplicate boolean not null,
 received_at timestamptz not null default now(),
 unique(transaction_id,order_id)
);
create unique index live_one_primary_receipt on live_finance.receipts(order_id) where not duplicate;
create table live_finance.reversals (
 transaction_id text primary key check(transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 event_key text not null unique check(length(event_key) between 8 and 200),
 order_id uuid not null references live_finance.order_terms(order_id),
 reference text not null,
 amount_kobo bigint not null check(amount_kobo between 20000 and 9007199254740991),
 kind text not null check(kind in ('refund','chargeback')),
 received_at timestamptz not null default now()
);
-- Each row is one balanced debit/credit pair. The amount applies to both sides.
-- This is the canonical journal for NEW staged orders; never sum legacy ledger_entries.
create table live_finance.journal (
 event_key text primary key,
 transaction_id text not null references live_finance.receipts(transaction_id),
 order_id uuid not null references live_finance.order_terms(order_id),
 kind text not null check(kind in ('charge','duplicate_charge','provider_fee','reversal','duplicate_reversal','creator_allocation','platform_allocation','creator_allocation_reversal','platform_allocation_reversal')),
 debit_account text not null,
 credit_account text not null,
 amount_kobo bigint not null check(amount_kobo between 1 and 9007199254740991),
 currency text not null default 'NGN' check(currency='NGN'),
 created_at timestamptz not null default now(),
 unique(transaction_id,kind),
 foreign key(transaction_id,order_id) references live_finance.receipts(transaction_id,order_id),
 check((kind='charge' and debit_account='processor_clearing' and credit_account='gross_pending')
 or (kind='duplicate_charge' and debit_account='processor_clearing' and credit_account='duplicate_liability')
 or (kind='provider_fee' and debit_account in ('creator_pending','platform_pending','duplicate_liability') and credit_account='processor_clearing')
 or (kind='reversal' and debit_account='gross_pending' and credit_account='processor_clearing')
 or (kind='duplicate_reversal' and debit_account='duplicate_liability' and credit_account='processor_clearing')
 or (kind='creator_allocation' and debit_account='gross_pending' and credit_account='creator_pending')
 or (kind='platform_allocation' and debit_account='gross_pending' and credit_account='platform_pending')
 or (kind='creator_allocation_reversal' and debit_account='creator_pending' and credit_account='gross_pending')
 or (kind='platform_allocation_reversal' and debit_account='platform_pending' and credit_account='gross_pending'))
);
alter table live_finance.order_terms enable row level security;
alter table live_finance.receipts enable row level security;
alter table live_finance.reversals enable row level security;
alter table live_finance.journal enable row level security;
revoke all on all tables in schema live_finance from public,anon,authenticated,service_role;
-- Direct financial writes forbidden; backend uses service-only RPCs.
grant select on live_finance.runtime_gate to service_role;

create function live_finance.deny_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'APPEND_ONLY' using errcode='23514'; end $$;
revoke all on function live_finance.deny_mutation() from public,anon,authenticated;
create trigger terms_append_only before update or delete on live_finance.order_terms for each row execute function live_finance.deny_mutation();
create trigger receipts_append_only before update or delete on live_finance.receipts for each row execute function live_finance.deny_mutation();
create trigger reversals_append_only before update or delete on live_finance.reversals for each row execute function live_finance.deny_mutation();
create trigger journal_append_only before update or delete on live_finance.journal for each row execute function live_finance.deny_mutation();

-- Protect only orders created under this contract. Existing legacy rows are not migrated.
create function live_finance.immutable_terms() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from live_finance.order_terms where order_id=old.id) then
  if tg_op='DELETE' then raise exception 'IMMUTABLE_ORDER' using errcode='23514'; end if;
  if (to_jsonb(new)-array['status','paid_at','updated_at']) is distinct from
     (to_jsonb(old)-array['status','paid_at','updated_at']) then
   raise exception 'IMMUTABLE_ORDER' using errcode='23514';
  end if;
  if old.status in ('refunded','chargeback') and new.status is distinct from old.status then
   raise exception 'TERMINAL_ORDER' using errcode='23514';
  end if;
  if new.status='paid' and not exists(select 1 from live_finance.receipts r join live_finance.journal j on j.transaction_id=r.transaction_id and j.order_id=r.order_id and j.kind='charge' where r.order_id=old.id and not r.duplicate and r.amount_kobo=new.amount_kobo and j.amount_kobo=new.amount_kobo and not exists(select 1 from live_finance.reversals v where v.transaction_id=r.transaction_id)) then
   raise exception 'VERIFIED_JOURNAL_REQUIRED' using errcode='23514';
  end if;
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then
   raise exception 'IMMUTABLE_PAID_AT' using errcode='23514';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function live_finance.immutable_terms() from public,anon,authenticated;
create trigger live_order_snapshot before update or delete on public.orders for each row execute function live_finance.immutable_terms();

-- Block a direct active entitlement for managed orders without a matching paid
-- receipt and posted charge. The existing visibility policy still enforces
-- account, course and creator restrictions. Revocation never grants access.
create function live_finance.entitlement_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and exists(select 1 from live_finance.order_terms where order_id=old.order_id) then
  if (new.order_id,new.buyer_id,new.content_id,new.granted_at,new.expires_at) is distinct from (old.order_id,old.buyer_id,old.content_id,old.granted_at,old.expires_at) then
   raise exception 'IMMUTABLE_ENTITLEMENT' using errcode='23514';
  end if;
 end if;
 if new.state='active' and exists(select 1 from live_finance.order_terms where order_id=new.order_id)
 and not exists(select 1 from public.orders o join live_finance.receipts r on r.order_id=o.id and not r.duplicate
 join live_finance.journal j on j.transaction_id=r.transaction_id and j.order_id=o.id and j.kind='charge'
 where o.id=new.order_id and o.buyer_id=new.buyer_id and o.content_id=new.content_id and o.status='paid'
 and o.amount_kobo=r.amount_kobo and j.amount_kobo=o.amount_kobo
 and new.expires_at=o.paid_at+make_interval(secs=>(select license_seconds from live_finance.order_terms where order_id=o.id))
 and not exists(select 1 from live_finance.reversals v where v.transaction_id=r.transaction_id)) then
  raise exception 'VERIFIED_JOURNAL_REQUIRED' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function live_finance.entitlement_guard() from public,anon,authenticated;
create trigger live_entitlement_guard before insert or update on public.entitlements for each row execute function live_finance.entitlement_guard();

-- The caller derives buyer and email from trusted current Auth, not request JSON.
-- A buyer-wide advisory lock serializes checkout creation across different request keys.
create function public.live_create_order(p_buyer uuid,p_email text,p_content uuid,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; l public.listings%rowtype; ref text; policy live_finance.runtime_gate%rowtype; fee bigint;
begin
 if p_buyer is null or p_content is null or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 or p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
  raise exception 'INVALID_ORDER_REQUEST' using errcode='22023';
 end if;
 select * into policy from live_finance.runtime_gate where singleton and allow_checkout for share;
 if not found then raise exception 'LIVE_CHECKOUT_DISABLED' using errcode='42501'; end if;
 if not exists(select 1 from auth.users u where u.id=p_buyer and u.email_confirmed_at is not null and lower(trim(u.email))=lower(trim(p_email))) then raise exception 'NOT_ELIGIBLE' using errcode='42501';end if;
 if not public.affiliation_eligible(p_buyer) then raise exception 'NOT_ELIGIBLE' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('live:buyer:'||p_buyer::text,0));
 select * into o from public.orders where buyer_id=p_buyer and idempotency_key=p_key;
 if found and o.content_id<>p_content then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
 if not found then select * into o from public.orders where buyer_id=p_buyer and content_id=p_content order by created_at,id limit 1; end if;
 if o.id is not null then
  if not exists(select 1 from live_finance.order_terms where order_id=o.id and buyer_email=lower(trim(p_email))) then
   raise exception 'EXISTING_ORDER_REVIEW_REQUIRED' using errcode='23514';
  end if;
  select reference into strict ref from public.payment_attempts where order_id=o.id and provider='paystack';
  return jsonb_build_object('order_id',o.id,'reference',ref,'amount_kobo',o.amount_kobo,'currency',o.currency,'status',o.status,'replayed',true);
 end if;
 select x.* into l from public.listings x join public.content_items c on c.id=x.content_id
 join public.courses co on co.id=c.course_id
 where x.content_id=p_content and x.state='active' and c.status='published' and co.active
 and x.creator_id<>p_buyer and public.affiliation_eligible(x.creator_id)
 and not exists(select 1 from public.creator_restrictions r where r.creator_id=x.creator_id and r.viewer_id=p_buyer and r.deny_view)
 and x.price_kobo between 20000 and 9007199254740991;
 if not found then raise exception 'CHECKOUT_UNAVAILABLE' using errcode='42501'; end if;
 insert into public.orders(buyer_id,listing_id,content_id,creator_id,idempotency_key,amount_kobo,currency,platform_fee_bps,platform_fee_kobo,creator_gross_share_kobo,environment,status)
 values(p_buyer,l.id,l.content_id,l.creator_id,p_key,l.price_kobo,'NGN',policy.platform_fee_bps,round(l.price_kobo::numeric*policy.platform_fee_bps/10000)::bigint,l.price_kobo-round(l.price_kobo::numeric*policy.platform_fee_bps/10000)::bigint,'live','pending') returning * into o;
 insert into live_finance.order_terms(order_id,buyer_email,terms_version,refund_policy_version,platform_fee_bps,fee_bearer,license_seconds) values(o.id,lower(trim(p_email)),policy.terms_version,policy.refund_policy_version,policy.platform_fee_bps,policy.fee_bearer,policy.license_seconds);
 ref:='lc_'||replace(gen_random_uuid()::text,'-','');
 insert into public.payment_attempts(order_id,provider,reference,status) values(o.id,'paystack',ref,'created');
 insert into public.audit_events(actor_id,action,target_kind,target_id) values(p_buyer,'live.order.created','order',o.id);
 return jsonb_build_object('order_id',o.id,'reference',ref,'amount_kobo',o.amount_kobo,'currency','NGN','status','pending','replayed',false);
end $$;

-- Apply a VERIFIED successful provider response, never webhook or redirect data alone.
-- All charge / duplicate / fee / reversal movements, entitlement and audit commit together.
-- Late verified charges after a reversal are recorded but never reactivate access.
create function public.live_apply_charge(p_ref text,p_tx text,p_amount bigint,p_currency text,p_domain text,p_email text,p_fee bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; t live_finance.order_terms%rowtype; r live_finance.receipts%rowtype; rev live_finance.reversals%rowtype; dupe boolean;
begin
 if p_ref is null or p_tx is null or p_tx !~ '^[A-Za-z0-9_-]{1,128}$' or p_amount is null
 or p_currency is distinct from 'NGN' or p_domain is distinct from 'live' or p_email is null
 or (p_fee is not null and (p_fee<0 or p_fee>p_amount)) then raise exception 'INVALID_VERIFICATION' using errcode='22023'; end if;
 -- Serialize provider identity across DIFFERENT orders as well as callbacks for one order.
 perform pg_advisory_xact_lock(hashtextextended('live:tx:'||p_tx,0));
 -- Same order lock used by reversal, including early reversal before charge.
 select x.* into o from public.orders x join public.payment_attempts a on a.order_id=x.id
 where a.provider='paystack' and a.reference=p_ref for update of x;
 if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 select * into t from live_finance.order_terms where order_id=o.id;
 if not found or o.environment<>'live' or o.currency<>'NGN' or o.platform_fee_bps<>t.platform_fee_bps or o.platform_fee_kobo<>round(o.amount_kobo::numeric*t.platform_fee_bps/10000)::bigint
 or o.amount_kobo is distinct from p_amount or t.buyer_email is distinct from lower(trim(p_email)) then raise exception 'PAYMENT_MISMATCH' using errcode='23514'; end if;
 select * into r from live_finance.receipts where transaction_id=p_tx;
 if found then
  if r.order_id<>o.id or r.reference<>p_ref or r.amount_kobo<>p_amount or r.fee_kobo is distinct from p_fee then raise exception 'PAYMENT_REPLAY_CONFLICT' using errcode='23514'; end if;
  return jsonb_build_object('status',o.status,'replayed',true,'duplicate',r.duplicate);
 end if;
 select * into rev from live_finance.reversals where transaction_id=p_tx;
 if found and (rev.order_id<>o.id or rev.reference<>p_ref or rev.amount_kobo<>p_amount) then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 dupe:=exists(select 1 from live_finance.receipts where order_id=o.id and not duplicate);
 -- A verified charge on a canceled/expired/failed order must be reconciled separately;
 -- never silently grant access against a closed or disputed order.
 if not dupe and o.status not in ('created','pending','verification_pending','refunded','chargeback') then raise exception 'ORDER_REVIEW_REQUIRED' using errcode='23514'; end if;
 if not dupe and o.status in ('refunded','chargeback') and rev.transaction_id is null then raise exception 'ORDER_REVIEW_REQUIRED' using errcode='23514'; end if;
 insert into live_finance.receipts(transaction_id,order_id,reference,amount_kobo,fee_kobo,duplicate) values(p_tx,o.id,p_ref,p_amount,p_fee,dupe);
 insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
 values('charge:'||p_tx,p_tx,o.id,case when dupe then 'duplicate_charge' else 'charge' end,'processor_clearing',case when dupe then 'duplicate_liability' else 'gross_pending' end,p_amount);
 if not dupe then
  if o.creator_gross_share_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('creator:'||p_tx,p_tx,o.id,'creator_allocation','gross_pending','creator_pending',o.creator_gross_share_kobo); end if;
  if o.platform_fee_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('platform:'||p_tx,p_tx,o.id,'platform_allocation','gross_pending','platform_pending',o.platform_fee_kobo); end if;
 end if;
 if p_fee>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
 values('fee:'||p_tx,p_tx,o.id,'provider_fee',case when dupe then 'duplicate_liability' when t.fee_bearer='creator' then 'creator_pending' else 'platform_pending' end,'processor_clearing',p_fee); end if;
 if rev.transaction_id is not null then
  insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
  values('reverse:'||p_tx,p_tx,o.id,case when dupe then 'duplicate_reversal' else 'reversal' end,case when dupe then 'duplicate_liability' else 'gross_pending' end,'processor_clearing',p_amount);
  if not dupe then
  if o.creator_gross_share_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('reverse-creator:'||p_tx,p_tx,o.id,'creator_allocation_reversal','creator_pending','gross_pending',o.creator_gross_share_kobo);end if;
  if o.platform_fee_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('reverse-platform:'||p_tx,p_tx,o.id,'platform_allocation_reversal','platform_pending','gross_pending',o.platform_fee_kobo);end if;
 end if;
 end if;
 if not dupe then
  update public.payment_attempts set provider_transaction_id=p_tx,status=case when rev.transaction_id is null then 'success' else 'reversed' end where order_id=o.id and provider='paystack' and reference=p_ref;
  update public.orders set status=case when rev.transaction_id is null then 'paid' when rev.kind='refund' then 'refunded' else 'chargeback' end,paid_at=coalesce(paid_at,now()),updated_at=now() where id=o.id returning * into o;
  insert into public.entitlements(buyer_id,content_id,order_id,state,expires_at) values(o.buyer_id,o.content_id,o.id,case when rev.transaction_id is null then 'active' else 'revoked' end,o.paid_at+make_interval(secs=>t.license_seconds));
 end if;
 insert into public.audit_events(actor_id,action,target_kind,target_id,correlation_id) values(null,case when dupe then 'live.duplicate_charge.recorded' else 'live.verified_charge.recorded' end,'order',o.id,p_tx);
 return jsonb_build_object('status',o.status,'replayed',false,'duplicate',dupe);
end $$;

-- Only independently verified FULL reversal evidence is accepted. Partial refunds,
-- commercial refund policy and dispute resolutions are separate approval work.
create function public.live_record_reversal(p_ref text,p_tx text,p_event text,p_kind text,p_amount bigint,p_currency text,p_domain text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; r live_finance.receipts%rowtype; existing live_finance.reversals%rowtype;
begin
 if p_ref is null or p_tx is null or p_tx !~ '^[A-Za-z0-9_-]{1,128}$' or p_event is null or length(p_event) not between 8 and 200
 or p_kind is null or p_kind not in ('refund','chargeback') or p_amount is null or p_currency is distinct from 'NGN' or p_domain is distinct from 'live' then raise exception 'INVALID_REVERSAL' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('live:tx:'||p_tx,0));
 select x.* into o from public.orders x join public.payment_attempts a on a.order_id=x.id where a.reference=p_ref and a.provider='paystack' for update of x;
 if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 if not exists(select 1 from live_finance.order_terms where order_id=o.id) or o.environment<>'live' or o.amount_kobo is distinct from p_amount then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 select * into existing from live_finance.reversals where transaction_id=p_tx;
 if found then
  if existing.order_id<>o.id or existing.reference<>p_ref or existing.amount_kobo<>p_amount or existing.kind<>p_kind then raise exception 'REVERSAL_REVIEW_REQUIRED' using errcode='23514'; end if;
  return jsonb_build_object('status',o.status,'replayed',true);
 end if;
 select * into r from live_finance.receipts where transaction_id=p_tx;
 if found and (r.order_id<>o.id or r.reference<>p_ref or r.amount_kobo<>p_amount) then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 insert into live_finance.reversals(transaction_id,event_key,order_id,reference,amount_kobo,kind) values(p_tx,p_event,o.id,p_ref,p_amount,p_kind);
 if r.transaction_id is not null then
  insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
  values('reverse:'||p_tx,p_tx,o.id,case when r.duplicate then 'duplicate_reversal' else 'reversal' end,case when r.duplicate then 'duplicate_liability' else 'gross_pending' end,'processor_clearing',p_amount);
  if not r.duplicate then
  if o.creator_gross_share_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('reverse-creator:'||p_tx,p_tx,o.id,'creator_allocation_reversal','creator_pending','gross_pending',o.creator_gross_share_kobo);end if;
  if o.platform_fee_kobo>0 then insert into live_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) values('reverse-platform:'||p_tx,p_tx,o.id,'platform_allocation_reversal','platform_pending','gross_pending',o.platform_fee_kobo);end if;
 end if;
  if not r.duplicate then
   update public.orders set status=case when p_kind='refund' then 'refunded' else 'chargeback' end,updated_at=now() where id=o.id returning * into o;
   update public.entitlements set state='revoked' where order_id=o.id;
   update public.payment_attempts set status='reversed' where order_id=o.id and provider_transaction_id=p_tx;
  end if;
 end if;
 insert into public.audit_events(actor_id,action,target_kind,target_id,correlation_id) values(null,'live.verified_reversal.recorded','order',o.id,p_event);
 return jsonb_build_object('status',o.status,'replayed',false,'awaiting_charge',r.transaction_id is null);
end $$;

-- Restrict staged RPCs to backend service role; no browser payment mutations.
revoke all on function public.live_create_order(uuid,text,uuid,text),public.live_apply_charge(text,text,bigint,text,text,text,bigint),public.live_record_reversal(text,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.live_create_order(uuid,text,uuid,text),public.live_apply_charge(text,text,bigint,text,text,text,bigint),public.live_record_reversal(text,text,text,text,bigint,text,text) to service_role;
grant select on public.listings,public.content_items,public.courses to service_role;
revoke insert,update,delete on public.orders,public.payment_attempts,public.entitlements from service_role;
grant insert on public.audit_events to service_role;

CREATE OR REPLACE FUNCTION public.can_view_published_content(_content_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.content_items c JOIN public.courses co ON co.id=c.course_id JOIN public.institutions i ON i.id=c.institution_id
 WHERE c.id=_content_id AND c.status='published' AND co.active AND i.active AND public.creator_can_view_published(c.creator_id)
 AND (c.creator_id=(SELECT auth.uid()) OR NOT EXISTS(SELECT 1 FROM public.listings l WHERE l.content_id=c.id)
 OR EXISTS(SELECT 1 FROM public.entitlements e JOIN public.orders o ON o.id=e.order_id
 WHERE e.content_id=c.id AND e.buyer_id=(SELECT auth.uid()) AND e.state='active' AND e.expires_at>now()
 AND o.status='paid' AND o.content_id=c.id AND o.buyer_id=e.buyer_id AND o.currency='NGN' AND o.environment='live')));
$$;
REVOKE ALL ON FUNCTION public.can_view_published_content(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_published_content(uuid) TO authenticated,service_role;
