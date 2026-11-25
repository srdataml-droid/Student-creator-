BEGIN;
SELECT public.record_verified_mux_delivery('fixture_event_17',repeat('a',64),'video.asset.ready','asset_fixture');
DO $$ DECLARE r jsonb; BEGIN
 IF has_function_privilege('authenticated','public.claim_mux_test_event()','EXECUTE') OR has_function_privilege('anon','public.revoke_deleted_mux_test_asset(text)','EXECUTE') THEN RAISE EXCEPTION 'Public worker privilege'; END IF;
 r:=public.claim_mux_test_event();
 IF r->>'kind' IS DISTINCT FROM 'video.asset.ready' THEN RAISE EXCEPTION 'claim missing'; END IF;
 IF public.claim_mux_test_event() IS NOT NULL THEN RAISE EXCEPTION 'duplicate active lease'; END IF;
 IF public.finish_mux_test_event((r->>'id')::uuid,gen_random_uuid(),'processed') THEN RAISE EXCEPTION 'wrong lease finished'; END IF;
 IF NOT public.finish_mux_test_event((r->>'id')::uuid,(r->>'leaseId')::uuid,'retry') THEN RAISE EXCEPTION 'retry failed'; END IF;
 IF public.claim_mux_test_event() IS NOT NULL THEN RAISE EXCEPTION 'backoff bypass'; END IF;
 UPDATE public.webhook_events SET next_retry_at=now()-interval '1 second' WHERE id=(r->>'id')::uuid;
 r:=public.claim_mux_test_event();
 IF NOT public.finish_mux_test_event((r->>'id')::uuid,(r->>'leaseId')::uuid,'processed') THEN RAISE EXCEPTION 'finish failed'; END IF;
 IF public.claim_mux_test_event() IS NOT NULL THEN RAISE EXCEPTION 'processed replay'; END IF;
 IF public.revoke_deleted_mux_test_asset('unknown_fixture') THEN RAISE EXCEPTION 'unknown asset revoked'; END IF;
END $$;
ROLLBACK;
