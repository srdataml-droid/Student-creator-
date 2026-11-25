-- Week 4 in-app notifications. Durable transaction-local events; no email/push provider.
BEGIN;
CREATE TABLE public.social_notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
 messages boolean NOT NULL DEFAULT true,social boolean NOT NULL DEFAULT true,community boolean NOT NULL DEFAULT true
);
CREATE TABLE public.social_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('message','follow','like','comment','community_reply')),
 event_id uuid NOT NULL,target_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),read_at timestamptz,
 UNIQUE(recipient_id,actor_id,kind,event_id), CHECK(recipient_id<>actor_id)
);
CREATE INDEX social_notifications_inbox ON public.social_notifications(recipient_id,created_at DESC,id DESC);
ALTER TABLE public.social_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_notification_preferences,public.social_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.social_notification_preferences TO authenticated;
GRANT SELECT(id,kind,target_id,created_at,read_at) ON public.social_notifications TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.social_notification_preferences,public.social_notifications TO service_role;
CREATE POLICY own_notification_preferences ON public.social_notification_preferences FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) AND public.current_student_eligible());
CREATE FUNCTION student_social_private.notification_visible(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.current_student_eligible() AND EXISTS(
 SELECT 1 FROM public.social_notifications n WHERE n.id=_id AND n.recipient_id=auth.uid()
 AND CASE n.kind
 WHEN 'community_reply' THEN student_social_private.visible_post(n.event_id,n.target_id)
 WHEN 'comment' THEN student_social_private.comment_visible(n.event_id,n.target_id)
 WHEN 'like' THEN public.can_view_published_content(n.target_id)
 ELSE true END
 );
$$;
REVOKE ALL ON FUNCTION student_social_private.notification_visible(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.notification_visible(uuid) TO authenticated;
CREATE POLICY own_visible_notifications ON public.social_notifications FOR SELECT TO authenticated USING(student_social_private.notification_visible(id));

CREATE FUNCTION student_social_private.emit_notification(_recipient uuid,_actor uuid,_kind text,_event uuid,_target uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE enabled boolean;
BEGIN
 IF _recipient IS NULL OR _recipient=_actor OR NOT public.affiliation_eligible(_recipient) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.social_contact_blocks b WHERE (b.blocker_id=_recipient AND b.blocked_id=_actor) OR (b.blocker_id=_actor AND b.blocked_id=_recipient)) THEN RETURN; END IF;
 SELECT CASE _kind WHEN 'message' THEN p.messages WHEN 'community_reply' THEN p.community ELSE p.social END INTO enabled
 FROM public.social_notification_preferences p WHERE p.user_id=_recipient;
 IF enabled=false THEN RETURN; END IF;
 INSERT INTO public.social_notifications(recipient_id,actor_id,kind,event_id,target_id)
 VALUES(_recipient,_actor,_kind,_event,_target) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION student_social_private.emit_notification(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION student_social_private.notification_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid; parent_author uuid;
BEGIN
 IF TG_TABLE_NAME='social_messages' THEN
   PERFORM student_social_private.emit_notification(NEW.recipient_id,NEW.sender_id,'message',NEW.id,NEW.sender_id);
 ELSIF TG_TABLE_NAME='social_creator_follows' THEN
   PERFORM student_social_private.emit_notification(NEW.creator_id,NEW.follower_id,'follow',NEW.creator_id,NEW.creator_id);
 ELSIF TG_TABLE_NAME='content_likes' THEN
   SELECT creator_id INTO owner_id FROM public.content_items WHERE id=NEW.content_id;
   PERFORM student_social_private.emit_notification(owner_id,NEW.user_id,'like',NEW.content_id,NEW.content_id);
 ELSIF TG_TABLE_NAME='content_comments' THEN
   SELECT creator_id INTO owner_id FROM public.content_items WHERE id=NEW.content_id;
   PERFORM student_social_private.emit_notification(owner_id,NEW.author_id,'comment',NEW.id,NEW.content_id);
   IF NEW.parent_id IS NOT NULL THEN
     SELECT author_id INTO parent_author FROM public.content_comments WHERE id=NEW.parent_id;
     IF parent_author IS DISTINCT FROM owner_id THEN
       PERFORM student_social_private.emit_notification(parent_author,NEW.author_id,'comment',NEW.id,NEW.content_id);
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='social_community_posts' AND NEW.parent_id IS NOT NULL THEN
   SELECT author_id INTO parent_author FROM public.social_community_posts WHERE id=NEW.parent_id;
   IF EXISTS(SELECT 1 FROM public.social_community_members WHERE course_id=NEW.course_id AND user_id=parent_author) THEN
     PERFORM student_social_private.emit_notification(parent_author,NEW.author_id,'community_reply',NEW.id,NEW.course_id);
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION student_social_private.notification_trigger() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER social_notify_message AFTER INSERT ON public.social_messages FOR EACH ROW EXECUTE FUNCTION student_social_private.notification_trigger();
CREATE TRIGGER social_notify_follow AFTER INSERT ON public.social_creator_follows FOR EACH ROW EXECUTE FUNCTION student_social_private.notification_trigger();
CREATE TRIGGER social_notify_like AFTER INSERT ON public.content_likes FOR EACH ROW EXECUTE FUNCTION student_social_private.notification_trigger();
CREATE TRIGGER social_notify_comment AFTER INSERT ON public.content_comments FOR EACH ROW EXECUTE FUNCTION student_social_private.notification_trigger();
CREATE TRIGGER social_notify_community_reply AFTER INSERT ON public.social_community_posts FOR EACH ROW EXECUTE FUNCTION student_social_private.notification_trigger();
CREATE FUNCTION student_social_private.notification_action(_action text,_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); item uuid; changed integer; result jsonb;
BEGIN
 IF actor IS NULL OR NOT public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _input IS NULL OR jsonb_typeof(_input)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF _action='preferences' THEN
   IF _input<>'{}'::jsonb THEN
     IF _input - ARRAY['messages','social','community']<>'{}'::jsonb OR jsonb_typeof(_input->'messages') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(_input->'social') IS DISTINCT FROM 'boolean' OR jsonb_typeof(_input->'community') IS DISTINCT FROM 'boolean'
       THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
     INSERT INTO public.social_notification_preferences(user_id,messages,social,community) VALUES(actor,(_input->>'messages')::boolean,(_input->>'social')::boolean,(_input->>'community')::boolean)
     ON CONFLICT(user_id) DO UPDATE SET messages=excluded.messages,social=excluded.social,community=excluded.community;
   END IF;
   SELECT jsonb_build_object('messages',messages,'social',social,'community',community) INTO result FROM public.social_notification_preferences WHERE user_id=actor;
   RETURN coalesce(result,'{"messages":true,"social":true,"community":true}'::jsonb);
 END IF;
 IF _action='read' THEN
   IF _input - ARRAY['id']<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   item:=(_input->>'id')::uuid;
   IF item IS NULL OR NOT student_social_private.notification_visible(item) THEN RAISE EXCEPTION 'NOTIFICATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
   UPDATE public.social_notifications SET read_at=clock_timestamp() WHERE id=item AND recipient_id=actor AND read_at IS NULL;
   GET DIAGNOSTICS changed=ROW_COUNT;
   RETURN jsonb_build_object('marked',changed);
 END IF;
 RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION student_social_private.notification_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.notification_action(text,jsonb) TO authenticated;
CREATE FUNCTION public.social_notification_action(_action text,_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.notification_action(_action,_input);
$$;
REVOKE ALL ON FUNCTION public.social_notification_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_notification_action(text,jsonb) TO authenticated;
COMMIT;
