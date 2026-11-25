-- Week 5: hosted checkout claim, cache and uncertainty tracking. Requires 0015–0016.
-- Network I/O always outside DB transaction, using immutable provider reference.
-- Never automatically reinitialize after a lost response or crash.
create table week05_finance.checkout_sessions(
 order_id uuid primary key references week05_finance.order_terms(order_id),
 reference text not null unique,
 state text not null check(state in ('started','ready','uncertain')),
 claim_token uuid not null unique,
 authorization_url text,
 started_at timestamptz not null default now(),
 completed_at timestamptz,
 check((state='ready')=(authorization_url is not null)),
 check((state='started')=(completed_at is null)),
 check(authorization_url is null or (length(authorization_url)<=2048 and authorization_url ~ '^https://(checkout[.]paystack[.]com|paystack[.]com)/[^[:space:]#]*$' and position(chr(92) in authorization_url)=0))
);
alter table week05_finance.checkout_sessions enable row level security;
revoke all on week05_finance.checkout_sessions from public,anon,authenticated,service_role;
grant select,insert,update on week05_finance.checkout_sessions to service_role;

create function week05_finance.checkout_transition_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.state<>'started' or new.state not in ('ready','uncertain') or
 (new.order_id,new.reference,new.claim_token,new.started_at) is distinct from (old.order_id,old.reference,old.claim_token,old.started_at) then
 raise exception 'CHECKOUT_IMMUTABLE' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function week05_finance.checkout_transition_guard() from public,anon,authenticated;
create trigger week05_checkout_transition_guard before update on week05_finance.checkout_sessions for each row execute function week05_finance.checkout_transition_guard();

create function public.week05_begin_test_checkout(p_buyer uuid,p_ref text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb; oid uuid; old week05_finance.checkout_sessions%rowtype;
begin
 -- Same order lock as charge/reversal; never create a second initialization.
 select o.id into oid from public.orders o join public.payment_attempts a on a.order_id=o.id where o.buyer_id=p_buyer and a.provider='paystack' and a.reference=p_ref for update of o;
 if oid is null then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
 snapshot:=public.week05_get_test_order(p_buyer,p_ref);
 if snapshot->>'checkoutAllowed' is distinct from 'true' then raise exception 'CHECKOUT_UNAVAILABLE' using errcode='42501'; end if;
 select * into old from week05_finance.checkout_sessions where order_id=oid;
 if found then
 if old.state='ready' then return jsonb_build_object('state','ready','reference',p_ref,'authorizationUrl',old.authorization_url);end if;
 return jsonb_build_object('state','uncertain','reference',p_ref);
 end if;
 insert into week05_finance.checkout_sessions(order_id,reference,state,claim_token) values(oid,p_ref,'started',gen_random_uuid()) returning * into old;
 return snapshot||jsonb_build_object('state','claimed','claim',old.claim_token);
end $$;

create function public.week05_finish_test_checkout(p_ref text,p_claim uuid,p_url text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old week05_finance.checkout_sessions%rowtype;
begin
 select * into old from week05_finance.checkout_sessions where reference=p_ref for update;
 if not found or old.state<>'started' or old.claim_token is distinct from p_claim then return jsonb_build_object('owned',false);end if;
 update week05_finance.checkout_sessions set state=case when p_url is null then 'uncertain' else 'ready' end,authorization_url=p_url,completed_at=clock_timestamp() where order_id=old.order_id returning * into old;
 return jsonb_build_object('owned',true,'state',old.state);
end $$;
revoke all on function public.week05_begin_test_checkout(uuid,text),public.week05_finish_test_checkout(text,uuid,text) from public,anon,authenticated;
grant execute on function public.week05_begin_test_checkout(uuid,text),public.week05_finish_test_checkout(text,uuid,text) to service_role;
