\set ON_ERROR_STOP on
BEGIN;
UPDATE public.platform_staff SET role='admin' WHERE user_id='99999999-9999-4999-8999-999999999999';
-- CI-only session fixtures inside this rollback transaction.
UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at,now()) WHERE email_confirmed_at IS NULL;
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users ON CONFLICT(id) DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true), set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated','session_id','11111111-1111-4111-8111-111111111111')::text,true);
SELECT public.social_message_action('preference',_enabled=>true);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true), set_config('request.jwt.claims',jsonb_build_object('sub','22222222-2222-4222-8222-222222222222','role','authenticated','session_id','22222222-2222-4222-8222-222222222222')::text,true);
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','Synthetic private evidence');
DO $$ DECLARE mid uuid; BEGIN
 SELECT id INTO STRICT mid FROM public.social_messages;
 BEGIN PERFORM public.social_abuse_report('message',mid,'spam','Reporting own outgoing message'); RAISE EXCEPTION 'sender report accepted'; EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN PERFORM public.social_report_queue('message'); RAISE EXCEPTION 'student read report queue'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_table_privilege(current_user,'public.social_abuse_reports','SELECT') THEN RAISE EXCEPTION 'raw reports exposed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true), set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated','session_id','11111111-1111-4111-8111-111111111111')::text,true);
DO $$ DECLARE mid uuid; rid uuid; BEGIN
 SELECT id INTO STRICT mid FROM public.social_messages;
 rid:=(public.social_abuse_report('message',mid,'spam','Recipient reports synthetic message')->>'id')::uuid;
 BEGIN PERFORM public.social_abuse_report('message',mid,'spam','Duplicate message report'); RAISE EXCEPTION 'duplicate report accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM public.social_abuse_report('account','22222222-2222-4222-8222-222222222222','harassment','Established contact report');
 BEGIN PERFORM public.social_review_report('message',rid,'review','Unauthorized review'); RAISE EXCEPTION 'student reviewed case'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true), set_config('request.jwt.claims',jsonb_build_object('sub','99999999-9999-4999-8999-999999999999','role','authenticated','session_id','99999999-9999-4999-8999-999999999999')::text,true);
DO $$ DECLARE queue jsonb; rid uuid; BEGIN
 queue:=public.social_report_queue('message');
 IF jsonb_array_length(queue)<>1 OR queue->0->>'body'<>'Synthetic private evidence' THEN RAISE EXCEPTION 'reported evidence not correctly scoped'; END IF;
 rid:=(queue->0->>'id')::uuid;
 IF public.social_review_report('message',rid,'review','Independent synthetic review')->>'status'<>'reviewed' THEN RAISE EXCEPTION 'case not reviewed'; END IF;
 IF jsonb_array_length(public.social_report_queue('message'))<>0 OR jsonb_array_length(public.social_report_queue('account'))<>1 THEN RAISE EXCEPTION 'review affected other queue'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id='22222222-2222-4222-8222-222222222222' AND suspended) THEN RAISE EXCEPTION 'report auto suspended student'; END IF; END $$;
ROLLBACK;
\echo 'PASS: recipient report, private queues, admin-only review, duplicate protection and no automatic sanctions';
