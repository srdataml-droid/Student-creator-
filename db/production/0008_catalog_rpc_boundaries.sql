-- Preserve existing predicates and policy dependency OIDs; only the exposed RPC wrappers become invokers.
-- New schema is internal and must not be added to PostgREST exposed schemas.
CREATE SCHEMA student_catalog_private;
REVOKE ALL ON SCHEMA student_catalog_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA student_catalog_private TO anon,authenticated,service_role;

ALTER FUNCTION public.can_view_published_content(uuid) SET SCHEMA student_catalog_private;
REVOKE ALL ON FUNCTION student_catalog_private.can_view_published_content(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.can_view_published_content(uuid) TO authenticated,service_role;
CREATE FUNCTION public.can_view_published_content(_content_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT student_catalog_private.can_view_published_content(_content_id)
$$;
REVOKE ALL ON FUNCTION public.can_view_published_content(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_view_published_content(uuid) TO authenticated,service_role;

ALTER FUNCTION public.creator_can_view_published(uuid) SET SCHEMA student_catalog_private;
REVOKE ALL ON FUNCTION student_catalog_private.creator_can_view_published(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.creator_can_view_published(uuid) TO authenticated,service_role;
CREATE FUNCTION public.creator_can_view_published(_creator_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT student_catalog_private.creator_can_view_published(_creator_id)
$$;
REVOKE ALL ON FUNCTION public.creator_can_view_published(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_can_view_published(uuid) TO authenticated,service_role;

ALTER FUNCTION public.creator_has_approved_public_work(uuid) SET SCHEMA student_catalog_private;
REVOKE ALL ON FUNCTION student_catalog_private.creator_has_approved_public_work(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.creator_has_approved_public_work(uuid) TO anon,authenticated,service_role;
CREATE FUNCTION public.creator_has_approved_public_work(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT student_catalog_private.creator_has_approved_public_work(_user_id)
$$;
REVOKE ALL ON FUNCTION public.creator_has_approved_public_work(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_has_approved_public_work(uuid) TO anon,authenticated,service_role;

ALTER FUNCTION public.current_student_eligible() SET SCHEMA student_catalog_private;
REVOKE ALL ON FUNCTION student_catalog_private.current_student_eligible() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.current_student_eligible() TO authenticated,service_role;
CREATE FUNCTION public.current_student_eligible() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT student_catalog_private.current_student_eligible()
$$;
REVOKE ALL ON FUNCTION public.current_student_eligible() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.current_student_eligible() TO authenticated,service_role;

ALTER FUNCTION public.my_institution_affiliation() SET SCHEMA student_catalog_private;
REVOKE ALL ON FUNCTION student_catalog_private.my_institution_affiliation() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.my_institution_affiliation() TO authenticated,service_role;
CREATE FUNCTION public.my_institution_affiliation() RETURNS TABLE(classification text, enrollment_state text, valid_until timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT * FROM student_catalog_private.my_institution_affiliation()
$$;
REVOKE ALL ON FUNCTION public.my_institution_affiliation() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.my_institution_affiliation() TO authenticated,service_role;
