CREATE FUNCTION student_social_private.can_moderate_social(_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT student_social_private.active_session() AND CASE WHEN _kind='community' THEN public.week7_staff_has_capability(auth.uid(),'community.moderate') WHEN _kind IN ('message','account','comment') THEN public.week7_staff_has_capability(auth.uid(),'content.moderate') ELSE false END
$$;
REVOKE ALL ON FUNCTION student_social_private.can_moderate_social(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION student_social_private.community_action(_action text,_course uuid,_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); school uuid; target uuid; post uuid; parent uuid; topic uuid; message text; key text; reason text; previous public.social_community_posts%ROWTYPE; changed integer; enabled boolean; staff boolean;
BEGIN
 IF NOT student_social_private.active_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _course IS NULL OR _input IS NULL OR jsonb_typeof(_input)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT c.institution_id INTO school FROM public.courses c WHERE c.id=_course AND c.active;
 IF school IS NULL THEN RAISE EXCEPTION 'COMMUNITY_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 staff:=student_social_private.can_moderate_social('community');
 IF _action='role' THEN
   IF NOT staff THEN RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
   IF _input - ARRAY['userId','enabled','reason'] <> '{}'::jsonb OR jsonb_typeof(_input->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(_input->'reason') IS DISTINCT FROM 'string'
     THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   target:=(_input->>'userId')::uuid;enabled:=(_input->>'enabled')::boolean;reason:=btrim(_input->>'reason');
   IF target IS NULL OR length(reason) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('student-social-course:'||_course::text,0));
   IF enabled THEN
     IF NOT public.affiliation_eligible(target) OR NOT EXISTS(SELECT 1 FROM public.social_community_members WHERE course_id=_course AND user_id=target)
       THEN RAISE EXCEPTION 'MEMBER_REQUIRED' USING ERRCODE='42501'; END IF;
     INSERT INTO public.social_community_moderators(course_id,user_id,assigned_by) VALUES(_course,target,actor) ON CONFLICT DO NOTHING;
   ELSE
     DELETE FROM public.social_community_moderators WHERE course_id=_course AND user_id=target;
   END IF;
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed>0 THEN INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,correlation_id,reason)
      VALUES(actor,CASE WHEN enabled THEN 'community.moderator.assigned' ELSE 'community.moderator.revoked' END,'course',_course,target::text,reason); END IF;
   RETURN jsonb_build_object('enabled',enabled,'replayed',changed=0);
 END IF;
 IF NOT public.affiliation_eligible(actor) OR NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id=actor AND institution_id=school)
   THEN RAISE EXCEPTION 'COMMUNITY_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 -- Course lock ensures a leave/hide/revoke cannot race a write on that course.
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-course:'||_course::text,0));
 IF _action IN ('join','leave','status') THEN
   IF _input<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   IF _action='join' THEN INSERT INTO public.social_community_members(course_id,user_id,institution_id) VALUES(_course,actor,school) ON CONFLICT DO NOTHING;
   ELSIF _action='leave' THEN DELETE FROM public.social_community_members WHERE course_id=_course AND user_id=actor; END IF;
   RETURN jsonb_build_object('joined',student_social_private.joined_course(_course),'memberCount',(SELECT count(*) FROM public.social_community_members WHERE course_id=_course),
     'canModerate',EXISTS(SELECT 1 FROM public.social_community_moderators WHERE course_id=_course AND user_id=actor));
 END IF;
 IF NOT student_social_private.joined_course(_course) THEN RAISE EXCEPTION 'MEMBER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _action='post' THEN
   IF _input - ARRAY['text','creationKey','replyTo','topicId'] <> '{}'::jsonb OR jsonb_typeof(_input->'text') IS DISTINCT FROM 'string'
      OR jsonb_typeof(_input->'creationKey') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   message:=btrim(_input->>'text');key:=_input->>'creationKey';parent:=(_input->>'replyTo')::uuid;topic:=(_input->>'topicId')::uuid;
   IF length(message) NOT BETWEEN 3 AND 2000 OR key !~ '^[A-Za-z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   IF topic IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.course_topics WHERE id=topic AND course_id=_course) THEN RAISE EXCEPTION 'INVALID_TOPIC' USING ERRCODE='22023'; END IF;
   IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_community_posts p WHERE p.id=parent AND p.course_id=_course AND p.parent_id IS NULL AND p.hidden_at IS NULL)
      THEN RAISE EXCEPTION 'INVALID_REPLY' USING ERRCODE='22023'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('student-social-post:'||actor::text,0));
   SELECT * INTO previous FROM public.social_community_posts WHERE author_id=actor AND creation_key=key;
   IF FOUND THEN
     IF previous.course_id<>_course OR previous.body<>message OR previous.parent_id IS DISTINCT FROM parent OR previous.topic_id IS DISTINCT FROM topic
       THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
     IF previous.hidden_at IS NOT NULL THEN RAISE EXCEPTION 'POST_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
     RETURN jsonb_build_object('id',previous.id,'replayed',true);
   END IF;
   IF (SELECT count(*) FROM public.social_community_posts WHERE author_id=actor AND created_at>clock_timestamp()-interval '1 hour')>=15 THEN RAISE EXCEPTION 'POST_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
   INSERT INTO public.social_community_posts(course_id,author_id,topic_id,parent_id,body,creation_key) VALUES(_course,actor,topic,parent,message,key) RETURNING id INTO post;
   RETURN jsonb_build_object('id',post,'replayed',false);
 END IF;
 IF _action IN ('hide','report') THEN
   IF _input - ARRAY['postId','reason'] <> '{}'::jsonb OR jsonb_typeof(_input->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   post:=(_input->>'postId')::uuid;reason:=btrim(_input->>'reason');
   IF post IS NULL OR length(reason)<(CASE WHEN _action='hide' THEN 5 ELSE 10 END) OR length(reason)>1000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   IF _action='hide' AND NOT EXISTS(SELECT 1 FROM public.social_community_moderators WHERE course_id=_course AND user_id=actor)
      THEN RAISE EXCEPTION 'MODERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
   SELECT * INTO previous FROM public.social_community_posts WHERE id=post AND course_id=_course;
   IF NOT FOUND OR (_action='report' AND NOT student_social_private.visible_post(post,_course)) THEN RAISE EXCEPTION 'POST_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
   IF previous.author_id=actor THEN RAISE EXCEPTION 'CONFLICT_OF_INTEREST' USING ERRCODE='42501'; END IF;
   IF _action='hide' THEN
     UPDATE public.social_community_posts SET hidden_at=clock_timestamp() WHERE id=post AND hidden_at IS NULL;
     GET DIAGNOSTICS changed=ROW_COUNT;
     IF changed>0 THEN INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(actor,'community.moderator.post.hidden','community_post',post,reason); END IF;
     RETURN jsonb_build_object('id',post,'hidden',true,'replayed',changed=0);
   ELSE
     INSERT INTO public.social_community_reports(post_id,reporter_id,reason) VALUES(post,actor,reason) RETURNING id INTO target;
     RETURN jsonb_build_object('id',target);
   END IF;
 END IF;
 RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION student_social_private.report_queue(_kind text,_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF NOT student_social_private.active_session() OR NOT student_social_private.can_moderate_social(_kind) THEN RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _kind IS NULL OR _kind NOT IN('message','account','comment','community') OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF _kind IN('message','account') THEN
   SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."createdAt",q.id),'[]'::jsonb) INTO result FROM (
   SELECT r.id,r.reporter_id AS "reporterId",r.subject_id AS "subjectId",r.target_id AS "targetId",r.category,r.reason,r.created_at AS "createdAt",m.body
   FROM public.social_abuse_reports r LEFT JOIN public.social_messages m ON m.id=r.message_id
   WHERE r.kind=_kind AND r.status='open' ORDER BY r.created_at,r.id LIMIT _limit) q;
 ELSIF _kind='comment' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."createdAt",q.id),'[]'::jsonb) INTO result FROM (
   SELECT r.id,r.reporter_id AS "reporterId",p.author_id AS "subjectId",p.id AS "targetId",p.content_id AS "contentId",r.reason,r.created_at AS "createdAt",p.body
   FROM public.content_comment_reports r JOIN public.content_comments p ON p.id=r.comment_id WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT _limit) q;
 ELSE
   SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."createdAt",q.id),'[]'::jsonb) INTO result FROM (
   SELECT r.id,r.reporter_id AS "reporterId",p.author_id AS "subjectId",p.id AS "targetId",p.course_id AS "courseId",r.reason,r.created_at AS "createdAt",p.body
   FROM public.social_community_reports r JOIN public.social_community_posts p ON p.id=r.post_id WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT _limit) q;
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION student_social_private.review_report(_kind text,_id uuid,_decision text,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); item uuid; new_status text; changed integer;
BEGIN
 IF NOT student_social_private.active_session() OR NOT student_social_private.can_moderate_social(_kind) THEN RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _kind IS NULL OR _kind NOT IN('message','account','comment','community') OR _id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 5 AND 1000
 OR _decision IS NULL OR (_kind IN('message','account') AND _decision<>'review') OR (_kind IN('comment','community') AND _decision NOT IN('hide','dismiss'))
 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF _kind IN('message','account') THEN
   new_status:='reviewed';
   UPDATE public.social_abuse_reports SET status=new_status,reviewer_id=actor,review_note=btrim(_reason) WHERE id=_id AND kind=_kind AND status='open';
   GET DIAGNOSTICS changed=ROW_COUNT;
 ELSE
   new_status:=CASE WHEN _decision='hide' THEN 'hidden' ELSE 'dismissed' END;
   IF _kind='comment' THEN
     SELECT comment_id INTO item FROM public.content_comment_reports WHERE id=_id AND status='open' FOR UPDATE;
     IF item IS NULL THEN RAISE EXCEPTION 'REPORT_CONFLICT' USING ERRCODE='P0002'; END IF;
     IF _decision='hide' THEN UPDATE public.content_comments SET hidden_at=coalesce(hidden_at,clock_timestamp()) WHERE id=item; END IF;
     UPDATE public.content_comment_reports SET status=new_status,reviewed_by=actor,review_note=btrim(_reason)
      WHERE status='open' AND (id=_id OR (_decision='hide' AND comment_id=item));
   ELSE
     SELECT post_id INTO item FROM public.social_community_reports WHERE id=_id AND status='open' FOR UPDATE;
     IF item IS NULL THEN RAISE EXCEPTION 'REPORT_CONFLICT' USING ERRCODE='P0002'; END IF;
     IF _decision='hide' THEN UPDATE public.social_community_posts SET hidden_at=coalesce(hidden_at,clock_timestamp()) WHERE id=item; END IF;
     UPDATE public.social_community_reports SET status=new_status,reviewer_id=actor,review_note=btrim(_reason)
      WHERE status='open' AND (id=_id OR (_decision='hide' AND post_id=item));
   END IF;
   GET DIAGNOSTICS changed=ROW_COUNT;
 END IF;
 IF changed=0 THEN RAISE EXCEPTION 'REPORT_CONFLICT' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(actor,'social.report.'||new_status,'social_report',_id,btrim(_reason));
 RETURN jsonb_build_object('id',_id,'status',new_status);
END $$;

CREATE OR REPLACE FUNCTION student_social_private.session_state() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('userId',auth.uid(),'active',student_social_private.active_session(),
 'student',student_social_private.active_session() AND public.current_student_eligible(),
 'admin',(student_social_private.can_moderate_social('community') OR student_social_private.can_moderate_social('message')));
$$;

CREATE FUNCTION student_social_private.read_learning_notification(_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT student_social_private.active_session() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 UPDATE public.learning_notifications SET seen_at=coalesce(seen_at,now()) WHERE id=_id AND user_id=auth.uid();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION student_social_private.read_learning_notification(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.read_learning_notification(uuid) TO authenticated;
CREATE FUNCTION public.hosted_read_learning_notification(_id uuid) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.read_learning_notification(_id) $$;
REVOKE ALL ON FUNCTION public.hosted_read_learning_notification(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_read_learning_notification(uuid) TO authenticated;
