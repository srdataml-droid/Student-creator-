-- Disposable PostgreSQL 17 creator restrictions contract; never use real student identities.
\set ON_ERROR_STOP on
\echo 'Creator restrictions: owner-private rows, verified-student view gate, and denial by default'
INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_view,deny_comment,deny_message)
VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',true,false,false);
INSERT INTO public.content_comments(id,content_id,author_id,body,creation_key,creation_hash) VALUES
('cccccccc-3333-4333-8333-cccccccccccc','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
'11111111-1111-4111-8111-111111111111','A synthetic protected content comment',
'creator_security_comment_001',repeat('c',64));

SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.creator_restrictions;
    RAISE EXCEPTION 'Anonymous user read private creator restrictions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.content_comments;
    RAISE EXCEPTION 'Anonymous user read full comment thread';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.creator_can_view_published('11111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'Anonymous caller invoked private gate';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer; allowed boolean;
BEGIN
  SELECT count(*) INTO n FROM public.creator_restrictions;
  IF n<>0 THEN RAISE EXCEPTION 'Non-owner could enumerate restrictions'; END IF;
  SELECT public.creator_can_view_published('11111111-1111-4111-8111-111111111111') INTO allowed;
  IF allowed THEN RAISE EXCEPTION 'Creator-denied verified viewer passed content gate'; END IF;
  SELECT count(*) INTO n FROM public.content_comments;
  IF n<>0 THEN RAISE EXCEPTION 'Creator-denied viewer read full comment text'; END IF;
  BEGIN
    UPDATE public.creator_restrictions SET deny_view=false;
    RAISE EXCEPTION 'Viewer changed creator restrictions directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.creator_restrictions;
  IF n<>1 THEN RAISE EXCEPTION 'Creator cannot inspect own restriction'; END IF;
  SELECT count(*) INTO n FROM public.content_comments;
  IF n<>1 THEN RAISE EXCEPTION 'Verified creator cannot read own published comments'; END IF;
  BEGIN
    DELETE FROM public.creator_restrictions;
    RAISE EXCEPTION 'Creator bypassed audited service API to remove restriction';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- After removing the view restriction in an owner-simulated backend action,
-- the verified cross-campus student may read the published comments.
UPDATE public.creator_restrictions SET deny_view=false
WHERE creator_id='11111111-1111-4111-8111-111111111111'
  AND viewer_id='22222222-2222-4222-8222-222222222222';
SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>1 THEN RAISE EXCEPTION 'Unblocked verified viewer cannot see approved comments';END IF;
END $$;
RESET ROLE;
UPDATE public.student_profiles SET suspended=true
 WHERE user_id='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>0 THEN RAISE EXCEPTION 'Suspended viewer saw published full comments';END IF;
END $$;
RESET ROLE;
UPDATE public.student_profiles SET suspended=false
 WHERE user_id='22222222-2222-4222-8222-222222222222';
DELETE FROM public.content_comments WHERE id='cccccccc-3333-4333-8333-cccccccccccc';
DELETE FROM public.creator_restrictions WHERE creator_id='11111111-1111-4111-8111-111111111111';
\echo 'PASS: creator restriction read RLS, anonymous denial, revoked and restored content viewing'
