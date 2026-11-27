-- Account-scoped activity analytics. Counts existing records, not inferred
-- watch duration, grades, mastery, historical removed likes or impression data.
CREATE INDEX IF NOT EXISTS wk_dashboard_likes_actor_time ON public.content_likes(user_id,created_at);
CREATE INDEX IF NOT EXISTS wk_dashboard_bookmarks_actor_time ON public.content_bookmarks(user_id,created_at);
CREATE INDEX IF NOT EXISTS wk_dashboard_comments_actor_time ON public.content_comments(author_id,created_at);
CREATE INDEX IF NOT EXISTS wk_dashboard_posts_actor_time ON public.social_community_posts(author_id,created_at);
CREATE INDEX IF NOT EXISTS wk_dashboard_presence_actor_time ON public.interactive_class_presence(user_id,created_at) WHERE kind='joined';
CREATE INDEX IF NOT EXISTS wk_dashboard_content_creator_time ON public.content_items(creator_id,published_at);
CREATE INDEX IF NOT EXISTS wk_dashboard_follow_actor_time ON public.social_creator_follows(follower_id,created_at);
CREATE INDEX IF NOT EXISTS wk_dashboard_follow_creator_time ON public.social_creator_follows(creator_id,created_at);
CREATE FUNCTION student_social_private.my_activity_dashboard(_days integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); today date:=(statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date; start_day date; end_day date; lower_bound timestamptz; upper_bound timestamptz; result jsonb;
BEGIN
 IF NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() OR actor IS NULL THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _days IS NULL OR _days NOT IN (7,28) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 start_day:=today-_days+1; end_day:=today+1;
 lower_bound:=start_day::timestamp AT TIME ZONE 'Africa/Lagos'; upper_bound:=end_day::timestamp AT TIME ZONE 'Africa/Lagos';
 WITH events AS (
 SELECT created_at AS at,'likes'::text AS metric,1::bigint AS n FROM public.content_likes WHERE user_id=actor AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT created_at,'saved',1 FROM public.content_bookmarks WHERE user_id=actor AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT created_at,'comments',1 FROM public.content_comments WHERE author_id=actor AND hidden_at IS NULL AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT created_at,'communityPosts',1 FROM public.social_community_posts WHERE author_id=actor AND hidden_at IS NULL AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT created_at,'following',1 FROM public.social_creator_follows WHERE follower_id=actor AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT min(p.created_at),'classesJoined',1 FROM public.interactive_class_presence p JOIN public.interactive_classes c ON c.id=p.class_id WHERE p.user_id=actor AND p.kind='joined' AND c.host_id<>actor AND p.created_at>=lower_bound AND p.created_at<upper_bound GROUP BY p.class_id
 UNION ALL SELECT published_at,'published',1 FROM public.content_items WHERE creator_id=actor AND status='published' AND published_at>=lower_bound AND published_at<upper_bound
 UNION ALL SELECT created_at,'newFollowers',1 FROM public.social_creator_follows WHERE creator_id=actor AND created_at>=lower_bound AND created_at<upper_bound
 ), daily AS (
 SELECT (at AT TIME ZONE 'Africa/Lagos')::date AS day,metric,sum(n) AS n FROM events GROUP BY 1,2
 ), days AS (SELECT start_day+i AS day FROM generate_series(0,_days-1) i),
 metrics AS (SELECT unnest(ARRAY['likes','saved','comments','communityPosts','following','classesJoined','published','newFollowers']) AS metric),
 series AS (SELECT d.day,jsonb_object_agg(m.metric,coalesce(a.n,0) ORDER BY m.metric) AS counts FROM days d CROSS JOIN metrics m LEFT JOIN daily a ON a.day=d.day AND a.metric=m.metric GROUP BY d.day),
 totals AS (SELECT jsonb_object_agg(m.metric,coalesce(x.n,0) ORDER BY m.metric) AS counts FROM metrics m LEFT JOIN (SELECT metric,sum(n) AS n FROM daily GROUP BY metric) x USING(metric))
 SELECT jsonb_build_object('timezone','Africa/Lagos','startDate',start_day,'endDate',today,'days',_days,'asOf',statement_timestamp(),
 'daily',(SELECT jsonb_agg(jsonb_build_object('date',day,'counts',counts) ORDER BY day) FROM series),
 'totals',(SELECT counts FROM totals),'activeInteractionDays',(SELECT count(DISTINCT day) FROM daily WHERE metric NOT IN ('newFollowers')),
 'currentFollowing',(SELECT count(*) FROM public.social_creator_follows WHERE follower_id=actor),
 'currentFollowers',(SELECT count(*) FROM public.social_creator_follows WHERE creator_id=actor),
 'currentPublished',(SELECT count(*) FROM public.content_items WHERE creator_id=actor AND status='published'),
 'watchMetricsAvailable',false,'masteryMetricsAvailable',false,'countSemantics','retained_records_and_verified_join_events') INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.my_activity_dashboard(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.my_activity_dashboard(integer) TO authenticated;
CREATE FUNCTION public.my_activity_dashboard(_days integer DEFAULT 7) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.my_activity_dashboard(_days); $$;
REVOKE ALL ON FUNCTION public.my_activity_dashboard(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.my_activity_dashboard(integer) TO authenticated;
