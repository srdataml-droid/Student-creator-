-- Durable privacy-minimal Supabase Auth email delivery ledger.
-- No email addresses, OTPs, URLs, raw webhook bodies or provider secrets.
CREATE TABLE public.auth_email_deliveries (
 delivery_key text PRIMARY KEY CHECK(delivery_key ~ '^[0-9a-f]{64}$'),
 message_digest text NOT NULL CHECK(message_digest ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('pending','sending','sent')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 lease_id uuid,lease_until timestamptz,
 next_retry_at timestamptz NOT NULL DEFAULT now(),
 provider_id text CHECK(provider_id ~ '^[A-Za-z0-9_-]{6,128}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 CHECK((lease_id IS NULL)=(lease_until IS NULL)),
 CHECK((state='sending')=(lease_id IS NOT NULL)),
 CHECK(state<>'sent' OR (provider_id IS NOT NULL AND sent_at IS NOT NULL))
);
ALTER TABLE public.auth_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_email_deliveries FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_auth_email_delivery(_key text,_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.auth_email_deliveries;
BEGIN
 IF _key IS NULL OR _key !~ '^[0-9a-f]{64}$' OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$'
 THEN RETURN jsonb_build_object('status','invalid'); END IF;
 -- One authorized pilot; serialize new event admission and cap per rolling hour.
 PERFORM pg_advisory_xact_lock(7821132026);
 SELECT * INTO r FROM public.auth_email_deliveries WHERE delivery_key=_key FOR UPDATE;
 IF NOT FOUND THEN
  IF (SELECT count(*) FROM public.auth_email_deliveries WHERE created_at>now()-interval '1 hour')>=10
  THEN RETURN jsonb_build_object('status','limited'); END IF;
  INSERT INTO public.auth_email_deliveries(delivery_key,message_digest,state) VALUES(_key,_digest,'pending') RETURNING * INTO r;
 END IF;
 IF r.message_digest<>_digest THEN RETURN jsonb_build_object('status','collision'); END IF;
 IF r.state='sent' THEN RETURN jsonb_build_object('status','duplicate'); END IF;
 -- Resend idempotency keys are time-limited; never auto-send after 23 hours.
 IF r.attempts>=5 OR r.created_at<=now()-interval '23 hours' THEN RETURN jsonb_build_object('status','expired'); END IF;
 IF r.next_retry_at>now() OR (r.lease_until IS NOT NULL AND r.lease_until>now())
 THEN RETURN jsonb_build_object('status','busy'); END IF;
 UPDATE public.auth_email_deliveries SET state='sending',attempts=attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '60 seconds'
 WHERE delivery_key=_key RETURNING * INTO r;
 RETURN jsonb_build_object('status','claimed','leaseId',r.lease_id);
END $$;

CREATE FUNCTION public.finish_auth_email_delivery(_key text,_lease uuid,_provider_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF _provider_id IS NOT NULL AND _provider_id !~ '^[A-Za-z0-9_-]{6,128}$' THEN RETURN false; END IF;
 UPDATE public.auth_email_deliveries SET state=CASE WHEN _provider_id IS NULL THEN 'pending' ELSE 'sent' END,
 provider_id=_provider_id,sent_at=CASE WHEN _provider_id IS NULL THEN NULL ELSE now() END,
 lease_id=NULL,lease_until=NULL,next_retry_at=now()+make_interval(secs=>30*attempts)
 WHERE delivery_key=_key AND state='sending' AND lease_id=_lease AND lease_until>now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_auth_email_delivery(text,text),public.finish_auth_email_delivery(text,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auth_email_delivery(text,text),public.finish_auth_email_delivery(text,uuid,text) TO service_role;
