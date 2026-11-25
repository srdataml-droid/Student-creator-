-- Disposable CI or dedicated hosted staging only; no Auth API registration.
BEGIN;
INSERT INTO auth.users(id,email_confirmed_at,is_anonymous)
VALUES ('f1010000-0000-4000-8000-000000000001',now(),false),
       ('f1010000-0000-4000-8000-000000000002',now(),false);
INSERT INTO auth.sessions(id,user_id,not_after)
VALUES ('f1020000-0000-4000-8000-000000000001','f1010000-0000-4000-8000-000000000001',now()+interval '1 hour'),
       ('f1020000-0000-4000-8000-000000000002','f1010000-0000-4000-8000-000000000001',now()-interval '1 hour');
DO $$ BEGIN
 IF has_function_privilege('anon','public.student_creators_session_active(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.student_creators_session_active(uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.student_creators_session_active(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Unexpected session RPC grants'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF NOT public.student_creators_session_active('f1010000-0000-4000-8000-000000000001','f1020000-0000-4000-8000-000000000001')
 OR public.student_creators_session_active('f1010000-0000-4000-8000-000000000002','f1020000-0000-4000-8000-000000000001')
 OR public.student_creators_session_active('f1010000-0000-4000-8000-000000000001','f1020000-0000-4000-8000-000000000002')
 OR public.student_creators_session_active('f1010000-0000-4000-8000-000000000001','f1020000-0000-4000-8000-000000000003')
 OR public.student_creators_session_active(NULL,NULL)
 THEN RAISE EXCEPTION 'Session ownership/expiry boundary failed'; END IF;
END $$;
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='f1010000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.student_creators_session_active('f1010000-0000-4000-8000-000000000001','f1020000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'Banned user accepted'; END IF;
END $$;
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='f1010000-0000-4000-8000-000000000001';
DELETE FROM auth.sessions WHERE id='f1020000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.student_creators_session_active('f1010000-0000-4000-8000-000000000001','f1020000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'Removed session accepted'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
