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

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('ae000000-0000-4000-8000-000000000001','access-finance@example.invalid',now()),('ae000000-0000-4000-8000-000000000002','access-moderator@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE 'f1910000-%';
INSERT INTO public.platform_staff(user_id,role,active) VALUES('ae000000-0000-4000-8000-000000000001','admin',true),('ae000000-0000-4000-8000-000000000002','moderator',true);
INSERT INTO public.governance_staff_role_grants(user_id,role) VALUES('ae000000-0000-4000-8000-000000000001','finance_reviewer'),('ae000000-0000-4000-8000-000000000002','content_moderator');
UPDATE live_finance.runtime_gate SET allow_checkout=true,terms_version='access-fixture-v1',refund_policy_version='access-fixture-refunds',platform_fee_bps=1000,fee_bearer='platform',license_seconds=3600,approved_at=now() WHERE singleton;
DO $$ DECLARE o jsonb; BEGIN
 o:=public.reserve_live_paystack_checkout('f1910000-0000-4000-8000-000000000002','f1950000-0000-4000-8000-000000000001','access-fixture-payment-key','access-fixture-v1');
 IF o IS NULL THEN RAISE EXCEPTION 'Payment fixture missing'; END IF;
 PERFORM public.live_apply_charge(o->>'reference','9800023456',20000,'NGN','live','buyer@example.invalid',100);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1910000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"f1910000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f1910000-0000-4000-8000-000000000001"}',true);
SELECT public.social_set_creator_restriction('f1910000-0000-4000-8000-000000000002',true,false,false);
RESET ROLE;
DO $$ DECLARE f uuid:='ae000000-0000-4000-8000-000000000001'; m uuid:='ae000000-0000-4000-8000-000000000002'; c uuid;
BEGIN
 SELECT id INTO c FROM public.social_creator_access_review_cases WHERE status='open';
 IF c IS NULL OR jsonb_array_length(public.week7_paid_access_queue(f,10)->'items')<>1 THEN RAISE EXCEPTION 'Access case missing'; END IF;
 BEGIN PERFORM public.week7_paid_access_queue(m,10); RAISE EXCEPTION 'Wrong finance scope'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.week7_resolve_paid_access(f,c,'access_available','Access remains blocked by creator'); RAISE EXCEPTION 'Blocked access marked delivered'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM public.week7_resolve_paid_access(f,c,'verified_reversal','No actual refund evidence exists'); RAISE EXCEPTION 'Unverified reversal accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1910000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"f1910000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f1910000-0000-4000-8000-000000000001"}',true);
SELECT public.social_set_creator_restriction('f1910000-0000-4000-8000-000000000002',false,false,false);
RESET ROLE;
DO $$ DECLARE c uuid; q jsonb; BEGIN
 SELECT id INTO c FROM public.social_creator_access_review_cases WHERE status='open';
 q:=public.week7_resolve_paid_access('ae000000-0000-4000-8000-000000000001',c,'access_available','Canonical playback authorization restored');
 IF q->>'status'<>'resolved' OR q->>'refundIssued'<>'false' THEN RAISE EXCEPTION 'Restoration review failed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1910000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"f1910000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f1910000-0000-4000-8000-000000000001"}',true);
SELECT public.social_set_creator_restriction('f1910000-0000-4000-8000-000000000002',true,false,false);
RESET ROLE;
DO $$ DECLARE c uuid; e jsonb; ref text;
BEGIN
 SELECT id INTO c FROM public.social_creator_access_review_cases WHERE status='open';
 SELECT reference INTO ref FROM live_finance.receipts WHERE transaction_id='9800023456';
 PERFORM public.enqueue_live_reversal_event('refund.processed','9800023457',repeat('a',64));
 e:=public.claim_live_reversal_event();
 IF NOT public.apply_live_refund_event('9800023457',(e->>'lease')::uuid,'9800023456',20000) THEN RAISE EXCEPTION 'Fixture reversal failed'; END IF;
 PERFORM public.week7_resolve_paid_access('ae000000-0000-4000-8000-000000000001',c,'verified_reversal','Verified primary refund evidence reconciled');
 IF (SELECT resolution FROM public.social_creator_access_review_cases WHERE id=c)<>'verified_reversal' OR has_function_privilege('authenticated','public.week7_resolve_paid_access(uuid,uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Access review evidence boundary failed'; END IF;
END $$;
ROLLBACK;
