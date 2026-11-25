-- Payout reservations only. No transfer endpoint, provider recipient creation, or automatic clearance.
-- Policy and independently verified bank/recipient evidence are owner-managed and initially absent.
CREATE TABLE live_finance.payout_gate(
 singleton boolean PRIMARY KEY CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
 version text CHECK(version ~ '^[A-Za-z0-9_.:-]{1,128}$'), minimum_kobo bigint CHECK(minimum_kobo>0),
 maximum_kobo bigint CHECK(maximum_kobo>=minimum_kobo AND maximum_kobo<=9007199254740991),
 approved_at timestamptz,
 CHECK(NOT enabled OR (version IS NOT NULL AND minimum_kobo IS NOT NULL AND maximum_kobo IS NOT NULL AND approved_at IS NOT NULL))
);
INSERT INTO live_finance.payout_gate(singleton) VALUES(true);
CREATE TABLE live_finance.payout_recipient_evidence(
 creator_id uuid PRIMARY KEY REFERENCES auth.users(id),
 recipient_reference text NOT NULL CHECK(recipient_reference ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 kyc_evidence_reference text NOT NULL CHECK(kyc_evidence_reference ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 verified_at timestamptz NOT NULL, valid_until timestamptz NOT NULL CHECK(valid_until>verified_at), revoked_at timestamptz
);
-- One receipt can be cleared once only. These entries attest independent bank
-- evidence, not merely a Paystack charge or a user-uploaded screenshot.
CREATE TABLE live_finance.payout_clearance(
 transaction_id text PRIMARY KEY CHECK(transaction_id ~ '^[1-9][0-9]{0,19}$'),
 creator_id uuid NOT NULL REFERENCES auth.users(id),
 source text NOT NULL CHECK(source IN ('lesson','learning')),
 settlement_reference text NOT NULL CHECK(settlement_reference ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 bank_evidence_reference text NOT NULL CHECK(bank_evidence_reference ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 recorded_by uuid NOT NULL REFERENCES auth.users(id), confirmed_by uuid NOT NULL REFERENCES auth.users(id),
 cleared_at timestamptz NOT NULL DEFAULT now(),
 CHECK(recorded_by<>confirmed_by AND creator_id<>recorded_by AND creator_id<>confirmed_by)
);
CREATE INDEX payout_clearance_creator ON live_finance.payout_clearance(creator_id);
CREATE TABLE live_finance.payout_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),creator_id uuid NOT NULL REFERENCES auth.users(id),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 1 AND 9007199254740991),
 policy_version text NOT NULL, recipient_reference text NOT NULL,
 state text NOT NULL DEFAULT 'pending_review' CHECK(state IN ('pending_review','reserved','rejected','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reviewer_id uuid REFERENCES auth.users(id), review_note text,
 UNIQUE(creator_id,request_key), CHECK(reviewer_id IS NULL OR reviewer_id<>creator_id),
 CHECK((state='pending_review' AND reviewed_at IS NULL AND reviewer_id IS NULL) OR
 (state='cancelled' AND reviewed_at IS NOT NULL) OR
 (state IN ('reserved','rejected') AND reviewed_at IS NOT NULL AND reviewer_id IS NOT NULL AND review_note IS NOT NULL))
);
CREATE INDEX payout_request_creator_state ON live_finance.payout_requests(creator_id,state,created_at);
ALTER TABLE live_finance.payout_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_finance.payout_recipient_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_finance.payout_clearance ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_finance.payout_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.payout_gate,live_finance.payout_recipient_evidence,live_finance.payout_clearance,live_finance.payout_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_clearance_immutable BEFORE UPDATE OR DELETE ON live_finance.payout_clearance FOR EACH ROW EXECUTE FUNCTION live_finance.deny_mutation();
-- Compute from journal movements on cleared receipts; reversed credits are
-- removed, negative fee/refund movements are never promoted to spendable money.
CREATE FUNCTION live_finance.payout_balance(_creator uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH movements AS (
 SELECT r.transaction_id,coalesce(sum(CASE WHEN j.credit_account='creator_pending' THEN j.amount_kobo WHEN j.debit_account='creator_pending' THEN -j.amount_kobo ELSE 0 END),0) AS net,
 EXISTS(SELECT 1 FROM live_finance.reversals v WHERE v.transaction_id=r.transaction_id) AS reversed
 FROM live_finance.payout_clearance e JOIN live_finance.receipts r ON e.source='lesson' AND e.transaction_id=r.transaction_id AND NOT r.duplicate
 JOIN public.orders o ON o.id=r.order_id AND o.creator_id=e.creator_id AND o.environment='live'
 JOIN live_finance.journal j ON j.transaction_id=r.transaction_id AND j.order_id=r.order_id
 WHERE e.creator_id=_creator GROUP BY r.transaction_id
 UNION ALL
 SELECT r.transaction_id,coalesce(sum(CASE WHEN j.credit_account='creator_pending' THEN j.amount_kobo WHEN j.debit_account='creator_pending' THEN -j.amount_kobo ELSE 0 END),0),
 EXISTS(SELECT 1 FROM live_finance.learning_refunds v WHERE v.transaction_id=r.transaction_id)
 FROM live_finance.payout_clearance e JOIN live_finance.learning_receipts r ON e.source='learning' AND e.transaction_id=r.transaction_id AND NOT r.duplicate AND r.delivered
 JOIN live_finance.learning_orders o ON o.id=r.order_id AND o.creator_id=e.creator_id
 JOIN live_finance.learning_journal j ON j.transaction_id=r.transaction_id AND j.order_id=r.order_id
 WHERE e.creator_id=_creator GROUP BY r.transaction_id
 ), net AS (SELECT coalesce(sum(CASE WHEN reversed THEN least(net,0) ELSE net END),0) AS cleared FROM movements),
 reserved AS (SELECT coalesce(sum(amount_kobo),0) AS amount FROM live_finance.payout_requests WHERE creator_id=_creator AND state='reserved')
 SELECT jsonb_build_object('clearedKobo',cleared::text,'reservedKobo',amount::text,'availableKobo',greatest(cleared-amount,0)::text,'transferEnabled',false) FROM net,reserved
$$;
REVOKE ALL ON FUNCTION live_finance.payout_balance(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION student_social_private.payout_request(_action text,_amount bigint,_key text,_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); g live_finance.payout_gate%ROWTYPE; e live_finance.payout_recipient_evidence%ROWTYPE; r live_finance.payout_requests%ROWTYPE; b jsonb;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _action='list' THEN
  RETURN jsonb_build_object('balance',live_finance.payout_balance(actor),'items',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) FROM (SELECT id,amount_kobo,state,policy_version,created_at,reviewed_at FROM live_finance.payout_requests WHERE creator_id=actor ORDER BY created_at DESC,id LIMIT 50) q),'transferEnabled',false);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':payout',0));
 IF _action='cancel' THEN
  UPDATE live_finance.payout_requests SET state='cancelled',reviewed_at=now() WHERE id=_id AND creator_id=actor AND state IN ('pending_review','reserved') RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
  INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'payout.cancelled','payout_request',r.id);
  RETURN jsonb_build_object('id',r.id,'state',r.state,'transferEnabled',false);
 END IF;
 IF _action IS DISTINCT FROM 'request' OR _amount IS NULL OR _key IS NULL OR _key !~ '^[A-Za-z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'INVALID_PAYOUT_REQUEST' USING ERRCODE='22023'; END IF;
 IF NOT public.current_student_eligible() THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO g FROM live_finance.payout_gate WHERE singleton FOR SHARE;
 IF NOT g.enabled THEN RAISE EXCEPTION 'PAYOUT_DISABLED' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM live_finance.payout_recipient_evidence WHERE creator_id=actor AND revoked_at IS NULL AND verified_at<=now() AND valid_until>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM live_finance.payout_requests WHERE creator_id=actor AND request_key=_key;
 IF FOUND THEN
  IF r.amount_kobo<>_amount THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('id',r.id,'state',r.state,'replayed',true,'transferEnabled',false);
 END IF;
 b:=live_finance.payout_balance(actor);
 IF _amount NOT BETWEEN g.minimum_kobo AND g.maximum_kobo OR _amount>(b->>'availableKobo')::numeric OR EXISTS(SELECT 1 FROM live_finance.payout_requests WHERE creator_id=actor AND state='pending_review') THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 INSERT INTO live_finance.payout_requests(creator_id,request_key,amount_kobo,policy_version,recipient_reference) VALUES(actor,_key,_amount,g.version,e.recipient_reference) RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'payout.requested','payout_request',r.id);
 RETURN jsonb_build_object('id',r.id,'state',r.state,'replayed',false,'transferEnabled',false);
