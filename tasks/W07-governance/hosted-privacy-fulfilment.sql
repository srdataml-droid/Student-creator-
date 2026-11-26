-- Record manual privacy fulfilment and independent review. This module
-- does not perform erasure, export, correction or retention execution.
CREATE TABLE public.privacy_fulfilment_records(
 request_id uuid PRIMARY KEY REFERENCES public.student_privacy_requests(id),
 performed_by uuid NOT NULL REFERENCES auth.users(id), evidence_reference text NOT NULL CHECK(evidence_reference ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 summary text NOT NULL CHECK(length(btrim(summary)) BETWEEN 20 AND 500),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 confirmed_by uuid REFERENCES auth.users(id), confirmed_at timestamptz,
 confirmation_note text CHECK(length(btrim(confirmation_note)) BETWEEN 10 AND 500),
 CHECK(confirmed_by IS NULL OR confirmed_by<>performed_by),
 CHECK((confirmed_by IS NULL AND confirmed_at IS NULL AND confirmation_note IS NULL) OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirmation_note IS NOT NULL))
);
CREATE TABLE public.retention_review_recommendations(
 proposal_id uuid PRIMARY KEY REFERENCES public.governance_retention_proposals(id),
 reviewer_id uuid NOT NULL REFERENCES auth.users(id),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 20 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.privacy_fulfilment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_review_recommendations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_fulfilment_records,public.retention_review_recommendations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.week7_record_privacy_fulfilment(_actor uuid,_id uuid,_reference text,_summary text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.student_privacy_requests%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'privacy.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _reference IS NULL OR _reference !~ '^[A-Za-z0-9_.:-]{8,128}$' OR _summary IS NULL OR length(btrim(_summary)) NOT BETWEEN 20 AND 500 OR _summary ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.student_privacy_requests WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR r.user_id=_actor THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF r.status<>'decision_recorded' OR r.outcome IS DISTINCT FROM 'approved_for_manual_fulfilment' OR EXISTS(SELECT 1 FROM public.privacy_fulfilment_records WHERE request_id=r.id) THEN RAISE EXCEPTION 'PRIVACY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 INSERT INTO public.privacy_fulfilment_records(request_id,performed_by,evidence_reference,summary) VALUES(r.id,_actor,_reference,btrim(_summary));
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'privacy.fulfilment.attested','privacy_request',r.id);
 RETURN jsonb_build_object('id',r.id,'status','awaiting_independent_confirmation','automaticExecution',false,'independentlyConfirmed',false);
END $$;
CREATE FUNCTION public.week7_confirm_privacy_fulfilment(_actor uuid,_id uuid,_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.student_privacy_requests%ROWTYPE; f public.privacy_fulfilment_records%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'privacy.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.student_privacy_requests WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR r.user_id=_actor THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.privacy_fulfilment_records WHERE request_id=r.id FOR UPDATE;
 IF NOT FOUND OR f.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'PRIVACY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 IF f.performed_by=_actor THEN RAISE EXCEPTION 'INDEPENDENT_REVIEW_REQUIRED' USING ERRCODE='42501'; END IF;
 UPDATE public.privacy_fulfilment_records SET confirmed_by=_actor,confirmed_at=now(),confirmation_note=btrim(_note) WHERE request_id=r.id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'privacy.fulfilment.independently_attested','privacy_request',r.id);
 RETURN jsonb_build_object('id',r.id,'status','staff_confirmation_recorded','automaticExecution',false,'independentlyConfirmed',true);
END $$;
CREATE FUNCTION public.week7_privacy_fulfilment_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'privacy.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO r FROM (
 SELECT p.id,p.user_id,p.kind,p.created_at,p.reviewed_at,f.performed_by,f.evidence_reference,f.summary,f.recorded_at,
 CASE WHEN f.request_id IS NULL THEN 'awaiting_manual_fulfilment' ELSE 'awaiting_independent_confirmation' END AS fulfilment_status
 FROM public.student_privacy_requests p LEFT JOIN public.privacy_fulfilment_records f ON f.request_id=p.id
 WHERE p.status='decision_recorded' AND p.outcome='approved_for_manual_fulfilment' AND p.user_id<>_actor AND f.confirmed_at IS NULL ORDER BY p.created_at,p.id LIMIT _limit) q;
 RETURN jsonb_build_object('items',r);
END $$;
CREATE OR REPLACE FUNCTION student_social_private.my_privacy_requests() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO result FROM (
 SELECT p.id,p.kind,p.status,p.outcome,p.created_at,p.reviewed_at,p.review_note,
 CASE WHEN f.confirmed_at IS NOT NULL THEN 'staff_confirmation_recorded' WHEN f.request_id IS NOT NULL THEN 'awaiting_independent_confirmation' WHEN p.outcome='approved_for_manual_fulfilment' THEN 'awaiting_manual_fulfilment' ELSE NULL END AS fulfilment_status
 FROM public.student_privacy_requests p LEFT JOIN public.privacy_fulfilment_records f ON f.request_id=p.id WHERE p.user_id=auth.uid() ORDER BY p.created_at DESC,p.id LIMIT 30) q;
 RETURN result;
END $$;
CREATE FUNCTION public.week7_recommend_retention(_actor uuid,_id uuid,_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.governance_retention_proposals%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'retention.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 20 AND 500 OR _reason ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM public.governance_retention_proposals WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR p.proposed_by=_actor THEN RAISE EXCEPTION 'INDEPENDENT_REVIEW_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p.state<>'proposed' OR EXISTS(SELECT 1 FROM public.retention_review_recommendations WHERE proposal_id=p.id) THEN RAISE EXCEPTION 'RETENTION_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 INSERT INTO public.retention_review_recommendations(proposal_id,reviewer_id,rationale) VALUES(p.id,_actor,btrim(_reason));
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'retention.recommended_for_policy_review','governance_retention',p.id);
 RETURN jsonb_build_object('id',p.id,'status','recommended_for_policy_review','policyApproved',false,'automaticDeletion',false);
END $$;
REVOKE ALL ON FUNCTION public.week7_record_privacy_fulfilment(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_record_privacy_fulfilment(uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.week7_confirm_privacy_fulfilment(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_confirm_privacy_fulfilment(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.week7_privacy_fulfilment_queue(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_privacy_fulfilment_queue(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.week7_recommend_retention(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_recommend_retention(uuid,uuid,text) TO service_role;
