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
declare b uuid:='50000000-0000-4000-8000-000000000002'; c uuid:='50000000-0000-4000-8000-000000000007'; other uuid:='50000000-0000-4000-8000-000000000003'; r jsonb; ref text; ref2 text; claim uuid;
begin
 if has_function_privilege('authenticated','public.week05_begin_test_checkout(uuid,text)','execute') or has_function_privilege('anon','public.week05_finish_test_checkout(text,uuid,text)','execute') then raise exception 'Browser checkout privilege';end if;
 ref:=public.week05_create_test_order(b,'buyer@example.invalid',c,'week05-checkout-buyer')->>'reference';
 ref2:=public.week05_create_test_order(other,'other@example.invalid',c,'week05-checkout-other')->>'reference';
 begin perform public.week05_begin_test_checkout(other,ref);raise exception 'Cross-account checkout';exception when no_data_found then null;end;
 r:=public.week05_begin_test_checkout(b,ref);claim:=(r->>'claim')::uuid;
 if r->>'state'<>'claimed' or claim is null or r->>'amountKobo'<>'20000' then raise exception 'Missing claim';end if;
 if public.week05_begin_test_checkout(b,ref)->>'state'<>'uncertain' then raise exception 'Second network claim';end if;
 if public.week05_finish_test_checkout(ref,gen_random_uuid(),'https://checkout.paystack.com/test')->>'owned'<>'false' then raise exception 'Wrong claim accepted';end if;
 begin perform public.week05_finish_test_checkout(ref,claim,'https://checkout.paystack.com.evil.invalid/test');raise exception 'Unsafe URL stored';exception when check_violation then null;end;
 begin perform public.week05_finish_test_checkout(ref,claim,'https://checkout.paystack.com/test#fragment');raise exception 'Fragment URL stored';exception when check_violation then null;end;
 if public.week05_finish_test_checkout(ref,claim,'https://checkout.paystack.com/test')->>'state'<>'ready' then raise exception 'Checkout not saved';end if;
 r:=public.week05_begin_test_checkout(b,ref);
 if r->>'state'<>'ready' or r->>'authorizationUrl'<>'https://checkout.paystack.com/test' then raise exception 'Cache not returned';end if;
 if public.week05_finish_test_checkout(ref,claim,null)->>'owned'<>'false' then raise exception 'Completed claim overwritten';end if;
 perform public.week05_apply_test_charge(ref,'checkout_tx',20000,'NGN','test','buyer@example.invalid',0);
 begin perform public.week05_begin_test_checkout(b,ref);raise exception 'Paid checkout reused';exception when insufficient_privilege then null;end;
 r:=public.week05_begin_test_checkout(other,ref2);claim:=(r->>'claim')::uuid;
 if public.week05_finish_test_checkout(ref2,claim,null)->>'state'<>'uncertain' then raise exception 'Uncertain response not retained';end if;
 if public.week05_begin_test_checkout(other,ref2)->>'state'<>'uncertain' then raise exception 'Uncertain checkout retried';end if;
end $$;
reset role;
rollback;
select 'PASS: Week 5 durable hosted checkout initialization' as evidence;
