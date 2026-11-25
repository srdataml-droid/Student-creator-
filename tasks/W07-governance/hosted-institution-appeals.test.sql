BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('aa000000-0000-4000-8000-000000000001','appeal-student@example.invalid',now()),('aa000000-0000-4000-8000-000000000002','appeal-other@example.invalid',now()),('aa000000-0000-4000-8000-000000000003','appeal-reviewer@example.invalid',now()),('aa000000-0000-4000-8000-000000000004','appeal-finance@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE 'aa000000-%';
INSERT INTO public.student_profiles(user_id,display_name) VALUES('aa000000-0000-4000-8000-000000000001','Synthetic applicant'),('aa000000-0000-4000-8000-000000000002','Synthetic other applicant');
INSERT INTO public.platform_staff(user_id,role,active) VALUES('aa000000-0000-4000-8000-000000000003','moderator',true),('aa000000-0000-4000-8000-000000000004','admin',true);
INSERT INTO public.governance_staff_role_grants(user_id,role) VALUES('aa000000-0000-4000-8000-000000000003','verification_reviewer'),('aa000000-0000-4000-8000-000000000004','finance_reviewer');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"aa000000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.submit_institution_appeal('Synthetic request for independent identity review');
 IF r->>'status'<>'open' THEN RAISE EXCEPTION 'Appeal not opened'; END IF;
 IF public.submit_institution_appeal('Synthetic request for independent identity review')->>'replayed'<>'true' THEN RAISE EXCEPTION 'Appeal replay failed'; END IF;
 IF jsonb_array_length(public.my_institution_appeals())<>1 THEN RAISE EXCEPTION 'Own appeal missing'; END IF;
 IF has_function_privilege(current_user,'public.week7_review_institution_appeal(uuid,uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Browser can review appeal'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"aa000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN IF jsonb_array_length(public.my_institution_appeals())<>0 THEN RAISE EXCEPTION 'Foreign appeal leaked'; END IF; END $$;
RESET ROLE;
DO $$ DECLARE actor uuid:='aa000000-0000-4000-8000-000000000003'; finance uuid:='aa000000-0000-4000-8000-000000000004'; applicant uuid:='aa000000-0000-4000-8000-000000000001'; a uuid; BEGIN
 SELECT id INTO a FROM public.institution_verification_appeals WHERE user_id=applicant;
 IF jsonb_array_length(public.week7_institution_appeal_queue(actor,10)->'items')<>1 THEN RAISE EXCEPTION 'Reviewer queue failure'; END IF;
 BEGIN PERFORM public.week7_institution_appeal_queue(finance,10); RAISE EXCEPTION 'Finance accessed identity appeal'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.week7_review_institution_appeal(actor,a,'review_requested','Independent evidence review required');
 IF public.affiliation_eligible(applicant) THEN RAISE EXCEPTION 'Appeal automatically granted eligibility'; END IF;
 BEGIN PERFORM public.week7_review_institution_appeal(actor,a,'rejected','Duplicate appeal review attempted'); RAISE EXCEPTION 'Duplicate appeal review'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
ROLLBACK;
