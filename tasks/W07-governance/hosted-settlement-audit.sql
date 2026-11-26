-- Read-only comparison of provider settlement transactions against recorded receipts.
-- No balance is released, no bank credit is certified, and no transfer is initiated.
CREATE FUNCTION public.audit_live_settlement_receipts(_items jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF _items IS NULL OR jsonb_typeof(_items)<>'array' THEN RAISE EXCEPTION 'INVALID_SETTLEMENT_BATCH' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(_items)>50 THEN RAISE EXCEPTION 'INVALID_SETTLEMENT_BATCH' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_items) x WHERE jsonb_typeof(x)<>'object' OR coalesce(x->>'transactionId','') !~ '^[1-9][0-9]{0,19}$' OR coalesce(x->>'reference','') !~ '^[A-Za-z0-9._-]{1,128}$' OR coalesce(x->>'amountKobo','') !~ '^[1-9][0-9]{0,15}$' OR coalesce(x->>'feeKobo','') !~ '^(0|[1-9][0-9]{0,15})$') THEN RAISE EXCEPTION 'INVALID_SETTLEMENT_ITEM' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_items) x WHERE (x->>'transactionId')::numeric>18446744073709551615 OR (x->>'amountKobo')::numeric>9007199254740991 OR (x->>'feeKobo')::numeric>(x->>'amountKobo')::numeric) OR (SELECT count(DISTINCT x->>'transactionId') FROM jsonb_array_elements(_items) x)<>jsonb_array_length(_items) THEN RAISE EXCEPTION 'INVALID_SETTLEMENT_ITEM' USING ERRCODE='22023'; END IF;
 WITH inputs AS (SELECT x->>'transactionId' AS tx,x->>'reference' AS ref,(x->>'amountKobo')::bigint AS amount,(x->>'feeKobo')::bigint AS fee FROM jsonb_array_elements(_items) x),
 checks AS (
 SELECT i.tx,CASE WHEN r.matches=0 THEN 'unrecorded' WHEN r.matches>1 THEN 'ambiguous' WHEN NOT r.exact THEN 'mismatch' WHEN r.reversed THEN 'reversed' WHEN r.review THEN 'review' ELSE 'matched' END AS state
 FROM inputs i CROSS JOIN LATERAL (
 SELECT count(*) AS matches,bool_and(z.reference=i.ref AND z.amount_kobo=i.amount AND z.fee_kobo=i.fee) AS exact,bool_or(z.reversed) AS reversed,bool_or(z.review) AS review
 FROM (
 SELECT x.reference,x.amount_kobo,x.fee_kobo,EXISTS(SELECT 1 FROM live_finance.reversals y WHERE y.transaction_id=x.transaction_id) AS reversed,x.duplicate AS review
 FROM live_finance.receipts x WHERE x.transaction_id=i.tx
 UNION ALL
 SELECT x.reference,x.amount_kobo,x.fee_kobo,EXISTS(SELECT 1 FROM live_finance.learning_refunds y WHERE y.transaction_id=x.transaction_id),x.duplicate OR NOT x.delivered
 FROM live_finance.learning_receipts x WHERE x.transaction_id=i.tx
 ) z
 ) r)
 SELECT jsonb_build_object('matched',count(*) FILTER(WHERE state='matched'),'unrecorded',count(*) FILTER(WHERE state='unrecorded'),'ambiguous',count(*) FILTER(WHERE state='ambiguous'),'mismatch',count(*) FILTER(WHERE state='mismatch'),'reversed',count(*) FILTER(WHERE state='reversed'),'review',count(*) FILTER(WHERE state='review'),'bankCreditVerified',false,'withdrawalEnabled',false) INTO result FROM checks;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.audit_live_settlement_receipts(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.audit_live_settlement_receipts(jsonb) TO service_role;
