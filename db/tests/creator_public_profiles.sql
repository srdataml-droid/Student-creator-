-- Run in disposable PostgreSQL 17 AFTER db/tests/smoke.sql and BEFORE comments.sql.
\set ON_ERROR_STOP on
\echo 'Create strictly public aliases; never store an email or private campus ID here'
INSERT INTO public.creator_public_profiles(user_id,handle,display_name,bio) VALUES
 ('11111111-1111-4111-8111-111111111111','alice_teaches','Alice Teaches','Original lessons and study examples'),
 ('22222222-2222-4222-8222-222222222222','bob_math','Bob Math','Personal tutoring interests');
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='creator_public_profiles'
             AND column_name IN ('email','password','private_evidence_path','student_card'))
 THEN RAISE EXCEPTION 'Public profile contains a private identity field'; END IF;
 BEGIN
  UPDATE public.creator_public_profiles SET handle='alice_teaches'
   WHERE user_id='22222222-2222-4222-8222-222222222222';
  RAISE EXCEPTION 'Duplicate creator handle accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  UPDATE public.creator_public_profiles SET handle='admin'
   WHERE user_id='22222222-2222-4222-8222-222222222222';
  RAISE EXCEPTION 'Reserved platform role accepted as public handle';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

\echo 'Anonymous can see only approved public creator, not unapproved draft alias'
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.creator_public_profiles;
 IF n<>1 THEN RAISE EXCEPTION 'Anonymous exposed unapproved creator identity or hid approved: %',n;END IF;
 SELECT count(*) INTO n FROM public.creator_public_profiles WHERE handle='alice_teaches';
 IF n<>1 THEN RAISE EXCEPTION 'Approved creator not public';END IF;
 BEGIN
  SELECT count(*) INTO n FROM public.student_profiles;
  RAISE EXCEPTION 'Anonymous read private student verification profiles';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.creator_public_profiles(user_id,handle,display_name)
   VALUES('11111111-1111-4111-8111-111111111111','impersonator','Impersonator');
  RAISE EXCEPTION 'Anonymous bypassed public identity write protection';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

\echo 'Authenticated owner can read own unpublished alias but cannot edit through RLS'
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.creator_public_profiles;
 IF n<>2 THEN RAISE EXCEPTION 'Verified owner cannot see own draft + public creator: %',n;END IF;
 BEGIN
  UPDATE public.creator_public_profiles SET handle='bobby_math'
   WHERE user_id='22222222-2222-4222-8222-222222222222';
  RAISE EXCEPTION 'Browser updated a public profile without verified server authority';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.creator_public_profiles;
 IF n<>1 THEN RAISE EXCEPTION 'Student can see another student private draft profile: %',n;END IF;
END $$;
RESET ROLE;

\echo 'Revocation, suspension and course deactivation remove public aliases'
UPDATE public.student_profiles SET verified_at=NULL WHERE user_id='11111111-1111-4111-8111-111111111111';
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.creator_public_profiles;
 IF n<>0 THEN RAISE EXCEPTION 'Unverified creator still visible: %',n;END IF;
END $$;
RESET ROLE;
UPDATE public.student_profiles SET verified_at=now(),suspended=true
 WHERE user_id='11111111-1111-4111-8111-111111111111';
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.creator_public_profiles;
 IF n<>0 THEN RAISE EXCEPTION 'Suspended creator still visible: %',n;END IF;
END $$;
RESET ROLE;
UPDATE public.student_profiles SET suspended=false
 WHERE user_id='11111111-1111-4111-8111-111111111111';
UPDATE public.courses SET active=false WHERE id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.creator_public_profiles;
 IF n<>0 THEN RAISE EXCEPTION 'Creator public with no active approved course: %',n;END IF;
END $$;
RESET ROLE;
UPDATE public.courses SET active=true WHERE id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
\echo 'PASS: creator public aliases, ownership, uniqueness and revocation RLS'
