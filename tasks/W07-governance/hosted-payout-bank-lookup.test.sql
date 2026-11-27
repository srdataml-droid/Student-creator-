BEGIN;
DO $$ BEGIN
 IF has_schema_privilege('authenticated','student_payout_private','USAGE')
 OR has_table_privilege('anon','student_payout_private.bank_lookup_attempts','SELECT')
 OR has_table_privilege('authenticated','student_payout_private.bank_lookup_attempts','INSERT')
 OR has_function_privilege('anon','public.admit_creator_bank_lookup(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.admit_creator_bank_lookup(uuid,uuid,text)','EXECUTE')
 OR has_table_privilege('service_role','student_payout_private.bank_lookup_attempts','TRUNCATE')
 THEN RAISE EXCEPTION 'Bank lookup privilege boundary failed'; END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('da110000-0000-4000-8000-000000000001','bank-fixture-a@example.invalid',now()),
 ('da110000-0000-4000-8000-000000000002','bank-fixture-b@example.invalid',now());
INSERT INTO public.institutions(id,slug,name) VALUES('da120000-0000-4000-8000-000000000001','fixture-bank-lookup','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at)
 SELECT id,'da120000-0000-4000-8000-000000000001','Synthetic',now() FROM auth.users
 WHERE id IN ('da110000-0000-4000-8000-000000000001','da110000-0000-4000-8000-000000000002');
INSERT INTO auth.sessions(id,user_id) VALUES
 ('da130000-0000-4000-8000-000000000001','da110000-0000-4000-8000-000000000001'),
 ('da130000-0000-4000-8000-000000000002','da110000-0000-4000-8000-000000000002');
SET LOCAL ROLE service_role;
DO $$ DECLARE actor uuid:='da110000-0000-4000-8000-000000000001'; session_id uuid:='da130000-0000-4000-8000-000000000001'; other_actor uuid:='da110000-0000-4000-8000-000000000002'; other_session uuid:='da130000-0000-4000-8000-000000000002'; i integer;
BEGIN
 IF public.admit_creator_bank_lookup(actor,other_session,'resolve')
 OR public.admit_creator_bank_lookup(actor,session_id,'transfer')
 OR public.admit_creator_bank_lookup(actor,NULL,'resolve') THEN RAISE EXCEPTION 'Invalid lookup admitted'; END IF;
 FOR i IN 1..5 LOOP
 IF NOT public.admit_creator_bank_lookup(actor,session_id,'resolve') THEN RAISE EXCEPTION 'Lookup denied too early'; END IF;
 END LOOP;
 IF public.admit_creator_bank_lookup(actor,session_id,'resolve') THEN RAISE EXCEPTION 'Lookup cap bypassed'; END IF;
 IF NOT public.admit_creator_bank_lookup(other_actor,other_session,'resolve') OR NOT public.admit_creator_bank_lookup(actor,session_id,'banks') THEN RAISE EXCEPTION 'Independent limit broken'; END IF;
END $$;
RESET ROLE;
UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id='da130000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.admit_creator_bank_lookup('da110000-0000-4000-8000-000000000002','da130000-0000-4000-8000-000000000002','banks') THEN RAISE EXCEPTION 'Expired session admitted'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM student_payout_private.bank_lookup_attempts)<>7 THEN RAISE EXCEPTION 'Invalid attempt persisted'; END IF;
END $$;
ROLLBACK;
