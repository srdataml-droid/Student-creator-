-- Minimal learning telemetry, derived from authenticated live Mux grants.
-- Client playback reports are bounded estimates, not provider-proof or mastery.
CREATE TABLE student_social_private.watch_sessions(
 viewer_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 auth_session uuid NOT NULL,
 content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
 asset_id text NOT NULL CHECK(asset_id ~ '^[A-Za-z0-9_-]{6,128}$'),
 duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 1 AND 43200000),
 expires_at timestamptz NOT NULL,
 last_seq integer NOT NULL DEFAULT 0 CHECK(last_seq>=0),
 last_at timestamptz,
 last_position_ms integer,
 last_playing boolean NOT NULL DEFAULT false,
 CHECK(last_position_ms IS NULL OR last_position_ms BETWEEN 0 AND duration_ms)
);
CREATE TABLE student_social_private.watch_progress(
 viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
 asset_id text NOT NULL,
 position_ms integer NOT NULL CHECK(position_ms>=0),
 duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 1 AND 43200000),
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(viewer_id,content_id), CHECK(position_ms<=duration_ms)
);
CREATE INDEX watch_progress_recent ON student_social_private.watch_progress(viewer_id,updated_at DESC);
CREATE TABLE student_social_private.watch_daily(
 viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
 day date NOT NULL,
 watch_ms bigint NOT NULL CHECK(watch_ms BETWEEN 1 AND 86400000),
 PRIMARY KEY(viewer_id,content_id,day)
);
CREATE INDEX watch_daily_content_day ON student_social_private.watch_daily(content_id,day);
CREATE INDEX watch_daily_viewer_day ON student_social_private.watch_daily(viewer_id,day);
ALTER TABLE student_social_private.watch_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_social_private.watch_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_social_private.watch_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON student_social_private.watch_sessions,student_social_private.watch_progress,student_social_private.watch_daily FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.register_live_watch_grant(_viewer uuid,_session uuid,_content uuid,_asset text,_duration_ms integer,_expires_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb; g student_social_private.watch_sessions%ROWTYPE; t timestamptz:=clock_timestamp(); expiry timestamptz; resume integer;
BEGIN
 IF _viewer IS NULL OR _session IS NULL OR _content IS NULL OR _duration_ms IS NULL OR _duration_ms NOT BETWEEN 1 AND 43200000 OR _expires_epoch IS NULL OR _expires_epoch<=floor(extract(epoch FROM t)) OR _expires_epoch>floor(extract(epoch FROM t))+120 OR NOT public.student_creators_session_active(_viewer,_session) THEN RETURN NULL;END IF;
 a:=public.authorized_mux_live_playback(_viewer,_content);
 IF a IS NULL OR a->>'assetId' IS DISTINCT FROM _asset THEN RETURN NULL;END IF;
 IF a->>'entitlementExpiresAt' IS NOT NULL AND _expires_epoch>(a->>'entitlementExpiresAt')::bigint THEN RETURN NULL;END IF;
 expiry:=to_timestamp(_expires_epoch);
 PERFORM pg_advisory_xact_lock(hashtextextended('watch:'||_viewer::text,0));
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
REVOKE ALL ON FUNCTION public.register_live_watch_grant(uuid,uuid,uuid,text,integer,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_live_watch_grant(uuid,uuid,uuid,text,integer,bigint) TO service_role;

CREATE FUNCTION student_social_private.record_watch_progress(_id uuid,_seq integer,_position_ms integer,_playing boolean,_continuous boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); session_claim text:=auth.jwt()->>'session_id'; g student_social_private.watch_sessions%ROWTYPE; a jsonb; t timestamptz; elapsed bigint; delta bigint; credited bigint:=0; local_day date;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501';END IF;
 IF _id IS NULL OR _seq IS NULL OR _seq NOT BETWEEN 1 AND 2147483646 OR _position_ms IS NULL OR _position_ms<0 OR _playing IS NULL OR _continuous IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('watch:'||actor::text,0));
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
  INSERT INTO student_social_private.watch_daily(viewer_id,content_id,day,watch_ms) VALUES(actor,g.content_id,local_day,credited)
  ON CONFLICT(viewer_id,content_id,day) DO UPDATE SET watch_ms=least(86400000,student_social_private.watch_daily.watch_ms+excluded.watch_ms);
 END IF;
 INSERT INTO student_social_private.watch_progress(viewer_id,content_id,asset_id,position_ms,duration_ms,updated_at)
 VALUES(actor,g.content_id,g.asset_id,_position_ms,g.duration_ms,t)
 ON CONFLICT(viewer_id,content_id) DO UPDATE SET asset_id=excluded.asset_id,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,updated_at=excluded.updated_at;
 UPDATE student_social_private.watch_sessions SET last_seq=_seq,last_at=t,last_position_ms=_position_ms,last_playing=_playing WHERE viewer_id=actor;
 RETURN jsonb_build_object('accepted',true,'replayed',false,'creditedMs',credited,'nextSequence',_seq+1);
END $$;
REVOKE ALL ON FUNCTION student_social_private.record_watch_progress(uuid,integer,integer,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.record_watch_progress(uuid,integer,integer,boolean,boolean) TO authenticated;
CREATE FUNCTION public.record_watch_progress(_id uuid,_seq integer,_position_ms integer,_playing boolean,_continuous boolean)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.record_watch_progress(_id,_seq,_position_ms,_playing,_continuous); $$;
REVOKE ALL ON FUNCTION public.record_watch_progress(uuid,integer,integer,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_watch_progress(uuid,integer,integer,boolean,boolean) TO authenticated;

CREATE FUNCTION student_social_private.my_watch_dashboard(_days integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); today date:=(statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date; first_day date; result jsonb;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501';END IF;
 IF _days IS NULL OR _days NOT IN (7,28) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 first_day:=today-_days+1;
 WITH mine AS (SELECT content_id,day,watch_ms FROM student_social_private.watch_daily WHERE viewer_id=actor AND day BETWEEN first_day AND today),
 daily AS (SELECT day,sum(watch_ms) AS ms FROM mine GROUP BY day),
 audience AS (SELECT w.viewer_id,w.content_id,w.watch_ms FROM student_social_private.watch_daily w JOIN public.content_items c ON c.id=w.content_id WHERE c.creator_id=actor AND w.viewer_id<>actor AND w.day BETWEEN first_day AND today),
 resume AS (SELECT p.content_id,p.position_ms,p.duration_ms,p.updated_at,c.title FROM (SELECT * FROM student_social_private.watch_progress WHERE viewer_id=actor ORDER BY updated_at DESC LIMIT 50) p JOIN public.content_items c ON c.id=p.content_id WHERE public.authorized_mux_live_playback(actor,p.content_id)->>'assetId'=p.asset_id ORDER BY p.updated_at DESC LIMIT 20)
 SELECT jsonb_build_object('source','bounded_client_playback_reports','estimatedWatchMs',(SELECT coalesce(sum(watch_ms),0) FROM mine),'watchDays',(SELECT count(*) FROM daily),'videosWithWatchActivity',(SELECT count(DISTINCT content_id) FROM mine),
 'daily',(SELECT jsonb_agg(jsonb_build_object('date',first_day+i,'estimatedWatchMs',coalesce(d.ms,0)) ORDER BY i) FROM generate_series(0,_days-1) i LEFT JOIN daily d ON d.day=first_day+i),
 'continueWatching',(SELECT coalesce(jsonb_agg(jsonb_build_object('contentId',content_id,'title',title,'positionMs',position_ms,'durationMs',duration_ms,'updatedAt',updated_at) ORDER BY updated_at DESC),'[]'::jsonb) FROM resume),
 'creatorAudience',jsonb_build_object('estimatedWatchMs',(SELECT coalesce(sum(watch_ms),0) FROM audience),'distinctReportingViewers',(SELECT count(DISTINCT viewer_id) FROM audience),'videosWithAudienceActivity',(SELECT count(DISTINCT content_id) FROM audience)),
 'completionMetricsAvailable',false,'masteryMetricsAvailable',false) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.my_watch_dashboard(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.my_watch_dashboard(integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.my_activity_dashboard(_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT student_social_private.my_activity_dashboard(_days)||jsonb_build_object('watchMetricsAvailable',true,'watch',student_social_private.my_watch_dashboard(_days));
$$;
