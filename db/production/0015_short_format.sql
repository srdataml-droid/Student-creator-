-- Additive metadata for original creator-selected short videos. Existing posts remain ordinary videos.
ALTER TABLE public.content_items ADD COLUMN content_format text NOT NULL DEFAULT 'video' CHECK (content_format IN ('video','short'));
GRANT SELECT(content_format) ON public.content_items TO anon,authenticated;
CREATE INDEX content_short_discovery ON public.content_items(published_at DESC,id DESC) WHERE status='published' AND content_format='short';
CREATE FUNCTION student_catalog_private.creator_draft_format(_content uuid,_format text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); r public.content_items%ROWTYPE; editable boolean;
BEGIN
 IF actor IS NULL OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _format IS NOT NULL AND _format NOT IN ('video','short') THEN RAISE EXCEPTION 'INVALID_FORMAT' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.content_items WHERE id=_content AND creator_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='42501'; END IF;
 editable:=r.status IN ('draft','rejected') AND r.published_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.orders WHERE content_id=r.id);
 IF _format IS NOT NULL THEN
  IF NOT editable THEN RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE='23505'; END IF;
  IF r.content_format<>_format THEN
   UPDATE public.content_items SET content_format=_format WHERE id=r.id RETURNING * INTO r;
   INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'creator.draft.format.changed','content',r.id);
  END IF;
 END IF;
 RETURN jsonb_build_object('contentId',r.id,'format',r.content_format,'editable',editable);
END $$;
REVOKE ALL ON FUNCTION student_catalog_private.creator_draft_format(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.creator_draft_format(uuid,text) TO authenticated;
CREATE FUNCTION public.creator_draft_format(_content uuid,_format text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_catalog_private.creator_draft_format(_content,_format) $$;
REVOKE ALL ON FUNCTION public.creator_draft_format(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_draft_format(uuid,text) TO authenticated;
