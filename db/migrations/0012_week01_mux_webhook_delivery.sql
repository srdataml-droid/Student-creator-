-- Original staging-only durable Mux event metadata contract.
-- Requires existing 0007 inbox. No raw provider payloads or public access.
CREATE TABLE public.mux_event_details (
 provider text NOT NULL DEFAULT 'mux' CHECK(provider='mux'),
 event_id text NOT NULL,
 event_type text NOT NULL CHECK(event_type ~ '^[a-z][a-z0-9_.-]{0,127}$'),
 resource_id text CHECK(resource_id ~ '^[A-Za-z0-9_-]{3,128}$'),
 PRIMARY KEY(provider,event_id),
 FOREIGN KEY(provider,event_id) REFERENCES public.webhook_events(provider,stable_event_key) ON DELETE RESTRICT
);
ALTER TABLE public.mux_event_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mux_event_details FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.mux_event_details TO service_role;

CREATE FUNCTION public.record_verified_mux_delivery(_event_id text,_digest text,_event_type text,_resource_id text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $$
DECLARE outcome text;
BEGIN
 IF _event_type IS NULL OR _event_type !~ '^[a-z][a-z0-9_.-]{0,127}$'
 OR (_resource_id IS NOT NULL AND _resource_id !~ '^[A-Za-z0-9_-]{3,128}$')
 THEN RAISE EXCEPTION 'Invalid Mux resource metadata' USING ERRCODE='22023'; END IF;
 outcome:=public.ingest_verified_mux_event(_event_id,_digest);
 IF outcome='collision' THEN RETURN outcome; END IF;
 INSERT INTO public.mux_event_details(event_id,event_type,resource_id)
 VALUES(_event_id,_event_type,_resource_id)
 ON CONFLICT(provider,event_id) DO NOTHING;
 -- Metadata must never change on a replay. Raise to roll back the transaction
 -- if a privileged caller accidentally mismatches the verified event.
 IF NOT EXISTS (SELECT 1 FROM public.mux_event_details d WHERE d.provider='mux'
  AND d.event_id=_event_id AND d.event_type=_event_type
  AND d.resource_id IS NOT DISTINCT FROM _resource_id)
 THEN RAISE EXCEPTION 'Mux event metadata mismatch'; END IF;
 RETURN outcome;
END;
$$;
REVOKE ALL ON FUNCTION public.record_verified_mux_delivery(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_mux_delivery(text,text,text,text) TO service_role;
