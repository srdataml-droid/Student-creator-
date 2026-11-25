-- Live hosted recovery; requires production 0001. No provider call or schedule here.
-- Input to enqueue must come from a signature-verified raw Paystack event.
-- Every successful completion requires an independently verified receipt.
create table live_finance.charge_inbox (
 transaction_id text primary key check(transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 order_id uuid not null references live_finance.order_terms(order_id),
 reference text not null,
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null default 'received' check(state in ('received','processing','failed','processed','dead_letter')),
 attempts integer not null default 0 check(attempts between 0 and 8),
 lease_token uuid,
 lease_until timestamptz,
 next_retry_at timestamptz not null default now(),
 last_error_code text check(last_error_code ~ '^[A-Z_]{1,60}$'),
 received_at timestamptz not null default now(),
 check((state='processing')=(lease_token is not null and lease_until is not null)),
 check(state='processing' or (lease_token is null and lease_until is null))
);
create index live_inbox_due on live_finance.charge_inbox(next_retry_at,received_at) where state in ('received','failed','processing');
alter table live_finance.charge_inbox enable row level security;
revoke all on live_finance.charge_inbox from public,anon,authenticated,service_role;
-- Service role may only invoke the controlled queue RPCs.
create function live_finance.inbox_identity_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.transaction_id,new.order_id,new.reference,new.payload_sha256,new.received_at) is distinct from (old.transaction_id,old.order_id,old.reference,old.payload_sha256,old.received_at) or old.state in ('processed','dead_letter') then
 raise exception 'IMMUTABLE_INBOX' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function live_finance.inbox_identity_guard() from public,anon,authenticated;
create trigger live_inbox_identity_guard before update on live_finance.charge_inbox for each row execute function live_finance.inbox_identity_guard();

-- Buyer-specific lookup. Backend must authenticate current session before calling.
create function public.live_get_order(p_buyer uuid,p_ref text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if p_buyer is null or not public.affiliation_eligible(p_buyer) then raise exception 'NOT_ELIGIBLE' using errcode='42501'; end if;
 select jsonb_build_object('orderId',o.id,'reference',a.reference,'amountKobo',o.amount_kobo,'buyerEmail',t.buyer_email,'domain',o.environment,'currency',o.currency,'status',o.status,
 'checkoutAllowed',o.status in ('created','pending','verification_pending') and l.state='active' and c.status='published' and co.active and i.active and public.affiliation_eligible(o.creator_id) and not exists(select 1 from public.creator_restrictions r2 where r2.creator_id=o.creator_id and r2.viewer_id=o.buyer_id and r2.deny_view) and exists(select 1 from live_finance.runtime_gate where singleton and allow_checkout))
 into r from public.orders o join live_finance.order_terms t on t.order_id=o.id join public.payment_attempts a on a.order_id=o.id
 join public.listings l on l.id=o.listing_id join public.content_items c on c.id=o.content_id join public.courses co on co.id=c.course_id join public.institutions i on i.id=c.institution_id
 where o.buyer_id=p_buyer and o.environment='live' and a.provider='paystack' and a.reference=p_ref;
 if r is null then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 return r;
end $$;

create function public.live_enqueue_charge(p_ref text,p_tx text,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare oid uuid; existing live_finance.charge_inbox%rowtype;
begin
 if p_ref is null or p_tx is null or p_tx !~ '^[A-Za-z0-9_-]{1,128}$' or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_EVENT' using errcode='22023'; end if;
 select o.id into oid from public.orders o join live_finance.order_terms t on t.order_id=o.id join public.payment_attempts a on a.order_id=o.id where o.environment='live' and a.provider='paystack' and a.reference=p_ref;
 if oid is null then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended('live:tx:'||p_tx,0));
 select * into existing from live_finance.charge_inbox where transaction_id=p_tx;
 if found then
 if existing.reference<>p_ref or existing.order_id<>oid then raise exception 'EVENT_CONFLICT' using errcode='23514'; end if;
 return jsonb_build_object('received',true,'replayed',true,'state',existing.state);
 end if;
 if exists(select 1 from live_finance.receipts r where r.transaction_id=p_tx and r.order_id<>oid) then raise exception 'EVENT_CONFLICT' using errcode='23514'; end if;
 insert into live_finance.charge_inbox(transaction_id,order_id,reference,payload_sha256) values(p_tx,oid,p_ref,p_digest);
 return jsonb_build_object('received',true,'replayed',false,'state','received');
end $$;

-- Independent workers cannot claim the same active lease. Expired final attempts
-- are marked dead_letter and retained for operator investigation.
create function public.live_claim_charge()
returns jsonb language plpgsql security definer set search_path='' as $$
declare e live_finance.charge_inbox%rowtype; result jsonb;
begin
 update live_finance.charge_inbox set state='dead_letter',lease_token=null,lease_until=null,last_error_code='RETRY_EXHAUSTED' where state='processing' and attempts=8 and lease_until<=clock_timestamp();
 select * into e from live_finance.charge_inbox
 where attempts<8 and ((state in ('received','failed') and next_retry_at<=clock_timestamp()) or (state='processing' and lease_until<=clock_timestamp()))
 order by next_retry_at,received_at,transaction_id for update skip locked limit 1;
 if not found then return null; end if;
 update live_finance.charge_inbox set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',last_error_code=null where transaction_id=e.transaction_id returning * into e;
 select jsonb_build_object('transactionId',e.transaction_id,'lease',e.lease_token,'reference',e.reference,'amountKobo',o.amount_kobo,'buyerEmail',t.buyer_email,'domain',o.environment,'currency',o.currency,'attempt',e.attempts)
 into result from public.orders o join live_finance.order_terms t on t.order_id=o.id where o.id=e.order_id;
 return result;
end $$;

create function public.live_finish_charge(p_tx text,p_lease uuid,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e live_finance.charge_inbox%rowtype; new_state text;
begin
 if p_error is not null and p_error !~ '^[A-Z_]{1,60}$' then raise exception 'INVALID_ERROR_CODE' using errcode='22023'; end if;
 select * into e from live_finance.charge_inbox where transaction_id=p_tx for update;
 if not found or e.state<>'processing' or e.lease_token is distinct from p_lease or e.lease_until<=clock_timestamp() then return jsonb_build_object('owned',false); end if;
 if p_error is null then
 if not exists(select 1 from live_finance.receipts r where r.transaction_id=e.transaction_id and r.order_id=e.order_id and r.reference=e.reference) then raise exception 'VERIFIED_RECEIPT_REQUIRED' using errcode='23514'; end if;
 new_state:='processed';
 elsif e.attempts>=8 then new_state:='dead_letter';
 else new_state:='failed'; end if;
 update live_finance.charge_inbox set state=new_state,lease_token=null,lease_until=null,last_error_code=p_error,next_retry_at=clock_timestamp()+make_interval(secs=>least(3600, 15*(1<<e.attempts))) where transaction_id=e.transaction_id;
 return jsonb_build_object('owned',true,'state',new_state);
end $$;

revoke all on function public.live_get_order(uuid,text),public.live_enqueue_charge(text,text,text),public.live_claim_charge(),public.live_finish_charge(text,uuid,text) from public,anon,authenticated;
grant execute on function public.live_get_order(uuid,text),public.live_enqueue_charge(text,text,text),public.live_claim_charge(),public.live_finish_charge(text,uuid,text) to service_role;
