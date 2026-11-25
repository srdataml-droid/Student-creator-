-- Owner-managed transfer policy is disabled on installation. No automatic policy defaults.
CREATE TABLE live_finance.payout_transfer_gate(
 singleton boolean PRIMARY KEY CHECK(singleton),enabled boolean NOT NULL DEFAULT false,
 version text CHECK(version ~ '^[A-Za-z0-9_.:-]{1,128}$'),fee_bearer text CHECK(fee_bearer='platform'),approved_at timestamptz,
 CHECK(NOT enabled OR (version IS NOT NULL AND fee_bearer IS NOT NULL AND approved_at IS NOT NULL))
);
INSERT INTO live_finance.payout_transfer_gate(singleton) VALUES(true);
CREATE TABLE live_finance.payout_transfers(
 payout_id uuid PRIMARY KEY REFERENCES live_finance.payout_requests(id),
 reference text NOT NULL UNIQUE CHECK(reference ~ '^pt_[a-f0-9]{32}$'),
 recipient_code text NOT NULL CHECK(recipient_code ~ '^RCP_[A-Za-z0-9]{8,80}$'),
 amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 1 AND 9007199254740991),
 transfer_policy_version text NOT NULL,
 authorized_by uuid NOT NULL REFERENCES auth.users(id),authorized_at timestamptz NOT NULL DEFAULT now(),
 stage text NOT NULL DEFAULT 'ready' CHECK(stage IN ('ready','verifying','observed','review','cancelled')),
 provider_status text NOT NULL DEFAULT 'unknown' CHECK(provider_status IN ('unknown','pending','otp','success','failed','reversed')),
 provider_code text UNIQUE CHECK(provider_code ~ '^TRF_[A-Za-z0-9]{8,80}$'),
 provider_fee_kobo bigint CHECK(provider_fee_kobo BETWEEN 0 AND 9007199254740991),
 observed_at timestamptz,dispatch_attempted_at timestamptz,
 lease_id uuid,lease_until timestamptz,next_check_at timestamptz NOT NULL DEFAULT now(),
 verification_attempts integer NOT NULL DEFAULT 0 CHECK(verification_attempts BETWEEN 0 AND 12),
 recheck_requested boolean NOT NULL DEFAULT false,
 bank_state text NOT NULL DEFAULT 'unconfirmed' CHECK(bank_state IN ('unconfirmed','paid','returned')),
 CHECK((lease_id IS NULL)=(lease_until IS NULL)),
 CHECK(stage='ready' OR dispatch_attempted_at IS NOT NULL OR stage IN ('review','cancelled'))
);
CREATE INDEX payout_transfer_due ON live_finance.payout_transfers(stage,next_check_at) WHERE stage IN ('ready','verifying');
CREATE TABLE live_finance.payout_transfer_bank_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payout_id uuid NOT NULL REFERENCES live_finance.payout_transfers(payout_id),
 outcome text NOT NULL CHECK(outcome IN ('paid','returned')),
 evidence_reference text NOT NULL CHECK(evidence_reference ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 confirmed_by uuid NOT NULL REFERENCES auth.users(id),confirmed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(payout_id,outcome)
);
CREATE TABLE live_finance.payout_transfer_events(
 payout_id uuid NOT NULL REFERENCES live_finance.payout_transfers(payout_id),event text NOT NULL CHECK(event IN ('transfer.success','transfer.failed','transfer.reversed')),digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64} ROW LEVEL SECURITY;
ALTER TABLE live_finance.payout_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_finance.payout_transfer_bank_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.payout_transfer_gate,live_finance.payout_transfers,live_finance.payout_transfer_bank_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_bank_event_immutable BEFORE UPDATE OR DELETE ON live_finance.payout_transfer_bank_events FOR EACH ROW EXECUTE FUNCTION live_finance.deny_mutation();
CREATE FUNCTION live_finance.prevent_dispatched_payout_cancellation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.state='reserved' AND NEW.state<>OLD.state AND EXISTS(SELECT 1 FROM live_finance.payout_transfers t WHERE t.payout_id=OLD.id AND (t.stage<>'cancelled' OR t.dispatch_attempted_at IS NOT NULL)) THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION live_finance.prevent_dispatched_payout_cancellation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_transfer_cancellation_guard BEFORE UPDATE OF state ON live_finance.payout_requests FOR EACH ROW EXECUTE FUNCTION live_finance.prevent_dispatched_payout_cancellation();

