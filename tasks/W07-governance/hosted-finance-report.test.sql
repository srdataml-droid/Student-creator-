BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('f1910000-0000-4000-8000-000000000001','creator@example.invalid',now()),('f1910000-0000-4000-8000-000000000002','buyer@example.invalid',now()),('f1910000-0000-4000-8000-000000000003','reviewer@example.invalid',now());
INSERT INTO public.institutions(id,slug,name) VALUES('f1920000-0000-4000-8000-000000000001','fixture-paystack-19','Synthetic');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('f1930000-0000-4000-8000-000000000001','f1920000-0000-4000-8000-000000000001','fixture','Synthetic');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('f1940000-0000-4000-8000-000000000001','f1920000-0000-4000-8000-000000000001','f1930000-0000-4000-8000-000000000001','PAY19','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'f1920000-0000-4000-8000-000000000001','Synthetic',now() FROM auth.users WHERE id IN ('f1910000-0000-4000-8000-000000000001','f1910000-0000-4000-8000-000000000002');
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status,reviewer_id,review_reason,reviewed_at,published_at) VALUES('f1950000-0000-4000-8000-000000000001','f1910000-0000-4000-8000-000000000001','f1920000-0000-4000-8000-000000000001','f1940000-0000-4000-8000-000000000001','Synthetic payment lesson',now(),'fixture-paystack-19',repeat('a',64),'published','f1910000-0000-4000-8000-000000000003','Synthetic approval',now(),now());
INSERT INTO public.mux_video_uploads(content_id,creator_id,state,upload_id,asset_id,playback_id) VALUES('f1950000-0000-4000-8000-000000000001','f1910000-0000-4000-8000-000000000001','ready','fixture_live_upload','fixture_live_asset','fixture_live_playback');
INSERT INTO public.content_assets(content_id,private_object_key,mime_type,bytes,processing_status,scan_verdict) VALUES('f1950000-0000-4000-8000-000000000001','private/mux/fixture_live_asset','video/mp4',100,'ready','clean');
INSERT INTO public.listings(content_id,creator_id,price_kobo) VALUES('f1950000-0000-4000-8000-000000000001','f1910000-0000-4000-8000-000000000001',20000);
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('9b000000-0000-4000-8000-000000000001','learning-host@example.invalid',now()),('9b000000-0000-4000-8000-000000000002','learning-buyer@example.invalid',now()),('9b000000-0000-4000-8000-000000000003','learning-other@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE '9b000000-%';
INSERT INTO public.institutions(id,slug,name) VALUES('9b000000-0000-4000-8000-000000000010','fixture-paid-learning','Synthetic learning campus');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('9b000000-0000-4000-8000-000000000011','9b000000-0000-4000-8000-000000000010','science','Science');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('9b000000-0000-4000-8000-000000000012','9b000000-0000-4000-8000-000000000010','9b000000-0000-4000-8000-000000000011','LEARN1','Learning');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'9b000000-0000-4000-8000-000000000010','Synthetic learner',now() FROM auth.users WHERE id::text LIKE '9b000000-%';
INSERT INTO public.interactive_classes(id,institution_id,course_id,host_id,title,starts_at,ends_at,capacity,price_kobo,status,provider_ready,room_name,creation_key) VALUES('9b000000-0000-4000-8000-000000000013','9b000000-0000-4000-8000-000000000010','9b000000-0000-4000-8000-000000000012','9b000000-0000-4000-8000-000000000001','Synthetic paid class',now()+interval '5 minutes',now()+interval '2 hours',2,20000,'room_open',true,'wk-class-9b000000-0000-4000-8000-000000000013','fixture-paid-learning-key');
INSERT INTO public.personal_learning_requests(id,institution_id,student_id,creator_id,kind,description,budget_kobo,quote_kobo,state,creation_key) VALUES('9b000000-0000-4000-8000-000000000014','9b000000-0000-4000-8000-000000000010','9b000000-0000-4000-8000-000000000002','9b000000-0000-4000-8000-000000000001','tutoring','Synthetic tutorial request for a regression test',30000,30000,'quoted','fixture-paid-service-key');

INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE 'f1910000-%';
INSERT INTO public.platform_staff(user_id,role,active) VALUES('f1910000-0000-4000-8000-000000000003','admin',true),('9b000000-0000-4000-8000-000000000003','moderator',true);
INSERT INTO public.governance_staff_role_grants(user_id,role) VALUES('f1910000-0000-4000-8000-000000000003','finance_reviewer'),('9b000000-0000-4000-8000-000000000003','privacy_reviewer');
UPDATE live_finance.runtime_gate SET allow_checkout=true,terms_version='finance-fixture-v1',refund_policy_version='finance-fixture-refunds',platform_fee_bps=1000,fee_bearer='platform',license_seconds=3600,approved_at=now() WHERE singleton;
UPDATE live_finance.learning_gate SET allow_checkout=true,terms_version='finance-fixture-v1',approved_at=now() WHERE singleton;
DO $$ DECLARE o jsonb; e jsonb; q jsonb; lesson jsonb; class jsonb; service jsonb;
BEGIN
 o:=public.reserve_live_paystack_checkout('f1910000-0000-4000-8000-000000000002','f1950000-0000-4000-8000-000000000001','finance-fixture-lesson-key','finance-fixture-v1');
 IF o IS NULL THEN RAISE EXCEPTION 'Lesson snapshot missing'; END IF;
 PERFORM public.live_apply_charge(o->>'reference','9700011111',20000,'NGN','live','buyer@example.invalid',100);
 o:=public.reserve_live_learning_checkout('9b000000-0000-4000-8000-000000000002','class','9b000000-0000-4000-8000-000000000013','finance-fixture-class-key','finance-fixture-v1');
 IF o IS NULL THEN RAISE EXCEPTION 'Class snapshot missing'; END IF;
 PERFORM public.record_live_learning_charge(o->>'reference','9700011112',repeat('a',64));
 e:=public.claim_live_learning_charge();IF NOT public.settle_live_learning_charge('9700011112',(e->>'leaseId')::uuid,20000,100) THEN RAISE EXCEPTION 'Class settlement failed'; END IF;
 o:=public.reserve_live_learning_checkout('9b000000-0000-4000-8000-000000000002','service','9b000000-0000-4000-8000-000000000014','finance-fixture-service-key','finance-fixture-v1');
 IF o IS NULL THEN RAISE EXCEPTION 'Service snapshot missing'; END IF;
 PERFORM public.record_live_learning_charge(o->>'reference','9700011113',repeat('b',64));
 e:=public.claim_live_learning_charge();IF NOT public.settle_live_learning_charge('9700011113',(e->>'leaseId')::uuid,30000,200) THEN RAISE EXCEPTION 'Service settlement failed'; END IF;
 q:=public.week7_finance_report('f1910000-0000-4000-8000-000000000003',now()-interval '1 day',now()+interval '1 hour');
 SELECT v INTO lesson FROM jsonb_array_elements(q->'items') v WHERE v->>'kind'='lesson';
 SELECT v INTO class FROM jsonb_array_elements(q->'items') v WHERE v->>'kind'='class';
 SELECT v INTO service FROM jsonb_array_elements(q->'items') v WHERE v->>'kind'='service';
 IF lesson->>'creatorPendingMovementKobo' IS DISTINCT FROM '18000' OR class->>'creatorPendingMovementKobo' IS DISTINCT FROM '18000' OR service->>'creatorPendingMovementKobo' IS DISTINCT FROM '27000' OR service->>'platformPendingMovementKobo' IS DISTINCT FROM '2800' OR q->>'withdrawalAvailable'<>'false' THEN RAISE EXCEPTION 'Combined journal report mismatch'; END IF;
 BEGIN PERFORM public.week7_finance_report('9b000000-0000-4000-8000-000000000003',now()-interval '1 day',now()); RAISE EXCEPTION 'Privacy role accessed finance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('authenticated','public.week7_finance_report(uuid,timestamptz,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Direct finance RPC exposed'; END IF;
 PERFORM public.enqueue_live_reversal_event('refund.processed','9700011114',repeat('c',64));e:=public.claim_live_reversal_event();
 IF NOT public.apply_live_refund_event('9700011114',(e->>'lease')::uuid,'9700011112',20000) THEN RAISE EXCEPTION 'Fixture refund failed'; END IF;
 SELECT public.audit_live_settlement_receipts(jsonb_agg(jsonb_build_object('transactionId',transaction_id,'reference',reference,'amountKobo',amount_kobo::text,'feeKobo',fee_kobo::text))) INTO q FROM (SELECT transaction_id,reference,amount_kobo,fee_kobo FROM live_finance.receipts WHERE transaction_id='9700011111' UNION ALL SELECT transaction_id,reference,amount_kobo,fee_kobo FROM live_finance.learning_receipts WHERE transaction_id IN ('9700011112','9700011113')) x;
 IF q->>'matched'<>'2' OR q->>'reversed'<>'1' OR q->>'withdrawalEnabled'<>'false' THEN RAISE EXCEPTION 'Settlement audit mismatch %',q; END IF;
 q:=public.audit_live_settlement_receipts('[{"transactionId":"9700011199","reference":"unknown","amountKobo":"20000","feeKobo":"100"}]'::jsonb);
 IF q->>'unrecorded'<>'1' OR has_function_privilege('authenticated','public.audit_live_settlement_receipts(jsonb)','EXECUTE') OR has_function_privilege('anon','public.audit_live_settlement_receipts(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Settlement audit access mismatch'; END IF;
 BEGIN PERFORM public.audit_live_settlement_receipts('[{"transactionId":"1","reference":"x","amountKobo":"0","feeKobo":"0"}]'::jsonb); RAISE EXCEPTION 'Invalid settlement item accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"9b000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"9b000000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE q jsonb; l jsonb; c jsonb; s jsonb; BEGIN
 q:=public.my_creator_finance_report(now()-interval '1 day',now()+interval '1 hour');
 SELECT v INTO l FROM jsonb_array_elements(q->'items') v WHERE v->>'kind'='lesson';
 SELECT v INTO c FROM jsonb_array_elements(q->'items') v WHERE v->>'kind'='class';
 SELECT v INTO s FROM jsonb_array_elements(q->'items') v WHERE v->>'kind'='service';
 IF l->>'verifiedChargesKobo' IS DISTINCT FROM '0' OR c->>'creatorPendingMovementKobo' IS DISTINCT FROM '0' OR c->>'reversalsKobo' IS DISTINCT FROM '20000' OR s->>'creatorPendingMovementKobo' IS DISTINCT FROM '27000' OR s ? 'platformPendingMovementKobo' THEN RAISE EXCEPTION 'Creator journal isolation or refund reporting failed'; END IF;
 BEGIN PERFORM public.my_creator_finance_report(now()-interval '400 days',now()); RAISE EXCEPTION 'Unbounded reporting accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
DO $$ BEGIN
 IF public.creator_payout_request('list')->'balance'->>'availableKobo'<>'0' THEN RAISE EXCEPTION 'Uncleared earnings counted as money'; END IF;
 BEGIN PERFORM public.creator_payout_request('request',10000,'fixture-payout-request-1'); RAISE EXCEPTION 'Disabled payout requested'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- All policy and bank evidence below are disposable fixtures; never production terms.
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('f1910000-0000-4000-8000-000000000004','independent-finance@example.invalid',now());
INSERT INTO public.platform_staff(user_id,role,active) VALUES('f1910000-0000-4000-8000-000000000004','admin',true);
INSERT INTO public.governance_staff_role_grants(user_id,role) VALUES('f1910000-0000-4000-8000-000000000004','finance_reviewer');
UPDATE live_finance.payout_gate SET enabled=true,version='fixture-payout-policy',minimum_kobo=100,maximum_kobo=50000,approved_at=now() WHERE singleton;
INSERT INTO live_finance.payout_recipient_evidence(creator_id,recipient_reference,kyc_evidence_reference,verified_at,valid_until) VALUES('9b000000-0000-4000-8000-000000000001','fixture-recipient-ref','fixture-kyc-ref',now(),now()+interval '1 hour');
DO $$ BEGIN
 BEGIN
 INSERT INTO live_finance.payout_clearance(transaction_id,creator_id,source,settlement_reference,bank_evidence_reference,recorded_by,confirmed_by) VALUES('9700011112','9b000000-0000-4000-8000-000000000001','learning','fixture-settlement-ref','fixture-bank-ref','f1910000-0000-4000-8000-000000000003','f1910000-0000-4000-8000-000000000004');
 RAISE EXCEPTION 'Reversed receipt cleared'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO live_finance.payout_clearance(transaction_id,creator_id,source,settlement_reference,bank_evidence_reference,recorded_by,confirmed_by) VALUES('9700011113','9b000000-0000-4000-8000-000000000001','learning','fixture-settlement-ref','fixture-bank-ref','f1910000-0000-4000-8000-000000000003','f1910000-0000-4000-8000-000000000004');
SET LOCAL ROLE authenticated;
DO $$ DECLARE q jsonb; BEGIN
 IF public.creator_payout_request('list')->'balance'->>'availableKobo'<>'27000' THEN RAISE EXCEPTION 'Cleared earnings mismatch'; END IF;
 BEGIN PERFORM public.creator_payout_request('request',28000,'fixture-payout-excess-key'); RAISE EXCEPTION 'Overdraw allowed'; EXCEPTION WHEN unique_violation THEN NULL; END;
 q:=public.creator_payout_request('request',10000,'fixture-payout-request-1');
 IF q->>'state'<>'pending_review' OR q->>'transferEnabled'<>'false' THEN RAISE EXCEPTION 'Payout state invalid'; END IF;
 IF public.creator_payout_request('request',10000,'fixture-payout-request-1')->>'replayed'<>'true' THEN RAISE EXCEPTION 'Payout replay invalid'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE r uuid; q jsonb; BEGIN
 SELECT id INTO r FROM live_finance.payout_requests WHERE request_key='fixture-payout-request-1';
 BEGIN PERFORM public.week7_review_payout('9b000000-0000-4000-8000-000000000003',r,'reserve','Synthetic denial'); RAISE EXCEPTION 'Privacy reviewer can reserve'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 q:=public.week7_review_payout('f1910000-0000-4000-8000-000000000003',r,'reserve','Synthetic finance review');
 IF q->>'state'<>'reserved' OR q->>'transferEnabled'<>'false' OR live_finance.payout_balance('9b000000-0000-4000-8000-000000000001')->>'availableKobo'<>'17000' THEN RAISE EXCEPTION 'Reservation mismatch'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r uuid; BEGIN
 r:=(public.creator_payout_request('list')->'items'->0->>'id')::uuid;
 IF public.creator_payout_request('cancel',NULL,NULL,r)->>'state'<>'cancelled' OR public.creator_payout_request('list')->'balance'->>'availableKobo'<>'27000' THEN RAISE EXCEPTION 'Reservation release mismatch'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"9b000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"9b000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN IF jsonb_array_length(public.creator_payout_request('list')->'items')<>0 OR public.creator_payout_request('list')->'balance'->>'availableKobo'<>'0' THEN RAISE EXCEPTION 'Cross-creator payout disclosure'; END IF; END $$;
RESET ROLE;
ROLLBACK;
