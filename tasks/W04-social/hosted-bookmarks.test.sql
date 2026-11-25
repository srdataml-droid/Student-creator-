BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('7b000000-0000-4000-8000-000000000001','bookmark-creator@example.invalid',now()),('7b000000-0000-4000-8000-000000000002','bookmark-reader@example.invalid',now()),('7b000000-0000-4000-8000-000000000003','bookmark-other@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE '7b000000-%';
INSERT INTO public.institutions(id,slug,name) VALUES('7b000000-0000-4000-8000-000000000010','fixture-bookmark-1','Synthetic campus');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('7b000000-0000-4000-8000-000000000011','7b000000-0000-4000-8000-000000000010','science','Synthetic science');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('7b000000-0000-4000-8000-000000000012','7b000000-0000-4000-8000-000000000010','7b000000-0000-4000-8000-000000000011','BOOK1','Synthetic book');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'7b000000-0000-4000-8000-000000000010','Synthetic student',now() FROM auth.users WHERE id::text LIKE '7b000000-%';
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status,reviewer_id,review_reason,reviewed_at,published_at) VALUES('7b000000-0000-4000-8000-000000000013','7b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000010','7b000000-0000-4000-8000-000000000012','Synthetic bookmark lesson',now(),'bookmark-fixture-001',repeat('a',64),'published','7b000000-0000-4000-8000-000000000003','Synthetic approval',now(),now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7b000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"7b000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"7b000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
 IF public.social_bookmark_action('7b000000-0000-4000-8000-000000000013',true)->>'bookmarked'<>'true' OR public.social_bookmark_action('7b000000-0000-4000-8000-000000000013',true)->>'replayed'<>'true' THEN RAISE EXCEPTION 'bookmark replay failed'; END IF;
 IF (SELECT count(content_id) FROM public.content_bookmarks)<>1 OR has_table_privilege(current_user,'public.content_bookmarks','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'bookmark grant failure'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','7b000000-0000-4000-8000-000000000003',true),set_config('request.jwt.claims','{"sub":"7b000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"7b000000-0000-4000-8000-000000000003"}',true);
DO $$ BEGIN IF (SELECT count(content_id) FROM public.content_bookmarks)<>0 THEN RAISE EXCEPTION 'foreign bookmark leak'; END IF; END $$;
RESET ROLE;
INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_view) VALUES('7b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7b000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"7b000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"7b000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
 IF (SELECT count(content_id) FROM public.content_bookmarks)<>0 THEN RAISE EXCEPTION 'blocked bookmark visible'; END IF;
 BEGIN PERFORM public.social_bookmark_action('7b000000-0000-4000-8000-000000000013',true); RAISE EXCEPTION 'blocked bookmark accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.social_bookmark_action('7b000000-0000-4000-8000-000000000013',false);
END $$;
RESET ROLE;
ROLLBACK;
