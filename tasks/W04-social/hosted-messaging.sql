-- Week 4 hosted text-message contract. Disposable CI only until integration review.
-- No browser mutation grants; public RPC is invoker-only, private function validates auth.uid().
BEGIN;
CREATE SCHEMA student_social_private;
REVOKE ALL ON SCHEMA student_social_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA student_social_private TO authenticated;

-- Signed bearer must refer to an existing, current session for its own subject.
CREATE FUNCTION student_social_private.active_session() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT student_creators_private.current_session_active();
$$;
REVOKE ALL ON FUNCTION student_social_private.active_session() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.active_session() TO authenticated;

CREATE TABLE public.social_message_preferences (
 user_id uuid PRIMARY KEY REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
 allow_messages boolean NOT NULL DEFAULT false
);
CREATE TABLE public.social_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sender_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
 recipient_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(sender_id<>recipient_id)
);
CREATE INDEX social_messages_sender ON public.social_messages(sender_id,created_at DESC,id DESC);
CREATE INDEX social_messages_recipient ON public.social_messages(recipient_id,created_at DESC,id DESC);
CREATE TABLE public.social_message_reads (
 message_id uuid PRIMARY KEY REFERENCES public.social_messages(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
 read_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.social_contact_blocks (
 blocker_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
 blocked_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id<>blocked_id)
);
ALTER TABLE public.social_message_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_contact_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_message_preferences,public.social_messages,public.social_message_reads,public.social_contact_blocks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.social_message_preferences,public.social_messages,public.social_message_reads,public.social_contact_blocks TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.social_message_preferences,public.social_messages,public.social_message_reads,public.social_contact_blocks TO service_role;
CREATE POLICY own_message_preferences ON public.social_message_preferences FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) AND public.current_student_eligible());
CREATE POLICY own_messages ON public.social_messages FOR SELECT TO authenticated USING((sender_id=(SELECT auth.uid()) OR recipient_id=(SELECT auth.uid())) AND public.current_student_eligible());
CREATE POLICY own_read_state ON public.social_message_reads FOR SELECT TO authenticated USING(recipient_id=(SELECT auth.uid()) AND public.current_student_eligible());
CREATE POLICY own_contact_blocks ON public.social_contact_blocks FOR SELECT TO authenticated USING(blocker_id=(SELECT auth.uid()) AND public.current_student_eligible());

-- Private function is not exposed to the Data API. The public invoker wrapper
-- accepts no sender/recipient-of-read identity: every mutation uses auth.uid().
CREATE FUNCTION student_social_private.message_action(_action text,_peer uuid,_body text,_enabled boolean,_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid := auth.uid(); mid uuid; changed integer; at_time timestamptz; contact boolean;
BEGIN
 IF NOT student_social_private.active_session() OR NOT public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _action='preference' THEN
   IF _enabled IS NULL OR _peer IS NOT NULL OR _body IS NOT NULL OR _ids IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   INSERT INTO public.social_message_preferences(user_id,allow_messages) VALUES(actor,_enabled)
   ON CONFLICT(user_id) DO UPDATE SET allow_messages=excluded.allow_messages;
   RETURN jsonb_build_object('allowMessages',_enabled);
 END IF;
 IF _peer IS NULL OR _peer=actor THEN RAISE EXCEPTION 'INVALID_PEER' USING ERRCODE='22023'; END IF;
 IF _action='read' THEN
   IF _ids IS NULL OR cardinality(_ids) NOT BETWEEN 1 AND 100 OR _body IS NOT NULL OR _enabled IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(_ids) AS x)<>cardinality(_ids) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   IF (SELECT count(*) FROM public.social_messages m WHERE m.id=ANY(_ids) AND m.sender_id=_peer AND m.recipient_id=actor)<>cardinality(_ids)
     THEN RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
   INSERT INTO public.social_message_reads(message_id,recipient_id) SELECT x,actor FROM unnest(_ids) AS x ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS changed=ROW_COUNT;
   RETURN jsonb_build_object('marked',changed);
 END IF;
 -- The same pair lock serializes message send and contact block/unblock.
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-pair:'||least(actor,_peer)::text||':'||greatest(actor,_peer)::text,0));
 SELECT EXISTS(SELECT 1 FROM public.social_messages m WHERE (m.sender_id=actor AND m.recipient_id=_peer) OR (m.sender_id=_peer AND m.recipient_id=actor)) INTO contact;
 IF _action IN ('block','unblock') THEN
   IF _body IS NOT NULL OR _enabled IS NOT NULL OR _ids IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   IF _action='block' THEN
     IF NOT contact AND NOT public.creator_has_approved_public_work(_peer) THEN RAISE EXCEPTION 'CONTACT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
     INSERT INTO public.social_contact_blocks(blocker_id,blocked_id) VALUES(actor,_peer) ON CONFLICT DO NOTHING;
   ELSE
     DELETE FROM public.social_contact_blocks WHERE blocker_id=actor AND blocked_id=_peer;
   END IF;
   RETURN jsonb_build_object('blocked',_action='block');
 END IF;
 IF _action IS DISTINCT FROM 'send' OR _body IS NULL OR length(btrim(_body)) NOT BETWEEN 1 AND 2000 OR _enabled IS NOT NULL OR _ids IS NOT NULL
   THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF NOT public.affiliation_eligible(_peer) OR EXISTS(SELECT 1 FROM public.creator_restrictions r WHERE r.creator_id=_peer AND r.viewer_id=actor AND r.deny_message)
   OR EXISTS(SELECT 1 FROM public.social_contact_blocks b WHERE (b.blocker_id=actor AND b.blocked_id=_peer) OR (b.blocker_id=_peer AND b.blocked_id=actor))
   OR NOT (EXISTS(SELECT 1 FROM public.social_messages m WHERE m.sender_id=_peer AND m.recipient_id=actor)
     OR (public.creator_has_approved_public_work(_peer) AND EXISTS(SELECT 1 FROM public.social_message_preferences p WHERE p.user_id=_peer AND p.allow_messages)))
   THEN RAISE EXCEPTION 'RECIPIENT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 -- Separate sender lock prevents concurrent sends to different peers bypassing quota.
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-sender:'||actor::text,0));
 IF (SELECT count(*) FROM public.social_messages m WHERE m.sender_id=actor AND m.created_at>clock_timestamp()-interval '1 hour')>=30
   THEN RAISE EXCEPTION 'MESSAGE_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.social_messages(sender_id,recipient_id,body) VALUES(actor,_peer,btrim(_body)) RETURNING id,created_at INTO mid,at_time;
 RETURN jsonb_build_object('id',mid,'senderId',actor,'recipientId',_peer,'body',btrim(_body),'createdAt',at_time);
END $$;
REVOKE ALL ON FUNCTION student_social_private.message_action(text,uuid,text,boolean,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.message_action(text,uuid,text,boolean,uuid[]) TO authenticated;
CREATE FUNCTION public.social_message_action(_action text,_peer uuid DEFAULT NULL,_body text DEFAULT NULL,_enabled boolean DEFAULT NULL,_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.message_action(_action,_peer,_body,_enabled,_ids);
$$;
REVOKE ALL ON FUNCTION public.social_message_action(text,uuid,text,boolean,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_message_action(text,uuid,text,boolean,uuid[]) TO authenticated;
COMMIT;