CREATE OR REPLACE FUNCTION live_finance.payout_balance(_creator uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
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
 reserved AS (SELECT coalesce(sum(r.amount_kobo) FILTER(WHERE coalesce(t.bank_state,'unconfirmed')='unconfirmed'),0) AS amount,coalesce(sum(r.amount_kobo) FILTER(WHERE t.bank_state='paid'),0) AS paid FROM live_finance.payout_requests r LEFT JOIN live_finance.payout_transfers t ON t.payout_id=r.id WHERE r.creator_id=_creator AND r.state='reserved')
 SELECT jsonb_build_object('grossClearedKobo',cleared::text,'clearedKobo',(cleared-paid)::text,'paidKobo',paid::text,'reservedKobo',amount::text,'availableKobo',greatest(cleared-paid-amount,0)::text,'transferEnabled',false) FROM net,reserved
$$;
REVOKE ALL ON FUNCTION live_finance.payout_balance(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION student_social_private.payout_request(_action text,_amount bigint,_key text,_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); g live_finance.payout_gate%ROWTYPE; e live_finance.payout_recipient_evidence%ROWTYPE; r live_finance.payout_requests%ROWTYPE; b jsonb;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _action='list' THEN
  RETURN jsonb_build_object('balance',live_finance.payout_balance(actor),'items',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) FROM (SELECT r.id,r.amount_kobo,r.state,r.policy_version,r.created_at,r.reviewed_at,t.provider_status AS transfer_status,t.bank_state FROM live_finance.payout_requests r LEFT JOIN live_finance.payout_transfers t ON t.payout_id=r.id WHERE r.creator_id=actor ORDER BY r.created_at DESC,r.id LIMIT 50) q),'transferEnabled',false);
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
 IF _amount NOT BETWEEN g.minimum_kobo AND g.maximum_kobo OR _amount>(b->>'availableKobo')::numeric OR EXISTS(SELECT 1 FROM live_finance.payout_requests WHERE creator_id=actor AND state='pending_review') OR (SELECT count(*) FROM live_finance.payout_requests WHERE creator_id=actor AND created_at>now()-interval '1 day')>=10 THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 INSERT INTO live_finance.payout_requests(creator_id,request_key,amount_kobo,policy_version,recipient_reference) VALUES(actor,_key,_amount,g.version,e.recipient_reference) RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'payout.requested','payout_request',r.id);
 RETURN jsonb_build_object('id',r.id,'state',r.state,'replayed',false,'transferEnabled',false);
