-- Week 5 staged contract. Requires 0001–0006. NOT a deployed payment route.
-- Only trusted server calls these functions after Auth / Paystack verification.
-- Sandbox only; no settlement, transfer, commission or commercial terms approved.
-- Keep existing local SQLite and hosted tables. Legacy orders remain untouched.
create schema week05_finance;
revoke all on schema week05_finance from public,anon,authenticated;
grant usage on schema week05_finance to service_role;

-- Explicit database-owner approval required even for NEW test orders. Never enable
-- on a live project; existing paid-access policies do not separate test licenses.
create table week05_finance.runtime_gate (singleton boolean primary key check(singleton), allow_test_checkout boolean not null default false);
insert into week05_finance.runtime_gate(singleton) values(true);
alter table week05_finance.runtime_gate enable row level security;

create table week05_finance.order_terms (
 order_id uuid primary key references public.orders(id),
 buyer_email text not null check(length(buyer_email) between 3 and 254),
 terms_version text not null check(terms_version='synthetic-v1'),
 created_at timestamptz not null default now()
);
create table week05_finance.receipts (
 transaction_id text primary key check(transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 order_id uuid not null references week05_finance.order_terms(order_id),
 reference text not null,
 amount_kobo bigint not null check(amount_kobo between 20000 and 9007199254740991),
 fee_kobo bigint check(fee_kobo between 0 and amount_kobo),
 duplicate boolean not null,
 received_at timestamptz not null default now(),
 unique(transaction_id,order_id)
);
create unique index week05_one_primary_receipt on week05_finance.receipts(order_id) where not duplicate;
create table week05_finance.reversals (
 transaction_id text primary key check(transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 event_key text not null unique check(length(event_key) between 8 and 200),
 order_id uuid not null references week05_finance.order_terms(order_id),
 reference text not null,
 amount_kobo bigint not null check(amount_kobo between 20000 and 9007199254740991),
 kind text not null check(kind in ('refund','chargeback')),
 received_at timestamptz not null default now()
);
-- Each row is one balanced debit/credit pair. The amount applies to both sides.
-- This is the canonical journal for NEW staged orders; never sum legacy ledger_entries.
create table week05_finance.journal (
 event_key text primary key,
 transaction_id text not null references week05_finance.receipts(transaction_id),
 order_id uuid not null references week05_finance.order_terms(order_id),
 kind text not null check(kind in ('charge','duplicate_charge','provider_fee','reversal','duplicate_reversal')),
 debit_account text not null,
 credit_account text not null,
 amount_kobo bigint not null check(amount_kobo between 1 and 9007199254740991),
 currency text not null default 'NGN' check(currency='NGN'),
 created_at timestamptz not null default now(),
 unique(transaction_id,kind),
 foreign key(transaction_id,order_id) references week05_finance.receipts(transaction_id,order_id),
 check((kind='charge' and debit_account='processor_clearing' and credit_account='creator_pending')
 or (kind='duplicate_charge' and debit_account='processor_clearing' and credit_account='duplicate_liability')
 or (kind='provider_fee' and debit_account='provider_fee_suspense' and credit_account='processor_clearing')
 or (kind='reversal' and debit_account='creator_pending' and credit_account='processor_clearing')
 or (kind='duplicate_reversal' and debit_account='duplicate_liability' and credit_account='processor_clearing'))
);
alter table week05_finance.order_terms enable row level security;
alter table week05_finance.receipts enable row level security;
alter table week05_finance.reversals enable row level security;
alter table week05_finance.journal enable row level security;
revoke all on all tables in schema week05_finance from public,anon,authenticated,service_role;
grant select,insert on week05_finance.order_terms,week05_finance.receipts,week05_finance.reversals,week05_finance.journal to service_role;
grant select on week05_finance.runtime_gate to service_role;

create function week05_finance.deny_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'APPEND_ONLY' using errcode='23514'; end $$;
revoke all on function week05_finance.deny_mutation() from public,anon,authenticated;
create trigger terms_append_only before update or delete on week05_finance.order_terms for each row execute function week05_finance.deny_mutation();
create trigger receipts_append_only before update or delete on week05_finance.receipts for each row execute function week05_finance.deny_mutation();
create trigger reversals_append_only before update or delete on week05_finance.reversals for each row execute function week05_finance.deny_mutation();
create trigger journal_append_only before update or delete on week05_finance.journal for each row execute function week05_finance.deny_mutation();

-- Protect only orders created under this contract. Existing legacy rows are not migrated.
create function week05_finance.immutable_terms() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from week05_finance.order_terms where order_id=old.id) then
  if tg_op='DELETE' then raise exception 'IMMUTABLE_ORDER' using errcode='23514'; end if;
  if (to_jsonb(new)-array['status','paid_at','updated_at']) is distinct from
     (to_jsonb(old)-array['status','paid_at','updated_at']) then
   raise exception 'IMMUTABLE_ORDER' using errcode='23514';
  end if;
  if old.status in ('refunded','chargeback') and new.status is distinct from old.status then
   raise exception 'TERMINAL_ORDER' using errcode='23514';
  end if;
  if new.status='paid' and not exists(select 1 from week05_finance.receipts r join week05_finance.journal j on j.transaction_id=r.transaction_id and j.order_id=r.order_id and j.kind='charge' where r.order_id=old.id and not r.duplicate and r.amount_kobo=new.amount_kobo and j.amount_kobo=new.amount_kobo and not exists(select 1 from week05_finance.reversals v where v.transaction_id=r.transaction_id)) then
   raise exception 'VERIFIED_JOURNAL_REQUIRED' using errcode='23514';
  end if;
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then
   raise exception 'IMMUTABLE_PAID_AT' using errcode='23514';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function week05_finance.immutable_terms() from public,anon,authenticated;
create trigger week05_order_snapshot before update or delete on public.orders for each row execute function week05_finance.immutable_terms();

-- Block a direct active entitlement for managed orders without a matching paid
-- receipt and posted charge. The existing visibility policy still enforces
-- account, course and creator restrictions. Revocation never grants access.
create function week05_finance.entitlement_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and exists(select 1 from week05_finance.order_terms where order_id=old.order_id) then
  if (new.order_id,new.buyer_id,new.content_id,new.granted_at) is distinct from (old.order_id,old.buyer_id,old.content_id,old.granted_at) then
   raise exception 'IMMUTABLE_ENTITLEMENT' using errcode='23514';
  end if;
 end if;
 if new.state='active' and exists(select 1 from week05_finance.order_terms where order_id=new.order_id)
 and not exists(select 1 from public.orders o join week05_finance.receipts r on r.order_id=o.id and not r.duplicate
 join week05_finance.journal j on j.transaction_id=r.transaction_id and j.order_id=o.id and j.kind='charge'
 where o.id=new.order_id and o.buyer_id=new.buyer_id and o.content_id=new.content_id and o.status='paid'
 and o.amount_kobo=r.amount_kobo and j.amount_kobo=o.amount_kobo
 and not exists(select 1 from week05_finance.reversals v where v.transaction_id=r.transaction_id)) then
  raise exception 'VERIFIED_JOURNAL_REQUIRED' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function week05_finance.entitlement_guard() from public,anon,authenticated;
create trigger week05_entitlement_guard before insert or update on public.entitlements for each row execute function week05_finance.entitlement_guard();

-- The caller derives buyer and email from trusted current Auth, not request JSON.
-- A buyer-wide advisory lock serializes checkout creation across different request keys.
create function public.week05_create_test_order(p_buyer uuid,p_email text,p_content uuid,p_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype; l public.listings%rowtype; ref text;
begin
 if p_buyer is null or p_content is null or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 or p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
  raise exception 'INVALID_ORDER_REQUEST' using errcode='22023';
 end if;
 if not exists(select 1 from week05_finance.runtime_gate where singleton and allow_test_checkout) then raise exception 'TEST_CHECKOUT_DISABLED' using errcode='42501'; end if;
 if not public.affiliation_eligible(p_buyer) then raise exception 'NOT_ELIGIBLE' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('week05:buyer:'||p_buyer::text,0));
 select * into o from public.orders where buyer_id=p_buyer and idempotency_key=p_key;
 if found and o.content_id<>p_content then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
 if not found then select * into o from public.orders where buyer_id=p_buyer and content_id=p_content order by created_at,id limit 1; end if;
 if o.id is not null then
  if not exists(select 1 from week05_finance.order_terms where order_id=o.id and buyer_email=lower(trim(p_email))) then
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
 values(p_buyer,l.id,l.content_id,l.creator_id,p_key,l.price_kobo,'NGN',0,0,l.price_kobo,'test','pending') returning * into o;
 insert into week05_finance.order_terms(order_id,buyer_email,terms_version) values(o.id,lower(trim(p_email)),'synthetic-v1');
 ref:='sc_'||replace(gen_random_uuid()::text,'-','');
 insert into public.payment_attempts(order_id,provider,reference,status) values(o.id,'paystack',ref,'created');
 insert into public.audit_events(actor_id,action,target_kind,target_id) values(p_buyer,'week05.order.created','order',o.id);
 return jsonb_build_object('order_id',o.id,'reference',ref,'amount_kobo',o.amount_kobo,'currency','NGN','status','pending','replayed',false);
end $$;

-- Apply a VERIFIED successful provider response, never webhook or redirect data alone.
-- All charge / duplicate / fee / reversal movements, entitlement and audit commit together.
-- Late verified charges after a reversal are recorded but never reactivate access.
create function public.week05_apply_test_charge(p_ref text,p_tx text,p_amount bigint,p_currency text,p_domain text,p_email text,p_fee bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype; t week05_finance.order_terms%rowtype; r week05_finance.receipts%rowtype; rev week05_finance.reversals%rowtype; dupe boolean;
begin
 if p_ref is null or p_tx is null or p_tx !~ '^[A-Za-z0-9_-]{1,128}$' or p_amount is null
 or p_currency is distinct from 'NGN' or p_domain is distinct from 'test' or p_email is null
 or (p_fee is not null and (p_fee<0 or p_fee>p_amount)) then raise exception 'INVALID_VERIFICATION' using errcode='22023'; end if;
 -- Serialize provider identity across DIFFERENT orders as well as callbacks for one order.
 perform pg_advisory_xact_lock(hashtextextended('week05:tx:'||p_tx,0));
 -- Same order lock used by reversal, including early reversal before charge.
 select x.* into o from public.orders x join public.payment_attempts a on a.order_id=x.id
 where a.provider='paystack' and a.reference=p_ref for update of x;
 if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 select * into t from week05_finance.order_terms where order_id=o.id;
 if not found or o.environment<>'test' or o.currency<>'NGN' or o.platform_fee_bps<>0 or o.platform_fee_kobo<>0 or o.creator_gross_share_kobo<>o.amount_kobo
 or o.amount_kobo is distinct from p_amount or t.buyer_email is distinct from lower(trim(p_email)) then raise exception 'PAYMENT_MISMATCH' using errcode='23514'; end if;
 select * into r from week05_finance.receipts where transaction_id=p_tx;
 if found then
  if r.order_id<>o.id or r.reference<>p_ref or r.amount_kobo<>p_amount or r.fee_kobo is distinct from p_fee then raise exception 'PAYMENT_REPLAY_CONFLICT' using errcode='23514'; end if;
  return jsonb_build_object('status',o.status,'replayed',true,'duplicate',r.duplicate);
 end if;
 select * into rev from week05_finance.reversals where transaction_id=p_tx;
 if found and (rev.order_id<>o.id or rev.reference<>p_ref or rev.amount_kobo<>p_amount) then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 dupe:=exists(select 1 from week05_finance.receipts where order_id=o.id and not duplicate);
 -- A verified charge on a canceled/expired/failed order must be reconciled separately;
 -- never silently grant access against a closed or disputed order.
 if not dupe and o.status not in ('created','pending','verification_pending','refunded','chargeback') then raise exception 'ORDER_REVIEW_REQUIRED' using errcode='23514'; end if;
 if not dupe and o.status in ('refunded','chargeback') and rev.transaction_id is null then raise exception 'ORDER_REVIEW_REQUIRED' using errcode='23514'; end if;
 insert into week05_finance.receipts(transaction_id,order_id,reference,amount_kobo,fee_kobo,duplicate) values(p_tx,o.id,p_ref,p_amount,p_fee,dupe);
 insert into week05_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
 values('charge:'||p_tx,p_tx,o.id,case when dupe then 'duplicate_charge' else 'charge' end,'processor_clearing',case when dupe then 'duplicate_liability' else 'creator_pending' end,p_amount);
 if p_fee>0 then insert into week05_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
 values('fee:'||p_tx,p_tx,o.id,'provider_fee','provider_fee_suspense','processor_clearing',p_fee); end if;
 if rev.transaction_id is not null then
  insert into week05_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
  values('reverse:'||p_tx,p_tx,o.id,case when dupe then 'duplicate_reversal' else 'reversal' end,case when dupe then 'duplicate_liability' else 'creator_pending' end,'processor_clearing',p_amount);
 end if;
 if not dupe then
  update public.payment_attempts set provider_transaction_id=p_tx,status=case when rev.transaction_id is null then 'success' else 'reversed' end where order_id=o.id and provider='paystack' and reference=p_ref;
  update public.orders set status=case when rev.transaction_id is null then 'paid' when rev.kind='refund' then 'refunded' else 'chargeback' end,paid_at=coalesce(paid_at,now()),updated_at=now() where id=o.id returning * into o;
  insert into public.entitlements(buyer_id,content_id,order_id,state) values(o.buyer_id,o.content_id,o.id,case when rev.transaction_id is null then 'active' else 'revoked' end);
 end if;
 insert into public.audit_events(actor_id,action,target_kind,target_id,correlation_id) values(null,case when dupe then 'week05.duplicate_charge.recorded' else 'week05.verified_charge.recorded' end,'order',o.id,p_tx);
 return jsonb_build_object('status',o.status,'replayed',false,'duplicate',dupe);
end $$;

-- Only independently verified FULL reversal evidence is accepted. Partial refunds,
-- commercial refund policy and dispute resolutions are separate approval work.
create function public.week05_record_test_reversal(p_ref text,p_tx text,p_event text,p_kind text,p_amount bigint,p_currency text,p_domain text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype; r week05_finance.receipts%rowtype; existing week05_finance.reversals%rowtype;
begin
 if p_ref is null or p_tx is null or p_tx !~ '^[A-Za-z0-9_-]{1,128}$' or p_event is null or length(p_event) not between 8 and 200
 or p_kind is null or p_kind not in ('refund','chargeback') or p_amount is null or p_currency is distinct from 'NGN' or p_domain is distinct from 'test' then raise exception 'INVALID_REVERSAL' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('week05:tx:'||p_tx,0));
 select x.* into o from public.orders x join public.payment_attempts a on a.order_id=x.id where a.reference=p_ref and a.provider='paystack' for update of x;
 if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 if not exists(select 1 from week05_finance.order_terms where order_id=o.id) or o.environment<>'test' or o.amount_kobo is distinct from p_amount then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 select * into existing from week05_finance.reversals where transaction_id=p_tx;
 if found then
  if existing.order_id<>o.id or existing.reference<>p_ref or existing.amount_kobo<>p_amount or existing.kind<>p_kind then raise exception 'REVERSAL_REVIEW_REQUIRED' using errcode='23514'; end if;
  return jsonb_build_object('status',o.status,'replayed',true);
 end if;
 select * into r from week05_finance.receipts where transaction_id=p_tx;
 if found and (r.order_id<>o.id or r.reference<>p_ref or r.amount_kobo<>p_amount) then raise exception 'REVERSAL_MISMATCH' using errcode='23514'; end if;
 insert into week05_finance.reversals(transaction_id,event_key,order_id,reference,amount_kobo,kind) values(p_tx,p_event,o.id,p_ref,p_amount,p_kind);
 if r.transaction_id is not null then
  insert into week05_finance.journal(event_key,transaction_id,order_id,kind,debit_account,credit_account,amount_kobo)
  values('reverse:'||p_tx,p_tx,o.id,case when r.duplicate then 'duplicate_reversal' else 'reversal' end,case when r.duplicate then 'duplicate_liability' else 'creator_pending' end,'processor_clearing',p_amount);
  if not r.duplicate then
   update public.orders set status=case when p_kind='refund' then 'refunded' else 'chargeback' end,updated_at=now() where id=o.id returning * into o;
   update public.entitlements set state='revoked' where order_id=o.id;
   update public.payment_attempts set status='reversed' where order_id=o.id and provider_transaction_id=p_tx;
  end if;
 end if;
 insert into public.audit_events(actor_id,action,target_kind,target_id,correlation_id) values(null,'week05.verified_reversal.recorded','order',o.id,p_event);
 return jsonb_build_object('status',o.status,'replayed',false,'awaiting_charge',r.transaction_id is null);
end $$;

-- Restrict staged RPCs to backend service role; no browser payment mutations.
revoke all on function public.week05_create_test_order(uuid,text,uuid,text),public.week05_apply_test_charge(text,text,bigint,text,text,text,bigint),public.week05_record_test_reversal(text,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.week05_create_test_order(uuid,text,uuid,text),public.week05_apply_test_charge(text,text,bigint,text,text,text,bigint),public.week05_record_test_reversal(text,text,text,text,bigint,text,text) to service_role;
grant select on public.listings,public.content_items,public.courses to service_role;
grant select,insert,update on public.orders,public.payment_attempts,public.entitlements to service_role;
grant insert on public.audit_events to service_role;
