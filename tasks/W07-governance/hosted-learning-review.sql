-- Operational review: governance scope and current staff identity are checked
-- before server-side calls; no function here initiates any PSP transaction.
CREATE FUNCTION public.week7_learning_review_queue(_actor uuid,_kind text,_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF _kind NOT IN ('disputes','refunds') OR _kind IS NULL OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF NOT public.week7_staff_has_capability(_actor,CASE WHEN _kind='disputes' THEN 'content.moderate' ELSE 'finance.review' END) THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _kind='disputes' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO result FROM (
   SELECT d.id,d.request_id,d.reporter_id,d.reason,d.created_at,s.state AS request_state FROM public.personal_learning_disputes d JOIN public.personal_learning_requests s ON s.id=d.request_id WHERE d.state='open' AND s.state='disputed' ORDER BY d.created_at,d.id LIMIT _limit) q;
 ELSE
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO result FROM (
   SELECT v.id,v.resource_kind,v.resource_id,v.student_id,v.reason,v.created_at,o.id AS order_id,o.state AS order_state,o.amount_kobo,
    (SELECT count(*) FROM live_finance.learning_receipts r WHERE r.order_id=o.id AND NOT EXISTS(SELECT 1 FROM live_finance.learning_refunds f WHERE f.transaction_id=r.transaction_id)) AS unrefunded_receipts
   FROM public.learning_refund_reviews v LEFT JOIN live_finance.learning_orders o ON o.kind=v.resource_kind AND o.resource_id=v.resource_id AND o.buyer_id=v.student_id WHERE v.state='pending_review' ORDER BY v.created_at,v.id LIMIT _limit) q;
 END IF;
 RETURN jsonb_build_object('items',result);
END $$;
CREATE FUNCTION public.week7_resolve_learning_dispute(_actor uuid,_id uuid,_outcome text,_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.personal_learning_disputes%ROWTYPE; s public.personal_learning_requests%ROWTYPE; next_state text;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'content.moderate') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _outcome IS NULL OR _outcome NOT IN ('resume_guidance','cancel_service') OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.personal_learning_disputes WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'open' THEN RAISE EXCEPTION 'LEARNING_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 SELECT * INTO s FROM public.personal_learning_requests WHERE id=d.request_id FOR UPDATE;
 IF NOT FOUND OR s.state<>'disputed' OR _actor IN (s.student_id,s.creator_id) THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _outcome='resume_guidance' AND coalesce(s.quote_kobo,0)>0 AND NOT live_finance.learning_has_paid(s.student_id,'service',s.id,s.creator_id,s.quote_kobo) THEN RAISE EXCEPTION 'LEARNING_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 next_state:=CASE _outcome WHEN 'resume_guidance' THEN 'in_progress' ELSE 'cancelled' END;
 UPDATE public.personal_learning_disputes SET state='resolved',resolution=btrim(_note),reviewed_at=now(),reviewed_by=_actor WHERE id=d.id;
 UPDATE public.personal_learning_requests SET state=next_state,updated_at=now() WHERE id=s.id;
 IF next_state='cancelled' AND coalesce(s.quote_kobo,0)>0 THEN
  INSERT INTO public.learning_refund_reviews(resource_kind,resource_id,student_id,reason) VALUES('service',s.id,s.student_id,'Disputed paid learning cancelled') ON CONFLICT(resource_kind,resource_id,student_id) DO UPDATE SET state='pending_review',reason=EXCLUDED.reason;
 END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(_actor,'learning.dispute.'||_outcome,'personal_learning_dispute',d.id,btrim(_note));
 INSERT INTO public.learning_notifications(user_id,kind,resource_id,body) VALUES(s.student_id,'help.dispute.resolved',d.id,'Learning dispute reviewed'),(s.creator_id,'help.dispute.resolved',d.id,'Learning dispute reviewed') ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('id',d.id,'status',next_state,'refundIssued',false);
END $$;
CREATE FUNCTION public.week7_record_learning_refund_review(_actor uuid,_id uuid,_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.learning_refund_reviews%ROWTYPE; o live_finance.learning_orders%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.learning_refund_reviews WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR v.state<>'pending_review' THEN RAISE EXCEPTION 'LEARNING_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 SELECT * INTO o FROM live_finance.learning_orders WHERE kind=v.resource_kind AND resource_id=v.resource_id AND buyer_id=v.student_id FOR UPDATE;
 IF NOT FOUND OR _actor IN (o.creator_id,o.buyer_id) OR NOT EXISTS(SELECT 1 FROM live_finance.learning_receipts r WHERE r.order_id=o.id AND EXISTS(SELECT 1 FROM live_finance.learning_refunds f WHERE f.transaction_id=r.transaction_id)) OR EXISTS(SELECT 1 FROM live_finance.learning_receipts r WHERE r.order_id=o.id AND (o.state<>'paid' OR r.duplicate OR NOT r.delivered) AND NOT EXISTS(SELECT 1 FROM live_finance.learning_refunds f WHERE f.transaction_id=r.transaction_id)) THEN RAISE EXCEPTION 'LEARNING_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 UPDATE public.learning_refund_reviews SET state='recorded' WHERE id=v.id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(_actor,'learning.refund.review.recorded','learning_refund_review',v.id,btrim(_note));
 RETURN jsonb_build_object('id',v.id,'status','recorded','refundIssued',false);
END $$;
REVOKE ALL ON FUNCTION public.week7_learning_review_queue(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_learning_review_queue(uuid,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.week7_resolve_learning_dispute(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_resolve_learning_dispute(uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.week7_record_learning_refund_review(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_record_learning_refund_review(uuid,uuid,text) TO service_role;