END $$;
REVOKE ALL ON FUNCTION student_social_private.payout_request(text,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.payout_request(text,bigint,text,uuid) TO authenticated;
-- Read-only creator liability reconciliation. No bank proof, clearance or transfers.
CREATE OR REPLACE FUNCTION public.week7_payout_liability_report(_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 WITH journal_rows AS (
  SELECT o.creator_id,CASE WHEN j.credit_account='creator_pending' THEN j.amount_kobo WHEN j.debit_account='creator_pending' THEN -j.amount_kobo ELSE 0 END AS movement
  FROM live_finance.journal j JOIN public.orders o ON o.id=j.order_id WHERE o.environment='live'
  UNION ALL
  SELECT o.creator_id,CASE WHEN j.credit_account='creator_pending' THEN j.amount_kobo WHEN j.debit_account='creator_pending' THEN -j.amount_kobo ELSE 0 END
  FROM live_finance.learning_journal j JOIN live_finance.learning_orders o ON o.id=j.order_id
 ), journal_totals AS (SELECT creator_id,sum(movement) AS net FROM journal_rows GROUP BY creator_id),
 actors AS (SELECT creator_id FROM journal_totals UNION SELECT creator_id FROM live_finance.payout_clearance UNION SELECT creator_id FROM live_finance.payout_requests),
 balances AS MATERIALIZED (SELECT a.creator_id,coalesce(j.net,0) AS net,live_finance.payout_balance(a.creator_id) AS b FROM actors a LEFT JOIN journal_totals j USING(creator_id)),
 amounts AS (SELECT net,(b->>'grossClearedKobo')::numeric AS gross_cleared,(b->>'paidKobo')::numeric AS paid,(b->>'clearedKobo')::numeric AS cleared,(b->>'reservedKobo')::numeric AS reserved,(b->>'availableKobo')::numeric AS available FROM balances)
 SELECT jsonb_build_object('currency','NGN','creatorCount',count(*),
 'journalNetKobo',coalesce(sum(net),0)::text,'clearedKobo',coalesce(sum(cleared),0)::text,
 'grossClearedKobo',coalesce(sum(gross_cleared),0)::text,'paidKobo',coalesce(sum(paid),0)::text,'unclearedNetKobo',coalesce(sum(net-gross_cleared),0)::text,'reservedKobo',coalesce(sum(reserved),0)::text,
 'availableKobo',coalesce(sum(available),0)::text,
 'reservationShortfallKobo',coalesce(sum(greatest(reserved-greatest(cleared,0),0)),0)::text,
 'creatorsWithReservationShortfall',count(*) FILTER(WHERE reserved>greatest(cleared,0)),
 'negativeClearedKobo',coalesce(sum(greatest(-cleared,0)),0)::text,
 'observedTransferFeesKobo',(SELECT coalesce(sum(provider_fee_kobo),0)::text FROM live_finance.payout_transfers),
 'providerSuccessAwaitingBankKobo',(SELECT coalesce(sum(amount_kobo),0)::text FROM live_finance.payout_transfers WHERE provider_status='success' AND bank_state='unconfirmed'),
 'reversalsAwaitingBankCount',(SELECT count(*) FROM live_finance.payout_transfers WHERE provider_status='reversed' AND bank_state<>'returned'),
 'bankCreditVerified',false,'transferEnabled',false,'asOf',statement_timestamp()) INTO result FROM amounts;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.week7_payout_liability_report(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.week7_payout_liability_report(uuid) TO service_role;

-- Independent finance staff authorize and reconcile; the service role cannot
-- alter gates or money tables directly. Bank confirmation never follows solely
-- from a successful provider response.
CREATE FUNCTION public.week7_manage_payout_transfer(_actor uuid,_id uuid,_action text,_evidence text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r live_finance.payout_requests%ROWTYPE;t live_finance.payout_transfers%ROWTYPE;g live_finance.payout_transfer_gate%ROWTYPE;b jsonb;outcome text;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM live_finance.payout_requests WHERE id=_id;
 IF NOT FOUND OR r.creator_id=_actor THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.creator_id::text||':payout',0));
 SELECT * INTO r FROM live_finance.payout_requests WHERE id=_id FOR UPDATE;
 IF r.state<>'reserved' THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 SELECT * INTO t FROM live_finance.payout_transfers WHERE payout_id=_id FOR UPDATE;
 IF _action='authorize' THEN
  IF _actor=r.reviewer_id OR _evidence IS NOT NULL THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF t.payout_id IS NOT NULL THEN RETURN jsonb_build_object('id',_id,'stage',t.stage,'providerStatus',t.provider_status,'bankState',t.bank_state); END IF;
  SELECT * INTO g FROM live_finance.payout_transfer_gate WHERE singleton FOR SHARE;
  IF NOT g.enabled OR g.approved_at>now() OR NOT EXISTS(SELECT 1 FROM live_finance.payout_gate p WHERE p.singleton AND p.enabled AND p.version=r.policy_version AND r.amount_kobo BETWEEN p.minimum_kobo AND p.maximum_kobo) OR r.recipient_reference !~ '^RCP_[A-Za-z0-9]{8,80}$' OR NOT public.affiliation_eligible(r.creator_id) OR NOT EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence e WHERE e.creator_id=r.creator_id AND e.recipient_reference=r.recipient_reference AND e.revoked_at IS NULL AND e.verified_at<=now() AND e.valid_until>now()) THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.orders o WHERE o.creator_id=r.creator_id AND o.environment='live' ORDER BY o.id FOR UPDATE;
  PERFORM 1 FROM live_finance.learning_orders o WHERE o.creator_id=r.creator_id ORDER BY o.id FOR UPDATE;
  b:=live_finance.payout_balance(r.creator_id);
  IF (b->>'clearedKobo')::numeric<(b->>'reservedKobo')::numeric THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
  INSERT INTO live_finance.payout_transfers(payout_id,reference,recipient_code,amount_kobo,transfer_policy_version,authorized_by)
  VALUES(_id,'pt_'||replace(gen_random_uuid()::text,'-',''),r.recipient_reference,r.amount_kobo,g.version,_actor) RETURNING * INTO t;
 ELSIF _action='void_before_dispatch' THEN
  IF t.payout_id IS NULL OR t.authorized_by=_actor OR t.dispatch_attempted_at IS NOT NULL OR t.stage NOT IN ('ready','review') OR _evidence IS NOT NULL THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  UPDATE live_finance.payout_transfers SET stage='cancelled',lease_id=NULL,lease_until=NULL WHERE payout_id=_id RETURNING * INTO t;
  UPDATE live_finance.payout_requests SET state='cancelled',reviewed_at=now() WHERE id=_id;
 ELSIF _action='recheck' THEN
  IF t.payout_id IS NULL OR t.dispatch_attempted_at IS NULL OR t.lease_until>now() OR _evidence IS NOT NULL THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
  UPDATE live_finance.payout_transfers SET stage='verifying',lease_id=NULL,lease_until=NULL,next_check_at=now(),verification_attempts=0 WHERE payout_id=_id RETURNING * INTO t;
 ELSIF _action IN ('confirm_paid','confirm_returned') THEN
  IF t.payout_id IS NULL OR t.authorized_by=_actor OR t.lease_until>now() OR t.stage<>'observed' OR t.observed_at IS NULL OR t.observed_at<now()-interval '1 day' OR _evidence IS NULL OR _evidence !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  outcome:=CASE _action WHEN 'confirm_paid' THEN 'paid' ELSE 'returned' END;
  IF (outcome='paid' AND (t.bank_state<>'unconfirmed' OR t.provider_status<>'success')) OR (outcome='returned' AND (t.bank_state='returned' OR t.provider_status NOT IN ('failed','reversed') OR (t.bank_state='paid' AND t.provider_status<>'reversed'))) THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
  INSERT INTO live_finance.payout_transfer_bank_events(payout_id,outcome,evidence_reference,confirmed_by) VALUES(_id,outcome,_evidence,_actor);
  UPDATE live_finance.payout_transfers SET bank_state=outcome WHERE payout_id=_id RETURNING * INTO t;
 ELSE RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.transfer.'||_action,'payout_request',_id);
 RETURN jsonb_build_object('id',_id,'stage',t.stage,'providerStatus',t.provider_status,'bankState',t.bank_state);
END $$;

CREATE FUNCTION public.claim_payout_transfer(_allow_dispatch boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate uuid;creator uuid;r live_finance.payout_requests%ROWTYPE;t live_finance.payout_transfers%ROWTYPE;g live_finance.payout_transfer_gate%ROWTYPE;b jsonb;dispatch boolean;
BEGIN
 SELECT t0.payout_id,r0.creator_id INTO candidate,creator FROM live_finance.payout_transfers t0 JOIN live_finance.payout_requests r0 ON r0.id=t0.payout_id
 WHERE (t0.stage='verifying' AND t0.next_check_at<=now() AND (t0.lease_until IS NULL OR t0.lease_until<=now())) OR (t0.stage='ready' AND _allow_dispatch IS TRUE AND EXISTS(SELECT 1 FROM live_finance.payout_transfer_gate WHERE singleton AND enabled))
 ORDER BY (t0.stage='ready'),t0.next_check_at,t0.payout_id LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(creator::text||':payout',0)) THEN RETURN NULL; END IF;
 SELECT * INTO r FROM live_finance.payout_requests WHERE id=candidate FOR UPDATE;
 SELECT * INTO t FROM live_finance.payout_transfers WHERE payout_id=candidate FOR UPDATE;
 IF t.lease_until>now() OR t.stage NOT IN ('ready','verifying') OR t.next_check_at>now() THEN RETURN NULL; END IF;
 dispatch:=t.stage='ready';
 IF dispatch THEN
  SELECT * INTO g FROM live_finance.payout_transfer_gate WHERE singleton FOR SHARE;
  IF _allow_dispatch IS NOT TRUE OR NOT g.enabled THEN RETURN NULL; END IF;
  PERFORM 1 FROM live_finance.payout_recipient_evidence e WHERE e.creator_id=creator FOR SHARE;
  PERFORM 1 FROM live_finance.payout_gate WHERE singleton FOR SHARE;
  PERFORM 1 FROM public.orders o WHERE o.creator_id=creator AND o.environment='live' ORDER BY o.id FOR UPDATE;
  PERFORM 1 FROM live_finance.learning_orders o WHERE o.creator_id=creator ORDER BY o.id FOR UPDATE;
  b:=live_finance.payout_balance(creator);
  IF r.state<>'reserved' OR g.version<>t.transfer_policy_version OR g.approved_at>now() OR NOT public.week7_staff_has_capability(t.authorized_by,'finance.review') OR NOT public.week7_staff_has_capability(r.reviewer_id,'finance.review') OR NOT public.affiliation_eligible(creator) OR (b->>'clearedKobo')::numeric<(b->>'reservedKobo')::numeric OR NOT EXISTS(SELECT 1 FROM live_finance.payout_gate p WHERE p.singleton AND p.enabled AND p.version=r.policy_version AND r.amount_kobo BETWEEN p.minimum_kobo AND p.maximum_kobo) OR NOT EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence e WHERE e.creator_id=creator AND e.recipient_reference=t.recipient_code AND e.revoked_at IS NULL AND e.verified_at<=now() AND e.valid_until>now()) THEN
   UPDATE live_finance.payout_transfers SET stage='review' WHERE payout_id=candidate;
   RETURN NULL;
  END IF;
 ELSIF t.verification_attempts>=12 THEN
  UPDATE live_finance.payout_transfers SET stage='review',lease_id=NULL,lease_until=NULL WHERE payout_id=candidate;
  RETURN NULL;
 END IF;
 -- Commit before any external POST. A crash, timeout or expired lease can
 -- only cause GET verification; no automatic second transfer initiation.
 UPDATE live_finance.payout_transfers SET stage='verifying',dispatch_attempted_at=coalesce(dispatch_attempted_at,now()),lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',verification_attempts=verification_attempts+1 WHERE payout_id=candidate RETURNING * INTO t;
 RETURN jsonb_build_object('id',candidate,'reference',t.reference,'recipientCode',t.recipient_code,'amountKobo',t.amount_kobo,'lease',t.lease_id,'dispatch',dispatch);