END $$;
REVOKE ALL ON FUNCTION student_social_private.payout_request(text,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.payout_request(text,bigint,text,uuid) TO authenticated;
CREATE FUNCTION public.creator_payout_request(_action text,_amount bigint DEFAULT NULL,_key text DEFAULT NULL,_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.payout_request(_action,_amount,_key,_id) $$;
REVOKE ALL ON FUNCTION public.creator_payout_request(text,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_payout_request(text,bigint,text,uuid) TO authenticated;
CREATE FUNCTION public.week7_payout_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) FROM (SELECT id,creator_id,amount_kobo,state,policy_version,created_at FROM live_finance.payout_requests WHERE state='pending_review' AND creator_id<>_actor ORDER BY created_at,id LIMIT _limit) q),'transferEnabled',false);
END $$;
CREATE FUNCTION public.week7_review_payout(_actor uuid,_id uuid,_decision text,_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r live_finance.payout_requests%ROWTYPE; g live_finance.payout_gate%ROWTYPE; b jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _decision IS NULL OR _decision NOT IN ('reserve','reject') OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM live_finance.payout_requests WHERE id=_id;
 IF NOT FOUND OR r.creator_id=_actor THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.creator_id::text||':payout',0));
 SELECT * INTO r FROM live_finance.payout_requests WHERE id=_id FOR UPDATE;
 IF r.state<>'pending_review' THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 IF _decision='reserve' THEN
  SELECT * INTO g FROM live_finance.payout_gate WHERE singleton FOR SHARE;
  IF NOT g.enabled OR g.version<>r.policy_version OR r.amount_kobo NOT BETWEEN g.minimum_kobo AND g.maximum_kobo OR NOT public.affiliation_eligible(r.creator_id) OR NOT EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence e WHERE e.creator_id=r.creator_id AND e.recipient_reference=r.recipient_reference AND e.revoked_at IS NULL AND e.verified_at<=now() AND e.valid_until>now()) THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  -- Serialize with settlement/reversal order writers before recalculating.
  PERFORM 1 FROM public.orders o WHERE o.creator_id=r.creator_id AND o.environment='live' ORDER BY o.id FOR UPDATE;
  PERFORM 1 FROM live_finance.learning_orders o WHERE o.creator_id=r.creator_id ORDER BY o.id FOR UPDATE;
  b:=live_finance.payout_balance(r.creator_id);
  IF r.amount_kobo>(b->>'availableKobo')::numeric THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 END IF;
 UPDATE live_finance.payout_requests SET state=CASE _decision WHEN 'reserve' THEN 'reserved' ELSE 'rejected' END,reviewer_id=_actor,reviewed_at=now(),review_note=btrim(_note) WHERE id=_id RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.'||r.state,'payout_request',r.id);
 RETURN jsonb_build_object('id',r.id,'state',r.state,'transferEnabled',false);
END $$;
REVOKE ALL ON FUNCTION public.week7_payout_queue(uuid,integer),public.week7_review_payout(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.week7_payout_queue(uuid,integer),public.week7_review_payout(uuid,uuid,text,text) TO service_role;
