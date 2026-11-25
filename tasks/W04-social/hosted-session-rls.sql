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
COMMIT;
