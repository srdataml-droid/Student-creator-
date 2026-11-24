-- DRAFT FOR DISPOSABLE POSTGRES ONLY. NEVER apply on an unidentified hosted project.
-- Institution assertions must be verified by trusted backend crypto before service-only writes.
-- Browser metadata, email domains or ID photographs do not prove enrollment.
CREATE TABLE public.institution_integrations (
  provider_id text PRIMARY KEY CHECK(provider_id ~ '^[A-Za-z0-9_.:-]{3,128}$'),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  method text NOT NULL CHECK(method IN ('synthetic','rest','oidc','saml','roster')),
  issuer text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  UNIQUE(provider_id,institution_id)
);
CREATE TABLE public.institution_affiliations (
  user_id uuid PRIMARY KEY,
  institution_id uuid NOT NULL,
  provider_id text NOT NULL,
  subject_digest text NOT NULL CHECK(subject_digest ~ '^[0-9a-f]{64}$'),
  affiliation_role text NOT NULL CHECK(affiliation_role IN ('student','alumni','lecturer')),
  enrollment_state text NOT NULL CHECK(enrollment_state IN ('active','suspended','graduated','inactive')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  FOREIGN KEY(user_id,institution_id) REFERENCES public.student_profiles(user_id,institution_id) ON DELETE CASCADE,
  FOREIGN KEY(provider_id,institution_id) REFERENCES public.institution_integrations(provider_id,institution_id),
  UNIQUE(provider_id,subject_digest)
);
CREATE INDEX institution_affiliations_expiry ON public.institution_affiliations(provider_id,valid_until);
CREATE TABLE public.institution_verification_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','review_requested','rejected')),
  private_reason text NOT NULL CHECK(length(private_reason) BETWEEN 20 AND 800),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewer_id uuid REFERENCES auth.users(id),review_note text
);
ALTER TABLE public.institution_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_verification_appeals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_integrations,public.institution_affiliations,
 public.institution_verification_appeals FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.institution_integrations,public.institution_affiliations,
 public.institution_verification_appeals TO service_role;

-- Not callable directly by ordinary users: accepts arbitrary user_id for
-- audited access policies only. Manual verification is the fallback when
-- NO institutional provider has been configured for that student.
CREATE FUNCTION public.affiliation_eligible(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.student_profiles p
  WHERE p.user_id=_user_id AND p.verified_at IS NOT NULL AND p.suspended=false
    AND (
      NOT EXISTS(SELECT 1 FROM public.institution_affiliations a WHERE a.user_id=p.user_id)
      OR EXISTS(
        SELECT 1 FROM public.institution_affiliations a
        JOIN public.institution_integrations i
          ON i.provider_id=a.provider_id AND i.institution_id=a.institution_id
        WHERE a.user_id=p.user_id AND a.affiliation_role='student' AND
          a.enrollment_state='active' AND a.valid_until>now() AND i.enabled=true
      )
    )
 );
$$;
REVOKE ALL ON FUNCTION public.affiliation_eligible(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliation_eligible(uuid) TO service_role;

-- Current authenticated viewer only: no arbitrary-student eligibility probing.
CREATE FUNCTION public.current_student_eligible()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND
  public.affiliation_eligible((SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.current_student_eligible() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_student_eligible() TO authenticated,service_role;

-- User can inspect limited own affiliation state, not the permanent digest.
CREATE FUNCTION public.my_institution_affiliation()
RETURNS TABLE(classification text,enrollment_state text,valid_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT a.affiliation_role,a.enrollment_state,a.valid_until
 FROM public.institution_affiliations a WHERE a.user_id=(SELECT auth.uid());
$$;
REVOKE ALL ON FUNCTION public.my_institution_affiliation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.my_institution_affiliation() TO authenticated,service_role;

-- Same account/creator eligibility boundary used for paid comments and video
-- authorization. No raw roster or identity data becomes public metadata.
CREATE OR REPLACE FUNCTION public.creator_can_view_published(_creator_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL
   AND public.affiliation_eligible((SELECT auth.uid()))
   AND public.affiliation_eligible(_creator_id)
   AND NOT EXISTS(
     SELECT 1 FROM public.creator_restrictions r
     WHERE r.creator_id=_creator_id AND r.viewer_id=(SELECT auth.uid()) AND r.deny_view=true
   );
$$;
REVOKE ALL ON FUNCTION public.creator_can_view_published(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_can_view_published(uuid) TO authenticated,service_role;

DROP POLICY IF EXISTS verified_public_content_like ON public.content_likes;
CREATE POLICY currently_enrolled_content_like ON public.content_likes
 FOR INSERT TO authenticated WITH CHECK(
  user_id=(SELECT auth.uid()) AND public.current_student_eligible()
  AND EXISTS(
    SELECT 1 FROM public.content_items c
    JOIN public.courses cs ON cs.id=c.course_id
    WHERE c.id=content_id AND c.status='published' AND cs.active=true
  )
);
-- Identity tables are never client writable; a trusted service verifies
-- signed assertions and implements appeals, evidence deletion and audit.
