-- Privacy requests are review records, not deletion commands.
CREATE TABLE public.student_privacy_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),
 kind text NOT NULL CHECK(kind IN ('access','correction','erasure','restriction','portability')),
 private_reason text NOT NULL CHECK(length(btrim(private_reason)) BETWEEN 20 AND 1000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','under_review','decision_recorded')),
 outcome text CHECK(outcome IN ('approved_for_manual_fulfilment','declined')),
 created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,reviewer_id uuid REFERENCES auth.users(id),review_note text,
 CHECK((status='decision_recorded')=(outcome IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_id IS NOT NULL AND review_note IS NOT NULL))
);
CREATE UNIQUE INDEX student_privacy_one_active_kind ON public.student_privacy_requests(user_id,kind) WHERE status IN ('open','under_review');
ALTER TABLE public.student_privacy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_privacy_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION student_social_private.submit_privacy_request(_kind text,_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); r public.student_privacy_requests%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _kind IS NULL OR _kind NOT IN ('access','correction','erasure','restriction','portability') OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 20 AND 1000 OR _reason ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':privacy',0));
 SELECT * INTO r FROM public.student_privacy_requests WHERE user_id=actor AND kind=_kind AND status IN ('open','under_review');
 IF FOUND THEN
  IF r.private_reason<>btrim(_reason) THEN RAISE EXCEPTION 'PRIVACY_REQUEST_ALREADY_OPEN' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('id',r.id,'status',r.status,'replayed',true);
 END IF;
 IF (SELECT count(*) FROM public.student_privacy_requests WHERE user_id=actor AND created_at>now()-interval '1 day')>=5 THEN RAISE EXCEPTION 'PRIVACY_RATE_LIMIT' USING ERRCODE='22023'; END IF;
 INSERT INTO public.student_privacy_requests(user_id,kind,private_reason) VALUES(actor,_kind,btrim(_reason)) RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'privacy.request.submitted','privacy_request',r.id);
 RETURN jsonb_build_object('id',r.id,'status',r.status,'replayed',false);
END $$;
CREATE FUNCTION student_social_private.my_privacy_requests() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO result FROM (SELECT id,kind,status,outcome,created_at,reviewed_at,review_note FROM public.student_privacy_requests WHERE user_id=auth.uid() ORDER BY created_at DESC,id LIMIT 30) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.submit_privacy_request(text,text),student_social_private.my_privacy_requests() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.submit_privacy_request(text,text),student_social_private.my_privacy_requests() TO authenticated;
CREATE FUNCTION public.submit_privacy_request(_kind text,_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.submit_privacy_request(_kind,_reason) $$;
CREATE FUNCTION public.my_privacy_requests() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.my_privacy_requests() $$;
REVOKE ALL ON FUNCTION public.submit_privacy_request(text,text),public.my_privacy_requests() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_privacy_request(text,text),public.my_privacy_requests() TO authenticated;
CREATE FUNCTION public.week7_privacy_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'privacy.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO result FROM (SELECT id,user_id,kind,private_reason,status,created_at FROM public.student_privacy_requests WHERE status IN ('open','under_review') AND user_id<>_actor ORDER BY created_at,id LIMIT _limit) q;
 RETURN jsonb_build_object('items',result);
END $$;
CREATE FUNCTION public.week7_review_privacy_request(_actor uuid,_id uuid,_decision text,_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.student_privacy_requests%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'privacy.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _decision IS NULL OR _decision NOT IN ('under_review','approved_for_manual_fulfilment','declined') OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.student_privacy_requests WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR r.user_id=_actor THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF r.status='decision_recorded' OR (r.status='under_review' AND _decision='under_review') THEN RAISE EXCEPTION 'PRIVACY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 IF _decision='under_review' THEN UPDATE public.student_privacy_requests SET status='under_review' WHERE id=r.id;
 ELSE UPDATE public.student_privacy_requests SET status='decision_recorded',outcome=_decision,reviewed_at=now(),reviewer_id=_actor,review_note=btrim(_note) WHERE id=r.id; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'privacy.request.'||_decision,'privacy_request',r.id);
 RETURN jsonb_build_object('id',r.id,'status',CASE WHEN _decision='under_review' THEN 'under_review' ELSE 'decision_recorded' END,'dataDeleted',false,'fulfilled',false);
END $$;
REVOKE ALL ON FUNCTION public.week7_privacy_queue(uuid,integer),public.week7_review_privacy_request(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_privacy_queue(uuid,integer),public.week7_review_privacy_request(uuid,uuid,text,text) TO service_role;
