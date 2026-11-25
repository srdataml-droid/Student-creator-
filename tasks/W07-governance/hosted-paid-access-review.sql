-- Resolve purchased access reviews only when canonical delivery or financial evidence exists.
ALTER TABLE public.social_creator_access_review_cases ADD COLUMN resolution text CHECK(resolution IN ('access_available','verified_reversal')), ADD COLUMN reviewer_id uuid REFERENCES auth.users(id), ADD COLUMN reviewed_at timestamptz, ADD COLUMN review_note text;
ALTER TABLE public.social_creator_access_review_cases ADD CONSTRAINT access_review_resolution_complete CHECK(status='open' OR (resolution IS NOT NULL AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL));
REVOKE INSERT,UPDATE,DELETE ON public.social_creator_access_review_cases FROM service_role;
CREATE FUNCTION public.week7_paid_access_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO r FROM
 (SELECT c.id,c.creator_id,c.viewer_id,c.content_id,c.order_id,c.created_at,o.status AS order_status,e.state AS entitlement_state,e.expires_at,
 EXISTS(SELECT 1 FROM live_finance.reversals v JOIN live_finance.receipts rr ON rr.transaction_id=v.transaction_id AND rr.order_id=v.order_id AND NOT rr.duplicate WHERE v.order_id=o.id AND v.amount_kobo=o.amount_kobo) AS primary_reversal_verified
 FROM public.social_creator_access_review_cases c JOIN public.orders o ON o.id=c.order_id JOIN public.entitlements e ON e.id=c.entitlement_id AND e.order_id=o.id
 WHERE c.status='open' AND o.environment='live' AND _actor NOT IN (c.creator_id,c.viewer_id) ORDER BY c.created_at,c.id LIMIT _limit) q;
 RETURN jsonb_build_object('items',r);
END $$;
CREATE FUNCTION public.week7_resolve_paid_access(_actor uuid,_id uuid,_resolution text,_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.social_creator_access_review_cases%ROWTYPE; o public.orders%ROWTYPE; e public.entitlements%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _resolution IS NULL OR _resolution NOT IN ('access_available','verified_reversal') OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.social_creator_access_review_cases WHERE id=_id;
 IF NOT FOUND OR _actor IN (c.creator_id,c.viewer_id) THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=c.order_id FOR UPDATE;
 SELECT * INTO e FROM public.entitlements WHERE id=c.entitlement_id AND order_id=o.id FOR UPDATE;
 SELECT * INTO c FROM public.social_creator_access_review_cases WHERE id=_id FOR UPDATE;
 IF c.status<>'open' OR o.environment IS DISTINCT FROM 'live' OR o.creator_id IS DISTINCT FROM c.creator_id OR o.buyer_id IS DISTINCT FROM c.viewer_id OR o.content_id IS DISTINCT FROM c.content_id OR e.content_id IS DISTINCT FROM c.content_id OR e.buyer_id IS DISTINCT FROM c.viewer_id THEN RAISE EXCEPTION 'ACCESS_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 IF _resolution='access_available' THEN
  IF o.status<>'paid' OR e.state<>'active' OR e.expires_at<=now() OR public.authorized_mux_live_playback(c.viewer_id,c.content_id) IS NULL THEN RAISE EXCEPTION 'ACCESS_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 ELSIF _resolution='verified_reversal' THEN
  IF o.status NOT IN ('refunded','chargeback') OR e.state<>'revoked' OR NOT EXISTS(SELECT 1 FROM live_finance.reversals v JOIN live_finance.receipts r ON r.transaction_id=v.transaction_id AND r.order_id=v.order_id AND NOT r.duplicate WHERE v.order_id=o.id AND v.amount_kobo=o.amount_kobo AND r.amount_kobo=o.amount_kobo AND (v.kind='refund' AND o.status='refunded' OR v.kind='chargeback' AND o.status='chargeback')) THEN RAISE EXCEPTION 'ACCESS_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;

 END IF;
 UPDATE public.social_creator_access_review_cases SET status='resolved',resolution=_resolution,reviewer_id=_actor,reviewed_at=now(),review_note=btrim(_note) WHERE id=c.id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(_actor,'finance.access_review.'||_resolution,'paid_access_review',c.id,btrim(_note));
 RETURN jsonb_build_object('id',c.id,'status','resolved','resolution',_resolution,'refundIssued',false,'entitlementChanged',false);
END $$;
REVOKE ALL ON FUNCTION public.week7_paid_access_queue(uuid,integer),public.week7_resolve_paid_access(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_paid_access_queue(uuid,integer),public.week7_resolve_paid_access(uuid,uuid,text,text) TO service_role;
