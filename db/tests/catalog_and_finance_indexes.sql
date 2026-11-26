BEGIN;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='creator_public_profiles' AND permissive='PERMISSIVE' AND cmd='SELECT' AND 'authenticated'=ANY(roles))<>1 THEN RAISE EXCEPTION 'Redundant creator read policies'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_public_profiles' AND policyname='read_approved_creator_public_profile' AND 'anon'=ANY(roles) AND NOT 'authenticated'=ANY(roles)) THEN RAISE EXCEPTION 'Anonymous catalog rule missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_public_profiles' AND permissive='RESTRICTIVE' AND 'authenticated'=ANY(roles)) THEN RAISE EXCEPTION 'Session restriction lost'; END IF;
 IF to_regclass('live_finance.wk_live_journal_tx_order_idx') IS NULL OR to_regclass('public.wk_content_creator_institution_idx') IS NULL THEN RAISE EXCEPTION 'Critical indexes missing'; END IF;
END $$;
ROLLBACK;
