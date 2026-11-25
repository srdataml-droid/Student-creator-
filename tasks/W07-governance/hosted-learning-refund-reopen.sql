-- Reopen previously reviewed resources when newly verified payment evidence
-- creates another liability. Keep cancellation/late delivery review stronger
-- than duplicate-only reconciliation; never mark an actual refund from a note.
CREATE FUNCTION live_finance.reopen_learning_refund_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o live_finance.learning_orders%ROWTYPE; note text;
BEGIN
 IF NEW.delivered AND NOT NEW.duplicate THEN RETURN NEW; END IF;
 SELECT * INTO STRICT o FROM live_finance.learning_orders WHERE id=NEW.order_id;
 note:=CASE WHEN NEW.duplicate THEN 'Duplicate verified payment requires review' ELSE 'Verified payment could not deliver resource' END;
 INSERT INTO public.learning_refund_reviews(resource_kind,resource_id,student_id,state,reason) VALUES(o.kind,o.resource_id,o.buyer_id,'pending_review',note)
 ON CONFLICT(resource_kind,resource_id,student_id) DO UPDATE SET state='pending_review',reason=CASE WHEN public.learning_refund_reviews.state='pending_review' AND public.learning_refund_reviews.reason<>'Duplicate verified payment requires review' THEN public.learning_refund_reviews.reason ELSE EXCLUDED.reason END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION live_finance.reopen_learning_refund_review() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER learning_receipt_reopens_review AFTER INSERT ON live_finance.learning_receipts FOR EACH ROW EXECUTE FUNCTION live_finance.reopen_learning_refund_review();
CREATE FUNCTION live_finance.cancel_learning_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text;
BEGIN
 k:=CASE WHEN TG_TABLE_NAME='interactive_classes' THEN 'class' ELSE 'service' END;
 INSERT INTO public.learning_refund_reviews(resource_kind,resource_id,student_id,state,reason)
 SELECT o.kind,o.resource_id,o.buyer_id,'pending_review','Paid resource cancelled; verify full refund evidence' FROM live_finance.learning_orders o WHERE o.kind=k AND o.resource_id=NEW.id AND o.state IN ('paid','paid_review')
 ON CONFLICT(resource_kind,resource_id,student_id) DO UPDATE SET state='pending_review',reason=EXCLUDED.reason;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION live_finance.cancel_learning_review() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER class_cancel_reopens_review AFTER UPDATE OF status ON public.interactive_classes FOR EACH ROW WHEN (NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION live_finance.cancel_learning_review();
CREATE TRIGGER service_cancel_reopens_review AFTER UPDATE OF state ON public.personal_learning_requests FOR EACH ROW WHEN (NEW.state='cancelled' AND OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION live_finance.cancel_learning_review();
CREATE OR REPLACE FUNCTION public.week7_record_learning_refund_review(_actor uuid,_id uuid,_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.learning_refund_reviews%ROWTYPE; o live_finance.learning_orders%ROWTYPE; duplicate_only boolean;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.learning_refund_reviews WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR v.state<>'pending_review' THEN RAISE EXCEPTION 'LEARNING_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 SELECT * INTO o FROM live_finance.learning_orders WHERE kind=v.resource_kind AND resource_id=v.resource_id AND buyer_id=v.student_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEARNING_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 duplicate_only:=v.reason='Duplicate verified payment requires review' AND o.state='paid' AND CASE o.kind
 WHEN 'class' THEN EXISTS(SELECT 1 FROM public.interactive_classes c JOIN public.interactive_class_enrollments e ON e.class_id=c.id AND e.student_id=o.buyer_id AND e.state='enrolled' WHERE c.id=o.resource_id AND c.status<>'cancelled')
 WHEN 'service' THEN EXISTS(SELECT 1 FROM public.personal_learning_requests s WHERE s.id=o.resource_id AND s.state NOT IN ('cancelled','disputed'))
 ELSE false END;
 IF _actor IN (o.creator_id,o.buyer_id) OR NOT EXISTS(SELECT 1 FROM live_finance.learning_receipts r WHERE r.order_id=o.id AND EXISTS(SELECT 1 FROM live_finance.learning_refunds f WHERE f.transaction_id=r.transaction_id)) OR EXISTS(SELECT 1 FROM live_finance.learning_receipts r WHERE r.order_id=o.id AND (NOT duplicate_only OR r.duplicate OR NOT r.delivered) AND NOT EXISTS(SELECT 1 FROM live_finance.learning_refunds f WHERE f.transaction_id=r.transaction_id)) THEN RAISE EXCEPTION 'LEARNING_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 UPDATE public.learning_refund_reviews SET state='recorded' WHERE id=v.id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(_actor,'learning.refund.review.recorded','learning_refund_review',v.id,btrim(_note));
 RETURN jsonb_build_object('id',v.id,'status','recorded','refundIssued',false);
END $$;
