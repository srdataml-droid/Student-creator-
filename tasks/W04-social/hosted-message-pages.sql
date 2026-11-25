-- Week 4 read-only hosted DM paging, RLS enforced by SECURITY INVOKER.
BEGIN;
CREATE FUNCTION public.social_thread_page(_peer uuid,_before uuid DEFAULT NULL,_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); cursor_at timestamptz; result jsonb;
BEGIN
 IF NOT student_social_private.active_session() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _peer IS NULL OR _peer=actor OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF _before IS NOT NULL THEN
  SELECT created_at INTO cursor_at FROM public.social_messages WHERE id=_before AND ((sender_id=actor AND recipient_id=_peer) OR (sender_id=_peer AND recipient_id=actor));
  IF cursor_at IS NULL THEN RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 END IF;
 WITH rows AS (
  SELECT m.id,m.sender_id,m.recipient_id,m.body,m.created_at FROM public.social_messages m
  WHERE ((m.sender_id=actor AND m.recipient_id=_peer) OR (m.sender_id=_peer AND m.recipient_id=actor))
   AND (_before IS NULL OR (m.created_at,m.id)<(cursor_at,_before))
  ORDER BY m.created_at DESC,m.id DESC LIMIT _limit+1
 ), page AS (SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT _limit)
 SELECT jsonb_build_object('messages',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'senderId',sender_id,'recipientId',recipient_id,'body',body,'createdAt',created_at) ORDER BY created_at,id) FROM page),'[]'::jsonb),
 'nextBefore',CASE WHEN (SELECT count(*) FROM rows)>_limit THEN (SELECT id FROM page ORDER BY created_at,id LIMIT 1) ELSE NULL END,
 'blocked',EXISTS(SELECT 1 FROM public.social_contact_blocks WHERE blocker_id=actor AND blocked_id=_peer)) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.social_inbox_page(_before uuid DEFAULT NULL,_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); cursor_at timestamptz; result jsonb;
BEGIN
 IF NOT student_social_private.active_session() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF _before IS NOT NULL THEN
  SELECT max(created_at) INTO cursor_at FROM public.social_messages WHERE (sender_id=actor AND recipient_id=_before) OR (sender_id=_before AND recipient_id=actor);
  IF cursor_at IS NULL THEN RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 END IF;
 WITH grouped AS (
 SELECT CASE WHEN m.sender_id=actor THEN m.recipient_id ELSE m.sender_id END AS peer,
 max(m.created_at) AS last_at,count(*) FILTER(WHERE m.recipient_id=actor AND NOT EXISTS(SELECT 1 FROM public.social_message_reads r WHERE r.message_id=m.id AND r.recipient_id=actor)) AS unread
 FROM public.social_messages m WHERE m.sender_id=actor OR m.recipient_id=actor GROUP BY 1
 ), rows AS (
 SELECT * FROM grouped WHERE _before IS NULL OR last_at<cursor_at OR (last_at=cursor_at AND peer>_before)
 ORDER BY last_at DESC,peer LIMIT _limit+1
 ), page AS (SELECT * FROM rows ORDER BY last_at DESC,peer LIMIT _limit)
 SELECT jsonb_build_object('inbox',coalesce((SELECT jsonb_agg(jsonb_build_object('peerId',peer,'lastMessageAt',last_at,'unreadCount',unread) ORDER BY last_at DESC,peer) FROM page),'[]'::jsonb),
 'nextBefore',CASE WHEN (SELECT count(*) FROM rows)>_limit THEN (SELECT peer FROM page ORDER BY last_at,peer DESC LIMIT 1) ELSE NULL END) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.social_thread_page(uuid,uuid,integer),public.social_inbox_page(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_thread_page(uuid,uuid,integer),public.social_inbox_page(uuid,integer) TO authenticated;
COMMIT;
