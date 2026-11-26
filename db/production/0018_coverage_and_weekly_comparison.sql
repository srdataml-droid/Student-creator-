-- Owner-controlled telemetry and unique bounded video coverage.
CREATE TABLE student_social_private.watch_preferences(
 viewer_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE student_social_private.watch_coverage(
 viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
 asset_id text NOT NULL,
 duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 1 AND 43200000),
 covered int4multirange NOT NULL,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(viewer_id,content_id),
 CHECK(covered <@ int4multirange(int4range(0,duration_ms,'[)')))
);
CREATE INDEX watch_coverage_content_idx ON student_social_private.watch_coverage(content_id);
ALTER TABLE student_social_private.watch_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_social_private.watch_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON student_social_private.watch_preferences,student_social_private.watch_coverage FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION student_social_private.watch_preference(_enabled boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); enabled_now boolean;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('watch:'||actor::text,0));
 IF _enabled IS NOT NULL THEN
  INSERT INTO student_social_private.watch_preferences(viewer_id,enabled) VALUES(actor,_enabled)
  ON CONFLICT(viewer_id) DO UPDATE SET enabled=excluded.enabled,updated_at=now();
 END IF;
 SELECT enabled INTO enabled_now FROM student_social_private.watch_preferences WHERE viewer_id=actor;
 RETURN jsonb_build_object('enabled',coalesce(enabled_now,true),'existingHistoryRetained',true,'scope','optional_video_progress');