END $$;

CREATE FUNCTION public.record_payout_transfer_observation(_id uuid,_lease uuid,_status text,_code text,_fee bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t live_finance.payout_transfers%ROWTYPE;valid boolean;terminal boolean;
BEGIN
 SELECT * INTO t FROM live_finance.payout_transfers WHERE payout_id=_id AND stage='verifying' AND lease_id=_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF _status IS NULL OR _status NOT IN ('unknown','pending','otp','success','failed','reversed') THEN RETURN false; END IF;
 valid:=_status<>'unknown' AND _code IS NOT NULL AND _code ~ '^TRF_[A-Za-z0-9]{8,80}$' AND (t.provider_code IS NULL OR t.provider_code=_code) AND (_fee IS NULL OR _fee BETWEEN 0 AND 9007199254740991) AND (_status<>'success' OR _fee IS NOT NULL);
 terminal:=valid AND _status IN ('success','failed','reversed');
 -- Never silently overwrite an earlier definitive provider status with an
 -- incompatible one. A late reversal after success is expected and recorded.
 IF valid AND t.provider_status IN ('success','failed','reversed') AND t.provider_status<>_status AND NOT (t.provider_status='success' AND _status='reversed') THEN
  UPDATE live_finance.payout_transfers SET stage='review',lease_id=NULL,lease_until=NULL WHERE payout_id=_id;RETURN true;
 END IF;
 UPDATE live_finance.payout_transfers SET provider_status=CASE WHEN valid THEN _status ELSE provider_status END,provider_code=CASE WHEN valid THEN _code ELSE provider_code END,provider_fee_kobo=CASE WHEN valid THEN coalesce(_fee,provider_fee_kobo) ELSE provider_fee_kobo END,observed_at=CASE WHEN valid THEN now() ELSE observed_at END,stage=CASE WHEN recheck_requested THEN 'verifying' WHEN terminal THEN 'observed' WHEN verification_attempts>=12 THEN 'review' ELSE 'verifying' END,next_check_at=CASE WHEN recheck_requested THEN now() ELSE now()+interval '2 minutes' END,verification_attempts=CASE WHEN recheck_requested THEN 0 ELSE verification_attempts END,recheck_requested=false,lease_id=NULL,lease_until=NULL WHERE payout_id=_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.week7_manage_payout_transfer(uuid,uuid,text,text),public.claim_payout_transfer(boolean),public.record_payout_transfer_observation(uuid,uuid,text,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.week7_manage_payout_transfer(uuid,uuid,text,text),public.claim_payout_transfer(boolean),public.record_payout_transfer_observation(uuid,uuid,text,text,bigint) TO service_role;
),received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(payout_id,event)
);
ALTER TABLE live_finance.payout_transfer_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.payout_transfer_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_transfer_event_immutable BEFORE UPDATE OR DELETE ON live_finance.payout_transfer_events FOR EACH ROW EXECUTE FUNCTION live_finance.deny_mutation();
ALTER TABLE live_finance.payout_transfer_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_finance.payout_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_finance.payout_transfer_bank_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.payout_transfer_gate,live_finance.payout_transfers,live_finance.payout_transfer_bank_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_bank_event_immutable BEFORE UPDATE OR DELETE ON live_finance.payout_transfer_bank_events FOR EACH ROW EXECUTE FUNCTION live_finance.deny_mutation();
CREATE FUNCTION live_finance.prevent_dispatched_payout_cancellation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.state='reserved' AND NEW.state<>OLD.state AND EXISTS(SELECT 1 FROM live_finance.payout_transfers t WHERE t.payout_id=OLD.id) THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION live_finance.prevent_dispatched_payout_cancellation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_transfer_cancellation_guard BEFORE UPDATE OF state ON live_finance.payout_requests FOR EACH ROW EXECUTE FUNCTION live_finance.prevent_dispatched_payout_cancellation();

