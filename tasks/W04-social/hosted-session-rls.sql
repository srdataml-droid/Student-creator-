-- Restrictive policies intersect existing ownership rules, not replace them.
-- Applies to authenticated users only; anonymous public previews remain unchanged.
BEGIN;
CREATE POLICY social_active_session ON public.social_message_preferences AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_messages AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_message_reads AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_contact_blocks AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_community_members AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_community_moderators AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_community_posts AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_creator_follows AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.content_comments AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_notification_preferences AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.social_notifications AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.creator_restrictions AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.content_likes AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.content_items AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
CREATE POLICY social_active_session ON public.creator_public_profiles AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_social_private.active_session())) WITH CHECK((SELECT student_social_private.active_session()));
-- Only the current subject can obtain the boolean role/session state used by the server.
CREATE FUNCTION student_social_private.session_state() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('userId',auth.uid(),'active',student_social_private.active_session(),
 'student',student_social_private.active_session() AND public.current_student_eligible(),
 'admin',student_social_private.active_session() AND EXISTS(SELECT 1 FROM public.platform_staff WHERE user_id=auth.uid() AND role='admin' AND active));
$$;
REVOKE ALL ON FUNCTION student_social_private.session_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.session_state() TO authenticated;
CREATE FUNCTION public.social_session_state() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.session_state();
$$;
REVOKE ALL ON FUNCTION public.social_session_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_session_state() TO authenticated;
COMMIT;
