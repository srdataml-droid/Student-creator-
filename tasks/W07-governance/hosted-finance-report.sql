-- Reporting is journal-derived, in integer kobo (decimal strings for exact JSON).
-- Pending balances are not settled funds or withdrawable creator earnings.
CREATE FUNCTION live_finance.report_journal(_creator uuid,_from timestamptz,_to timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF _from IS NULL OR _to IS NULL OR NOT isfinite(_from) OR NOT isfinite(_to) OR _to<=_from OR _to>now()+interval '1 day' OR _to-_from>interval '366 days' THEN RAISE EXCEPTION 'INVALID_REPORT_WINDOW' USING ERRCODE='22023'; END IF;
 WITH entries AS (
  SELECT 'lesson'::text AS kind,j.transaction_id,j.kind AS entry,j.debit_account,j.credit_account,j.amount_kobo FROM live_finance.journal j JOIN public.orders o ON o.id=j.order_id AND o.environment='live' WHERE (_creator IS NULL OR o.creator_id=_creator) AND j.created_at>=_from AND j.created_at<_to
  UNION ALL
  SELECT o.kind,j.transaction_id,j.kind,j.debit_account,j.credit_account,j.amount_kobo FROM live_finance.learning_journal j JOIN live_finance.learning_orders o ON o.id=j.order_id WHERE (_creator IS NULL OR o.creator_id=_creator) AND j.created_at>=_from AND j.created_at<_to
 ), kinds AS (SELECT unnest(ARRAY['lesson','class','service']) AS kind), totals AS (
  SELECT kind,count(*) AS entries,
   sum(amount_kobo) FILTER(WHERE entry IN ('charge','duplicate_charge')) AS charges,
   sum(amount_kobo) FILTER(WHERE entry IN ('reversal','duplicate_reversal','refund')) AS reversals,
   sum(amount_kobo) FILTER(WHERE entry IN ('provider_fee','fee')) AS fees,
   sum(CASE WHEN credit_account='creator_pending' THEN amount_kobo WHEN debit_account='creator_pending' THEN -amount_kobo ELSE 0 END) AS creator_net,
   sum(CASE WHEN credit_account='platform_pending' THEN amount_kobo WHEN debit_account='platform_pending' THEN -amount_kobo ELSE 0 END) AS platform_net,
   sum(CASE WHEN credit_account='duplicate_liability' THEN amount_kobo WHEN debit_account='duplicate_liability' THEN -amount_kobo ELSE 0 END) AS duplicate_net,
   sum(CASE WHEN credit_account='review_liability' THEN amount_kobo WHEN debit_account='review_liability' THEN -amount_kobo ELSE 0 END) AS review_net
  FROM entries GROUP BY kind
 )
 SELECT jsonb_agg(jsonb_build_object('kind',k.kind,'journalEntries',coalesce(t.entries,0),'verifiedChargesKobo',coalesce(t.charges,0)::text,'reversalsKobo',coalesce(t.reversals,0)::text,'processorFeesKobo',coalesce(t.fees,0)::text,'creatorPendingMovementKobo',coalesce(t.creator_net,0)::text)
 || CASE WHEN _creator IS NULL THEN jsonb_build_object('platformPendingMovementKobo',coalesce(t.platform_net,0)::text,'duplicateLiabilityMovementKobo',coalesce(t.duplicate_net,0)::text,'reviewLiabilityMovementKobo',coalesce(t.review_net,0)::text) ELSE '{}'::jsonb END ORDER BY k.kind) INTO result FROM kinds k LEFT JOIN totals t USING(kind);
 RETURN jsonb_build_object('currency','NGN','from',_from,'to',_to,'items',result,'withdrawalAvailable',false,'providerSettlementVerified',false);
END $$;
REVOKE ALL ON FUNCTION live_finance.report_journal(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION student_social_private.my_creator_finance_report(_from timestamptz,_to timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN live_finance.report_journal(auth.uid(),_from,_to);
END $$;
REVOKE ALL ON FUNCTION student_social_private.my_creator_finance_report(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.my_creator_finance_report(timestamptz,timestamptz) TO authenticated;
CREATE FUNCTION public.my_creator_finance_report(_from timestamptz,_to timestamptz) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.my_creator_finance_report(_from,_to) $$;
REVOKE ALL ON FUNCTION public.my_creator_finance_report(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.my_creator_finance_report(timestamptz,timestamptz) TO authenticated;
CREATE FUNCTION public.week7_finance_report(_actor uuid,_from timestamptz,_to timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN live_finance.report_journal(NULL,_from,_to);
END $$;
REVOKE ALL ON FUNCTION public.week7_finance_report(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_finance_report(uuid,timestamptz,timestamptz) TO service_role;
