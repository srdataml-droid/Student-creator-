-- DRAFT ONLY: for disposable PostgreSQL CI; do not apply to a hosted project without reviewed migration approval.
-- Aligns published comments with the verified, creator-controlled full-view boundary used in local SQLite.
-- Paid entitlement checks and protected external media grants are NOT implemented by this file.
CREATE TABLE public.creator_restrictions (
  creator_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
  deny_view boolean NOT NULL DEFAULT false,
  deny_comment boolean NOT NULL DEFAULT false,
  deny_message boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_id,viewer_id),
  CHECK (creator_id <> viewer_id)
);
ALTER TABLE public.creator_restrictions ENABLE ROW LEVEL SECURITY;
-- Browsers cannot mutate creator security rules: the reviewed server API must authenticate
-- verified owner, check rate limits and audit before using its service-only write channel.
CREATE POLICY creator_read_own_restrictions ON public.creator_restrictions
  FOR SELECT TO authenticated USING (creator_id=(SELECT auth.uid()));
REVOKE ALL ON public.creator_restrictions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.creator_restrictions TO authenticated;
GRANT ALL ON public.creator_restrictions TO service_role;

-- A constrained visibility check for policies; deliberately returns only a boolean.
-- No private student data or restriction rows are exposed to the caller.
CREATE FUNCTION public.creator_can_view_published(_creator_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.student_profiles v
      WHERE v.user_id=(SELECT auth.uid())
        AND v.verified_at IS NOT NULL AND v.suspended=false
    )
    AND EXISTS (
      SELECT 1 FROM public.student_profiles c
      WHERE c.user_id=_creator_id
        AND c.verified_at IS NOT NULL AND c.suspended=false
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.creator_restrictions r
      WHERE r.creator_id=_creator_id AND r.viewer_id=(SELECT auth.uid())
        AND r.deny_view=true
    );
$$;
REVOKE ALL ON FUNCTION public.creator_can_view_published(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.creator_can_view_published(uuid) TO authenticated,service_role;

-- Earlier draft permitted anonymous published comments. Full comment threads are now
-- accessible only to verified, unblocked students, consistent with the local HTTP handler.
DROP POLICY IF EXISTS read_published_comments ON public.content_comments;
CREATE POLICY read_verified_viewable_comments ON public.content_comments
  FOR SELECT TO authenticated USING (
    hidden_at IS NULL AND EXISTS (
      SELECT 1 FROM public.content_items item
      JOIN public.courses course ON course.id=item.course_id
      WHERE item.id=content_id AND item.status='published' AND course.active=true
        AND public.creator_can_view_published(item.creator_id)
    )
  );
REVOKE SELECT ON public.content_comments FROM anon;
