-- DESIGN DRAFT, not applied to hosted Supabase. Dedicated Student Creators project only.
-- Read-only public creator identity, separate from private student verification evidence.
-- Service-only writes: verified Auth and alias policy must be checked before this table is updated.
CREATE TABLE public.creator_public_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
  handle text COLLATE "C" NOT NULL UNIQUE
    CHECK(handle ~ '^[a-z][a-z0-9_]{2,23}$'
      AND handle !~ '^(admin|administrator|staff|official|verified|support|moderator|system|platform|worthkind|registrar|school_admin)(_|$)'),
  display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 3 AND 60),
  bio text NOT NULL DEFAULT '' CHECK(length(bio)<=280),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creator_public_profiles_recent ON public.creator_public_profiles(updated_at DESC);

-- This tightly scoped boolean helper avoids granting anonymous access to
-- private student_profiles verification records. It returns no student PII.
CREATE FUNCTION public.creator_has_approved_public_work(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_profiles p
    JOIN public.content_items i ON i.creator_id=p.user_id
    JOIN public.courses c ON c.id=i.course_id
    WHERE p.user_id=_user_id AND p.verified_at IS NOT NULL AND p.suspended=false
      AND i.status='published' AND c.active=true
  );
$$;
REVOKE ALL ON FUNCTION public.creator_has_approved_public_work(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.creator_has_approved_public_work(uuid) TO anon,authenticated,service_role;

ALTER TABLE public.creator_public_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_approved_creator_public_profile ON public.creator_public_profiles
 FOR SELECT TO anon,authenticated
 USING(public.creator_has_approved_public_work(user_id));
CREATE POLICY read_own_creator_public_profile ON public.creator_public_profiles
 FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

REVOKE ALL ON public.creator_public_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.creator_public_profiles TO anon,authenticated;
GRANT ALL ON public.creator_public_profiles TO service_role;
-- Important: Never expose arbitrary service-role writes in a browser.
-- The future hosted API must independently check identity, verification,
-- rate limits, normalization, handle reservation and audit.
