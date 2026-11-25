-- Paystack refund webhooks may contain transaction_reference but no numeric refund ID.
ALTER TABLE live_finance.reversal_inbox DROP CONSTRAINT reversal_inbox_provider_id_check;
ALTER TABLE live_finance.reversal_inbox ADD CONSTRAINT reversal_inbox_provider_id_check CHECK(provider_id ~ '^[1-9][0-9]{0,19}$' OR (event_type='refund.processed' AND provider_id ~ '^lc_[0-9a-f]{32}:[0-9a-f]{64}$' AND split_part(provider_id,':',2)=payload_sha256));
CREATE OR REPLACE FUNCTION public.enqueue_live_reversal_event(_event text,_id text,_digest text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _event IS NULL OR _event NOT IN ('refund.processed','charge.dispute.create','charge.dispute.remind','charge.dispute.resolve') OR _id IS NULL OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' OR (_id !~ '^[1-9][0-9]{0,19}$' AND NOT (_event='refund.processed' AND _id ~ '^lc_[0-9a-f]{32}:[0-9a-f]{64}$' AND split_part(_id,':',2)=_digest)) THEN RETURN 'invalid'; END IF;
 INSERT INTO live_finance.reversal_inbox(event_type,provider_id,payload_sha256) VALUES(_event,_id,_digest) ON CONFLICT DO NOTHING;
 RETURN CASE WHEN FOUND THEN 'accepted' ELSE 'duplicate' END;
END $$;

CREATE OR REPLACE FUNCTION public.apply_live_refund_event(_id text,_lease uuid,_tx text,_amount bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r live_finance.reversal_inbox; receipt live_finance.receipts;
BEGIN
 SELECT * INTO r FROM live_finance.reversal_inbox WHERE event_type='refund.processed' AND provider_id=_id AND state='processing' AND lease_id=_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO receipt FROM live_finance.receipts WHERE transaction_id=_tx;
 IF NOT FOUND OR receipt.amount_kobo IS DISTINCT FROM _amount OR (_id LIKE 'lc_%:%' AND split_part(_id,':',1) IS DISTINCT FROM receipt.reference) THEN RETURN false;END IF;
 PERFORM public.live_record_reversal(receipt.reference,_tx,'paystack-refund:'||_id,'refund',_amount,'NGN','live');
 UPDATE live_finance.reversal_inbox SET state='processed',lease_id=NULL,lease_until=NULL,reason=NULL,next_retry_at=NULL WHERE event_type=r.event_type AND provider_id=r.provider_id;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_live_reversal_event(text,text,text),public.apply_live_refund_event(text,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_live_reversal_event(text,text,text),public.apply_live_refund_event(text,uuid,text,bigint) TO service_role;
