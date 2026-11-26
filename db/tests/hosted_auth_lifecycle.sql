BEGIN;
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.hosted_auth_attempts','SELECT')
 OR has_function_privilege('anon','public.claim_hosted_pilot_invite(text)','EXECUTE')
 OR has_function_privilege('authenticated','public.enqueue_hosted_recovery(text,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'Auth lifecycle privilege leak'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE d text:=repeat('a',64); r jsonb; i integer; BEGIN
 FOR i IN 1..8 LOOP IF NOT public.admit_hosted_auth_attempt('recover',d) THEN RAISE EXCEPTION 'Premature throttle'; END IF; END LOOP;
 IF public.admit_hosted_auth_attempt('recover',d) THEN RAISE EXCEPTION 'Rate cap bypassed'; END IF;
 IF NOT public.claim_hosted_pilot_invite(d) OR public.claim_hosted_pilot_invite(repeat('b',64)) THEN RAISE EXCEPTION 'One-seat gate failed'; END IF;
 IF NOT public.finish_hosted_pilot_invite(d,'requested') THEN RAISE EXCEPTION 'Invite finalization failed'; END IF;
 IF NOT public.enqueue_hosted_recovery(d,false) OR public.claim_hosted_recovery(d) IS NOT NULL THEN RAISE EXCEPTION 'Unknown address queued'; END IF;
 IF NOT public.enqueue_hosted_recovery(d,true) THEN RAISE EXCEPTION 'Recovery queue failed'; END IF;
 IF NOT public.enqueue_hosted_recovery(d,true) THEN RAISE EXCEPTION 'Duplicate response changed'; END IF;
 r:=public.claim_hosted_recovery(d);
 IF r IS NULL OR public.claim_hosted_recovery(d) IS NOT NULL THEN RAISE EXCEPTION 'Duplicate recovery claim'; END IF;
 IF public.finish_hosted_recovery((r->>'id')::uuid,gen_random_uuid(),'requested') THEN RAISE EXCEPTION 'Wrong recovery lease'; END IF;
 IF NOT public.finish_hosted_recovery((r->>'id')::uuid,(r->>'leaseId')::uuid,'uncertain') THEN RAISE EXCEPTION 'Uncertain state failed'; END IF;
 IF public.claim_hosted_recovery(d) IS NOT NULL THEN RAISE EXCEPTION 'Uncertain request automatically repeated'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.hosted_recovery_jobs)<>1 OR (SELECT count(*) FROM public.hosted_pilot_invitation)<>1
 THEN RAISE EXCEPTION 'Duplicate invite or recovery state'; END IF;
END $$;
ROLLBACK;
