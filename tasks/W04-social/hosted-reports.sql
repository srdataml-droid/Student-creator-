-- Week 4 hosted abuse reports, independent staff review. No automatic punishment.
BEGIN;
CREATE TABLE public.social_abuse_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN('message','account')),
 reporter_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
 subject_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
 target_id uuid NOT NULL, message_id uuid REFERENCES public.social_messages(id),
 category text NOT NULL CHECK(category IN('harassment','impersonation','spam','other')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewed')),
 reviewer_id uuid REFERENCES auth.users(id),review_note text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(reporter_id<>subject_id),
 CHECK((kind='account' AND message_id IS NULL AND target_id=subject_id) OR (kind='message' AND message_id IS NOT NULL AND target_id=message_id))
);
CREATE UNIQUE INDEX social_abuse_open_unique ON public.social_abuse_reports(reporter_id,kind,target_id) WHERE status='open';
CREATE UNIQUE INDEX social_abuse_message_unique ON public.social_abuse_reports(reporter_id,message_id) WHERE kind='message';
CREATE INDEX social_abuse_reporter_quota ON public.social_abuse_reports(reporter_id,created_at DESC);
ALTER TABLE public.social_abuse_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_abuse_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.social_abuse_reports TO service_role;
CREATE FUNCTION student_social_private.abuse_report(_kind text,_target uuid,_category text,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); subject uuid; message uuid; item uuid;
BEGIN
 IF actor IS NULL OR NOT public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _kind IS NULL OR _kind NOT IN('message','account') OR _target IS NULL OR _category IS NULL OR _category NOT IN('harassment','impersonation','spam','other')
 OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF _kind='message' THEN
   SELECT sender_id,id INTO subject,message FROM public.social_messages WHERE id=_target AND recipient_id=actor;
 ELSE
   IF _target=actor THEN RAISE EXCEPTION 'CANNOT_REPORT_SELF' USING ERRCODE='42501'; END IF;
   SELECT user_id INTO subject FROM public.student_profiles WHERE user_id=_target AND
   (public.creator_has_approved_public_work(_target) OR EXISTS(SELECT 1 FROM public.social_messages m WHERE (m.sender_id=actor AND m.recipient_id=_target) OR (m.sender_id=_target AND m.recipient_id=actor)));
 END IF;
 IF subject IS NULL THEN RAISE EXCEPTION 'REPORT_TARGET_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-report:'||actor::text,0));
 IF (SELECT count(*) FROM public.social_abuse_reports WHERE reporter_id=actor AND created_at>clock_timestamp()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'REPORT_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.social_abuse_reports(kind,reporter_id,subject_id,target_id,message_id,category,reason) VALUES(_kind,actor,subject,_target,message,_category,btrim(_reason)) RETURNING id INTO item;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'social.abuse.reported','social_report',item);
 RETURN jsonb_build_object('id',item);
END $$;
REVOKE ALL ON FUNCTION student_social_private.abuse_report(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.abuse_report(text,uuid,text,text) TO authenticated;
CREATE FUNCTION public.social_abuse_report(_kind text,_target uuid,_category text,_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.abuse_report(_kind,_target,_category,_reason);
$$;
REVOKE ALL ON FUNCTION public.social_abuse_report(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_abuse_report(text,uuid,text,text) TO authenticated;

CREATE FUNCTION student_social_private.report_queue(_kind text,_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.platform_staff WHERE user_id=actor AND role='admin' AND active) THEN RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
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
REVOKE ALL ON FUNCTION student_social_private.report_queue(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.report_queue(text,integer) TO authenticated;
CREATE FUNCTION public.social_report_queue(_kind text,_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.report_queue(_kind,_limit);
$$;
REVOKE ALL ON FUNCTION public.social_report_queue(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_report_queue(text,integer) TO authenticated;

CREATE FUNCTION student_social_private.review_report(_kind text,_id uuid,_decision text,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); item uuid; new_status text; changed integer;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.platform_staff WHERE user_id=actor AND role='admin' AND active) THEN RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
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
REVOKE ALL ON FUNCTION student_social_private.review_report(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.review_report(text,uuid,text,text) TO authenticated;
CREATE FUNCTION public.social_review_report(_kind text,_id uuid,_decision text,_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.review_report(_kind,_id,_decision,_reason);
$$;
REVOKE ALL ON FUNCTION public.social_review_report(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_review_report(text,uuid,text,text) TO authenticated;
COMMIT;
