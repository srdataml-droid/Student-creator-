-- Disposable PostgreSQL 17 engagement RLS tests; run only after smoke.sql.
\set ON_ERROR_STOP on
\echo 'Seed synthetic published and draft engagement using trusted database owner'
INSERT INTO auth.users(id) VALUES ('33333333-3333-4333-8333-333333333333');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at)
 VALUES('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carol',now());
INSERT INTO public.content_comments(id,content_id,author_id,body,creation_key,creation_hash) VALUES
 ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 'An original public study comment','alice_comment_key_0001',repeat('a',64)),
 ('bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb','bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',
 'Private draft should stay hidden','bob_comment_key_00001',repeat('b',64));
INSERT INTO public.content_likes(user_id,content_id) VALUES
 ('22222222-2222-4222-8222-222222222222','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');
INSERT INTO public.content_comment_reports(comment_id,reporter_id,reason)
 VALUES('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','Please review this educational comment');
\echo 'Anonymous can see published comments but cannot read private likes or reports'
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>1 THEN RAISE EXCEPTION 'Public draft comment leak or missing published comment: %',n; END IF;
 BEGIN
  PERFORM 1 FROM public.content_likes;
  RAISE EXCEPTION 'Anonymous role read private like identities';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM 1 FROM public.content_comment_reports;
  RAISE EXCEPTION 'Anonymous role read private moderation reports';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.content_comments(content_id,author_id,body,creation_key,creation_hash)
   VALUES('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
     'Should never be inserted','forbidden_comment_0001',repeat('c',64));
  RAISE EXCEPTION 'Anonymous role inserted a comment';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

\echo 'Verified authenticated students can like only as themselves and only published content'
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_likes;
 IF n<>0 THEN RAISE EXCEPTION 'Student could see another student likes'; END IF;
 INSERT INTO public.content_likes(user_id,content_id) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');
 SELECT count(*) INTO n FROM public.content_likes;
 IF n<>1 THEN RAISE EXCEPTION 'Student could not view their own like'; END IF;
 BEGIN
  INSERT INTO public.content_likes(user_id,content_id) VALUES
   ('33333333-3333-4333-8333-333333333333','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');
  RAISE EXCEPTION 'Student impersonated another liker';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.content_comments SET body='Changed content' WHERE id='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
  RAISE EXCEPTION 'Browser edited published comment';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 DELETE FROM public.content_likes WHERE user_id='11111111-1111-4111-8111-111111111111';
 SELECT count(*) INTO n FROM public.content_likes;
 IF n<>0 THEN RAISE EXCEPTION 'Own like removal failed'; END IF;
END $$;
RESET ROLE;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.content_likes(user_id,content_id) VALUES
   ('22222222-2222-4222-8222-222222222222','bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');
  RAISE EXCEPTION 'Student liked an unpublished draft';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

\echo 'Hiding comments and deactivating a course revokes public comment visibility'
UPDATE public.content_comments SET hidden_at=now() WHERE id='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>0 THEN RAISE EXCEPTION 'Hidden or draft comments leaked: %',n;END IF;
END $$;
RESET ROLE;
UPDATE public.content_comments SET hidden_at=NULL WHERE id='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
UPDATE public.courses SET active=false WHERE id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>0 THEN RAISE EXCEPTION 'Inactive-course comments leaked: %',n;END IF;
END $$;
RESET ROLE;
\echo 'PASS: PostgreSQL engagement RLS, visibility, write guards and reactions'
