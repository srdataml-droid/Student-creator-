-- Disposable PostgreSQL contract for Week 6 payments; no real charge.
\set ON_ERROR_STOP on
\echo 'W06 financial access: pending cannot open paid class; verified paid order can, reversals revoke'
BEGIN;
INSERT INTO auth.users(id) VALUES('33333333-3333-4333-8333-333333333333');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at)
VALUES('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Verified W06 Test Learner',now());
INSERT INTO public.interactive_classes(id,institution_id,course_id,host_id,title,starts_at,ends_at,capacity,price_kobo,room_name,creation_key)
VALUES('66666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
  'Private paid night class',now()+interval '30 minutes',now()+interval '90 minutes',
  12,30000,'wk-class-66666666-6666-4666-8666-666666666666','wk06-finance-course-unique-001');
INSERT INTO public.interactive_class_enrollments(class_id,student_id,state)
VALUES('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','enrolled');
INSERT INTO public.learning_purchase_orders(reference,buyer_id,creator_id,
 resource_kind,resource_id,buyer_email,amount_kobo,request_key)
VALUES('lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
 '33333333-3333-4333-8333-333333333333',
 '11111111-1111-4111-8111-111111111111',
 'class','66666666-6666-4666-8666-666666666666',
 'student-w6@example.invalid',30000,'wk06-finance-order-unique-01');

SET request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
SET ROLE authenticated;
DO $$ DECLARE n integer; can_join boolean;
BEGIN
 SELECT public.can_join_paid_week06_class('66666666-6666-4666-8666-666666666666') INTO can_join;
 IF can_join THEN RAISE EXCEPTION 'Pending order gave room access';END IF;
 SELECT count(*) INTO n FROM public.learning_purchase_orders;
 IF n<>1 THEN RAISE EXCEPTION 'Buyer cannot see their own order'; END IF;
 SELECT count(*) INTO n FROM public.learning_payment_entitlements;
 IF n<>0 THEN RAISE EXCEPTION 'Buyer has entitlement before payment';END IF;
 BEGIN
  INSERT INTO public.learning_payment_entitlements(buyer_id,resource_kind,resource_id,order_reference,state)
  VALUES('33333333-3333-4333-8333-333333333333','class',
   '66666666-6666-4666-8666-666666666666','lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','active');
  RAISE EXCEPTION 'Browser manufactured paid entitlement';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  UPDATE public.learning_purchase_orders SET state='paid'
   WHERE reference='lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'Browser marked order as paid';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  SELECT count(*) INTO n FROM public.learning_payment_ledger;
  RAISE EXCEPTION 'Browser read private payment ledger';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;

-- Server-verified fake payment recorded with scoped entitlement and balanced ledger.
UPDATE public.learning_purchase_orders
  SET state='paid',paid_at=now(),provider_transaction_id='synthetic_psp_transaction_w06'
WHERE reference='lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
INSERT INTO public.learning_payment_entitlements(buyer_id,resource_kind,resource_id,order_reference,state)
VALUES('33333333-3333-4333-8333-333333333333','class',
'66666666-6666-4666-8666-666666666666',
'lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','active');
INSERT INTO public.learning_payment_events(order_reference,event_key,kind)
VALUES('lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','charge:synthetic_psp_transaction_w06','charge');
INSERT INTO public.learning_payment_ledger(order_reference,event_key,line_no,account,debit_kobo,credit_kobo)
VALUES('lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','charge:synthetic_psp_transaction_w06',1,'processor_clearing',30000,0),
('lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','charge:synthetic_psp_transaction_w06',2,'creator_payable',0,30000);
SET CONSTRAINTS learning_ledger_commit_balanced IMMEDIATE;

SET request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
SET ROLE authenticated;
DO $$ DECLARE n integer; can_join boolean;
BEGIN
 SELECT public.can_join_paid_week06_class('66666666-6666-4666-8666-666666666666') INTO can_join;
 IF NOT can_join THEN RAISE EXCEPTION 'Paid buyer lost scoped class access'; END IF;
 SELECT count(*) INTO n FROM public.learning_payment_entitlements;
 IF n<>1 THEN RAISE EXCEPTION 'Paid buyer cannot see one owned entitlement';END IF;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer; can_join boolean;
BEGIN
 SELECT public.can_join_paid_week06_class('66666666-6666-4666-8666-666666666666') INTO can_join;
 IF can_join THEN RAISE EXCEPTION 'Other-campus user obtained room access';END IF;
 SELECT count(*) INTO n FROM public.learning_purchase_orders;
 IF n<>0 THEN RAISE EXCEPTION 'Other student can read private order';END IF;
 SELECT count(*) INTO n FROM public.learning_payment_entitlements;
 IF n<>0 THEN RAISE EXCEPTION 'Other student can read entitlement';END IF;
END $$;
RESET ROLE;

UPDATE public.learning_purchase_orders SET state='refunded',refunded_at=now()
WHERE reference='lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
UPDATE public.learning_payment_entitlements SET state='revoked',revoked_at=now()
WHERE order_reference='lsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
SET request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
SET ROLE authenticated;
DO $$ DECLARE can_join boolean;
BEGIN
 SELECT public.can_join_paid_week06_class('66666666-6666-4666-8666-666666666666') INTO can_join;
 IF can_join THEN RAISE EXCEPTION 'Refunded paid class still joinable'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: Week 6 scoped paid service entitlements, reversal and private ledger RLS'
