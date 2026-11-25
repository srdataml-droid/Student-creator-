-- Week 4: course-scoped communities, private member lists, audited moderation.
-- Apply only to disposable CI after hosted-messaging.sql; hosted deployment requires review.
BEGIN;
CREATE TABLE public.social_community_members (
 course_id uuid NOT NULL, user_id uuid NOT NULL, institution_id uuid NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(course_id,user_id),
 FOREIGN KEY(course_id,institution_id) REFERENCES public.courses(id,institution_id),
 FOREIGN KEY(user_id,institution_id) REFERENCES public.student_profiles(user_id,institution_id) ON DELETE CASCADE
);
CREATE TABLE public.social_community_moderators (
 course_id uuid NOT NULL,user_id uuid NOT NULL,assigned_by uuid NOT NULL REFERENCES auth.users(id),
 assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(course_id,user_id),
 FOREIGN KEY(course_id,user_id) REFERENCES public.social_community_members(course_id,user_id) ON DELETE CASCADE
);
CREATE TABLE public.social_community_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid NOT NULL REFERENCES public.courses(id),
 author_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
 topic_id uuid,parent_id uuid,body text NOT NULL CHECK(length(btrim(body)) BETWEEN 3 AND 2000),
 creation_key text NOT NULL CHECK(creation_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),hidden_at timestamptz,
 UNIQUE(author_id,creation_key),UNIQUE(id,course_id),
 FOREIGN KEY(topic_id,course_id) REFERENCES public.course_topics(id,course_id),
 FOREIGN KEY(parent_id,course_id) REFERENCES public.social_community_posts(id,course_id)
);
CREATE INDEX social_community_post_feed ON public.social_community_posts(course_id,created_at DESC,id DESC);
CREATE INDEX social_community_post_quota ON public.social_community_posts(author_id,created_at DESC);
CREATE TABLE public.social_community_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),post_id uuid NOT NULL REFERENCES public.social_community_posts(id),
 reporter_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','hidden','dismissed')),
 reviewer_id uuid REFERENCES auth.users(id),review_note text,
 UNIQUE(post_id,reporter_id)
);
ALTER TABLE public.social_community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_community_moderators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_community_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_community_members,public.social_community_moderators,public.social_community_posts,public.social_community_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.social_community_members,public.social_community_moderators TO authenticated;
GRANT SELECT(id,course_id,author_id,topic_id,parent_id,body,created_at) ON public.social_community_posts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.social_community_members,public.social_community_moderators,public.social_community_posts,public.social_community_reports TO service_role;
CREATE FUNCTION student_social_private.joined_course(_course uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT student_social_private.active_session() AND public.current_student_eligible() AND EXISTS(
 SELECT 1 FROM public.social_community_members m JOIN public.courses c ON c.id=m.course_id
 WHERE m.user_id=auth.uid() AND m.course_id=_course AND c.active
 );
$$;
CREATE FUNCTION student_social_private.visible_post(_post uuid,_course uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT student_social_private.joined_course(_course) AND EXISTS(
 SELECT 1 FROM public.social_community_posts p WHERE p.id=_post AND p.course_id=_course AND p.hidden_at IS NULL
 AND (p.parent_id IS NULL OR EXISTS(SELECT 1 FROM public.social_community_posts parent WHERE parent.id=p.parent_id AND parent.course_id=_course AND parent.hidden_at IS NULL))
 );
$$;
REVOKE ALL ON FUNCTION student_social_private.joined_course(uuid),student_social_private.visible_post(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.joined_course(uuid),student_social_private.visible_post(uuid,uuid) TO authenticated;
CREATE POLICY own_community_membership ON public.social_community_members FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) AND student_social_private.joined_course(course_id));
CREATE POLICY own_community_role ON public.social_community_moderators FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) AND student_social_private.joined_course(course_id));
CREATE POLICY joined_visible_posts ON public.social_community_posts FOR SELECT TO authenticated USING(student_social_private.visible_post(id,course_id));

CREATE FUNCTION student_social_private.community_action(_action text,_course uuid,_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); school uuid; target uuid; post uuid; parent uuid; topic uuid; message text; key text; reason text; previous public.social_community_posts%ROWTYPE; changed integer; enabled boolean; staff boolean;
BEGIN
 IF NOT student_social_private.active_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _course IS NULL OR _input IS NULL OR jsonb_typeof(_input)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT c.institution_id INTO school FROM public.courses c WHERE c.id=_course AND c.active;
 IF school IS NULL THEN RAISE EXCEPTION 'COMMUNITY_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 staff:=EXISTS(SELECT 1 FROM public.platform_staff WHERE user_id=actor AND role='admin' AND active);
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
REVOKE ALL ON FUNCTION student_social_private.community_action(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.community_action(text,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.social_community_action(_action text,_course uuid,_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.community_action(_action,_course,_input);
$$;
REVOKE ALL ON FUNCTION public.social_community_action(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_community_action(text,uuid,jsonb) TO authenticated;
COMMIT;
