-- Read-only creator liability reconciliation. No bank proof, clearance or transfers.
CREATE FUNCTION public.week7_payout_liability_report(_actor uuid) RETURNS jsonb
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
 amounts AS (SELECT net,(b->>'clearedKobo')::numeric AS cleared,(b->>'reservedKobo')::numeric AS reserved,(b->>'availableKobo')::numeric AS available FROM balances)
 SELECT jsonb_build_object('currency','NGN','creatorCount',count(*),
 'journalNetKobo',coalesce(sum(net),0)::text,'clearedKobo',coalesce(sum(cleared),0)::text,
 'unclearedNetKobo',coalesce(sum(net-cleared),0)::text,'reservedKobo',coalesce(sum(reserved),0)::text,
 'availableKobo',coalesce(sum(available),0)::text,
 'reservationShortfallKobo',coalesce(sum(greatest(reserved-greatest(cleared,0),0)),0)::text,
 'creatorsWithReservationShortfall',count(*) FILTER(WHERE reserved>greatest(cleared,0)),
 'negativeClearedKobo',coalesce(sum(greatest(-cleared,0)),0)::text,
 'bankCreditVerified',false,'transferEnabled',false,'asOf',statement_timestamp()) INTO result FROM amounts;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.week7_payout_liability_report(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.week7_payout_liability_report(uuid) TO service_role;
