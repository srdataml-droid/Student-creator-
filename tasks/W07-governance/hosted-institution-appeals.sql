-- Scoped institutional appeals. A review request never grants enrollment.
CREATE FUNCTION student_social_private.submit_institution_appeal(_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); appeal public.institution_verification_appeals%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 20 AND 800 OR _reason ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.student_profiles WHERE user_id=actor FOR UPDATE;
 IF NOT FOUND OR public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'APPEAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO appeal FROM public.institution_verification_appeals WHERE user_id=actor AND status='open' ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN
  IF appeal.private_reason<>btrim(_reason) THEN RAISE EXCEPTION 'APPEAL_ALREADY_OPEN' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('id',appeal.id,'status',appeal.status,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.institution_verification_appeals WHERE user_id=actor AND created_at>now()-interval '24 hours') THEN RAISE EXCEPTION 'APPEAL_RATE_LIMIT' USING ERRCODE='22023'; END IF;
 INSERT INTO public.institution_verification_appeals(user_id,private_reason) VALUES(actor,btrim(_reason)) RETURNING * INTO appeal;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'identity.appeal.submitted','institution_appeal',appeal.id);
 RETURN jsonb_build_object('id',appeal.id,'status',appeal.status,'replayed',false);
END $$;
CREATE FUNCTION student_social_private.my_institution_appeals() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO result FROM (SELECT id,status,created_at,review_note FROM public.institution_verification_appeals WHERE user_id=auth.uid() ORDER BY created_at DESC,id LIMIT 20) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.submit_institution_appeal(text),student_social_private.my_institution_appeals() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.submit_institution_appeal(text),student_social_private.my_institution_appeals() TO authenticated;
CREATE FUNCTION public.submit_institution_appeal(_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.submit_institution_appeal(_reason) $$;
CREATE FUNCTION public.my_institution_appeals() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.my_institution_appeals() $$;
REVOKE ALL ON FUNCTION public.submit_institution_appeal(text),public.my_institution_appeals() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_institution_appeal(text),public.my_institution_appeals() TO authenticated;

CREATE FUNCTION public.week7_institution_appeal_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'verification.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO result FROM (SELECT a.id,a.user_id,a.private_reason,a.created_at,p.institution_id FROM public.institution_verification_appeals a JOIN public.student_profiles p ON p.user_id=a.user_id WHERE a.status='open' AND a.user_id<>_actor ORDER BY a.created_at,a.id LIMIT _limit) q;
 RETURN jsonb_build_object('items',result);
END $$;
CREATE FUNCTION public.week7_review_institution_appeal(_actor uuid,_id uuid,_decision text,_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.institution_verification_appeals%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'verification.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _decision IS NULL OR _decision NOT IN ('review_requested','rejected') OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.institution_verification_appeals WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR a.user_id=_actor THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF a.status<>'open' THEN RAISE EXCEPTION 'APPEAL_ALREADY_REVIEWED' USING ERRCODE='23505'; END IF;
 UPDATE public.institution_verification_appeals SET status=_decision,reviewer_id=_actor,review_note=btrim(_note) WHERE id=a.id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(_actor,'identity.appeal.'||_decision,'institution_appeal',a.id,btrim(_note));
 RETURN jsonb_build_object('id',a.id,'status',_decision,'eligibilityChanged',false);
END $$;
REVOKE ALL ON FUNCTION public.week7_institution_appeal_queue(uuid,integer),public.week7_review_institution_appeal(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_institution_appeal_queue(uuid,integer),public.week7_review_institution_appeal(uuid,uuid,text,text) TO service_role;
