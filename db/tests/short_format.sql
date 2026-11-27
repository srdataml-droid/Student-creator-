BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('7d000000-0000-4000-8000-000000000001','short-owner@example.invalid',now()),('7d000000-0000-4000-8000-000000000002','short-other@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE '7d000000-%';
INSERT INTO public.institutions(id,slug,name) VALUES('7d000000-0000-4000-8000-000000000010','fixture-short','Synthetic campus');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('7d000000-0000-4000-8000-000000000011','7d000000-0000-4000-8000-000000000010','science','Synthetic science');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('7d000000-0000-4000-8000-000000000012','7d000000-0000-4000-8000-000000000010','7d000000-0000-4000-8000-000000000011','PRICE1','Synthetic price');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'7d000000-0000-4000-8000-000000000010','Synthetic student',now() FROM auth.users WHERE id::text LIKE '7d000000-%';
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status) VALUES('7d000000-0000-4000-8000-000000000013','7d000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-000000000010','7d000000-0000-4000-8000-000000000012','Synthetic draft',now(),'price-fixture-00001',repeat('a',64),'draft');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"7d000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"7d000000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN
 IF public.creator_draft_format('7d000000-0000-4000-8000-000000000013')->>'format'<>'video' THEN RAISE EXCEPTION 'existing videos must remain videos'; END IF;
 IF public.creator_draft_format('7d000000-0000-4000-8000-000000000013','short')->>'format'<>'short' THEN RAISE EXCEPTION 'short format not saved'; END IF;
 BEGIN PERFORM public.creator_draft_format('7d000000-0000-4000-8000-000000000013','invalid');RAISE EXCEPTION 'invalid accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"7d000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"7d000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.creator_draft_format('7d000000-0000-4000-8000-000000000013','video'); RAISE EXCEPTION 'cross-account update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.content_items SET status='in_review' WHERE id='7d000000-0000-4000-8000-000000000013';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"7d000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"7d000000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.creator_draft_format('7d000000-0000-4000-8000-000000000013','video'); RAISE EXCEPTION 'review format changed'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
