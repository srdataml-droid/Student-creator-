-- Require a current Auth session for direct authenticated Data API access.
-- Public metadata remains readable under the existing anon policies.
-- Private schema is not an exposed PostgREST schema. The only callable
-- predicate accepts no parameters and inspects only the current JWT identity.
CREATE SCHEMA student_creators_private;
REVOKE ALL ON SCHEMA student_creators_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA student_creators_private TO authenticated,service_role;

CREATE FUNCTION student_creators_private.current_session_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT CASE WHEN (SELECT auth.uid()) IS NOT NULL
   AND (SELECT auth.jwt()->>'role')='authenticated'
   AND (SELECT auth.jwt()->>'session_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 THEN public.student_creators_session_active((SELECT auth.uid()),(SELECT auth.jwt()->>'session_id')::uuid)
 ELSE false END
$$;
REVOKE ALL ON FUNCTION student_creators_private.current_session_active() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_creators_private.current_session_active() TO authenticated,service_role;

-- Restrictive policies AND the existing owner/eligibility policies. A stale
-- authenticated token cannot use the Data API as a backdoor around the server.
CREATE POLICY require_current_session ON public.student_profiles AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));
CREATE POLICY require_current_session ON public.verification_requests AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));
CREATE POLICY require_current_session ON public.orders AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));
CREATE POLICY require_current_session ON public.entitlements AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));
CREATE POLICY require_current_session ON public.content_items AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));
CREATE POLICY require_current_session ON public.content_likes AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));
CREATE POLICY require_current_session ON public.content_comments AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));
CREATE POLICY require_current_session ON public.creator_public_profiles AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));
CREATE POLICY require_current_session ON public.creator_restrictions AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT student_creators_private.current_session_active()))
 WITH CHECK ((SELECT student_creators_private.current_session_active()));

-- Public-schema authenticated helpers must also reject revoked sessions;
-- the anonymous public creator-preview predicate is intentionally unchanged.
CREATE OR REPLACE FUNCTION public.current_student_eligible()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT student_creators_private.current_session_active()
   AND public.affiliation_eligible((SELECT auth.uid()));
$$;
CREATE OR REPLACE FUNCTION public.my_institution_affiliation()
RETURNS TABLE(classification text,enrollment_state text,valid_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT a.affiliation_role,a.enrollment_state,a.valid_until
 FROM public.institution_affiliations a WHERE a.user_id=(SELECT auth.uid())
 AND student_creators_private.current_session_active();
$$;
CREATE OR REPLACE FUNCTION public.creator_can_view_published(_creator_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT student_creators_private.current_session_active()
   AND public.affiliation_eligible((SELECT auth.uid()))
   AND public.affiliation_eligible(_creator_id)
   AND NOT EXISTS(
     SELECT 1 FROM public.creator_restrictions r
     WHERE r.creator_id=_creator_id AND r.viewer_id=(SELECT auth.uid()) AND r.deny_view=true
   );
$$;
-- Existing can_view_published_content calls creator_can_view_published, so it
-- now inherits the same live session gate without duplicating entitlement logic.
