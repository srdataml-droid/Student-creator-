-- Disposable PostgreSQL only; apply bootstrap and 0001–0006 then 0015.
-- All synthetic fixtures rolled back. No Paystack credentials or requests.
begin;
insert into auth.users(id) values('50000000-0000-4000-8000-000000000001'),('50000000-0000-4000-8000-000000000002'),('50000000-0000-4000-8000-000000000003');
insert into public.institutions(id,slug,name) values('50000000-0000-4000-8000-000000000004','week05-contract','Synthetic finance campus');
insert into public.departments(id,institution_id,slug,name) values('50000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000004','test','Synthetic department');
insert into public.courses(id,institution_id,department_id,code,title) values('50000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000005','W05','Synthetic course');
insert into public.student_profiles(user_id,institution_id,display_name,verified_at) values
('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004','Creator',now()),
('50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000004','Buyer',now()),
('50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004','Other',now());
insert into public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status,reviewer_id,review_reason,reviewed_at,published_at) values
('50000000-0000-4000-8000-000000000007','50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000006','Original synthetic work',now(),'week05-draft-0001',repeat('5',64),'published','50000000-0000-4000-8000-000000000003','Synthetic review',now(),now());
insert into public.listings(content_id,creator_id,price_kobo) values('50000000-0000-4000-8000-000000000007','50000000-0000-4000-8000-000000000001',20000);

do $$ begin
 if has_function_privilege('anon','public.week05_apply_test_charge(text,text,bigint,text,text,text,bigint)','execute') or has_function_privilege('authenticated','public.week05_create_test_order(uuid,text,uuid,text)','execute') or has_schema_privilege('authenticated','week05_finance','usage') then raise exception 'Browser access leaked'; end if;
end $$;
set local role service_role;
do $$ begin
 begin perform public.week05_create_test_order('50000000-0000-4000-8000-000000000002','buyer@example.invalid','50000000-0000-4000-8000-000000000007','week05-disabled-0001'); raise exception 'Disabled staging gate accepted order'; exception when insufficient_privilege then null; end;
 begin update week05_finance.runtime_gate set allow_test_checkout=true; raise exception 'Service role can enable staging checkout'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update week05_finance.runtime_gate set allow_test_checkout=true where singleton;
set local role service_role;
do $$
declare b uuid:='50000000-0000-4000-8000-000000000002'; c uuid:='50000000-0000-4000-8000-000000000007'; other uuid:='50000000-0000-4000-8000-000000000003'; r jsonb; ref text; ref2 text; lease uuid; fresh uuid;
begin
 if has_function_privilege('authenticated','public.week05_claim_test_charge()','execute') or has_function_privilege('anon','public.week05_get_test_order(uuid,text)','execute') then raise exception 'Inbox access leaked'; end if;
 ref:=public.week05_create_test_order(b,'buyer@example.invalid',c,'week05-inbox-buyer-01')->>'reference';
 ref2:=public.week05_create_test_order(other,'other@example.invalid',c,'week05-inbox-other-01')->>'reference';
 r:=public.week05_get_test_order(b,ref);
 if r->>'amountKobo'<>'20000' or r->>'checkoutAllowed'<>'true' or r->>'buyerEmail'<>'buyer@example.invalid' then raise exception 'Bad trusted snapshot'; end if;
 begin perform public.week05_get_test_order(other,ref); raise exception 'Cross-account snapshot'; exception when no_data_found then null; end;
 r:=public.week05_enqueue_test_charge(ref,'inbox_tx',repeat('a',64));
 if r->>'replayed'<>'false' then raise exception 'New event lost'; end if;
 r:=public.week05_enqueue_test_charge(ref,'inbox_tx',repeat('b',64));
 if r->>'replayed'<>'true' then raise exception 'Replay duplicated'; end if;
 begin perform public.week05_enqueue_test_charge(ref2,'inbox_tx',repeat('c',64)); raise exception 'Cross-order replay accepted'; exception when check_violation then null; end;
 r:=public.week05_claim_test_charge();lease:=(r->>'lease')::uuid;
 if lease is null or r->>'transactionId'<>'inbox_tx' or r->>'reference'<>ref then raise exception 'Lease missing'; end if;
 if public.week05_claim_test_charge() is not null then raise exception 'Concurrent lease issued'; end if;
 if public.week05_finish_test_charge('inbox_tx',gen_random_uuid(),null)->>'owned'<>'false' then raise exception 'Wrong lease accepted'; end if;
 begin perform public.week05_finish_test_charge('inbox_tx',lease,null); raise exception 'Unverified receipt ack'; exception when check_violation then null; end;
 if public.week05_finish_test_charge('inbox_tx',lease,'GATEWAY_TIMEOUT')->>'state'<>'failed' then raise exception 'Retry not persisted'; end if;
 if public.week05_claim_test_charge() is not null then raise exception 'Backoff not respected'; end if;
 update week05_finance.charge_inbox set next_retry_at=clock_timestamp()-interval '1 second' where transaction_id='inbox_tx';
 r:=public.week05_claim_test_charge();fresh:=(r->>'lease')::uuid;
 if fresh is null or fresh=lease or r->>'attempt'<>'2' then raise exception 'Retry lease invalid'; end if;
 if public.week05_finish_test_charge('inbox_tx',lease,null)->>'owned'<>'false' then raise exception 'Old lease accepted'; end if;
 perform public.week05_apply_test_charge(ref,'inbox_tx',20000,'NGN','test','buyer@example.invalid',100);
 if public.week05_finish_test_charge('inbox_tx',fresh,null)->>'state'<>'processed' then raise exception 'Verified event not processed'; end if;
 if public.week05_claim_test_charge() is not null then raise exception 'Processed event reissued'; end if;
 perform public.week05_enqueue_test_charge(ref2,'expired_tx',repeat('d',64));
 r:=public.week05_claim_test_charge();lease:=(r->>'lease')::uuid;
 update week05_finance.charge_inbox set lease_until=clock_timestamp()-interval '1 second' where transaction_id='expired_tx';
 r:=public.week05_claim_test_charge();fresh:=(r->>'lease')::uuid;
 if fresh is null or fresh=lease then raise exception 'Expired lease not recovered'; end if;
 update week05_finance.charge_inbox set attempts=8 where transaction_id='expired_tx';
 if public.week05_finish_test_charge('expired_tx',fresh,'NOT_PAID')->>'state'<>'dead_letter' then raise exception 'Retry exhaustion missing'; end if;
 if public.week05_claim_test_charge() is not null then raise exception 'Dead letter reclaimed'; end if;
end $$;
reset role;
rollback;
select 'PASS: Week 5 hosted charge inbox and trusted order lookup' as evidence;
