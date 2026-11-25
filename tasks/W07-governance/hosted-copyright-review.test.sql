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

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('ad000000-0000-4000-8000-000000000001','copyright-reviewer@example.invalid',now()),('ad000000-0000-4000-8000-000000000002','copyright-appeal-reviewer@example.invalid',now()),('ad000000-0000-4000-8000-000000000003','copyright-finance@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE 'f1910000-%';
INSERT INTO public.platform_staff(user_id,role,active) VALUES('ad000000-0000-4000-8000-000000000001','moderator',true),('ad000000-0000-4000-8000-000000000002','moderator',true),('ad000000-0000-4000-8000-000000000003','admin',true);
INSERT INTO public.governance_staff_role_grants(user_id,role) VALUES('ad000000-0000-4000-8000-000000000001','content_moderator'),('ad000000-0000-4000-8000-000000000002','content_moderator'),('ad000000-0000-4000-8000-000000000003','finance_reviewer');
UPDATE live_finance.runtime_gate SET allow_checkout=true,terms_version='copyright-fixture-v1',refund_policy_version='copyright-fixture-refunds',platform_fee_bps=1000,fee_bearer='platform',license_seconds=3600,approved_at=now() WHERE singleton;
DO $$ DECLARE o jsonb; BEGIN
 o:=public.reserve_live_paystack_checkout('f1910000-0000-4000-8000-000000000002','f1950000-0000-4000-8000-000000000001','copyright-fixture-payment-key','copyright-fixture-v1');
 IF o IS NULL THEN RAISE EXCEPTION 'Paid entitlement fixture missing'; END IF;
 PERFORM public.live_apply_charge(o->>'reference','9800012345',20000,'NGN','live','buyer@example.invalid',100);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1910000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"f1910000-0000-4000-8000-000000000002","role":"authenticated","session_id":"f1910000-0000-4000-8000-000000000002"}',true);
SELECT public.copyright_action('submit','f1950000-0000-4000-8000-000000000001','Synthetic copyright assertion requiring human evidence review');
DO $$ BEGIN
 IF jsonb_array_length(public.my_copyright_cases())<>1 OR public.my_copyright_cases()::text LIKE '%claimant_id%' THEN RAISE EXCEPTION 'Claim ownership boundary'; END IF;
 IF NOT public.can_view_published_content('f1950000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Unreviewed claim removed content'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE r uuid:='ad000000-0000-4000-8000-000000000001'; f uuid:='ad000000-0000-4000-8000-000000000003'; c uuid:='f1950000-0000-4000-8000-000000000001'; a uuid; q jsonb;
BEGIN
 SELECT id INTO a FROM public.copyright_claims WHERE content_id=c;
 IF jsonb_array_length(public.week7_copyright_queue(r,10)->'items')<>1 THEN RAISE EXCEPTION 'Queue failed'; END IF;
 BEGIN PERFORM public.week7_copyright_queue(f,10); RAISE EXCEPTION 'Finance read copyright queue'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 q:=public.week7_review_copyright(r,a,'uphold','Synthetic reviewed takedown decision');
 IF q->>'accessReviewCases'<>'1' OR q->>'refundIssued'<>'false' OR (SELECT status FROM public.content_items WHERE id=c)<>'taken_down' OR public.authorized_mux_live_playback('f1910000-0000-4000-8000-000000000002',c) IS NOT NULL THEN RAISE EXCEPTION 'Takedown or paid review missing'; END IF;
 BEGIN UPDATE public.content_items SET status='published' WHERE id=c; RAISE EXCEPTION 'Copyright hold bypass'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM public.entitlements WHERE content_id=c AND state='active') THEN RAISE EXCEPTION 'Takedown destroyed entitlement'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1910000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"f1910000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f1910000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE a uuid; BEGIN
 a:=(public.my_copyright_cases()->0->>'id')::uuid;
 PERFORM public.copyright_action('appeal',a,'Synthetic creator appeal with supporting explanation');
END $$;
RESET ROLE;
DO $$ DECLARE a uuid; c uuid:='f1950000-0000-4000-8000-000000000001'; BEGIN
 SELECT id INTO a FROM public.copyright_claims WHERE content_id=c;
 BEGIN PERFORM public.week7_review_copyright('ad000000-0000-4000-8000-000000000001',a,'release','First reviewer cannot decide appeal'); RAISE EXCEPTION 'Self-reviewed appeal'; EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM public.week7_review_copyright('ad000000-0000-4000-8000-000000000002',a,'release','Independent synthetic appeal decision');
 IF (SELECT status FROM public.content_items WHERE id=c)<>'taken_down' THEN RAISE EXCEPTION 'Appeal automatically republished'; END IF;
 IF has_function_privilege('authenticated','public.week7_review_copyright(uuid,uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Direct moderation bypass'; END IF;
END $$;
ROLLBACK;
