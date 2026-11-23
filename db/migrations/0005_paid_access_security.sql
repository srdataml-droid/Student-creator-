-- DRAFT ONLY. Disposable PostgreSQL contract, NOT deployed to hosted Supabase.
-- The creator owns copyright; purchased access is a scoped entitlement, not ownership.
-- Published metadata can remain discoverable; full body/media/threads need this gate.
-- A listing record makes a lesson paid even when listing is paused/closed.
-- Apply in hosted staging only after isolated project ownership and RLS review.
CREATE FUNCTION public.can_view_published_content(_content_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS(
      SELECT 1 FROM public.content_items c
      JOIN public.courses course ON course.id=c.course_id
      WHERE c.id=_content_id AND c.status='published' AND course.active=true
        AND public.creator_can_view_published(c.creator_id)
        AND (
          c.creator_id=(SELECT auth.uid())
          OR NOT EXISTS (
            SELECT 1 FROM public.listings l WHERE l.content_id=c.id
          )
          OR EXISTS (
            SELECT 1 FROM public.entitlements e
            JOIN public.orders o ON o.id=e.order_id
            WHERE e.content_id=c.id
              AND e.buyer_id=(SELECT auth.uid())
              AND e.state='active'
              AND o.status='paid'
              AND o.content_id=c.id AND o.buyer_id=(SELECT auth.uid())
              AND o.currency='NGN'
          )
        )
    );
$$;
REVOKE ALL ON FUNCTION public.can_view_published_content(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_published_content(uuid) TO authenticated,service_role;

DROP POLICY IF EXISTS read_verified_viewable_comments ON public.content_comments;
CREATE POLICY read_paid_entitled_comments ON public.content_comments
  FOR SELECT TO authenticated USING(
    hidden_at IS NULL AND public.can_view_published_content(content_id)
  );
-- No client writes for listings, orders, entitlement activation or ledger.
-- Full lesson bodies, asset bytes, and signed media URLs must be gated
-- separately by audited service endpoints. This function is not DRM.
