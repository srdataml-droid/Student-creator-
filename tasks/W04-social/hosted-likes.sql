-- Like writes must pass the same preview authorization and quota as local mode.
BEGIN;
REVOKE INSERT,UPDATE,DELETE ON public.content_likes FROM authenticated,anon,PUBLIC;
CREATE FUNCTION student_social_private.like_action(_content uuid,_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); owner_id uuid; changed integer;
BEGIN
 IF NOT student_social_private.active_session() OR NOT public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _content IS NULL OR _enabled IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-like:'||actor::text,0));
 IF _enabled THEN
  SELECT c.creator_id INTO owner_id FROM public.content_items c JOIN public.courses cs ON cs.id=c.course_id WHERE c.id=_content AND c.status='published' AND cs.active;
  IF owner_id IS NULL OR NOT student_social_private.preview_allowed(owner_id) THEN RAISE EXCEPTION 'CONTENT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.content_likes WHERE user_id=actor AND content_id=_content) THEN RETURN jsonb_build_object('liked',true,'replayed',true); END IF;
  IF (SELECT count(*) FROM public.audit_events WHERE actor_id=actor AND action='social.content.liked' AND created_at>clock_timestamp()-interval '1 hour')>=60 THEN RAISE EXCEPTION 'LIKE_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.content_likes(user_id,content_id) VALUES(actor,_content) ON CONFLICT DO NOTHING;
 ELSE
  DELETE FROM public.content_likes WHERE user_id=actor AND content_id=_content;
 END IF;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,CASE WHEN _enabled THEN 'social.content.liked' ELSE 'social.content.unliked' END,'content',_content); END IF;
 RETURN jsonb_build_object('liked',_enabled,'replayed',changed=0);
END $$;
REVOKE ALL ON FUNCTION student_social_private.like_action(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.like_action(uuid,boolean) TO authenticated;
CREATE FUNCTION public.social_like_action(_content uuid,_enabled boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.like_action(_content,_enabled);
$$;
REVOKE ALL ON FUNCTION public.social_like_action(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_like_action(uuid,boolean) TO authenticated;
COMMIT;
