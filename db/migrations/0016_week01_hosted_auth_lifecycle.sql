-- One-seat staging invite and generic recovery-request queue.
-- No raw email, password, OTP, access token or refresh token stored here.
CREATE TABLE public.hosted_auth_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('invite','sign-in','complete','recover','refresh')),
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hosted_auth_attempt_time ON public.hosted_auth_attempts(created_at);
CREATE INDEX hosted_auth_attempt_digest ON public.hosted_auth_attempts(kind,request_digest,created_at);
CREATE TABLE public.hosted_pilot_invitation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 recipient_digest text NOT NULL CHECK(recipient_digest ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('claimed','requested','uncertain')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hosted_recovery_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_digest text NOT NULL CHECK(recipient_digest ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','requested','uncertain')),
 lease_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 CHECK((state='claimed')=(lease_id IS NOT NULL))
);
ALTER TABLE public.hosted_auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_recovery_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hosted_auth_attempts,public.hosted_pilot_invitation,public.hosted_recovery_jobs FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.admit_hosted_auth_attempt(_kind text,_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF _kind IS NULL OR _kind NOT IN ('invite','sign-in','complete','recover','refresh')
 OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(7821162026);
 DELETE FROM public.hosted_auth_attempts WHERE created_at<now()-interval '24 hours';
 IF (SELECT count(*) FROM public.hosted_auth_attempts WHERE created_at>now()-interval '1 hour')>=120
 OR (SELECT count(*) FROM public.hosted_auth_attempts WHERE kind=_kind AND request_digest=_digest AND created_at>now()-interval '1 hour')>=
 CASE WHEN _kind='refresh' THEN 30 ELSE 8 END THEN RETURN false; END IF;
 INSERT INTO public.hosted_auth_attempts(kind,request_digest) VALUES(_kind,_digest);
 RETURN true;
END $$;
CREATE FUNCTION public.claim_hosted_pilot_invite(_recipient text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF _recipient IS NULL OR _recipient !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 INSERT INTO public.hosted_pilot_invitation(singleton,recipient_digest,state) VALUES(true,_recipient,'claimed')
 ON CONFLICT(singleton) DO NOTHING;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.finish_hosted_pilot_invite(_recipient text,_state text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF _state IS NULL OR _state NOT IN ('requested','uncertain') THEN RETURN false; END IF;
 UPDATE public.hosted_pilot_invitation SET state=_state WHERE singleton=true AND recipient_digest=_recipient AND state='claimed';
 RETURN FOUND;
END $$;
-- Return nothing account-specific; provider work is deliberately asynchronous.
CREATE FUNCTION public.enqueue_hosted_recovery(_recipient text,_eligible boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF _recipient IS NULL OR _recipient !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(7821172026);
 IF _eligible IS NOT TRUE THEN RETURN true; END IF;
 UPDATE public.hosted_recovery_jobs SET state='uncertain',lease_id=NULL
 WHERE state='claimed' AND claimed_at<now()-interval '5 minutes';
 IF EXISTS(SELECT 1 FROM public.hosted_recovery_jobs WHERE recipient_digest=_recipient
 AND (state IN ('pending','claimed') OR created_at>now()-interval '5 minutes'))
 OR (SELECT count(*) FROM public.hosted_recovery_jobs WHERE recipient_digest=_recipient AND created_at>now()-interval '1 hour')>=3
 THEN RETURN true; END IF;
 INSERT INTO public.hosted_recovery_jobs(recipient_digest) VALUES(_recipient);
 RETURN true;
END $$;
CREATE FUNCTION public.claim_hosted_recovery(_recipient text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.hosted_recovery_jobs;
BEGIN
 SELECT * INTO r FROM public.hosted_recovery_jobs WHERE recipient_digest=_recipient AND state='pending'
 AND created_at>now()-interval '10 minutes' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN
  UPDATE public.hosted_recovery_jobs SET state='uncertain' WHERE recipient_digest=_recipient AND state='pending' AND created_at<=now()-interval '10 minutes';
  RETURN NULL;
 END IF;
 UPDATE public.hosted_recovery_jobs SET state='claimed',lease_id=gen_random_uuid(),claimed_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id,'leaseId',r.lease_id);
END $$;
CREATE FUNCTION public.finish_hosted_recovery(_id uuid,_lease uuid,_state text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF _state IS NULL OR _state NOT IN ('requested','uncertain') THEN RETURN false; END IF;
 UPDATE public.hosted_recovery_jobs SET state=_state,lease_id=NULL WHERE id=_id AND lease_id=_lease AND state='claimed'
 AND claimed_at>now()-interval '5 minutes';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.admit_hosted_auth_attempt(text,text),public.claim_hosted_pilot_invite(text),
 public.finish_hosted_pilot_invite(text,text),public.enqueue_hosted_recovery(text,boolean),
 public.claim_hosted_recovery(text),public.finish_hosted_recovery(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_hosted_auth_attempt(text,text),public.claim_hosted_pilot_invite(text),
 public.finish_hosted_pilot_invite(text,text),public.enqueue_hosted_recovery(text,boolean),
 public.claim_hosted_recovery(text),public.finish_hosted_recovery(uuid,uuid,text) TO service_role;
