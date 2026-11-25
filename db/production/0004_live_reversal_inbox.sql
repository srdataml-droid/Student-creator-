-- Durable live reversal evidence inbox. It cannot initiate refunds or transfers.
CREATE TABLE live_finance.reversal_inbox (
 event_type text NOT NULL CHECK(event_type IN ('refund.processed','charge.dispute.create','charge.dispute.remind','charge.dispute.resolve')),
 provider_id text NOT NULL CHECK(provider_id ~ '^[1-9][0-9]{0,19}$'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'received' CHECK(state IN ('received','processing','processed','failed','review','dead_letter')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 lease_id uuid,lease_until timestamptz,next_retry_at timestamptz DEFAULT now(),
 reason text CHECK(reason ~ '^[A-Z_]{1,60}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_type,provider_id),
 CHECK((state='processing')=(lease_id IS NOT NULL AND lease_until IS NOT NULL))
);
ALTER TABLE live_finance.reversal_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.reversal_inbox FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX live_reversal_due ON live_finance.reversal_inbox(next_retry_at,created_at) WHERE state IN ('received','failed','processing');

CREATE FUNCTION public.enqueue_live_reversal_event(_event text,_id text,_digest text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _event IS NULL OR _event NOT IN ('refund.processed','charge.dispute.create','charge.dispute.remind','charge.dispute.resolve') OR _id IS NULL OR _id !~ '^[1-9][0-9]{0,19}$' OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
 INSERT INTO live_finance.reversal_inbox(event_type,provider_id,payload_sha256) VALUES(_event,_id,_digest) ON CONFLICT DO NOTHING;
 RETURN CASE WHEN FOUND THEN 'accepted' ELSE 'duplicate' END;
END $$;
CREATE FUNCTION public.claim_live_reversal_event()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r live_finance.reversal_inbox;
BEGIN
 UPDATE live_finance.reversal_inbox SET state='dead_letter',reason='RETRY_EXHAUSTED',lease_id=NULL,lease_until=NULL,next_retry_at=NULL
 WHERE state='processing' AND lease_until<=now() AND attempts>=8;
 SELECT * INTO r FROM live_finance.reversal_inbox WHERE attempts<8 AND
 (state='received' OR (state='failed' AND next_retry_at<=now()) OR (state='processing' AND lease_until<=now()))
 ORDER BY created_at,event_type,provider_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE live_finance.reversal_inbox SET state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',next_retry_at=NULL
 WHERE event_type=r.event_type AND provider_id=r.provider_id RETURNING * INTO r;
 RETURN jsonb_build_object('event',r.event_type,'id',r.provider_id,'lease',r.lease_id);
END $$;
CREATE FUNCTION public.finish_live_reversal_event(_event text,_id text,_lease uuid,_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _reason IS NULL OR _reason NOT IN ('PROVIDER_UNAVAILABLE','RECEIPT_NOT_FOUND','PARTIAL_REFUND_REVIEW','DISPUTE_REVIEW','PROVIDER_EVIDENCE_REVIEW','REVERSAL_CONFLICT') THEN RETURN false;END IF;
 UPDATE live_finance.reversal_inbox SET
 state=CASE WHEN _reason IN ('PROVIDER_UNAVAILABLE','RECEIPT_NOT_FOUND') THEN CASE WHEN attempts>=8 THEN 'dead_letter' ELSE 'failed' END ELSE 'review' END,
 reason=_reason,lease_id=NULL,lease_until=NULL,next_retry_at=CASE WHEN _reason IN ('PROVIDER_UNAVAILABLE','RECEIPT_NOT_FOUND') AND attempts<8 THEN now()+make_interval(secs=>60*attempts) ELSE NULL END
 WHERE event_type=_event AND provider_id=_id AND state='processing' AND lease_id=_lease AND lease_until>now();
 RETURN FOUND;
END $$;
-- Resolve only a previously verified receipt. Provider evidence is checked by the worker;
-- no caller can set a reference, entitlement or order amount directly.
CREATE FUNCTION public.live_reversal_receipt(_tx text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('reference',r.reference,'amountKobo',r.amount_kobo,'transactionId',r.transaction_id,'domain',o.environment)
 FROM live_finance.receipts r JOIN public.orders o ON o.id=r.order_id WHERE r.transaction_id=_tx AND o.environment='live'
$$;
CREATE FUNCTION public.apply_live_refund_event(_id text,_lease uuid,_tx text,_amount bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r live_finance.reversal_inbox; receipt live_finance.receipts;
BEGIN
 SELECT * INTO r FROM live_finance.reversal_inbox WHERE event_type='refund.processed' AND provider_id=_id AND state='processing' AND lease_id=_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO receipt FROM live_finance.receipts WHERE transaction_id=_tx;
 IF NOT FOUND OR receipt.amount_kobo IS DISTINCT FROM _amount THEN RETURN false;END IF;
 PERFORM public.live_record_reversal(receipt.reference,_tx,'paystack-refund:'||_id,'refund',_amount,'NGN','live');
 UPDATE live_finance.reversal_inbox SET state='processed',lease_id=NULL,lease_until=NULL,reason=NULL,next_retry_at=NULL WHERE event_type=r.event_type AND provider_id=r.provider_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_live_reversal_event(text,text,text),public.claim_live_reversal_event(),public.finish_live_reversal_event(text,text,uuid,text),public.live_reversal_receipt(text),public.apply_live_refund_event(text,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_live_reversal_event(text,text,text),public.claim_live_reversal_event(),public.finish_live_reversal_event(text,text,uuid,text),public.live_reversal_receipt(text),public.apply_live_refund_event(text,uuid,text,bigint) TO service_role;
