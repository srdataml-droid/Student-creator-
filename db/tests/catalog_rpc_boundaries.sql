BEGIN;
DO $$
DECLARE n text; p oid; q oid;
BEGIN
 FOREACH n IN ARRAY ARRAY['can_view_published_content(uuid)','creator_can_view_published(uuid)','creator_has_approved_public_work(uuid)','current_student_eligible()','my_institution_affiliation()'] LOOP
  p:=to_regprocedure('public.'||n); q:=to_regprocedure('student_catalog_private.'||n);
  IF p IS NULL OR q IS NULL OR (SELECT prosecdef FROM pg_proc WHERE oid=p) OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=q) THEN RAISE EXCEPTION 'Invalid privilege boundary %',n; END IF;
  IF NOT has_function_privilege('authenticated',p,'EXECUTE') OR NOT has_function_privilege('authenticated',q,'EXECUTE') OR NOT has_function_privilege('service_role',p,'EXECUTE') OR NOT has_function_privilege('service_role',q,'EXECUTE') THEN RAISE EXCEPTION 'Expected caller lost access %',n; END IF;
  IF has_function_privilege('anon',p,'EXECUTE') IS DISTINCT FROM (n='creator_has_approved_public_work(uuid)') OR has_function_privilege('anon',q,'EXECUTE') IS DISTINCT FROM (n='creator_has_approved_public_work(uuid)') THEN RAISE EXCEPTION 'Unexpected anonymous grant %',n; END IF;
 END LOOP;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF public.creator_has_approved_public_work('00000000-0000-4000-8000-000000000099') THEN RAISE EXCEPTION 'Unknown creator exposed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.current_student_eligible() OR public.creator_can_view_published('00000000-0000-4000-8000-000000000099') OR public.can_view_published_content('00000000-0000-4000-8000-000000000099') OR EXISTS(SELECT 1 FROM public.my_institution_affiliation()) THEN RAISE EXCEPTION 'Sessionless user authorized'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: preserved catalog and eligibility privilege boundaries' AS result;