END $$;
REVOKE ALL ON FUNCTION student_social_private.watch_preference(boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.watch_preference(boolean) TO authenticated;
CREATE FUNCTION public.watch_preference(_enabled boolean DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.watch_preference(_enabled); $$;
REVOKE ALL ON FUNCTION public.watch_preference(boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.watch_preference(boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.register_live_watch_grant(_viewer uuid,_session uuid,_content uuid,_asset text,_duration_ms integer,_expires_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb; g student_social_private.watch_sessions%ROWTYPE; t timestamptz:=clock_timestamp(); expiry timestamptz; resume integer;
BEGIN
 IF _viewer IS NULL OR _session IS NULL OR _content IS NULL OR _duration_ms IS NULL OR _duration_ms NOT BETWEEN 1 AND 43200000 OR _expires_epoch IS NULL OR _expires_epoch<=floor(extract(epoch FROM t)) OR _expires_epoch>floor(extract(epoch FROM t))+120 OR NOT public.student_creators_session_active(_viewer,_session) THEN RETURN NULL;END IF;
 a:=public.authorized_mux_live_playback(_viewer,_content);
 IF a IS NULL OR a->>'assetId' IS DISTINCT FROM _asset THEN RETURN NULL;END IF;
 IF a->>'entitlementExpiresAt' IS NOT NULL AND _expires_epoch>(a->>'entitlementExpiresAt')::bigint THEN RETURN NULL;END IF;
 expiry:=to_timestamp(_expires_epoch);
 PERFORM pg_advisory_xact_lock(hashtextextended('watch:'||_viewer::text,0));
 IF EXISTS(SELECT 1 FROM student_social_private.watch_preferences WHERE viewer_id=_viewer AND NOT enabled) THEN RETURN NULL;END IF;
 SELECT * INTO g FROM student_social_private.watch_sessions WHERE viewer_id=_viewer FOR UPDATE;
 IF FOUND AND g.auth_session=_session AND g.content_id=_content AND g.asset_id=_asset AND g.duration_ms=_duration_ms AND g.expires_at>t THEN
  UPDATE student_social_private.watch_sessions SET expires_at=greatest(expires_at,expiry) WHERE viewer_id=_viewer RETURNING * INTO g;
 ELSE
  INSERT INTO student_social_private.watch_sessions(viewer_id,auth_session,content_id,asset_id,duration_ms,expires_at)
  VALUES(_viewer,_session,_content,_asset,_duration_ms,expiry)
  ON CONFLICT(viewer_id) DO UPDATE SET id=gen_random_uuid(),auth_session=excluded.auth_session,content_id=excluded.content_id,asset_id=excluded.asset_id,duration_ms=excluded.duration_ms,expires_at=excluded.expires_at,last_seq=0,last_at=NULL,last_position_ms=NULL,last_playing=false
  RETURNING * INTO g;
 END IF;
 SELECT position_ms INTO resume FROM student_social_private.watch_progress WHERE viewer_id=_viewer AND content_id=_content AND asset_id=_asset AND duration_ms=_duration_ms;
 RETURN jsonb_build_object('id',g.id,'nextSequence',g.last_seq+1,'durationMs',g.duration_ms,'resumePositionMs',coalesce(resume,0),'expiresAt',floor(extract(epoch FROM g.expires_at))::bigint);
END $$;
CREATE OR REPLACE FUNCTION student_social_private.record_watch_progress(_id uuid,_seq integer,_position_ms integer,_playing boolean,_continuous boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); session_claim text:=auth.jwt()->>'session_id'; g student_social_private.watch_sessions%ROWTYPE; a jsonb; t timestamptz; elapsed bigint; delta bigint; credited bigint:=0; local_day date;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501';END IF;
 IF _id IS NULL OR _seq IS NULL OR _seq NOT BETWEEN 1 AND 2147483646 OR _position_ms IS NULL OR _position_ms<0 OR _playing IS NULL OR _continuous IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('watch:'||actor::text,0));
 IF EXISTS(SELECT 1 FROM student_social_private.watch_preferences WHERE viewer_id=actor AND NOT enabled) THEN RAISE EXCEPTION 'WATCH_SESSION_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO g FROM student_social_private.watch_sessions WHERE viewer_id=actor AND id=_id FOR UPDATE;
 t:=clock_timestamp();
 IF NOT FOUND OR g.auth_session::text IS DISTINCT FROM session_claim OR g.expires_at<=t THEN RAISE EXCEPTION 'WATCH_SESSION_UNAVAILABLE' USING ERRCODE='42501';END IF;
 a:=public.authorized_mux_live_playback(actor,g.content_id);
 IF a IS NULL OR a->>'assetId' IS DISTINCT FROM g.asset_id THEN RAISE EXCEPTION 'WATCH_SESSION_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF _position_ms>g.duration_ms THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 IF _seq<=g.last_seq THEN RETURN jsonb_build_object('accepted',false,'replayed',true,'creditedMs',0,'nextSequence',g.last_seq+1);END IF;
 IF _seq<>g.last_seq+1 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 IF g.last_at IS NOT NULL THEN
  elapsed:=greatest(0,floor(extract(epoch FROM (t-g.last_at))*1000)::bigint);
  IF elapsed<5000 THEN RETURN jsonb_build_object('accepted',false,'retryAfterMs',5000-elapsed,'creditedMs',0,'nextSequence',g.last_seq+1);END IF;
  delta:=_position_ms::bigint-g.last_position_ms;
  IF _continuous AND g.last_playing AND _playing AND elapsed<=60000 AND delta>0 AND delta<=elapsed*2+1000 THEN credited:=least(delta,elapsed,30000);END IF;
 END IF;
 local_day:=(t AT TIME ZONE 'Africa/Lagos')::date;
 IF credited>0 THEN
  INSERT INTO student_social_private.watch_coverage(viewer_id,content_id,asset_id,duration_ms,covered,updated_at)
  VALUES(actor,g.content_id,g.asset_id,g.duration_ms,int4multirange(int4range(g.last_position_ms,g.last_position_ms+credited::integer,'[)')),t)
  ON CONFLICT(viewer_id,content_id) DO UPDATE SET asset_id=excluded.asset_id,duration_ms=excluded.duration_ms,covered=CASE WHEN student_social_private.watch_coverage.asset_id=excluded.asset_id AND student_social_private.watch_coverage.duration_ms=excluded.duration_ms THEN student_social_private.watch_coverage.covered+excluded.covered ELSE excluded.covered END,updated_at=t;
  INSERT INTO student_social_private.watch_daily(viewer_id,content_id,day,watch_ms) VALUES(actor,g.content_id,local_day,credited)
  ON CONFLICT(viewer_id,content_id,day) DO UPDATE SET watch_ms=least(86400000,student_social_private.watch_daily.watch_ms+excluded.watch_ms);
 END IF;
 INSERT INTO student_social_private.watch_progress(viewer_id,content_id,asset_id,position_ms,duration_ms,updated_at)
 VALUES(actor,g.content_id,g.asset_id,_position_ms,g.duration_ms,t)
 ON CONFLICT(viewer_id,content_id) DO UPDATE SET asset_id=excluded.asset_id,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,updated_at=excluded.updated_at;
 UPDATE student_social_private.watch_sessions SET last_seq=_seq,last_at=t,last_position_ms=_position_ms,last_playing=_playing WHERE viewer_id=actor;
 RETURN jsonb_build_object('accepted',true,'replayed',false,'creditedMs',credited,'nextSequence',_seq+1);
END $$;
CREATE FUNCTION student_social_private.my_coverage_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501';END IF;
 WITH coverage AS (
 SELECT w.content_id,w.duration_ms,w.updated_at,(SELECT coalesce(sum(upper(r)-lower(r)),0) FROM unnest(w.covered) r) AS covered_ms
 FROM student_social_private.watch_coverage w WHERE w.viewer_id=actor AND public.authorized_mux_live_playback(actor,w.content_id)->>'assetId'=w.asset_id
 ), recent AS (SELECT * FROM coverage ORDER BY updated_at DESC,content_id LIMIT 20)
 SELECT jsonb_build_object('source','estimated_unique_reported_playback_coverage','thresholdPercent',90,'coveredVideos',(SELECT count(*) FROM coverage),
 'estimatedCompletedVideos',(SELECT count(*) FROM coverage WHERE covered_ms::bigint*10>=duration_ms::bigint*9),
 'recent',(SELECT coalesce(jsonb_agg(jsonb_build_object('contentId',content_id,'coveredMs',covered_ms,'durationMs',duration_ms,'coveragePercent',floor(100.0*covered_ms/duration_ms),'estimatedCompleted',covered_ms::bigint*10>=duration_ms::bigint*9) ORDER BY updated_at DESC,content_id),'[]'::jsonb) FROM recent)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.my_coverage_dashboard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.my_coverage_dashboard() TO authenticated;
-- Compare two equal, completed seven-day periods, excluding today.
CREATE FUNCTION student_social_private.my_weekly_comparison()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); today date:=(statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date; lower_bound timestamptz; upper_bound timestamptz; result jsonb;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501';END IF;
 lower_bound:=(today-14)::timestamp AT TIME ZONE 'Africa/Lagos';upper_bound:=today::timestamp AT TIME ZONE 'Africa/Lagos';
 WITH events AS (
 SELECT created_at AS at,'likes'::text AS metric,1::bigint AS n FROM public.content_likes WHERE user_id=actor AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT created_at,'saved',1 FROM public.content_bookmarks WHERE user_id=actor AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT created_at,'comments',1 FROM public.content_comments WHERE author_id=actor AND hidden_at IS NULL AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT created_at,'communityPosts',1 FROM public.social_community_posts WHERE author_id=actor AND hidden_at IS NULL AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT created_at,'following',1 FROM public.social_creator_follows WHERE follower_id=actor AND created_at>=lower_bound AND created_at<upper_bound
 UNION ALL SELECT min(p.created_at),'classesJoined',1 FROM public.interactive_class_presence p JOIN public.interactive_classes c ON c.id=p.class_id WHERE p.user_id=actor AND p.kind='joined' AND c.host_id<>actor AND p.created_at>=lower_bound AND p.created_at<upper_bound GROUP BY p.class_id,CASE WHEN (p.created_at AT TIME ZONE 'Africa/Lagos')::date>=today-7 THEN 1 ELSE 0 END
 UNION ALL SELECT published_at,'published',1 FROM public.content_items WHERE creator_id=actor AND status='published' AND published_at>=lower_bound AND published_at<upper_bound
 UNION ALL SELECT created_at,'newFollowers',1 FROM public.social_creator_follows WHERE creator_id=actor AND created_at>=lower_bound AND created_at<upper_bound
 ), all_events AS (
 SELECT (at AT TIME ZONE 'Africa/Lagos')::date AS day,metric,n FROM events
 UNION ALL SELECT day,'estimatedWatchMs',watch_ms FROM student_social_private.watch_daily WHERE viewer_id=actor AND day>=today-14 AND day<today
 ), metrics AS (SELECT unnest(ARRAY['likes','saved','comments','communityPosts','following','classesJoined','published','newFollowers','estimatedWatchMs']) AS metric),
 sums AS (SELECT m.metric,coalesce(sum(e.n) FILTER(WHERE e.day>=today-7),0) AS recent,coalesce(sum(e.n) FILTER(WHERE e.day<today-7),0) AS prior FROM metrics m LEFT JOIN all_events e USING(metric) GROUP BY m.metric)
 SELECT jsonb_build_object('recentStart',today-7,'recentEnd',today-1,'priorStart',today-14,'priorEnd',today-8,'todayExcluded',true,
 'metrics',jsonb_object_agg(metric,jsonb_build_object('recent',recent,'prior',prior,'change',recent-prior,'changePercent',CASE WHEN prior>0 THEN round(100.0*(recent-prior)/prior,1) ELSE NULL END))) INTO result FROM sums;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.my_weekly_comparison() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.my_weekly_comparison() TO authenticated;
CREATE OR REPLACE FUNCTION public.my_activity_dashboard(_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.my_activity_dashboard(_days)||jsonb_build_object('watchMetricsAvailable',true,'watch',student_social_private.my_watch_dashboard(_days)||jsonb_build_object('completionMetricsAvailable',true,'coverage',student_social_private.my_coverage_dashboard()),'weeklyComparison',student_social_private.my_weekly_comparison());
$$;