CREATE OR REPLACE FUNCTION live_finance.payout_balance(_creator uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
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
 reserved AS (SELECT coalesce(sum(r.amount_kobo) FILTER(WHERE coalesce(t.bank_state,'unconfirmed')='unconfirmed'),0) AS amount,coalesce(sum(r.amount_kobo) FILTER(WHERE t.bank_state='paid'),0) AS paid FROM live_finance.payout_requests r LEFT JOIN live_finance.payout_transfers t ON t.payout_id=r.id WHERE r.creator_id=_creator AND r.state='reserved')
 SELECT jsonb_build_object('grossClearedKobo',cleared::text,'clearedKobo',(cleared-paid)::text,'paidKobo',paid::text,'reservedKobo',amount::text,'availableKobo',greatest(cleared-paid-amount,0)::text,'transferEnabled',false) FROM net,reserved
$$;
REVOKE ALL ON FUNCTION live_finance.payout_balance(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION student_social_private.payout_request(_action text,_amount bigint,_key text,_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); g live_finance.payout_gate%ROWTYPE; e live_finance.payout_recipient_evidence%ROWTYPE; r live_finance.payout_requests%ROWTYPE; b jsonb;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _action='list' THEN
  RETURN jsonb_build_object('balance',live_finance.payout_balance(actor),'items',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) FROM (SELECT r.id,r.amount_kobo,r.state,r.policy_version,r.created_at,r.reviewed_at,t.provider_status AS transfer_status,t.bank_state FROM live_finance.payout_requests r LEFT JOIN live_finance.payout_transfers t ON t.payout_id=r.id WHERE r.creator_id=actor ORDER BY r.created_at DESC,r.id LIMIT 50) q),'transferEnabled',false);
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
 IF _amount NOT BETWEEN g.minimum_kobo AND g.maximum_kobo OR _amount>(b->>'availableKobo')::numeric OR EXISTS(SELECT 1 FROM live_finance.payout_requests WHERE creator_id=actor AND state='pending_review') OR (SELECT count(*) FROM live_finance.payout_requests WHERE creator_id=actor AND created_at>now()-interval '1 day')>=10 THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 INSERT INTO live_finance.payout_requests(creator_id,request_key,amount_kobo,policy_version,recipient_reference) VALUES(actor,_key,_amount,g.version,e.recipient_reference) RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'payout.requested','payout_request',r.id);
 RETURN jsonb_build_object('id',r.id,'state',r.state,'replayed',false,'transferEnabled',false);
