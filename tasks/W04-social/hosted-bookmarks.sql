-- Owner-only bookmarks, distinct from likes and paid access.
CREATE TABLE public.content_bookmarks(user_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,content_id));
ALTER TABLE public.content_bookmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_bookmarks FROM PUBLIC,anon,authenticated;
GRANT SELECT(content_id,created_at) ON public.content_bookmarks TO authenticated;
GRANT SELECT ON public.content_bookmarks TO service_role;
CREATE POLICY own_visible_bookmarks ON public.content_bookmarks FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.current_student_eligible() AND EXISTS(SELECT 1 FROM public.content_items c WHERE c.id=content_id AND c.status='published' AND public.creator_can_view_published(c.creator_id)));
CREATE FUNCTION student_social_private.bookmark_action(_content uuid,_enabled boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); n integer;
BEGIN
 IF NOT public.current_student_eligible() OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _content IS NULL OR _enabled IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':bookmark',0));
 IF _enabled THEN
  IF NOT EXISTS(SELECT 1 FROM public.content_items c JOIN public.courses co ON co.id=c.course_id JOIN public.institutions i ON i.id=c.institution_id WHERE c.id=_content AND c.status='published' AND co.active AND i.active AND public.creator_can_view_published(c.creator_id)) THEN RAISE EXCEPTION 'CONTENT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.content_bookmarks WHERE user_id=actor AND content_id=_content) AND (SELECT count(*) FROM public.content_bookmarks WHERE user_id=actor)>=5000 THEN RAISE EXCEPTION 'BOOKMARK_LIMIT' USING ERRCODE='22023'; END IF;
  INSERT INTO public.content_bookmarks(user_id,content_id) VALUES(actor,_content) ON CONFLICT DO NOTHING;
 ELSE
  DELETE FROM public.content_bookmarks WHERE user_id=actor AND content_id=_content;
 END IF;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('bookmarked',_enabled,'replayed',n=0);
END $$;
REVOKE ALL ON FUNCTION student_social_private.bookmark_action(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.bookmark_action(uuid,boolean) TO authenticated;
CREATE FUNCTION public.social_bookmark_action(_content uuid,_enabled boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.bookmark_action(_content,_enabled); $$;
REVOKE ALL ON FUNCTION public.social_bookmark_action(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_bookmark_action(uuid,boolean) TO authenticated;
