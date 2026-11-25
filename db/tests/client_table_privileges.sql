BEGIN;
DO $$
DECLARE t text; r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH t IN ARRAY ARRAY['public.audit_events','public.content_assets','public.content_items','public.content_likes','public.course_topics','public.courses','public.departments','public.entitlements','public.institutions','public.ledger_entries','public.listings','public.orders','public.payment_attempts','public.platform_staff','public.student_profiles','public.verification_requests','public.webhook_events'] LOOP
   IF has_table_privilege(r,t,'TRUNCATE,TRIGGER,REFERENCES') THEN RAISE EXCEPTION 'Unsafe non-row client privilege: % %',r,t; END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['public.audit_events','public.content_assets','public.ledger_entries','public.payment_attempts','public.platform_staff','public.webhook_events'] LOOP
   IF has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected direct private table privilege: % %',r,t; END IF;
  END LOOP;
 END LOOP;
END $$;
ROLLBACK;
SELECT 'PASS: private table and non-row client privilege boundaries' AS result;
