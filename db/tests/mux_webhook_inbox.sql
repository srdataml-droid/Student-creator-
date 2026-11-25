-- Week 1, disposable PostgreSQL: no live webhook requests or money.
-- Run AFTER migrations 0001..0007 and the existing SQL contract fixture.
\set ON_ERROR_STOP on
\echo 'Mux verified webhook inbox: unique IDs, collision detection, least privilege'
-- Existing Paystack event namespace must stay distinct.
INSERT INTO public.webhook_events(provider,stable_event_key,payload_sha256,status)
VALUES('paystack','shared_event_id_001',repeat('a',64),'processed');

SET ROLE service_role;
DO $$
DECLARE outcome text;
BEGIN
  SELECT public.ingest_verified_mux_event('shared_event_id_001',repeat('a',64))
    INTO outcome;
  IF outcome <> 'accepted' THEN RAISE EXCEPTION 'Mux event collided with Paystack namespace'; END IF;
  SELECT public.ingest_verified_mux_event('shared_event_id_001',repeat('a',64))
    INTO outcome;
  IF outcome <> 'duplicate' THEN RAISE EXCEPTION 'Duplicate Mux delivery accepted twice'; END IF;
  SELECT public.ingest_verified_mux_event('shared_event_id_001',repeat('b',64))
    INTO outcome;
  IF outcome <> 'collision' THEN RAISE EXCEPTION 'Reused Mux ID with different body was accepted'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.webhook_events
  WHERE stable_event_key = 'shared_event_id_001';
  IF n <> 2 THEN RAISE EXCEPTION 'Provider event keys not namespaced'; END IF;
  UPDATE public.webhook_events SET status='processed',attempt_count=2
  WHERE provider='mux' AND stable_event_key='shared_event_id_001';
END $$;

SET ROLE service_role;
DO $$
DECLARE outcome text;
BEGIN
  SELECT public.ingest_verified_mux_event('shared_event_id_001',repeat('a',64))
    INTO outcome;
  IF outcome <> 'duplicate' THEN RAISE EXCEPTION 'Processed Mux replay changed outcome'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE actual_status text; tries integer; digest text;
BEGIN
  SELECT status,attempt_count,payload_sha256 INTO actual_status,tries,digest
  FROM public.webhook_events WHERE provider='mux' AND stable_event_key='shared_event_id_001';
  IF actual_status <> 'processed' OR tries <> 2 OR digest <> repeat('a',64) THEN
    RAISE EXCEPTION 'Duplicate replay reset processed event or modified payload';
  END IF;
END $$;

-- Bad keys and fingerprints never create records.
SET ROLE service_role;
DO $$
DECLARE bad_key text; bad_hash text;
BEGIN
  FOREACH bad_key IN ARRAY ARRAY['', 'xx', '../foreign', 'two words'] LOOP
    BEGIN
      PERFORM public.ingest_verified_mux_event(bad_key, repeat('c',64));
      RAISE EXCEPTION 'Invalid event key accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  FOREACH bad_hash IN ARRAY ARRAY['', 'not_sha256', repeat('g',64), repeat('A',64)] LOOP
    BEGIN
      PERFORM public.ingest_verified_mux_event('bad_hash_event', bad_hash);
      RAISE EXCEPTION 'Invalid digest accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
END $$;
RESET ROLE;

-- A browser user cannot invoke privileged ingestion or write the inbox.
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.ingest_verified_mux_event('forged_browser_event',repeat('d',64));
    RAISE EXCEPTION 'Ordinary authenticated role executed privileged RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.webhook_events(provider,stable_event_key,payload_sha256,status)
    VALUES('mux','forged_direct_write',repeat('d',64),'processed');
    RAISE EXCEPTION 'Ordinary authenticated role inserted webhook inbox row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Verify no forged rows escaped either denial.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.webhook_events
  WHERE stable_event_key IN ('forged_browser_event','forged_direct_write','bad_hash_event');
  IF n <> 0 THEN RAISE EXCEPTION 'Untrusted or malformed event persisted'; END IF;
END $$;
\echo 'PASS: namespace collision-safe, duplicate does not reset processed events, browser denied'
