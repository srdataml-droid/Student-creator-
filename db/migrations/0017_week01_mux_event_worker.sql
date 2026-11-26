-- Service-only durable processing of verified Mux events. Requires 0012 and 0014.
ALTER TABLE public.webhook_events ADD COLUMN mux_lease_id uuid, ADD COLUMN mux_lease_until timestamptz;
CREATE FUNCTION public.claim_mux_test_event() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.webhook_events; d public.mux_event_details;
BEGIN
 UPDATE public.webhook_events SET status='failed',last_error_code='RETRY_EXHAUSTED',mux_lease_id=NULL,mux_lease_until=NULL,next_retry_at=NULL
 WHERE provider='mux' AND status='processing' AND mux_lease_until<=now() AND attempt_count>=5;
 SELECT e.* INTO r FROM public.webhook_events e JOIN public.mux_event_details m ON m.provider=e.provider AND m.event_id=e.stable_event_key
 WHERE e.provider='mux' AND e.attempt_count<5 AND
 (e.status='received' OR (e.status='failed' AND e.next_retry_at<=now()) OR (e.status='processing' AND e.mux_lease_until<=now()))
 ORDER BY e.received_at,e.id LIMIT 1 FOR UPDATE OF e SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.mux_event_details WHERE provider='mux' AND event_id=r.stable_event_key;
 UPDATE public.webhook_events SET status='processing',attempt_count=attempt_count+1,mux_lease_id=gen_random_uuid(),
 mux_lease_until=now()+interval '90 seconds',next_retry_at=NULL WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id,'leaseId',r.mux_lease_id,'kind',d.event_type,'resourceId',d.resource_id);
END $$;
CREATE FUNCTION public.finish_mux_test_event(_id uuid,_lease uuid,_outcome text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _outcome IS NULL OR _outcome NOT IN ('processed','ignored','retry') THEN RETURN false; END IF;
 UPDATE public.webhook_events SET status=CASE WHEN _outcome='retry' THEN 'failed' ELSE 'processed' END,
 last_error_code=CASE WHEN _outcome='retry' THEN 'PROVIDER_OR_ASSOCIATION_UNAVAILABLE' WHEN _outcome='ignored' THEN 'UNSUPPORTED_EVENT' ELSE NULL END,
 next_retry_at=CASE WHEN _outcome='retry' AND attempt_count<5 THEN now()+make_interval(secs=>30*attempt_count) ELSE NULL END,
 mux_lease_id=NULL,mux_lease_until=NULL
 WHERE id=_id AND provider='mux' AND status='processing' AND mux_lease_id=_lease AND mux_lease_until>now();
 RETURN FOUND;
END $$;
-- Only an already-bound asset may be revoked on a signed deletion event.
-- A delete cannot create an association or grant playback.
CREATE FUNCTION public.revoke_deleted_mux_test_asset(_asset text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.mux_video_uploads SET state='deleted',playback_id=NULL,updated_at=now() WHERE asset_id=_asset AND test_asset;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_mux_test_event(),public.finish_mux_test_event(uuid,uuid,text),public.revoke_deleted_mux_test_asset(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mux_test_event(),public.finish_mux_test_event(uuid,uuid,text),public.revoke_deleted_mux_test_asset(text) TO service_role;
