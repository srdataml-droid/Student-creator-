-- Human-reviewed copyright claims. No automated finding of infringement,
-- asset deletion, rights transfer, payment reversal or restoration of publication.
CREATE TABLE public.copyright_claims(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),content_id uuid NOT NULL REFERENCES public.content_items(id),
 claimant_id uuid NOT NULL REFERENCES auth.users(id),creator_id uuid NOT NULL REFERENCES auth.users(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 30 AND 1500),
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','dismissed','upheld','appealed','released')),
 reviewer_id uuid REFERENCES auth.users(id),review_note text,reviewed_at timestamptz,
 appeal_reason text CHECK(length(btrim(appeal_reason)) BETWEEN 20 AND 1000),
 appeal_reviewer_id uuid REFERENCES auth.users(id),appeal_note text,appeal_reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(claimant_id<>creator_id)
);
CREATE UNIQUE INDEX copyright_one_active_claim ON public.copyright_claims(content_id,claimant_id) WHERE state IN ('open','upheld','appealed');
CREATE INDEX copyright_claim_hold ON public.copyright_claims(content_id) WHERE state IN ('upheld','appealed');
ALTER TABLE public.copyright_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.copyright_claims FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION student_social_private.copyright_action(_action text,_id uuid,_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); c public.content_items%ROWTYPE; r public.copyright_claims%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 20 AND 1500 OR _reason ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF _action='submit' THEN
  IF length(btrim(_reason))<30 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':copyright',0));
  SELECT * INTO c FROM public.content_items WHERE id=_id AND status IN ('published','taken_down') AND published_at IS NOT NULL AND creator_id<>actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.copyright_claims WHERE content_id=c.id AND claimant_id=actor AND state IN ('open','upheld','appealed');
  IF FOUND THEN
   IF r.reason<>btrim(_reason) THEN RAISE EXCEPTION 'CLAIM_ALREADY_OPEN' USING ERRCODE='23505'; END IF;
   RETURN jsonb_build_object('id',r.id,'status',r.state,'replayed',true);
  END IF;
  IF (SELECT count(*) FROM public.copyright_claims WHERE claimant_id=actor AND created_at>now()-interval '1 day')>=5 THEN RAISE EXCEPTION 'CLAIM_RATE_LIMIT' USING ERRCODE='22023'; END IF;
  INSERT INTO public.copyright_claims(content_id,claimant_id,creator_id,reason) VALUES(c.id,actor,c.creator_id,btrim(_reason)) RETURNING * INTO r;
 ELSE
  IF _action IS DISTINCT FROM 'appeal' OR length(btrim(_reason))>1000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.copyright_claims WHERE id=_id AND creator_id=actor FOR UPDATE;
  IF NOT FOUND OR r.state<>'upheld' OR r.appeal_reason IS NOT NULL THEN RAISE EXCEPTION 'CLAIM_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  UPDATE public.copyright_claims SET state='appealed',appeal_reason=btrim(_reason) WHERE id=r.id RETURNING * INTO r;
 END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'copyright.claim.'||_action,'copyright_claim',r.id);
 RETURN jsonb_build_object('id',r.id,'status',r.state,'replayed',false);
END $$;
CREATE FUNCTION student_social_private.my_copyright_cases() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO result FROM (
 SELECT id,content_id,state,created_at,review_note,appeal_note,CASE WHEN claimant_id=auth.uid() THEN 'claimant' ELSE 'creator' END AS relation
 FROM public.copyright_claims WHERE auth.uid() IN (claimant_id,creator_id) ORDER BY created_at DESC,id LIMIT 50) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.copyright_action(text,uuid,text),student_social_private.my_copyright_cases() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.copyright_action(text,uuid,text),student_social_private.my_copyright_cases() TO authenticated;
