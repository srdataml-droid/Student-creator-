BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('8a000000-0000-4000-8000-000000000001','moderator-fixture@example.invalid',now()),('8a000000-0000-4000-8000-000000000002','finance-fixture@example.invalid',now()),('8a000000-0000-4000-8000-000000000003','legacy-admin-fixture@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE '8a000000-%';
INSERT INTO public.platform_staff(user_id,role,active) VALUES('8a000000-0000-4000-8000-000000000001','moderator',true),('8a000000-0000-4000-8000-000000000002','admin',true),('8a000000-0000-4000-8000-000000000003','admin',true);
INSERT INTO public.governance_staff_role_grants(user_id,role) VALUES('8a000000-0000-4000-8000-000000000001','content_moderator'),('8a000000-0000-4000-8000-000000000002','finance_reviewer');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8a000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"8a000000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN
 IF public.social_session_state()->>'admin'<>'true' OR jsonb_typeof(public.social_report_queue('message',10))<>'array' THEN RAISE EXCEPTION 'scoped moderator denied'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','8a000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"8a000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
 IF public.social_session_state()->>'admin'<>'false' THEN RAISE EXCEPTION 'finance granted moderation'; END IF;
 BEGIN PERFORM public.social_report_queue('message',10); RAISE EXCEPTION 'finance read message reports'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','8a000000-0000-4000-8000-000000000003',true),set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"8a000000-0000-4000-8000-000000000003"}',true);
DO $$ BEGIN
 IF public.social_session_state()->>'admin'<>'false' THEN RAISE EXCEPTION 'legacy admin bypassed scope'; END IF;
 BEGIN PERFORM public.social_report_queue('account',10); RAISE EXCEPTION 'legacy admin read reports'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
