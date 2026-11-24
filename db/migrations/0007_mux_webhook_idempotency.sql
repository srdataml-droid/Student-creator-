-- Week 1: durable Mux webhook ingest gate, extension of existing generic webhook_events.
-- Apply ONLY after reviewing all prior migrations on isolated Student Creators staging.
-- No provider calls, secrets, production student identities or live funds.
-- The HTTP server MUST verify Mux-Signature against raw body first; never let
-- a request choose its own "verified" status or call this RPC directly.
--
-- No duplicate event processing: provider+stable_event_key is unique in 0001.
-- A reused event ID with different raw-body digest is reported as a collision.
-- Existing event's status/attempt_count are NEVER overwritten by redelivery.
CREATE OR REPLACE FUNCTION public.ingest_verified_mux_event(
  _stable_event_key text,
  _payload_sha256 text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  inserted_count integer;
  existing_digest text;
BEGIN
  IF _stable_event_key IS NULL OR
     _stable_event_key !~ '^[A-Za-z0-9_-]{3,128}$' THEN
    RAISE EXCEPTION 'Invalid Mux event key' USING ERRCODE = '22023';
  END IF;
  IF _payload_sha256 IS NULL OR
     _payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid Mux payload digest' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.webhook_events(
    provider, stable_event_key, payload_sha256, status
  ) VALUES (
    'mux', _stable_event_key, _payload_sha256, 'received'
  )
  ON CONFLICT (provider, stable_event_key) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 1 THEN
    RETURN 'accepted';
  END IF;

  -- A conflicting concurrent insert blocks at ON CONFLICT until the
  -- competing transaction resolves. This transaction then inspects the
  -- single durable row and cannot erase a processing/processed state.
  SELECT e.payload_sha256 INTO existing_digest
    FROM public.webhook_events e
   WHERE e.provider = 'mux' AND e.stable_event_key = _stable_event_key
   FOR UPDATE;
  IF existing_digest IS NULL THEN
    RAISE EXCEPTION 'Mux event contention; retry safely' USING ERRCODE = '40001';
  END IF;
  IF existing_digest <> _payload_sha256 THEN
    RETURN 'collision';
  END IF;
  RETURN 'duplicate';
END;
$$;

-- No direct anonymous/authenticated execution, even for signed-in students.
-- SECURITY DEFINER is restricted to service_role and uses no dynamic SQL.
REVOKE ALL ON FUNCTION public.ingest_verified_mux_event(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_verified_mux_event(text,text)
  TO service_role;

-- This RPC ONLY records a verified event; it does not execute any event
-- mutation, authorize a video for publication, issue playback tokens,
-- or perform retry leasing. Those remain separate reviewed Week 1 tasks.
