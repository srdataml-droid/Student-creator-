-- Creator-only, fixed cohort coverage summaries and own-account telemetry export.
CREATE FUNCTION student_social_private.creator_video_retention(_content uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); a jsonb; result jsonb; n bigint;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501';END IF;
 IF _content IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.content_items WHERE id=_content AND creator_id=actor) THEN RAISE EXCEPTION 'CONTENT_UNAVAILABLE' USING ERRCODE='42501';END IF;
 a:=public.authorized_mux_live_playback(actor,_content);
 IF a IS NULL THEN RETURN jsonb_build_object('available',false,'reason','video_not_ready');END IF;
 -- Lifetime reporting cohort, never arbitrary date/student filters.
 SELECT count(*) INTO n FROM student_social_private.watch_coverage w WHERE w.content_id=_content AND w.asset_id=a->>'assetId' AND w.viewer_id<>actor;
 IF n<5 THEN RETURN jsonb_build_object('available',false,'reason','insufficient_reporting_viewers','minimumReportingViewers',5);END IF;
 WITH cohort AS MATERIALIZED (
 SELECT w.duration_ms,w.covered,(SELECT coalesce(sum(upper(r)-lower(r)),0) FROM unnest(w.covered) r) AS covered_ms
 FROM student_social_private.watch_coverage w WHERE w.content_id=_content AND w.asset_id=a->>'assetId' AND w.viewer_id<>actor
 ), bins AS (SELECT i FROM generate_series(0,9) i),
 stats AS (
 SELECT b.i,count(*) FILTER(WHERE c.covered @> int4range(floor(c.duration_ms::numeric*b.i/10)::integer,greatest(floor(c.duration_ms::numeric*b.i/10)::integer+1,floor(c.duration_ms::numeric*(b.i+1)/10)::integer),'[)')) AS full_bin
 FROM bins b CROSS JOIN cohort c GROUP BY b.i
 )
 SELECT jsonb_build_object('available',true,'source','estimated_unique_client_reported_coverage','reportingViewers',n,'minimumReportingViewers',5,
 'estimatedMeanCoveragePercent',(SELECT round(avg(100.0*covered_ms/duration_ms),1) FROM cohort),
 'estimatedCompletionPercent',(SELECT round(100.0*count(*) FILTER(WHERE covered_ms::bigint*10>=duration_ms::bigint*9)/n,1) FROM cohort),
 'segments',(SELECT jsonb_agg(jsonb_build_object('fromPercent',i*10,'toPercent',(i+1)*10,'fullSegmentCoveragePercent',round(100.0*full_bin/n,1)) ORDER BY i) FROM stats)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION student_social_private.creator_video_retention(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.creator_video_retention(uuid) TO authenticated;
CREATE FUNCTION public.creator_video_retention(_content uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.creator_video_retention(_content); $$;
REVOKE ALL ON FUNCTION public.creator_video_retention(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_video_retention(uuid) TO authenticated;

-- Account-scoped, bounded keyset export of personal telemetry summaries.
-- This is not an export of the entire account or an erasure command.
CREATE FUNCTION student_social_private.my_watch_export(_kind text,_after_content uuid DEFAULT NULL,_after_day date DEFAULT NULL,_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); items jsonb; last_item jsonb; next_cursor jsonb;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 IF _kind IS NULL OR _kind NOT IN ('progress','daily','coverage') OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 100
 OR (_kind='daily' AND ((_after_content IS NULL)<>(_after_day IS NULL))) OR (_kind<>'daily' AND _after_day IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 IF _kind='daily' THEN
  SELECT coalesce(jsonb_agg(q.item ORDER BY q.day,q.content_id),'[]'::jsonb) INTO items FROM (
   SELECT day,content_id,jsonb_build_object('contentId',content_id,'day',day,'estimatedWatchMs',watch_ms) AS item
   FROM student_social_private.watch_daily WHERE viewer_id=actor AND (_after_content IS NULL OR (day,content_id)>(_after_day,_after_content)) ORDER BY day,content_id LIMIT _limit+1) q;
 ELSIF _kind='progress' THEN
  SELECT coalesce(jsonb_agg(q.item ORDER BY q.content_id),'[]'::jsonb) INTO items FROM (
   SELECT content_id,jsonb_build_object('contentId',content_id,'positionMs',position_ms,'durationMs',duration_ms,'updatedAt',updated_at) AS item
   FROM student_social_private.watch_progress WHERE viewer_id=actor AND (_after_content IS NULL OR content_id>_after_content) ORDER BY content_id LIMIT _limit+1) q;
 ELSE
  SELECT coalesce(jsonb_agg(q.item ORDER BY q.content_id),'[]'::jsonb) INTO items FROM (
   SELECT content_id,jsonb_build_object('contentId',content_id,'durationMs',duration_ms,'updatedAt',updated_at,'coveredMs',(SELECT coalesce(sum(upper(r)-lower(r)),0) FROM unnest(covered) r)) AS item
   FROM student_social_private.watch_coverage WHERE viewer_id=actor AND (_after_content IS NULL OR content_id>_after_content) ORDER BY content_id LIMIT _limit+1) q;
 END IF;
 IF jsonb_array_length(items)>_limit THEN
  items:=items-_limit;last_item:=items->(_limit-1);
  next_cursor:=jsonb_build_object('afterContentId',last_item->>'contentId','afterDay',last_item->>'day');
 END IF;
 RETURN jsonb_build_object('kind',_kind,'items',items,'nextCursor',next_cursor,'scope','own_watch_summary','wholeAccountExport',false,'snapshot',false);
END $$;
REVOKE ALL ON FUNCTION student_social_private.my_watch_export(text,uuid,date,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.my_watch_export(text,uuid,date,integer) TO authenticated;
CREATE FUNCTION public.my_watch_export(_kind text,_after_content uuid DEFAULT NULL,_after_day date DEFAULT NULL,_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.my_watch_export(_kind,_after_content,_after_day,_limit); $$;
REVOKE ALL ON FUNCTION public.my_watch_export(text,uuid,date,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.my_watch_export(text,uuid,date,integer) TO authenticated;

-- Deterministic recommendation baseline, only existing authorized discovery candidates.
-- No model, behavioral training, watch history or private communications used.
CREATE FUNCTION student_social_private.my_recommendations(_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); candidates jsonb; result jsonb; school uuid;
BEGIN
 IF actor IS NULL OR NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501';END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 SELECT institution_id INTO school FROM public.student_profiles WHERE user_id=actor;
 candidates:=public.social_discover('all','',NULL,NULL,NULL,100);
 WITH preferences AS (
 SELECT c.course_id,count(*) AS score FROM public.content_bookmarks b JOIN public.content_items c ON c.id=b.content_id
 WHERE b.user_id=actor AND c.status='published' AND student_social_private.preview_allowed(c.creator_id) GROUP BY c.course_id
 ), ranked AS (
 SELECT x.item,x.ordinality,coalesce(p.score,0) AS score,CASE WHEN x.item->>'institutionId'=school::text THEN 1 ELSE 0 END AS campus,
 CASE WHEN x.item->>'following'='true' THEN 1 ELSE 0 END AS followed
 FROM jsonb_array_elements(candidates) WITH ORDINALITY x(item,ordinality) LEFT JOIN preferences p ON p.course_id=(x.item->>'courseId')::uuid
 WHERE x.item->>'creatorId'<>actor::text
 ), limited AS (
 SELECT * FROM ranked ORDER BY (score>0) DESC,campus DESC,followed DESC,score DESC,ordinality LIMIT _limit
 )
 SELECT coalesce(jsonb_agg(item||jsonb_build_object('recommendationReason',CASE WHEN score>0 THEN 'saved_course' WHEN campus=1 THEN 'your_institution' WHEN followed=1 THEN 'followed_creator' ELSE 'recent_content' END) ORDER BY (score>0) DESC,campus DESC,followed DESC,score DESC,ordinality),'[]'::jsonb) INTO result FROM limited;
 RETURN jsonb_build_object('strategy','explicit_interests_v1','candidateLimit',100,'items',result,'machineLearning',false);
END $$;
REVOKE ALL ON FUNCTION student_social_private.my_recommendations(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_social_private.my_recommendations(integer) TO authenticated;
CREATE FUNCTION public.my_recommendations(_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.my_recommendations(_limit); $$;
REVOKE ALL ON FUNCTION public.my_recommendations(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.my_recommendations(integer) TO authenticated;
