-- Disposable PG identity contract, never a hosted university integration.
\set ON_ERROR_STOP on
\echo 'Institution affiliation RLS: manual fallback, verified student, graduation, expired grant'
UPDATE public.student_profiles SET suspended=false
 WHERE user_id='22222222-2222-4222-8222-222222222222';
INSERT INTO public.institution_integrations(provider_id,institution_id,method,enabled)
VALUES('synthetic_uni_b','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic',true);
INSERT INTO public.institution_affiliations(user_id,institution_id,provider_id,subject_digest,
 affiliation_role,enrollment_state,valid_until)
VALUES('22222222-2222-4222-8222-222222222222',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic_uni_b',repeat('c',64),
 'student','active',now()+interval '2 days');
SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE ok boolean; n integer;
BEGIN
 SELECT public.current_student_eligible() INTO ok;
 IF NOT ok THEN RAISE EXCEPTION 'Verified current student was refused';END IF;
 SELECT public.creator_can_view_published('11111111-1111-4111-8111-111111111111') INTO ok;
 IF NOT ok THEN RAISE EXCEPTION 'Manual fallback creator not viewable';END IF;
 SELECT count(*) INTO n FROM public.my_institution_affiliation();
 IF n<>1 THEN RAISE EXCEPTION 'Current student affiliation not available';END IF;
 BEGIN
  SELECT count(*) INTO n FROM public.institution_affiliations;
  RAISE EXCEPTION 'Browser read raw institution digest';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.institution_affiliations SET affiliation_role='student';
  RAISE EXCEPTION 'Browser modified institutional evidence';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.institution_verification_appeals(user_id,private_reason)
  VALUES('22222222-2222-4222-8222-222222222222','Forged direct browser appeal');
  RAISE EXCEPTION 'Browser wrote privileged institutional case directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

UPDATE public.institution_affiliations SET enrollment_state='graduated'
 WHERE user_id='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE ok boolean; n integer;
BEGIN
 SELECT public.current_student_eligible() INTO ok;
 IF ok THEN RAISE EXCEPTION 'Graduated student still eligible';END IF;
 SELECT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') INTO ok;
 IF ok THEN RAISE EXCEPTION 'Graduated student could view bought content';END IF;
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>0 THEN RAISE EXCEPTION 'Graduated student could read paid comment';END IF;
END $$;
RESET ROLE;

UPDATE public.institution_affiliations SET enrollment_state='active',valid_until=now()-interval '1 day'
 WHERE user_id='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE ok boolean;
BEGIN
 SELECT public.current_student_eligible() INTO ok;
 IF ok THEN RAISE EXCEPTION 'Expired student proof remained eligible';END IF;
END $$;
RESET ROLE;

UPDATE public.institution_affiliations SET valid_until=now()+interval '2 days'
 WHERE user_id='22222222-2222-4222-8222-222222222222';
UPDATE public.institution_integrations SET enabled=false WHERE provider_id='synthetic_uni_b';
SET ROLE authenticated;
DO $$ DECLARE ok boolean;
BEGIN
 SELECT public.current_student_eligible() INTO ok;
 IF ok THEN RAISE EXCEPTION 'Disabled university integration still granted access';END IF;
END $$;
RESET ROLE;
UPDATE public.institution_integrations SET enabled=true WHERE provider_id='synthetic_uni_b';

INSERT INTO public.institution_integrations(provider_id,institution_id,method,enabled)
VALUES('synthetic_uni_a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic',true);
INSERT INTO public.institution_affiliations(user_id,institution_id,provider_id,subject_digest,
 affiliation_role,enrollment_state,valid_until)
VALUES('11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic_uni_a',repeat('a',64),
 'lecturer','active',now()+interval '2 days');
SET ROLE authenticated;
DO $$ DECLARE ok boolean;
BEGIN
 SELECT public.creator_can_view_published('11111111-1111-4111-8111-111111111111') INTO ok;
 IF ok THEN RAISE EXCEPTION 'Lecturer creator retained student creator visibility';END IF;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
DO $$ DECLARE ok boolean;
BEGIN
 SELECT public.current_student_eligible() INTO ok;
 IF ok THEN RAISE EXCEPTION 'Lecturer gained student creator privilege';END IF;
END $$;
RESET ROLE;

UPDATE public.institution_affiliations SET affiliation_role='student'
 WHERE user_id='11111111-1111-4111-8111-111111111111';
SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE ok boolean;
BEGIN
 SELECT public.creator_can_view_published('11111111-1111-4111-8111-111111111111') INTO ok;
 IF NOT ok THEN RAISE EXCEPTION 'Active student denied after signed revalidation';END IF;
END $$;
RESET ROLE;
\echo 'PASS: no browser proof mutation; current students, graduates, lecturers and expired providers fail closed'
