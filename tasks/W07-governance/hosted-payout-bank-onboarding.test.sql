BEGIN;
DO $$ BEGIN
 IF has_table_privilege('service_role','student_payout_private.bank_requests','SELECT')
 OR has_table_privilege('authenticated','student_payout_private.bank_requests','SELECT')
 OR has_function_privilege('authenticated','public.creator_bank_submission(uuid,uuid,uuid,text,text,text)','EXECUTE')
 OR has_function_privilege('anon','public.staff_bank_claim(uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.staff_bank_finish(uuid,uuid,uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Bank request privilege leak';END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('db110000-0000-4000-8000-000000000001','bank-owner@example.invalid',now()),
 ('db110000-0000-4000-8000-000000000002','bank-reviewer@example.invalid',now()),
 ('db110000-0000-4000-8000-000000000003','bank-registrar@example.invalid',now());
INSERT INTO public.institutions(id,slug,name) VALUES('db120000-0000-4000-8000-000000000001','fixture-bank-onboarding','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) VALUES('db110000-0000-4000-8000-000000000001','db120000-0000-4000-8000-000000000001','Synthetic',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id IN ('db110000-0000-4000-8000-000000000001','db110000-0000-4000-8000-000000000002','db110000-0000-4000-8000-000000000003');
INSERT INTO public.platform_staff(user_id,role,active) VALUES('db110000-0000-4000-8000-000000000002','admin',true),('db110000-0000-4000-8000-000000000003','moderator',true);
INSERT INTO public.governance_staff_role_grants(user_id,role,granted_by) VALUES('db110000-0000-4000-8000-000000000002','governance_owner','db110000-0000-4000-8000-000000000002'),('db110000-0000-4000-8000-000000000003','finance_reviewer','db110000-0000-4000-8000-000000000002');
SET LOCAL ROLE service_role;
DO $$ DECLARE a uuid:='db110000-0000-4000-8000-000000000001'; b uuid:='db110000-0000-4000-8000-000000000002'; c uuid:='db110000-0000-4000-8000-000000000003'; rid uuid:='db130000-0000-4000-8000-000000000001'; j jsonb; env text:='v1.'||repeat('a',24)||'.'||repeat('b',32)||'.cc'; BEGIN
 j:=public.creator_bank_submission(a,a,rid,'058','6789',env);
 IF j->>'state'<>'pending' OR public.creator_bank_status(a,a)::text LIKE '%v1.%' THEN RAISE EXCEPTION 'Submission/status failed'; END IF;
 IF public.staff_bank_claim(c,c,rid) IS NOT NULL THEN RAISE EXCEPTION 'Unreviewed bank claimed'; END IF;
 BEGIN PERFORM public.staff_bank_review(a,a,rid,'approve','fixture-evidence');RAISE EXCEPTION 'Student self-approved';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF public.staff_bank_details(b,b,rid)->>'envelope'<>env OR NOT public.staff_bank_review(b,b,rid,'approve','fixture-evidence') THEN RAISE EXCEPTION 'Review failed'; END IF;
 IF public.staff_bank_claim(b,b,rid) IS NOT NULL THEN RAISE EXCEPTION 'Same reviewer claimed registration'; END IF;
 j:=public.staff_bank_claim(c,c,rid);
 IF j IS NULL OR public.staff_bank_claim(c,c,rid) IS NOT NULL OR public.creator_bank_cancel(a,a,rid) THEN RAISE EXCEPTION 'Duplicate claim or cancellation'; END IF;
 IF public.staff_bank_finish(c,c,rid,gen_random_uuid(),'RCP_fixture12345') THEN RAISE EXCEPTION 'Wrong lease accepted'; END IF;
 IF NOT public.staff_bank_finish(c,c,rid,(j->>'lease')::uuid,'RCP_fixture12345') THEN RAISE EXCEPTION 'Fixture registration failed'; END IF;
 IF public.creator_bank_status(a,a)->>'recipientVerified'<>'true' THEN RAISE EXCEPTION 'Recipient status missing'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM student_payout_private.bank_requests WHERE state='active' AND envelope IS NOT NULL)
 OR (SELECT enabled FROM live_finance.payout_gate WHERE singleton) THEN RAISE EXCEPTION 'Unsafe activation or retained encrypted bank data'; END IF;
END $$;
ROLLBACK;
