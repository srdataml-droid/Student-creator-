CREATE OR REPLACE FUNCTION public.get_private_identity_review_object(_actor uuid,_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.private_identity_uploads;
BEGIN
 SELECT u.* INTO r FROM public.private_identity_uploads u
 JOIN public.verification_requests v ON v.id=u.request_id AND v.user_id=u.owner_id
 WHERE public.week7_staff_has_capability(_actor,'verification.review') AND u.request_id=_request AND u.owner_id<>_actor AND u.state='clean'
 AND v.status='pending' AND v.expires_at>now() AND v.private_evidence_path=u.object_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id)
 VALUES(_actor,'identity.evidence.access_requested','verification_request',_request);
 RETURN jsonb_build_object('objectKey',r.object_key,'ownerId',r.owner_id,'id',r.id,
 'mime',r.mime_type,'bytes',r.bytes,'digest',r.digest);
END $$;
CREATE FUNCTION public.week7_identity_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'verification.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO result FROM
 (SELECT v.id,v.user_id,v.institution_id,v.method,v.created_at,v.expires_at,coalesce(u.state='clean' AND v.private_evidence_path=u.object_key,false) AS evidence_ready
 FROM public.verification_requests v LEFT JOIN public.private_identity_uploads u ON u.request_id=v.id AND u.owner_id=v.user_id WHERE v.status='pending' AND v.expires_at>now() AND v.user_id<>_actor ORDER BY v.created_at,v.id LIMIT _limit) q;
 RETURN jsonb_build_object('items',result);
END $$;
CREATE FUNCTION public.week7_identity_revalidation_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'verification.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.valid_until,q.user_id),'[]'::jsonb) INTO result FROM
 (SELECT a.user_id,a.institution_id,a.affiliation_role,a.enrollment_state,a.valid_until FROM public.institution_affiliations a JOIN public.institution_integrations i ON i.provider_id=a.provider_id AND i.institution_id=a.institution_id
 WHERE a.user_id<>_actor AND (a.valid_until<=now()+interval '30 days' OR a.enrollment_state<>'active' OR NOT i.enabled) ORDER BY a.valid_until,a.user_id LIMIT _limit) q;
 RETURN jsonb_build_object('items',result);
END $$;
REVOKE ALL ON FUNCTION public.week7_identity_queue(uuid,integer),public.week7_identity_revalidation_queue(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_identity_queue(uuid,integer),public.week7_identity_revalidation_queue(uuid,integer) TO service_role;
