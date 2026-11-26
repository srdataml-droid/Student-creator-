BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('ab000000-0000-4000-8000-000000000001','scope-applicant@example.invalid',now()),('ab000000-0000-4000-8000-000000000002','scope-reviewer@example.invalid',now()),('ab000000-0000-4000-8000-000000000003','scope-legacy-admin@example.invalid',now()),('ab000000-0000-4000-8000-000000000004','scope-finance@example.invalid',now());
INSERT INTO public.institutions(id,slug,name) VALUES('ab000000-0000-4000-8000-000000000010','fixture-scope-identity','Synthetic institution');
INSERT INTO public.student_profiles(user_id,institution_id,display_name) VALUES('ab000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000010','Synthetic applicant');
INSERT INTO public.platform_staff(user_id,role,active) VALUES('ab000000-0000-4000-8000-000000000002','moderator',true),('ab000000-0000-4000-8000-000000000003','admin',true),('ab000000-0000-4000-8000-000000000004','admin',true);
INSERT INTO public.governance_staff_role_grants(user_id,role) VALUES('ab000000-0000-4000-8000-000000000002','verification_reviewer'),('ab000000-0000-4000-8000-000000000004','finance_reviewer');
INSERT INTO public.verification_requests(id,user_id,institution_id,method,status,expires_at) VALUES('ab000000-0000-4000-8000-000000000011','ab000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000010','manual_id','pending',now()+interval '1 day');
INSERT INTO public.private_identity_uploads(id,request_id,owner_id,object_key,mime_type,bytes,digest,state) VALUES('ab000000-0000-4000-8000-000000000012','ab000000-0000-4000-8000-000000000011','ab000000-0000-4000-8000-000000000001','private/ab000000-0000-4000-8000-000000000001/ab000000-0000-4000-8000-000000000011/ab000000-0000-4000-8000-000000000012.pdf','application/pdf',20,repeat('a',64),'clean');
UPDATE public.verification_requests SET private_evidence_path='private/ab000000-0000-4000-8000-000000000001/ab000000-0000-4000-8000-000000000011/ab000000-0000-4000-8000-000000000012.pdf' WHERE id='ab000000-0000-4000-8000-000000000011';

DO $$ DECLARE r uuid:='ab000000-0000-4000-8000-000000000002'; f uuid:='ab000000-0000-4000-8000-000000000004'; u uuid:='ab000000-0000-4000-8000-000000000001'; v uuid:='ab000000-0000-4000-8000-000000000011';
BEGIN
 IF public.affiliation_eligible(u) THEN RAISE EXCEPTION 'Unreviewed student eligible'; END IF;
 BEGIN PERFORM public.week7_review_manual_identity(r,v,'approve','Synthetic policy not yet approved',30); RAISE EXCEPTION 'Policy bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.week7_review_manual_identity(f,v,'approve','Wrong role must not approve',30); RAISE EXCEPTION 'Finance approval bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Disposable transaction only, not a founder policy decision.
UPDATE public.manual_verification_policy SET enabled=true,policy_version='fixture-v1',max_valid_days=30,approved_at=now() WHERE singleton;
DO $$ DECLARE r uuid:='ab000000-0000-4000-8000-000000000002'; u uuid:='ab000000-0000-4000-8000-000000000001'; v uuid:='ab000000-0000-4000-8000-000000000011';
BEGIN
 BEGIN PERFORM public.week7_review_manual_identity(r,v,'approve','Exceeds approved test duration',31); RAISE EXCEPTION 'Duration bypass'; EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM public.week7_review_manual_identity(r,v,'approve','Synthetic independent manual review',30);
 IF NOT public.affiliation_eligible(u) THEN RAISE EXCEPTION 'Verified grant failed'; END IF;
 IF jsonb_array_length(public.week7_manual_revalidation_queue(r,10)->'items')<>1 THEN RAISE EXCEPTION 'Revalidation queue failed'; END IF;
 UPDATE public.manual_verification_grants SET approved_at=now()-interval '31 days',valid_until=now()-interval '1 day' WHERE request_id=v;
 IF public.affiliation_eligible(u) THEN RAISE EXCEPTION 'Expired grant retained access'; END IF;
 PERFORM public.week7_review_manual_identity(r,v,'revoke','Synthetic documented enrollment revocation',NULL);
 IF public.affiliation_eligible(u) OR (SELECT status FROM public.verification_requests WHERE id=v)<>'revoked' THEN RAISE EXCEPTION 'Revocation failed'; END IF;
 IF has_function_privilege('authenticated','public.week7_review_manual_identity(uuid,uuid,text,text,integer)','EXECUTE') OR has_table_privilege('service_role','public.manual_verification_policy','UPDATE') THEN RAISE EXCEPTION 'Unsafe verification privilege'; END IF;
END $$;
ROLLBACK;
