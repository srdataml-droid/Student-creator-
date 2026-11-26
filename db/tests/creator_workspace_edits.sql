BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('7c000000-0000-4000-8000-000000000001','price-owner@example.invalid',now()),('7c000000-0000-4000-8000-000000000002','price-other@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE '7c000000-%';
INSERT INTO public.institutions(id,slug,name) VALUES('7c000000-0000-4000-8000-000000000010','fixture-price','Synthetic campus');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('7c000000-0000-4000-8000-000000000011','7c000000-0000-4000-8000-000000000010','science','Synthetic science');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('7c000000-0000-4000-8000-000000000012','7c000000-0000-4000-8000-000000000010','7c000000-0000-4000-8000-000000000011','PRICE1','Synthetic price');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'7c000000-0000-4000-8000-000000000010','Synthetic student',now() FROM auth.users WHERE id::text LIKE '7c000000-%';
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status) VALUES('7c000000-0000-4000-8000-000000000013','7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000010','7c000000-0000-4000-8000-000000000012','Synthetic draft',now(),'price-fixture-00001',repeat('a',64),'draft');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7c000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"7c000000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN
 IF public.save_creator_profile('original_creator','Original creator','Private fixture')->>'handle'<>'original_creator' THEN RAISE EXCEPTION 'profile missing'; END IF;
 IF public.edit_creator_draft('7c000000-0000-4000-8000-000000000013','Edited original','Description','Preview',true)->>'title'<>'Edited original' THEN RAISE EXCEPTION 'draft not edited'; END IF;
 BEGIN PERFORM public.save_creator_profile('admin','Invalid alias',''); RAISE EXCEPTION 'reserved name accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','7c000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"7c000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.edit_creator_draft('7c000000-0000-4000-8000-000000000013','Foreign change','','',true); RAISE EXCEPTION 'foreign edit accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.save_creator_profile('original_creator','Duplicate alias',''); RAISE EXCEPTION 'duplicate alias accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.content_items SET status='in_review' WHERE id='7c000000-0000-4000-8000-000000000013';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7c000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"7c000000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.edit_creator_draft('7c000000-0000-4000-8000-000000000013','Review change','','',true); RAISE EXCEPTION 'review draft changed'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
