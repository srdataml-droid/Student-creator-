-- Week 4: creator-owned, independently scoped restriction changes.
-- Access cases are durable handoff records only. Never mutate financial journals,
-- refund orders or erase entitlements here; Week 5 owns their resolution.
BEGIN;
CREATE TABLE public.social_creator_access_review_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),creator_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
 viewer_id uuid NOT NULL REFERENCES public.student_profiles(user_id),entitlement_id uuid NOT NULL REFERENCES public.entitlements(id),
 content_id uuid NOT NULL REFERENCES public.content_items(id),order_id uuid NOT NULL REFERENCES public.orders(id),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(creator_id<>viewer_id)
);
CREATE UNIQUE INDEX social_creator_access_open ON public.social_creator_access_review_cases(entitlement_id) WHERE status='open';
ALTER TABLE public.social_creator_access_review_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_creator_access_review_cases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.social_creator_access_review_cases TO service_role;
CREATE FUNCTION student_social_private.set_restriction(_viewer uuid,_view boolean,_comment boolean,_message boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); old_view boolean:=false; old_comment boolean:=false; old_message boolean:=false; previous public.creator_restrictions%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _viewer IS NULL OR _viewer=actor OR _view IS NULL OR _comment IS NULL OR _message IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id=_viewer) THEN RAISE EXCEPTION 'INVALID_VIEWER' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-restriction:'||actor::text,0));
 -- Share the DM pair lock with send/block. Already-issued external playback
 -- tokens may remain valid until expiry; the existing creator view function
 -- denies subsequent authorization. Media token revocation is a Week 3 gate.
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-pair:'||least(actor,_viewer)::text||':'||greatest(actor,_viewer)::text,0));
 SELECT * INTO previous FROM public.creator_restrictions WHERE creator_id=actor AND viewer_id=_viewer;
 IF FOUND THEN old_view:=previous.deny_view;old_comment:=previous.deny_comment;old_message:=previous.deny_message; END IF;
 IF old_view=_view AND old_comment=_comment AND old_message=_message THEN RETURN jsonb_build_object('viewerId',_viewer,'view',_view,'comment',_comment,'message',_message,'replayed',true); END IF;
 IF (SELECT count(*) FROM public.audit_events WHERE actor_id=actor AND action='social.creator.restriction.changed' AND created_at>clock_timestamp()-interval '1 hour')>=60
 THEN RAISE EXCEPTION 'RESTRICTION_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
 IF NOT (_view OR _comment OR _message) THEN DELETE FROM public.creator_restrictions WHERE creator_id=actor AND viewer_id=_viewer;
 ELSE
 INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_view,deny_comment,deny_message,updated_at)
 VALUES(actor,_viewer,_view,_comment,_message,clock_timestamp())
 ON CONFLICT(creator_id,viewer_id) DO UPDATE SET deny_view=excluded.deny_view,deny_comment=excluded.deny_comment,deny_message=excluded.deny_message,updated_at=excluded.updated_at;
 END IF;
 IF _view AND NOT old_view THEN
   INSERT INTO public.social_creator_access_review_cases(creator_id,viewer_id,entitlement_id,content_id,order_id)
   SELECT actor,_viewer,e.id,e.content_id,e.order_id FROM public.entitlements e JOIN public.content_items c ON c.id=e.content_id
   JOIN public.orders o ON o.id=e.order_id AND o.buyer_id=e.buyer_id AND o.content_id=e.content_id
   WHERE c.creator_id=actor AND e.buyer_id=_viewer AND e.state='active' AND o.status='paid'
   ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason)
 VALUES(actor,'social.creator.restriction.changed','student_profile',_viewer,
 jsonb_build_object('oldView',old_view,'oldComment',old_comment,'oldMessage',old_message,'view',_view,'comment',_comment,'message',_message)::text);
 RETURN jsonb_build_object('viewerId',_viewer,'view',_view,'comment',_comment,'message',_message,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION student_social_private.set_restriction(uuid,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.set_restriction(uuid,boolean,boolean,boolean) TO authenticated;
CREATE FUNCTION public.social_set_creator_restriction(_viewer uuid,_view boolean,_comment boolean,_message boolean)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.set_restriction(_viewer,_view,_comment,_message);
$$;
REVOKE ALL ON FUNCTION public.social_set_creator_restriction(uuid,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_set_creator_restriction(uuid,boolean,boolean,boolean) TO authenticated;
COMMIT;