END $$;
REVOKE ALL ON FUNCTION student_social_private.payout_request(text,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.payout_request(text,bigint,text,uuid) TO authenticated;
-- Read-only creator liability reconciliation. No bank proof, clearance or transfers.
CREATE OR REPLACE FUNCTION public.week7_payout_liability_report(_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 WITH journal_rows AS (
  SELECT o.creator_id,CASE WHEN j.credit_account='creator_pending' THEN j.amount_kobo WHEN j.debit_account='creator_pending' THEN -j.amount_kobo ELSE 0 END AS movement
  FROM live_finance.journal j JOIN public.orders o ON o.id=j.order_id WHERE o.environment='live'
  UNION ALL
  SELECT o.creator_id,CASE WHEN j.credit_account='creator_pending' THEN j.amount_kobo WHEN j.debit_account='creator_pending' THEN -j.amount_kobo ELSE 0 END
  FROM live_finance.learning_journal j JOIN live_finance.learning_orders o ON o.id=j.order_id
 ), journal_totals AS (SELECT creator_id,sum(movement) AS net FROM journal_rows GROUP BY creator_id),
 actors AS (SELECT creator_id FROM journal_totals UNION SELECT creator_id FROM live_finance.payout_clearance UNION SELECT creator_id FROM live_finance.payout_requests),
 balances AS MATERIALIZED (SELECT a.creator_id,coalesce(j.net,0) AS net,live_finance.payout_balance(a.creator_id) AS b FROM actors a LEFT JOIN journal_totals j USING(creator_id)),
 amounts AS (SELECT net,(b->>'grossClearedKobo')::numeric AS gross_cleared,(b->>'paidKobo')::numeric AS paid,(b->>'clearedKobo')::numeric AS cleared,(b->>'reservedKobo')::numeric AS reserved,(b->>'availableKobo')::numeric AS available FROM balances)
 SELECT jsonb_build_object('currency','NGN','creatorCount',count(*),
 'journalNetKobo',coalesce(sum(net),0)::text,'clearedKobo',coalesce(sum(cleared),0)::text,
 'grossClearedKobo',coalesce(sum(gross_cleared),0)::text,'paidKobo',coalesce(sum(paid),0)::text,'unclearedNetKobo',coalesce(sum(net-gross_cleared),0)::text,'reservedKobo',coalesce(sum(reserved),0)::text,
 'availableKobo',coalesce(sum(available),0)::text,
 'reservationShortfallKobo',coalesce(sum(greatest(reserved-greatest(cleared,0),0)),0)::text,
 'creatorsWithReservationShortfall',count(*) FILTER(WHERE reserved>greatest(cleared,0)),
 'negativeClearedKobo',coalesce(sum(greatest(-cleared,0)),0)::text,
 'bankCreditVerified',false,'transferEnabled',false,'asOf',statement_timestamp()) INTO result FROM amounts;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.week7_payout_liability_report(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.week7_payout_liability_report(uuid) TO service_role;

-- Independent finance staff authorize and reconcile; the service role cannot
-- alter gates or money tables directly. Bank confirmation never follows solely
-- from a successful provider response.
CREATE FUNCTION public.week7_manage_payout_transfer(_actor uuid,_id uuid,_action text,_evidence text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r live_finance.payout_requests%ROWTYPE;t live_finance.payout_transfers%ROWTYPE;g live_finance.payout_transfer_gate%ROWTYPE;b jsonb;outcome text;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM live_finance.payout_requests WHERE id=_id;
 IF NOT FOUND OR r.creator_id=_actor THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.creator_id::text||':payout',0));
 SELECT * INTO r FROM live_finance.payout_requests WHERE id=_id FOR UPDATE;
 IF r.state<>'reserved' THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
 SELECT * INTO t FROM live_finance.payout_transfers WHERE payout_id=_id FOR UPDATE;
 IF _action='authorize' THEN
  IF _actor=r.reviewer_id OR _evidence IS NOT NULL THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF t.payout_id IS NOT NULL THEN RETURN jsonb_build_object('id',_id,'stage',t.stage,'providerStatus',t.provider_status,'bankState',t.bank_state); END IF;
  SELECT * INTO g FROM live_finance.payout_transfer_gate WHERE singleton FOR SHARE;
  IF NOT g.enabled OR g.approved_at>now() OR NOT EXISTS(SELECT 1 FROM live_finance.payout_gate p WHERE p.singleton AND p.enabled AND p.version=r.policy_version AND r.amount_kobo BETWEEN p.minimum_kobo AND p.maximum_kobo) OR r.recipient_reference !~ '^RCP_[A-Za-z0-9]{8,80}$' OR NOT public.affiliation_eligible(r.creator_id) OR NOT EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence e WHERE e.creator_id=r.creator_id AND e.recipient_reference=r.recipient_reference AND e.revoked_at IS NULL AND e.verified_at<=now() AND e.valid_until>now()) THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.orders o WHERE o.creator_id=r.creator_id AND o.environment='live' ORDER BY o.id FOR UPDATE;
  PERFORM 1 FROM live_finance.learning_orders o WHERE o.creator_id=r.creator_id ORDER BY o.id FOR UPDATE;
  b:=live_finance.payout_balance(r.creator_id);
  IF (b->>'clearedKobo')::numeric<(b->>'reservedKobo')::numeric THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
  INSERT INTO live_finance.payout_transfers(payout_id,reference,recipient_code,amount_kobo,transfer_policy_version,authorized_by)
  VALUES(_id,'pt_'||replace(gen_random_uuid()::text,'-',''),r.recipient_reference,r.amount_kobo,g.version,_actor) RETURNING * INTO t;
 ELSIF _action='recheck' THEN
  IF t.payout_id IS NULL OR t.dispatch_attempted_at IS NULL OR t.lease_until>now() OR _evidence IS NOT NULL THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
  UPDATE live_finance.payout_transfers SET stage='verifying',lease_id=NULL,lease_until=NULL,next_check_at=now(),verification_attempts=0 WHERE payout_id=_id RETURNING * INTO t;
 ELSIF _action IN ('confirm_paid','confirm_returned') THEN
  IF t.payout_id IS NULL OR t.authorized_by=_actor OR t.lease_until>now() OR t.stage<>'observed' OR t.observed_at IS NULL OR t.observed_at<now()-interval '1 day' OR _evidence IS NULL OR _evidence !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN RAISE EXCEPTION 'PAYOUT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  outcome:=CASE _action WHEN 'confirm_paid' THEN 'paid' ELSE 'returned' END;
  IF (outcome='paid' AND (t.bank_state<>'unconfirmed' OR t.provider_status<>'success')) OR (outcome='returned' AND (t.bank_state='returned' OR t.provider_status NOT IN ('failed','reversed') OR (t.bank_state='paid' AND t.provider_status<>'reversed'))) THEN RAISE EXCEPTION 'PAYOUT_CONFLICT' USING ERRCODE='23505'; END IF;
  INSERT INTO live_finance.payout_transfer_bank_events(payout_id,outcome,evidence_reference,confirmed_by) VALUES(_id,outcome,_evidence,_actor);
  UPDATE live_finance.payout_transfers SET bank_state=outcome WHERE payout_id=_id RETURNING * INTO t;
 ELSE RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.transfer.'||_action,'payout_request',_id);
 RETURN jsonb_build_object('id',_id,'stage',t.stage,'providerStatus',t.provider_status,'bankState',t.bank_state);
END $$;

CREATE FUNCTION public.claim_payout_transfer(_allow_dispatch boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate uuid;creator uuid;r live_finance.payout_requests%ROWTYPE;t live_finance.payout_transfers%ROWTYPE;g live_finance.payout_transfer_gate%ROWTYPE;b jsonb;dispatch boolean;
BEGIN
 SELECT t0.payout_id,r0.creator_id INTO candidate,creator FROM live_finance.payout_transfers t0 JOIN live_finance.payout_requests r0 ON r0.id=t0.payout_id
 WHERE (t0.stage='verifying' AND t0.next_check_at<=now() AND (t0.lease_until IS NULL OR t0.lease_until<=now())) OR (t0.stage='ready' AND _allow_dispatch IS TRUE AND EXISTS(SELECT 1 FROM live_finance.payout_transfer_gate WHERE singleton AND enabled))
 ORDER BY (t0.stage='ready'),t0.next_check_at,t0.payout_id LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(creator::text||':payout',0)) THEN RETURN NULL; END IF;
 SELECT * INTO r FROM live_finance.payout_requests WHERE id=candidate FOR UPDATE;
 SELECT * INTO t FROM live_finance.payout_transfers WHERE payout_id=candidate FOR UPDATE;
 IF t.lease_until>now() OR t.stage NOT IN ('ready','verifying') OR t.next_check_at>now() THEN RETURN NULL; END IF;
 dispatch:=t.stage='ready';
 IF dispatch THEN
  SELECT * INTO g FROM live_finance.payout_transfer_gate WHERE singleton FOR SHARE;
  IF _allow_dispatch IS NOT TRUE OR NOT g.enabled THEN RETURN NULL; END IF;
  PERFORM 1 FROM live_finance.payout_recipient_evidence e WHERE e.creator_id=creator FOR SHARE;
  PERFORM 1 FROM live_finance.payout_gate WHERE singleton FOR SHARE;
  PERFORM 1 FROM public.orders o WHERE o.creator_id=creator AND o.environment='live' ORDER BY o.id FOR UPDATE;
  PERFORM 1 FROM live_finance.learning_orders o WHERE o.creator_id=creator ORDER BY o.id FOR UPDATE;
  b:=live_finance.payout_balance(creator);
  IF r.state<>'reserved' OR g.version<>t.transfer_policy_version OR g.approved_at>now() OR NOT public.week7_staff_has_capability(t.authorized_by,'finance.review') OR NOT public.week7_staff_has_capability(r.reviewer_id,'finance.review') OR NOT public.affiliation_eligible(creator) OR (b->>'clearedKobo')::numeric<(b->>'reservedKobo')::numeric OR NOT EXISTS(SELECT 1 FROM live_finance.payout_gate p WHERE p.singleton AND p.enabled AND p.version=r.policy_version AND r.amount_kobo BETWEEN p.minimum_kobo AND p.maximum_kobo) OR NOT EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence e WHERE e.creator_id=creator AND e.recipient_reference=t.recipient_code AND e.revoked_at IS NULL AND e.verified_at<=now() AND e.valid_until>now()) THEN
   UPDATE live_finance.payout_transfers SET stage='review' WHERE payout_id=candidate;
   RETURN NULL;
  END IF;
 ELSIF t.verification_attempts>=12 THEN
  UPDATE live_finance.payout_transfers SET stage='review',lease_id=NULL,lease_until=NULL WHERE payout_id=candidate;
  RETURN NULL;
 END IF;
 -- Commit before any external POST. A crash, timeout or expired lease can
 -- only cause GET verification; no automatic second transfer initiation.
 UPDATE live_finance.payout_transfers SET stage='verifying',dispatch_attempted_at=coalesce(dispatch_attempted_at,now()),lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',verification_attempts=verification_attempts+1 WHERE payout_id=candidate RETURNING * INTO t;
 RETURN jsonb_build_object('id',candidate,'reference',t.reference,'recipientCode',t.recipient_code,'amountKobo',t.amount_kobo,'lease',t.lease_id,'dispatch',dispatch);
