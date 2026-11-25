BEGIN;
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.auth_email_deliveries','SELECT')
 OR has_function_privilege('anon','public.claim_auth_email_delivery(text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.finish_auth_email_delivery(text,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Auth email ledger exposed'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE k text:=repeat('a',64); d text:=repeat('b',64); r jsonb; lease uuid;
BEGIN
 r:=public.claim_auth_email_delivery(k,d);lease:=(r->>'leaseId')::uuid;
 IF r->>'status'<>'claimed' OR lease IS NULL THEN RAISE EXCEPTION 'Claim failed'; END IF;
 IF public.claim_auth_email_delivery(k,d)->>'status'<>'busy' THEN RAISE EXCEPTION 'Concurrent send allowed'; END IF;
 IF public.claim_auth_email_delivery(k,repeat('c',64))->>'status'<>'collision' THEN RAISE EXCEPTION 'Collision not rejected'; END IF;
 IF public.finish_auth_email_delivery(k,gen_random_uuid(),'provider_fixture') THEN RAISE EXCEPTION 'Wrong lease accepted'; END IF;
 IF NOT public.finish_auth_email_delivery(k,lease,'provider_fixture') THEN RAISE EXCEPTION 'Send finalization failed'; END IF;
 IF public.claim_auth_email_delivery(k,d)->>'status'<>'duplicate' THEN RAISE EXCEPTION 'Duplicate send not denied'; END IF;
 r:=public.claim_auth_email_delivery(repeat('d',64),d);lease:=(r->>'leaseId')::uuid;
 IF NOT public.finish_auth_email_delivery(repeat('d',64),lease,NULL) THEN RAISE EXCEPTION 'Failure state not recorded'; END IF;
 IF public.claim_auth_email_delivery(repeat('d',64),d)->>'status'<>'busy' THEN RAISE EXCEPTION 'Backoff bypassed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.auth_email_deliveries WHERE state='sent' AND provider_id='provider_fixture')<>1
 THEN RAISE EXCEPTION 'Durable provider receipt missing'; END IF;
END $$;
ROLLBACK;
