-- DESIGN DRAFT / NOT APPLIED TO HOSTED SUPABASE.
-- Companion schema for the local post-like/comment implementation.
-- Apply only to a dedicated disposable PostgreSQL/Supabase staging project after migration review.
-- No browser route to modify comments or report decisions is authorized here.
CREATE TABLE public.content_likes (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,content_id)
);
CREATE INDEX content_likes_by_content ON public.content_likes(content_id);

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

ALTER TABLE public.content_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_comment_reports ENABLE ROW LEVEL SECURITY;

-- Published content is globally readable, but only while the course is active.
-- Never expose author email or unreviewed private school documents in the comment query.
CREATE POLICY read_published_comments ON public.content_comments FOR SELECT TO anon,authenticated
 USING(hidden_at IS NULL AND EXISTS (
  SELECT 1 FROM public.content_items item
  JOIN public.courses course ON course.id=item.course_id
  WHERE item.id=content_id AND item.status='published' AND course.active=true
 ));
-- Direct browser writes to comments/reports are DENIED: server must enforce verification,
-- request-key replay, comment rate limits, independent admin review and audit.
-- Likes may be set/removed only by the verified student for their own identity.
CREATE POLICY read_own_likes ON public.content_likes FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()));
CREATE POLICY insert_own_likes ON public.content_likes FOR INSERT TO authenticated
 WITH CHECK(user_id=(SELECT auth.uid())
  AND EXISTS(SELECT 1 FROM public.student_profiles student
    WHERE student.user_id=(SELECT auth.uid()) AND student.verified_at IS NOT NULL AND student.suspended=false)
  AND EXISTS(SELECT 1 FROM public.content_items item
    JOIN public.courses course ON course.id=item.course_id
    WHERE item.id=content_id AND item.status='published' AND course.active=true)
 );
CREATE POLICY delete_own_likes ON public.content_likes FOR DELETE TO authenticated
 USING(user_id=(SELECT auth.uid()));

REVOKE ALL ON public.content_likes,public.content_comments,public.content_comment_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.content_likes TO authenticated;
GRANT SELECT ON public.content_comments TO anon,authenticated;
-- Only server-side, reviewed service operations may insert comments and moderate reports.
-- Do not attach service-role credentials to a client component or return them to browsers.
GRANT ALL ON public.content_likes,public.content_comments,public.content_comment_reports TO service_role;
