BEGIN;
DO $$ BEGIN
 IF has_function_privilege('anon','public.record_verified_mux_delivery(text,text,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.record_verified_mux_delivery(text,text,text,text)','EXECUTE')
 OR has_table_privilege('authenticated','public.mux_event_details','SELECT')
 OR has_table_privilege('anon','public.mux_event_details','INSERT')
 OR has_table_privilege('service_role','public.mux_event_details','UPDATE')
 THEN RAISE EXCEPTION 'Unexpected Mux event access'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.record_verified_mux_delivery('fixture_mux_event_12',repeat('a',64),'video.asset.ready','fixture_asset_12')<>'accepted'
 THEN RAISE EXCEPTION 'Expected accepted'; END IF;
 IF public.record_verified_mux_delivery('fixture_mux_event_12',repeat('a',64),'video.asset.ready','fixture_asset_12')<>'duplicate'
 THEN RAISE EXCEPTION 'Expected duplicate'; END IF;
 IF public.record_verified_mux_delivery('fixture_mux_event_12',repeat('b',64),'video.asset.errored','fixture_asset_13')<>'collision'
 THEN RAISE EXCEPTION 'Expected collision'; END IF;
 IF (SELECT count(*) FROM public.mux_event_details WHERE event_id='fixture_mux_event_12' AND resource_id='fixture_asset_12')<>1
 THEN RAISE EXCEPTION 'Receipt was not immutable'; END IF;
 BEGIN
  PERFORM public.record_verified_mux_delivery('fixture_mux_bad_12',repeat('a',64),'video.asset.ready','../unsafe');
  RAISE EXCEPTION 'Malformed resource accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.webhook_events WHERE provider='mux' AND stable_event_key='fixture_mux_event_12' AND status='received')<>1
 THEN RAISE EXCEPTION 'Durable receipt missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.webhook_events WHERE stable_event_key='fixture_mux_bad_12')
 THEN RAISE EXCEPTION 'Invalid event persisted'; END IF;
END $$;
ROLLBACK;
