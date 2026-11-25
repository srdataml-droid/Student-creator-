-- Week 4 hosted discovery and following. Disposable PostgreSQL contract only.
BEGIN;
CREATE TABLE public.social_creator_follows (
 follower_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
 creator_id uuid NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(follower_id,creator_id), CHECK(follower_id<>creator_id)
);
CREATE INDEX social_creator_follows_creator ON public.social_creator_follows(creator_id);
ALTER TABLE public.social_creator_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_creator_follows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.social_creator_follows TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.social_creator_follows TO service_role;
CREATE POLICY own_social_follows ON public.social_creator_follows FOR SELECT TO authenticated
 USING(follower_id=(SELECT auth.uid()) AND public.current_student_eligible());

CREATE FUNCTION student_social_private.preview_allowed(_creator uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT student_social_private.active_session() AND public.affiliation_eligible(_creator)
 AND NOT EXISTS(SELECT 1 FROM public.creator_restrictions WHERE creator_id=_creator AND viewer_id=auth.uid() AND deny_view);
$$;
REVOKE ALL ON FUNCTION student_social_private.preview_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.preview_allowed(uuid) TO authenticated;
-- Keep own draft access and existing anonymous public-preview contract.
-- Authenticated blocked viewers cannot bypass discovery via the raw catalog.
DROP POLICY published_or_own_metadata_authenticated ON public.content_items;
CREATE POLICY published_or_own_metadata_authenticated ON public.content_items FOR SELECT TO authenticated
 USING(creator_id=(SELECT auth.uid()) OR (status='published' AND student_social_private.preview_allowed(creator_id)
 AND EXISTS(SELECT 1 FROM public.courses WHERE id=course_id AND active)));

CREATE FUNCTION student_social_private.follow_action(_creator uuid,_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); changed integer;
BEGIN
 IF NOT student_social_private.active_session() OR NOT public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _creator IS NULL OR _creator=actor OR _enabled IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('student-social-follow:'||actor::text,0));
 IF NOT _enabled THEN
   DELETE FROM public.social_creator_follows WHERE follower_id=actor AND creator_id=_creator;
 ELSE
   IF NOT student_social_private.preview_allowed(_creator) OR NOT public.creator_has_approved_public_work(_creator)
     THEN RAISE EXCEPTION 'CREATOR_UNAVAILABLE' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.social_creator_follows WHERE follower_id=actor AND creator_id=_creator)
     THEN RETURN jsonb_build_object('following',true,'replayed',true); END IF;
   IF (SELECT count(*) FROM public.audit_events WHERE actor_id=actor AND action='social.creator.followed' AND created_at>clock_timestamp()-interval '1 hour')>=60
     THEN RAISE EXCEPTION 'FOLLOW_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
   INSERT INTO public.social_creator_follows(follower_id,creator_id) VALUES(actor,_creator) ON CONFLICT DO NOTHING;
 END IF;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN INSERT INTO public.audit_events(actor_id,action,target_kind,target_id)
 VALUES(actor,CASE WHEN _enabled THEN 'social.creator.followed' ELSE 'social.creator.unfollowed' END,'creator',_creator); END IF;
 RETURN jsonb_build_object('following',_enabled,'replayed',changed=0);
