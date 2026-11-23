-- Disposable PostgreSQL 17 test only; after 0001 + 0002 and db/tests/smoke.sql.
\set ON_ERROR_STOP on
\echo 'Seed approved and draft comments under synthetic creator identities'
INSERT INTO public.content_comments(id,content_id,author_id,body,creation_key,creation_hash) VALUES
 ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 'Approved study feedback','alice_comment_key_0001',repeat('a',64)),
 ('bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb','bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',
 'This draft should stay private','bob_comment_key_00001',repeat('b',64));
INSERT INTO public.content_comment_reports(comment_id,reporter_id,reason)
 VALUES('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','Review a potentially misleading comment');

\echo 'Anonymous visitors cannot read full comment threads or private reports'
SET ROLE anon;
DO $creatorPolicyCheck$ DECLARE n integer;
BEGIN
 BEGIN
  SELECT count(*) INTO n FROM public.content_comments;
  RAISE EXCEPTION 'Anonymous visitor read protected comments';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM 1 FROM public.content_comment_reports;
  RAISE EXCEPTION 'Anonymous read private reports';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.content_comments(content_id,author_id,body,creation_key,creation_hash)
  VALUES('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
  'Should not be possible','anon_insert_comment_001',repeat('c',64));
  RAISE EXCEPTION 'Anonymous inserted comment';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $creatorPolicyCheck$;
RESET ROLE;

\echo 'Authenticated cannot bypass independent admin moderation'
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>1 THEN RAISE EXCEPTION 'Authenticated public comment visibility failed: %',n; END IF;
 BEGIN
  INSERT INTO public.content_comments(content_id,author_id,body,creation_key,creation_hash)
  VALUES('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
  'Direct write is forbidden','client_insert_comment_001',repeat('c',64));
  RAISE EXCEPTION 'Unverified service bypass: browser inserted comment';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.content_comments SET hidden_at=now()
   WHERE id='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
  RAISE EXCEPTION 'Browser moderated comment';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  SELECT count(*) INTO n FROM public.content_comment_reports;
  RAISE EXCEPTION 'Browser read moderation reports';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

\echo 'Hiding and deactivating published course revokes visibility'
UPDATE public.content_comments SET hidden_at=now() WHERE id='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>0 THEN RAISE EXCEPTION 'Hidden comment exposed: %',n;END IF;
END $$;
RESET ROLE;
UPDATE public.content_comments SET hidden_at=NULL WHERE id='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
UPDATE public.courses SET active=false WHERE id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>0 THEN RAISE EXCEPTION 'Inactive course exposed comment: %',n;END IF;
END $$;
RESET ROLE;
\echo 'PASS: PostgreSQL comment visibility, denied writes, private reports and inactive course'
