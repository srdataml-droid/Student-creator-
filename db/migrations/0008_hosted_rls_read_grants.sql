-- Week 1: make already-RLS-protected reads usable through Supabase Data API.
-- Source of hosted staging equivalent: migration student_creators_rls_read_grants_staging_0003.
-- No client writes are added; table-level GRANTs do not override RLS row filters.
-- Apply only after 0001–0007 and validate cross-account isolation.
GRANT SELECT ON TABLE
  public.institutions,
  public.departments,
  public.courses,
  public.course_topics,
  public.content_items,
  public.listings
TO anon, authenticated;

GRANT SELECT ON TABLE
  public.student_profiles,
  public.verification_requests,
  public.orders,
  public.entitlements
TO authenticated;

-- Intentional omissions: staff, private assets, payment attempts,
-- audit and ledgers are not given browser access.
