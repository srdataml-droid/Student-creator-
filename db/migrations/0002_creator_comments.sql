-- DESIGN DRAFT only: not applied to hosted Supabase. Independent of main's already-merged 0001 content_likes.
-- Requires 0001_proposed_core.sql and an approved dedicated Student Creators PostgreSQL project.
CREATE TABLE public.content_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES auth.users(id),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 3 AND 800),
 creation_key text NOT NULL CHECK(length(creation_key) BETWEEN 16 AND 128 AND creation_key ~ '^[A-Za-z0-9_-]+$'),
 creation_hash text NOT NULL CHECK(creation_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 hidden_at timestamptz,
 UNIQUE(author_id,content_id,creation_key)
);
CREATE INDEX content_comments_visible ON public.content_comments(content_id,created_at DESC) WHERE hidden_at IS NULL;

CREATE TABLE public.content_comment_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 comment_id uuid NOT NULL REFERENCES public.content_comments(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES auth.users(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','hidden')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES auth.users(id),
 review_note text,
 UNIQUE(comment_id,reporter_id)
);
CREATE INDEX content_comment_reports_open ON public.content_comment_reports(created_at) WHERE status='open';


ALTER TABLE public.content_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_comment_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_published_comments ON public.content_comments FOR SELECT TO anon,authenticated
 USING(hidden_at IS NULL AND EXISTS (
  SELECT 1 FROM public.content_items item
  JOIN public.courses course ON course.id=item.course_id
  WHERE item.id=content_id AND item.status='published' AND course.active=true
 ));
-- Direct browser writes to comments/reports are DENIED: server must enforce verification,
-- request-key replay, comment rate limits, independent admin review and audit.
-- Likes may be set/removed only by the verified student for their own identity.

-- Direct browser comment and report writes stay DENIED until a reviewed verified-Auth
-- service endpoint enforces idempotency, moderation, audit, anti-abuse and PII privacy.
REVOKE ALL ON public.content_comments,public.content_comment_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.content_comments TO anon,authenticated;
GRANT ALL ON public.content_comments,public.content_comment_reports TO service_role;
