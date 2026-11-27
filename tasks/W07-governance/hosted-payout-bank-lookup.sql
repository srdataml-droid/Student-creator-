-- Dedicated, server-only lookup admission. Does not enable payouts or
-- write recipient ownership evidence. Apply only after independent review.
CREATE SCHEMA student_payout_private;
REVOKE ALL ON SCHEMA student_payout_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA student_payout_private TO service_role;
CREATE TABLE student_payout_private.bank_lookup_attempts(
 actor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('banks','resolve')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX bank_lookup_attempt_time ON student_payout_private.bank_lookup_attempts(created_at);
CREATE INDEX bank_lookup_actor_time ON student_payout_private.bank_lookup_attempts(actor_id,kind,created_at);
ALTER TABLE student_payout_private.bank_lookup_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON student_payout_private.bank_lookup_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON student_payout_private.bank_lookup_attempts TO service_role;

-- The caller is a trusted server that has verified the bearer remotely.
-- Recheck the exact session and current eligibility before admitting a lookup.
-- Only actor ID, operation and timestamp are retained; never bank details.
CREATE FUNCTION public.admit_creator_bank_lookup(_actor uuid,_session uuid,_kind text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE at_time timestamptz;
BEGIN
 IF _actor IS NULL OR _session IS NULL OR _kind IS NULL OR _kind NOT IN ('banks','resolve')
 OR public.student_creators_session_active(_actor,_session) IS DISTINCT FROM true
 OR public.affiliation_eligible(_actor) IS DISTINCT FROM true THEN RETURN false; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('student_creators_bank_lookup',0));
 at_time:=clock_timestamp();
 DELETE FROM student_payout_private.bank_lookup_attempts WHERE created_at<at_time-interval '24 hours';
 IF (SELECT count(*) FROM student_payout_private.bank_lookup_attempts WHERE created_at>at_time-interval '1 hour')>=200
 OR (SELECT count(*) FROM student_payout_private.bank_lookup_attempts WHERE actor_id=_actor AND kind=_kind AND created_at>at_time-interval '1 hour')>=(CASE WHEN _kind='resolve' THEN 5 ELSE 10 END)
 THEN RETURN false; END IF;
 INSERT INTO student_payout_private.bank_lookup_attempts(actor_id,kind,created_at) VALUES(_actor,_kind,at_time);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admit_creator_bank_lookup(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admit_creator_bank_lookup(uuid,uuid,text) TO service_role;