END $$;
REVOKE ALL ON FUNCTION student_social_private.follow_action(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.follow_action(uuid,boolean) TO authenticated;
CREATE FUNCTION public.social_follow_action(_creator uuid,_enabled boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.follow_action(_creator,_enabled);
$$;
REVOKE ALL ON FUNCTION public.social_follow_action(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_follow_action(uuid,boolean) TO authenticated;

CREATE FUNCTION student_social_private.discover(_mode text,_q text,_institution uuid,_course uuid,_topic uuid,_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); school uuid; result jsonb; term text;
BEGIN
 IF NOT student_social_private.active_session() OR NOT public.affiliation_eligible(actor) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _mode IS NULL OR _mode NOT IN ('all','following','creators') OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 OR _q IS NULL
 OR length(btrim(_q))>80 OR length(btrim(_q))=1 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT institution_id INTO school FROM public.student_profiles WHERE user_id=actor;
 IF _course IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.courses c WHERE c.id=_course AND c.active AND (_institution IS NULL OR c.institution_id=_institution))
 THEN RAISE EXCEPTION 'INVALID_FILTER' USING ERRCODE='22023'; END IF;
 IF _topic IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.course_topics t JOIN public.courses c ON c.id=t.course_id WHERE t.id=_topic AND c.active
 AND (_course IS NULL OR c.id=_course) AND (_institution IS NULL OR c.institution_id=_institution))
 THEN RAISE EXCEPTION 'INVALID_FILTER' USING ERRCODE='22023'; END IF;
 term:=lower(btrim(_q));
 IF _mode='creators' AND left(term,1)='@' THEN term:=substr(term,2); END IF;
 WITH visible AS (
 SELECT ci.id,ci.creator_id,ci.institution_id,ci.course_id,ci.topic_id,ci.title,ci.description,ci.preview_text,ci.published_at,
 c.code AS course_code,c.title AS course_title,i.name AS institution_name,p.handle,p.display_name,p.bio,
 EXISTS(SELECT 1 FROM public.social_creator_follows f WHERE f.follower_id=actor AND f.creator_id=ci.creator_id) AS followed
 FROM public.content_items ci JOIN public.courses c ON c.id=ci.course_id JOIN public.institutions i ON i.id=ci.institution_id
 LEFT JOIN public.creator_public_profiles p ON p.user_id=ci.creator_id
 WHERE ci.status='published' AND c.active AND i.active AND student_social_private.preview_allowed(ci.creator_id)
 AND (_institution IS NULL OR ci.institution_id=_institution) AND (_course IS NULL OR ci.course_id=_course) AND (_topic IS NULL OR ci.topic_id=_topic)
 AND (term='' OR strpos(lower(concat_ws(' ',ci.title,ci.description,ci.preview_text,c.code,c.title,i.name,p.handle,p.display_name)),term)>0)
 ), ranked AS (
 SELECT v.* FROM visible v WHERE _mode<>'following' OR v.followed
 ), creators AS (
 SELECT DISTINCT ON (v.creator_id) v.creator_id,v.institution_id,v.institution_name,v.handle,v.display_name,v.bio,v.published_at,v.followed
 FROM visible v ORDER BY v.creator_id,v.published_at DESC,v.id
 )
 SELECT CASE WHEN _mode='creators' THEN
  (SELECT COALESCE(jsonb_agg(x.payload ORDER BY x.campus_rank,x.follow_rank,x.published_at DESC,x.id),'[]'::jsonb) FROM (
    SELECT jsonb_build_object('id',v.creator_id,'handle',v.handle,'displayName',v.display_name,'bio',coalesce(v.bio,''),'institutionName',v.institution_name,'following',v.followed) AS payload,
    CASE WHEN v.institution_id=school THEN 0 ELSE 1 END AS campus_rank,CASE WHEN v.followed THEN 0 ELSE 1 END AS follow_rank,v.published_at,v.creator_id AS id
    FROM creators v ORDER BY campus_rank,follow_rank,v.published_at DESC,v.creator_id LIMIT _limit
  ) x)
 ELSE
  (SELECT COALESCE(jsonb_agg(x.payload ORDER BY x.campus_rank,x.follow_rank,x.published_at DESC,x.id),'[]'::jsonb) FROM (
    SELECT jsonb_build_object('id',v.id,'creatorId',v.creator_id,'institutionId',v.institution_id,'institutionName',v.institution_name,'courseId',v.course_id,'courseCode',v.course_code,'courseTitle',v.course_title,'topicId',v.topic_id,'title',v.title,'description',v.description,'previewText',v.preview_text,'publishedAt',v.published_at,'displayName',v.display_name,'handle',v.handle,'following',v.followed,
    'paid',EXISTS(SELECT 1 FROM public.listings li WHERE li.content_id=v.id),'priceKobo',(SELECT li.price_kobo FROM public.listings li WHERE li.content_id=v.id AND li.state='active' LIMIT 1)) AS payload,
    CASE WHEN v.institution_id=school THEN 0 ELSE 1 END AS campus_rank,CASE WHEN v.followed THEN 0 ELSE 1 END AS follow_rank,v.published_at,v.id
    FROM ranked v ORDER BY campus_rank,follow_rank,v.published_at DESC,v.id LIMIT _limit
  ) x) END INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.discover(text,text,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.discover(text,text,uuid,uuid,uuid,integer) TO authenticated;
CREATE FUNCTION public.social_discover(_mode text DEFAULT 'all',_q text DEFAULT '',_institution uuid DEFAULT NULL,_course uuid DEFAULT NULL,_topic uuid DEFAULT NULL,_limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.discover(_mode,_q,_institution,_course,_topic,_limit);
$$;
REVOKE ALL ON FUNCTION public.social_discover(text,text,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_discover(text,text,uuid,uuid,uuid,integer) TO authenticated;
COMMIT;
