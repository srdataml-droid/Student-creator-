-- Week 4: paid/view/comment-authorized hosted lesson discussion mutations.
BEGIN;
ALTER TABLE public.content_comments ADD COLUMN parent_id uuid;
ALTER TABLE public.content_comments ADD CONSTRAINT social_comment_content_identity UNIQUE(id,content_id);
ALTER TABLE public.content_comments ADD CONSTRAINT social_comment_parent_fk FOREIGN KEY(parent_id,content_id) REFERENCES public.content_comments(id,content_id);
ALTER TABLE public.content_comments ADD CONSTRAINT social_comment_not_self_parent CHECK(parent_id IS NULL OR parent_id<>id);
CREATE INDEX social_comment_parent ON public.content_comments(parent_id);
CREATE INDEX social_comment_author_quota ON public.content_comments(author_id,created_at DESC);
CREATE FUNCTION student_social_private.comment_visible(_id uuid,_content uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.can_view_published_content(_content) AND EXISTS(
 SELECT 1 FROM public.content_comments c WHERE c.id=_id AND c.content_id=_content AND c.hidden_at IS NULL AND public.affiliation_eligible(c.author_id)
 AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM public.content_comments p WHERE p.id=c.parent_id AND p.content_id=_content AND p.hidden_at IS NULL AND public.affiliation_eligible(p.author_id)))
 );
$$;
REVOKE ALL ON FUNCTION student_social_private.comment_visible(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.comment_visible(uuid,uuid) TO authenticated;
DROP POLICY read_paid_entitled_comments ON public.content_comments;
CREATE POLICY read_paid_entitled_comments ON public.content_comments FOR SELECT TO authenticated USING(student_social_private.comment_visible(id,content_id));
-- Keep raw request keys/hashes outside browser reads.
REVOKE SELECT ON public.content_comments FROM authenticated;
GRANT SELECT(id,content_id,author_id,parent_id,body,created_at) ON public.content_comments TO authenticated;
CREATE FUNCTION student_social_private.comment_action(_action text,_content uuid,_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); creator uuid; item uuid; parent uuid; message text; key text; reason text; previous public.content_comments%ROWTYPE; changed integer;
BEGIN
 IF actor IS NULL OR NOT public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _content IS NULL OR _input IS NULL OR jsonb_typeof(_input)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 -- One content lock serializes social comment writes with owner removal.
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-comment-content:'||_content::text,0));
 IF _action='remove' THEN
   IF _input - ARRAY['commentId']<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   item:=(_input->>'commentId')::uuid;
   SELECT * INTO previous FROM public.content_comments WHERE id=item AND content_id=_content AND author_id=actor;
   IF NOT FOUND THEN RAISE EXCEPTION 'COMMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
   UPDATE public.content_comments SET hidden_at=clock_timestamp() WHERE id=item AND hidden_at IS NULL;
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed>0 THEN INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'social.comment.removed','content_comment',item); END IF;
   RETURN jsonb_build_object('removed',true,'replayed',changed=0);
 END IF;
 IF NOT public.can_view_published_content(_content) THEN RAISE EXCEPTION 'CONTENT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF _action='post' THEN
   SELECT creator_id INTO creator FROM public.content_items WHERE id=_content;
   IF EXISTS(SELECT 1 FROM public.creator_restrictions r WHERE r.creator_id=creator AND r.viewer_id=actor AND r.deny_comment)
      THEN RAISE EXCEPTION 'COMMENT_RESTRICTED' USING ERRCODE='42501'; END IF;
   IF _input - ARRAY['text','creationKey','replyTo']<>'{}'::jsonb OR jsonb_typeof(_input->'text') IS DISTINCT FROM 'string' OR jsonb_typeof(_input->'creationKey') IS DISTINCT FROM 'string'
      THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   message:=btrim(_input->>'text');key:=_input->>'creationKey';parent:=(_input->>'replyTo')::uuid;
   IF length(message) NOT BETWEEN 3 AND 800 OR key !~ '^[A-Za-z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.content_comments p WHERE p.id=parent AND p.content_id=_content AND p.parent_id IS NULL AND student_social_private.comment_visible(p.id,_content))
      THEN RAISE EXCEPTION 'INVALID_REPLY' USING ERRCODE='22023'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('student-social-comment-author:'||actor::text,0));
   SELECT * INTO previous FROM public.content_comments WHERE content_id=_content AND author_id=actor AND creation_key=key;
   IF FOUND THEN
     IF previous.body<>message OR previous.parent_id IS DISTINCT FROM parent THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
     IF previous.hidden_at IS NOT NULL THEN RAISE EXCEPTION 'COMMENT_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
     RETURN jsonb_build_object('id',previous.id,'replayed',true);
   END IF;
   IF (SELECT count(*) FROM public.content_comments WHERE author_id=actor AND created_at>clock_timestamp()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'COMMENT_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
   INSERT INTO public.content_comments(content_id,author_id,parent_id,body,creation_key,creation_hash)
   VALUES(_content,actor,parent,message,key,encode(sha256(convert_to(jsonb_build_object('body',message,'parent',parent)::text,'UTF8')),'hex')) RETURNING id INTO item;
   RETURN jsonb_build_object('id',item,'replayed',false);
 END IF;
 IF _action='report' THEN
   IF _input - ARRAY['commentId','reason']<>'{}'::jsonb OR jsonb_typeof(_input->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   item:=(_input->>'commentId')::uuid;reason:=btrim(_input->>'reason');
   IF item IS NULL OR length(reason) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   IF NOT student_social_private.comment_visible(item,_content) THEN RAISE EXCEPTION 'COMMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
   IF EXISTS(SELECT 1 FROM public.content_comments WHERE id=item AND author_id=actor) THEN RAISE EXCEPTION 'CANNOT_REPORT_SELF' USING ERRCODE='42501'; END IF;
   INSERT INTO public.content_comment_reports(comment_id,reporter_id,reason) VALUES(item,actor,reason) RETURNING id INTO item;
   RETURN jsonb_build_object('id',item);
 END IF;
 RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION student_social_private.comment_action(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.comment_action(text,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.social_comment_action(_action text,_content uuid,_input jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.comment_action(_action,_content,_input);
$$;
REVOKE ALL ON FUNCTION public.social_comment_action(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_comment_action(text,uuid,jsonb) TO authenticated;
COMMIT;
