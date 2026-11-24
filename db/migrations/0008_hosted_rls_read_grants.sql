-- Week 1: match hosted staging read grants, but restrict content columns.
-- RLS filters rows; column GRANTs prevent leaking moderation and retry metadata.
-- No browser writes. Keep staff, private media, PSP and audit internals inaccessible.
-- Apply after core RLS policies and prerequisite schema migrations.
GRANT SELECT ON TABLE
  public.institutions,
  public.departments,
  public.courses,
  public.course_topics,
  public.listings
TO anon, authenticated;

-- Earlier hosted staging migration granted full-table SELECT. Revoke it before
-- publishing this allowlist so a published record cannot expose creation_key,
-- creation_hash, reviewer_id, review_reason or rights attestation internals.
REVOKE SELECT ON TABLE public.content_items FROM anon, authenticated;
GRANT SELECT (
  id, creator_id, institution_id, course_id, topic_id, title,
  description, preview_text, status, published_at, created_at
) ON TABLE public.content_items TO anon, authenticated;

GRANT SELECT ON TABLE
  public.student_profiles,
  public.verification_requests,
  public.orders,
  public.entitlements
TO authenticated;

-- No UPDATE/INSERT/DELETE on browser-facing sensitive tables.
