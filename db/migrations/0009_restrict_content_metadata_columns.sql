-- Week 1: protect unpublished creation and moderation metadata from clients.
-- Migration 0008 granted broad table SELECT; RLS alone masks rows, NOT columns.
-- This migration makes a published record readable only via allowed metadata.
-- Hosted staging equivalent: student_creators_content_metadata_column_guard_0004.
-- Do not grant client writes; server-side permissions are handled separately.
REVOKE SELECT ON TABLE public.content_items FROM anon, authenticated;
GRANT SELECT (
  id, creator_id, institution_id, course_id, topic_id, title,
  description, preview_text, status, published_at, created_at
) ON TABLE public.content_items TO anon, authenticated;
