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
 IF public.set_draft_price('7c000000-0000-4000-8000-000000000013',30000)->>'priceKobo'<>'30000' THEN RAISE EXCEPTION 'price did not save'; END IF;
 BEGIN PERFORM public.set_draft_price('7c000000-0000-4000-8000-000000000013',100); RAISE EXCEPTION 'under minimum accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','7c000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"7c000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.set_draft_price('7c000000-0000-4000-8000-000000000013',0); RAISE EXCEPTION 'foreign owner changed price'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT price_kobo FROM public.listings WHERE content_id='7c000000-0000-4000-8000-000000000013') IS DISTINCT FROM 30000::bigint THEN RAISE EXCEPTION 'wrong price'; END IF; END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7c000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"7c000000-0000-4000-8000-000000000001"}',true);
SELECT public.set_draft_price('7c000000-0000-4000-8000-000000000013',0);
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.listings WHERE content_id='7c000000-0000-4000-8000-000000000013') THEN RAISE EXCEPTION 'free draft retained listing'; END IF; END $$;
UPDATE public.content_items SET status='in_review' WHERE id='7c000000-0000-4000-8000-000000000013';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.set_draft_price('7c000000-0000-4000-8000-000000000013',30000); RAISE EXCEPTION 'review price changed'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
