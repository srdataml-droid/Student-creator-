BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('ac000000-0000-4000-8000-000000000001','privacy-user@example.invalid',now()),('ac000000-0000-4000-8000-000000000002','privacy-reviewer@example.invalid',now()),('ac000000-0000-4000-8000-000000000003','privacy-finance@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE 'ac000000-%';
INSERT INTO public.platform_staff(user_id,role,active) VALUES('ac000000-0000-4000-8000-000000000002','moderator',true),('ac000000-0000-4000-8000-000000000003','admin',true);
INSERT INTO public.governance_staff_role_grants(user_id,role) VALUES('ac000000-0000-4000-8000-000000000002','privacy_reviewer'),('ac000000-0000-4000-8000-000000000003','finance_reviewer');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ac000000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN
 IF public.submit_privacy_request('erasure','Synthetic request for deletion review')->>'status'<>'open' THEN RAISE EXCEPTION 'Privacy request failed'; END IF;
 IF public.submit_privacy_request('erasure','Synthetic request for deletion review')->>'replayed'<>'true' THEN RAISE EXCEPTION 'Privacy replay failed'; END IF;
 IF jsonb_array_length(public.my_privacy_requests())<>1 THEN RAISE EXCEPTION 'Own request missing'; END IF;
 IF has_table_privilege(current_user,'public.student_privacy_requests','SELECT,INSERT,UPDATE,DELETE') OR has_function_privilege(current_user,'public.week7_review_privacy_request(uuid,uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Privacy direct access'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000003',true),set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"ac000000-0000-4000-8000-000000000003"}',true);
DO $$ BEGIN IF jsonb_array_length(public.my_privacy_requests())<>0 THEN RAISE EXCEPTION 'Foreign request leaked'; END IF; END $$;
RESET ROLE;
DO $$ DECLARE u uuid:='ac000000-0000-4000-8000-000000000001'; p uuid:='ac000000-0000-4000-8000-000000000002'; f uuid:='ac000000-0000-4000-8000-000000000003'; req uuid; r jsonb;
BEGIN
 SELECT id INTO req FROM public.student_privacy_requests WHERE user_id=u;
 IF jsonb_array_length(public.week7_privacy_queue(p,10)->'items')<>1 THEN RAISE EXCEPTION 'Privacy queue failed'; END IF;
 BEGIN PERFORM public.week7_privacy_queue(f,10); RAISE EXCEPTION 'Finance read privacy requests'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.week7_review_privacy_request(p,req,'under_review','Synthetic independent review');
 r:=public.week7_review_privacy_request(p,req,'approved_for_manual_fulfilment','Synthetic decision not execution');
 IF r->>'dataDeleted'<>'false' OR r->>'fulfilled'<>'false' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u) THEN RAISE EXCEPTION 'Destructive privacy action'; END IF;
 BEGIN PERFORM public.week7_review_privacy_request(p,req,'declined','Attempt to overwrite decision'); RAISE EXCEPTION 'Decision overwritten'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
ROLLBACK;
