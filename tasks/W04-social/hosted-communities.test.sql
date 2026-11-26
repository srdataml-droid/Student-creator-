\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES('41000000-0000-4000-8000-000000000001'),('41000000-0000-4000-8000-000000000002'),('41000000-0000-4000-8000-000000000003'),('41000000-0000-4000-8000-000000000004');
INSERT INTO public.institutions(id,slug,name) VALUES('41000000-0000-4000-8000-000000000010','community-contract-a','Campus A'),('41000000-0000-4000-8000-000000000020','community-contract-b','Campus B');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('41000000-0000-4000-8000-000000000011','41000000-0000-4000-8000-000000000010','science','Science');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('41000000-0000-4000-8000-000000000012','41000000-0000-4000-8000-000000000010','41000000-0000-4000-8000-000000000011','COM101','Community');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) VALUES
('41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000010','Member A',now()),
('41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000010','Member B',now()),
('41000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000020','Foreign member',now());
INSERT INTO public.platform_staff(user_id,role) VALUES('41000000-0000-4000-8000-000000000004','admin');
-- CI-only session fixtures inside this rollback transaction.
UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at,now()) WHERE email_confirmed_at IS NULL;
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users ON CONFLICT(id) DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true), set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-4000-8000-000000000001','role','authenticated','session_id','41000000-0000-4000-8000-000000000001')::text,true);
SELECT public.social_community_action('join','41000000-0000-4000-8000-000000000012');
SELECT public.social_community_action('post','41000000-0000-4000-8000-000000000012','{"text":"Original synthetic discussion","creationKey":"synthetic_community_001"}');
DO $$ BEGIN
 IF (SELECT count(id) FROM public.social_community_posts)<>1 OR has_table_privilege(current_user,'public.social_community_posts','INSERT') THEN RAISE EXCEPTION 'member grants incorrect'; END IF;
 IF public.social_community_action('post','41000000-0000-4000-8000-000000000012','{"text":"Original synthetic discussion","creationKey":"synthetic_community_001"}')->>'replayed'<>'true' THEN RAISE EXCEPTION 'post replay failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000002',true), set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-4000-8000-000000000002','role','authenticated','session_id','41000000-0000-4000-8000-000000000002')::text,true);
DO $$ BEGIN IF (SELECT count(id) FROM public.social_community_posts)<>0 THEN RAISE EXCEPTION 'nonmember read private post'; END IF; END $$;
SELECT public.social_community_action('join','41000000-0000-4000-8000-000000000012');
DO $$ DECLARE root uuid; BEGIN
 SELECT id INTO STRICT root FROM public.social_community_posts;
 PERFORM public.social_community_action('post','41000000-0000-4000-8000-000000000012',jsonb_build_object('text','Synthetic reply','creationKey','synthetic_community_002','replyTo',root));
 BEGIN PERFORM public.social_community_action('hide','41000000-0000-4000-8000-000000000012',jsonb_build_object('postId',root,'reason','Unauthorized hide')); RAISE EXCEPTION 'ordinary member hid post'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.social_community_action('role','41000000-0000-4000-8000-000000000012','{"userId":"41000000-0000-4000-8000-000000000002","enabled":true,"reason":"Self promote"}'); RAISE EXCEPTION 'self promotion'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM public.social_community_members)<>1 THEN RAISE EXCEPTION 'member list leak'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000003',true), set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-4000-8000-000000000003','role','authenticated','session_id','41000000-0000-4000-8000-000000000003')::text,true);
DO $$ BEGIN
 IF (SELECT count(id) FROM public.social_community_posts)<>0 THEN RAISE EXCEPTION 'foreign campus read'; END IF;
 BEGIN PERFORM public.social_community_action('join','41000000-0000-4000-8000-000000000012'); RAISE EXCEPTION 'foreign campus join'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000004',true), set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-4000-8000-000000000004','role','authenticated','session_id','41000000-0000-4000-8000-000000000004')::text,true);
SELECT public.social_community_action('role','41000000-0000-4000-8000-000000000012','{"userId":"41000000-0000-4000-8000-000000000002","enabled":true,"reason":"Authorized moderator"}');
SELECT set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000002',true), set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-4000-8000-000000000002','role','authenticated','session_id','41000000-0000-4000-8000-000000000002')::text,true);
DO $$ DECLARE root uuid; BEGIN
 SELECT id INTO STRICT root FROM public.social_community_posts WHERE parent_id IS NULL;
 PERFORM public.social_community_action('hide','41000000-0000-4000-8000-000000000012',jsonb_build_object('postId',root,'reason','Moderation reason'));
 IF (SELECT count(id) FROM public.social_community_posts)<>0 THEN RAISE EXCEPTION 'hidden parent or reply leak'; END IF;
END $$;
SELECT public.social_community_action('leave','41000000-0000-4000-8000-000000000012');
SELECT public.social_community_action('join','41000000-0000-4000-8000-000000000012');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.social_community_moderators)<>0 THEN RAISE EXCEPTION 'moderator role survived membership loss'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM public.audit_events WHERE target_kind='community_post' AND action='community.moderator.post.hidden')<>1 THEN RAISE EXCEPTION 'missing moderation audit'; END IF; END $$;
ROLLBACK;
\echo 'PASS: community membership, role isolation, campus boundaries, hidden descendants and audit';
