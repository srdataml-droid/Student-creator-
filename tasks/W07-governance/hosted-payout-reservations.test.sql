BEGIN;
DO $$ BEGIN
 IF (SELECT enabled FROM live_finance.payout_gate WHERE singleton) OR EXISTS(SELECT 1 FROM live_finance.payout_clearance) OR EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence) THEN RAISE EXCEPTION 'Unexpected payout activation'; END IF;
 IF has_table_privilege('service_role','live_finance.payout_gate','UPDATE') OR has_table_privilege('service_role','live_finance.payout_clearance','INSERT') OR has_table_privilege('authenticated','live_finance.payout_requests','INSERT') OR has_function_privilege('authenticated','public.week7_review_payout(uuid,uuid,text,text)','EXECUTE') OR has_function_privilege('anon','public.creator_payout_request(text,bigint,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe payout privilege'; END IF;
 IF has_function_privilege('authenticated','public.week7_payout_liability_report(uuid)','EXECUTE') OR has_function_privilege('anon','public.week7_payout_liability_report(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Payout liability RPC exposed'; END IF;
 IF live_finance.payout_balance('00000000-0000-4000-8000-000000000099')->>'availableKobo'<>'0' THEN RAISE EXCEPTION 'Unbacked payout balance'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.creator_payout_request('list'); RAISE EXCEPTION 'Sessionless payout access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
