-- Disposable restored database ONLY, never production.
DO $$ BEGIN
 IF current_database()<>'campus_ci_restore' THEN RAISE EXCEPTION 'Not isolated restore target'; END IF;
 IF (SELECT count(*) FROM public.student_profiles WHERE institution_id='f2020000-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'Missing restored profiles'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.webhook_events WHERE provider='mux' AND stable_event_key='fixture_restore_20' AND status='received') THEN RAISE EXCEPTION 'Missing durable event'; END IF;
 IF to_regprocedure('public.claim_mux_test_event()') IS NULL OR to_regprocedure('public.student_creators_session_active(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'Missing restored functions'; END IF;
 IF has_function_privilege('anon','public.claim_mux_test_event()','EXECUTE') OR has_function_privilege('authenticated','public.claim_mux_test_event()','EXECUTE') OR NOT has_function_privilege('service_role','public.claim_mux_test_event()','EXECUTE') THEN RAISE EXCEPTION 'Restore changed worker privileges'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('student_profiles','mux_video_uploads','webhook_events') AND NOT c.relrowsecurity) THEN RAISE EXCEPTION 'Restore lost RLS'; END IF;
END $$;
BEGIN;
SET LOCAL request.jwt.claim.sub='f2010000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims='{"sub":"f2010000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f2030000-0000-4000-8000-000000000001"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id='f2010000-0000-4000-8000-000000000001') OR EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id='f2010000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'Restored profile isolation broken'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: disposable database restore preserved records, RLS and restricted RPCs' AS evidence;
