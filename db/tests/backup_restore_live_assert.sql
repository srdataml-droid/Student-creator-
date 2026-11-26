-- Disposable production-schema restore target only.
DO $$ DECLARE q jsonb; BEGIN
 IF current_database()<>'campus_ci_live_restore' THEN RAISE EXCEPTION 'Wrong restore target'; END IF;
 IF (SELECT count(*) FROM live_finance.receipts WHERE transaction_id='9700022221')<>1 OR (SELECT count(*) FROM live_finance.journal WHERE transaction_id='9700022221')<3 THEN RAISE EXCEPTION 'Live financial history missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.orders o JOIN public.entitlements e ON e.order_id=o.id WHERE o.content_id='f3050000-0000-4000-8000-000000000001' AND o.environment='live' AND o.status='paid' AND e.state='active') THEN RAISE EXCEPTION 'Restored entitlement missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM live_finance.reversal_inbox) THEN RAISE EXCEPTION 'Durable reversal queue missing'; END IF;
 IF (SELECT allow_checkout FROM live_finance.runtime_gate WHERE singleton) OR (SELECT allow_checkout FROM live_finance.learning_gate WHERE singleton) OR (SELECT enabled FROM live_finance.payout_gate WHERE singleton) THEN RAISE EXCEPTION 'Restore enabled money movement'; END IF;
 IF has_function_privilege('authenticated','public.week7_review_payout(uuid,uuid,text,text)','EXECUTE') OR has_table_privilege('service_role','live_finance.payout_clearance','INSERT') OR has_table_privilege('anon','public.orders','TRUNCATE') THEN RAISE EXCEPTION 'Restored unsafe privileges'; END IF;
 IF to_regprocedure('public.week7_review_copyright(uuid,uuid,text,text)') IS NULL OR to_regprocedure('public.week7_resolve_paid_access(uuid,uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'Restored governance missing'; END IF;
 q:=live_finance.payout_balance('f3010000-0000-4000-8000-000000000001');
 IF q->>'availableKobo'<>'0' OR q->>'transferEnabled'<>'false' THEN RAISE EXCEPTION 'Uncleared funds restored as withdrawable'; END IF;
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f3010000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"f3010000-0000-4000-8000-000000000002","role":"authenticated","session_id":"f3060000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN IF NOT public.can_view_published_content('f3050000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Restored buyer access missing'; END IF; END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: restored production schema preserves paid entitlements, journal, queue and disabled financial gates' AS evidence;
