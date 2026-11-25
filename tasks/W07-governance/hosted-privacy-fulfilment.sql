-- Independent privacy fulfillment verification. The record describes an
-- externally completed procedure, not execution of deletion or export.
CREATE TABLE public.privacy_fulfilment_records(
 request_id uuid PRIMARY KEY REFERENCES public.student_privacy_requests(id),
 recorded_by uuid NOT NULL REFERENCES auth.users(id),
 verified_by uuid REFERENCES auth.users(id),
 outcome text NOT NULL CHECK(outcome IN ('fulfilled_externally','partially_fulfilled_externally','unable_to_fulfil')),
 evidence_reference text NOT NULL CHECK(evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$'),
 private_note text NOT NULL CHECK(length(btrim(private_note)) BETWEEN 20 AND 500),
 recorded_at timestamptz NOT NULL DEFAULT now(),verified_at timestamptz,
 CHECK(verified_by IS NULL OR verified_by<>recorded_by),
 CHECK((verified_by IS NULL)=(verified_at IS NULL))
);
ALTER TABLE public.privacy_fulfilment_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_fulfilment_records FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.week7_record_privacy_fulfilment(_actor uuid,_id uuid,_outcome text,_reference text,_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.student_privacy_requests%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'privacy.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _outcome IS NULL OR _outcome NOT IN ('fulfilled_externally','partially_fulfilled_externally','unable_to_fulfil') OR _reference IS NULL OR _reference !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 20 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.student_privacy_requests WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR r.user_id=_actor THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF r.status<>'decision_recorded' OR r.outcome IS DISTINCT FROM 'approved_for_manual_fulfilment' THEN RAISE EXCEPTION 'PRIVACY_FULFILMENT_CONFLICT' USING ERRCODE='23505'; END IF;
 INSERT INTO public.privacy_fulfilment_records(request_id,recorded_by,outcome,evidence_reference,private_note) VALUES(r.id,_actor,_outcome,_reference,btrim(_note));
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'privacy.fulfilment.recorded','privacy_request',r.id);
 RETURN jsonb_build_object('id',r.id,'status','awaiting_independent_verification','executedBySystem',false);
END $$;
CREATE FUNCTION public.week7_verify_privacy_fulfilment(_actor uuid,_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.privacy_fulfilment_records%ROWTYPE; r public.student_privacy_requests%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'privacy.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.student_privacy_requests WHERE id=_id;
 SELECT * INTO f FROM public.privacy_fulfilment_records WHERE request_id=_id FOR UPDATE;
 IF NOT FOUND OR _actor IN (r.user_id,f.recorded_by) THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF f.verified_by IS NOT NULL THEN RAISE EXCEPTION 'PRIVACY_FULFILMENT_CONFLICT' USING ERRCODE='23505'; END IF;
 UPDATE public.privacy_fulfilment_records SET verified_by=_actor,verified_at=now() WHERE request_id=_id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'privacy.fulfilment.reviewed','privacy_request',_id);
 RETURN jsonb_build_object('id',_id,'status','externally_reported_and_reviewed','outcome',f.outcome,'executedBySystem',false);
END $$;
CREATE FUNCTION public.week7_privacy_fulfilment_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'privacy.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.reviewed_at,q.id),'[]'::jsonb) INTO result FROM (SELECT r.id,r.kind,r.user_id,r.reviewed_at,f.outcome,f.evidence_reference,f.private_note,f.recorded_by FROM public.student_privacy_requests r LEFT JOIN public.privacy_fulfilment_records f ON f.request_id=r.id WHERE r.outcome='approved_for_manual_fulfilment' AND f.verified_at IS NULL AND r.user_id<>_actor ORDER BY r.reviewed_at,r.id LIMIT _limit) q;
 RETURN jsonb_build_object('items',result);
END $$;
CREATE OR REPLACE FUNCTION student_social_private.my_privacy_requests() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO result FROM (SELECT r.id,r.kind,r.status,r.outcome,r.created_at,r.reviewed_at,r.review_note,CASE WHEN f.verified_at IS NOT NULL THEN f.outcome END AS externally_reported_outcome,f.verified_at AS fulfilment_reviewed_at FROM public.student_privacy_requests r LEFT JOIN public.privacy_fulfilment_records f ON f.request_id=r.id WHERE r.user_id=auth.uid() ORDER BY r.created_at DESC,r.id LIMIT 30) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.week7_record_privacy_fulfilment(uuid,uuid,text,text,text),public.week7_verify_privacy_fulfilment(uuid,uuid),public.week7_privacy_fulfilment_queue(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_record_privacy_fulfilment(uuid,uuid,text,text,text),public.week7_verify_privacy_fulfilment(uuid,uuid),public.week7_privacy_fulfilment_queue(uuid,integer) TO service_role;