END $$;

CREATE FUNCTION public.record_payout_transfer_observation(_id uuid,_lease uuid,_status text,_code text,_fee bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t live_finance.payout_transfers%ROWTYPE;valid boolean;terminal boolean;
BEGIN
 SELECT * INTO t FROM live_finance.payout_transfers WHERE payout_id=_id AND stage='verifying' AND lease_id=_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF _status IS NULL OR _status NOT IN ('unknown','pending','otp','success','failed','reversed') THEN RETURN false; END IF;
 valid:=_status<>'unknown' AND _code IS NOT NULL AND _code ~ '^TRF_[A-Za-z0-9]{8,80}$' AND (t.provider_code IS NULL OR t.provider_code=_code) AND (_fee IS NULL OR _fee BETWEEN 0 AND 9007199254740991) AND (_status<>'success' OR _fee IS NOT NULL);
 terminal:=valid AND _status IN ('success','failed','reversed');
 -- Never silently overwrite an earlier definitive provider status with an
 -- incompatible one. A late reversal after success is expected and recorded.
 IF valid AND t.provider_status IN ('success','failed','reversed') AND t.provider_status<>_status AND NOT (t.provider_status='success' AND _status='reversed') THEN
  UPDATE live_finance.payout_transfers SET stage='review',lease_id=NULL,lease_until=NULL WHERE payout_id=_id;RETURN true;
 END IF;
 UPDATE live_finance.payout_transfers SET provider_status=CASE WHEN valid THEN _status ELSE provider_status END,provider_code=CASE WHEN valid THEN _code ELSE provider_code END,provider_fee_kobo=CASE WHEN valid THEN coalesce(_fee,provider_fee_kobo) ELSE provider_fee_kobo END,observed_at=CASE WHEN valid THEN now() ELSE observed_at END,stage=CASE WHEN terminal THEN 'observed' WHEN verification_attempts>=12 THEN 'review' ELSE 'verifying' END,next_check_at=now()+interval '2 minutes',lease_id=NULL,lease_until=NULL WHERE payout_id=_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.week7_manage_payout_transfer(uuid,uuid,text,text),public.claim_payout_transfer(boolean),public.record_payout_transfer_observation(uuid,uuid,text,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.week7_manage_payout_transfer(uuid,uuid,text,text),public.claim_payout_transfer(boolean),public.record_payout_transfer_observation(uuid,uuid,text,text,bigint) TO service_role;

-- Signed events are only wake-up signals. Their claimed outcome is never
-- used as settlement evidence; the worker verifies by the original reference.
CREATE FUNCTION public.enqueue_payout_transfer_event(_reference text,_event text,_digest text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t live_finance.payout_transfers%ROWTYPE;
BEGIN
 IF _reference IS NULL OR _reference !~ '^pt_[a-f0-9]{32}$' OR _event IS NULL OR _event NOT IN ('transfer.success','transfer.failed','transfer.reversed') OR _digest IS NULL OR _digest !~ '^[a-f0-9]{64}$' THEN RETURN 'invalid';END IF;
 SELECT * INTO t FROM live_finance.payout_transfers WHERE reference=_reference AND dispatch_attempted_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 'unknown';END IF;
 INSERT INTO live_finance.payout_transfer_events(payout_id,event,digest) VALUES(t.payout_id,_event,_digest) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'duplicate';END IF;
 IF t.lease_until>now() THEN
  UPDATE live_finance.payout_transfers SET recheck_requested=true WHERE payout_id=t.payout_id;
 ELSE
  UPDATE live_finance.payout_transfers SET stage='verifying',next_check_at=now(),verification_attempts=0,lease_id=NULL,lease_until=NULL,recheck_requested=false WHERE payout_id=t.payout_id;
 END IF;
 RETURN 'accepted';
END $$;
CREATE FUNCTION public.week7_payout_transfer_queue(_actor uuid,_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) FROM (
 SELECT r.id,r.creator_id,r.amount_kobo,r.created_at,t.stage,t.provider_status,t.bank_state,t.observed_at,t.provider_fee_kobo,t.dispatch_attempted_at
 FROM live_finance.payout_requests r LEFT JOIN live_finance.payout_transfers t ON t.payout_id=r.id
 WHERE r.creator_id<>_actor AND r.state='reserved' AND (t.payout_id IS NULL OR t.bank_state='unconfirmed' OR t.provider_status='reversed' AND t.bank_state='paid' OR t.stage='review')
 ORDER BY r.created_at,r.id LIMIT _limit) q));
END $$;
REVOKE ALL ON FUNCTION public.enqueue_payout_transfer_event(text,text,text),public.week7_payout_transfer_queue(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_payout_transfer_event(text,text,text),public.week7_payout_transfer_queue(uuid,integer) TO service_role;