CREATE FUNCTION public.copyright_action(_action text,_id uuid,_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.copyright_action(_action,_id,_reason) $$;
CREATE FUNCTION public.my_copyright_cases() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.my_copyright_cases() $$;
REVOKE ALL ON FUNCTION public.copyright_action(text,uuid,text),public.my_copyright_cases() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.copyright_action(text,uuid,text),public.my_copyright_cases() TO authenticated;

-- Hold persists across other publishing routes. All decisions serialize on the content row.
CREATE FUNCTION student_social_private.enforce_copyright_hold() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='published' AND EXISTS(SELECT 1 FROM public.copyright_claims WHERE content_id=NEW.id AND state IN ('upheld','appealed')) THEN RAISE EXCEPTION 'COPYRIGHT_HOLD' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION student_social_private.enforce_copyright_hold() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER content_copyright_hold BEFORE UPDATE OF status ON public.content_items FOR EACH ROW EXECUTE FUNCTION student_social_private.enforce_copyright_hold();

CREATE FUNCTION public.week7_copyright_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'copyright.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO result FROM (
 SELECT id,content_id,claimant_id,creator_id,reason,state,appeal_reason,review_note,created_at FROM public.copyright_claims WHERE state IN ('open','appealed') AND _actor NOT IN (claimant_id,creator_id) ORDER BY created_at,id LIMIT _limit) q;
 RETURN jsonb_build_object('items',result);
END $$;
CREATE FUNCTION public.week7_review_copyright(_actor uuid,_id uuid,_decision text,_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.copyright_claims%ROWTYPE; c public.content_items%ROWTYPE; next_state text; new_cases integer:=0;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'copyright.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _decision IS NULL OR _decision NOT IN ('dismiss','uphold','release','retain') OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.copyright_claims WHERE id=_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.content_items WHERE id=r.content_id FOR UPDATE;
 SELECT * INTO r FROM public.copyright_claims WHERE id=_id FOR UPDATE;
 IF _actor IN (r.creator_id,r.claimant_id) THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF r.state='open' AND _decision IN ('dismiss','uphold') THEN
  next_state:=CASE _decision WHEN 'dismiss' THEN 'dismissed' ELSE 'upheld' END;
  UPDATE public.copyright_claims SET state=next_state,reviewer_id=_actor,review_note=btrim(_note),reviewed_at=now() WHERE id=r.id;
 ELSIF r.state='appealed' AND _decision IN ('release','retain') AND r.reviewer_id<>_actor THEN
  next_state:=CASE _decision WHEN 'release' THEN 'released' ELSE 'upheld' END;
  UPDATE public.copyright_claims SET state=next_state,appeal_reviewer_id=_actor,appeal_note=btrim(_note),appeal_reviewed_at=now() WHERE id=r.id;
 ELSE RAISE EXCEPTION 'COPYRIGHT_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 IF next_state='upheld' THEN
  UPDATE public.content_items SET status='taken_down',reviewer_id=_actor,review_reason='Copyright review: '||btrim(_note),reviewed_at=now() WHERE id=c.id AND status='published';
  INSERT INTO public.social_creator_access_review_cases(creator_id,viewer_id,entitlement_id,content_id,order_id)
  SELECT c.creator_id,e.buyer_id,e.id,c.id,e.order_id FROM public.entitlements e JOIN public.orders o ON o.id=e.order_id AND o.buyer_id=e.buyer_id AND o.content_id=e.content_id
  WHERE e.content_id=c.id AND e.state='active' AND o.status='paid' ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS new_cases=ROW_COUNT;
 END IF;
 -- A release lifts only this claim; do not republish, restore a token or grant access automatically.
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(_actor,'copyright.review.'||_decision,'copyright_claim',r.id,btrim(_note));
 RETURN jsonb_build_object('id',r.id,'status',next_state,'accessReviewCases',new_cases,'automaticallyRepublished',false,'refundIssued',false);
END $$;
REVOKE ALL ON FUNCTION public.week7_copyright_queue(uuid,integer),public.week7_review_copyright(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_copyright_queue(uuid,integer),public.week7_review_copyright(uuid,uuid,text,text) TO service_role;
