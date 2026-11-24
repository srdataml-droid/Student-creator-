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
do $$
declare b uuid:='50000000-0000-4000-8000-000000000002'; c uuid:='50000000-0000-4000-8000-000000000007'; other uuid:='50000000-0000-4000-8000-000000000003'; r jsonb; ref text; oid uuid; ref2 text; oid2 uuid;
begin
 r:=public.week05_create_test_order(b,'buyer@example.invalid',c,'week05-request-0001'); ref:=r->>'reference'; oid:=(r->>'order_id')::uuid;
 if (r->>'amount_kobo')::bigint<>20000 then raise exception 'Server price wrong'; end if;
 r:=public.week05_create_test_order(b,'buyer@example.invalid',c,'week05-request-0002');
 if r->>'reference'<>ref or r->>'replayed'<>'true' then raise exception 'Duplicate order'; end if;
 begin update public.orders set amount_kobo=30000,creator_gross_share_kobo=30000 where id=oid; raise exception 'Mutable snapshot'; exception when check_violation then null; end;
 begin perform public.week05_apply_test_charge(ref,'w05_tx',21000,'NGN','test','buyer@example.invalid',0); raise exception 'Forged amount accepted'; exception when check_violation then null; end;
 begin perform public.week05_apply_test_charge(ref,'w05_tx',20000,'USD','test','buyer@example.invalid',0); raise exception 'Wrong currency accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.week05_apply_test_charge(ref,'w05_tx',20000,'NGN','live','buyer@example.invalid',0); raise exception 'Live accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.week05_apply_test_charge(ref,'w05_tx',20000,'NGN','test','other@example.invalid',0); raise exception 'Wrong buyer accepted'; exception when check_violation then null; end;
 if exists(select 1 from public.entitlements where order_id=oid) then raise exception 'Pending granted access'; end if;
 r:=public.week05_apply_test_charge(ref,'w05_tx',20000,'NGN','test','buyer@example.invalid',100);
 if r->>'status'<>'paid' then raise exception 'Charge failed'; end if;
 if (select count(*) from public.entitlements where order_id=oid and state='active')<>1 then raise exception 'Entitlement missing'; end if;
 r:=public.week05_apply_test_charge(ref,'w05_tx',20000,'NGN','test','buyer@example.invalid',100);
 if r->>'replayed'<>'true' then raise exception 'Retry not idempotent'; end if;
 r:=public.week05_apply_test_charge(ref,'w05_dup',20000,'NGN','test','buyer@example.invalid',0);
 if r->>'duplicate'<>'true' then raise exception 'Duplicate charge lost'; end if;
 if (select count(*) from week05_finance.journal where order_id=oid)<>3 then raise exception 'Journal count'; end if;
 perform public.week05_record_test_reversal(ref,'w05_dup','w05-refund-duplicate','refund',20000,'NGN','test');
 if (select state from public.entitlements where order_id=oid)<>'active' then raise exception 'Duplicate reversal revoked primary'; end if;
 perform public.week05_record_test_reversal(ref,'w05_tx','w05-refund-primary','refund',20000,'NGN','test');
 if (select state from public.entitlements where order_id=oid)<>'revoked' then raise exception 'Refund failed to revoke'; end if;
 r:=public.week05_apply_test_charge(ref,'w05_tx',20000,'NGN','test','buyer@example.invalid',100);
 if r->>'status'<>'refunded' or r->>'replayed'<>'true' then raise exception 'Late charge reactivated access'; end if;
 if (select coalesce(sum(case when credit_account='creator_pending' then amount_kobo when debit_account='creator_pending' then -amount_kobo else 0 end),0) from week05_finance.journal where order_id=oid)<>0 then raise exception 'Creator balance not reversed'; end if;
 r:=public.week05_create_test_order(other,'other@example.invalid',c,'week05-request-other');ref2:=r->>'reference';oid2:=(r->>'order_id')::uuid;
 perform public.week05_record_test_reversal(ref2,'w05_early','w05-early-refund','refund',20000,'NGN','test');
 r:=public.week05_apply_test_charge(ref2,'w05_early',20000,'NGN','test','other@example.invalid',0);
 if r->>'status'<>'refunded' or (select state from public.entitlements where order_id=oid2)<>'revoked' then raise exception 'Early reversal not preserved'; end if;
 begin perform public.week05_apply_test_charge(ref2,'w05_tx',20000,'NGN','test','other@example.invalid',100); raise exception 'Cross-order transaction reused'; exception when check_violation then null; end;
 begin update week05_finance.journal set amount_kobo=1 where order_id=oid;raise exception 'Journal mutable';exception when insufficient_privilege or check_violation then null;end;
end $$;
reset role;
rollback;
select 'PASS: Week 5 staged financial transaction contract' as evidence;
