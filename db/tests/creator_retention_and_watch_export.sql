BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('fa110000-0000-4000-8000-000000000001','creator@example.invalid',now()),('fa110000-0000-4000-8000-000000000002','buyer@example.invalid',now()),('fa110000-0000-4000-8000-000000000003','reviewer@example.invalid',now());
INSERT INTO public.institutions(id,slug,name) VALUES('fa120000-0000-4000-8000-000000000001','fixture-media-source','Synthetic');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('fa130000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fixture','Synthetic');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('fa140000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001','MEDIA19','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'fa120000-0000-4000-8000-000000000001','Synthetic',now() FROM auth.users WHERE id IN ('fa110000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000002');
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status,reviewer_id,review_reason,reviewed_at,published_at) VALUES('fa150000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fa140000-0000-4000-8000-000000000001','Synthetic payment lesson',now(),'fixture-media-source',repeat('a',64),'draft',NULL,NULL,NULL,NULL);

UPDATE public.content_items SET status='published',reviewer_id='fa110000-0000-4000-8000-000000000003',review_reason='Synthetic approval',reviewed_at=now(),published_at=now() WHERE id='fa150000-0000-4000-8000-000000000001';
INSERT INTO auth.sessions(id,user_id) VALUES('fa110000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001'),('fa110000-0000-4000-8000-000000000002','fa110000-0000-4000-8000-000000000002');

INSERT INTO public.mux_video_uploads(content_id,creator_id,state,upload_id,asset_id,playback_id) VALUES('fa150000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001','ready','fixture_watch_upload','fixture_watch_asset','fixture_watch_playback');
INSERT INTO public.content_assets(content_id,private_object_key,mime_type,bytes,processing_status,scan_verdict) VALUES('fa150000-0000-4000-8000-000000000001','private/mux/fixture_watch_asset','video/mp4',100,'ready','clean');
DO $$ DECLARE g jsonb; BEGIN
 IF has_table_privilege('authenticated','student_social_private.watch_daily','SELECT') OR has_function_privilege('authenticated','public.register_live_watch_grant(uuid,uuid,uuid,text,integer,bigint)','EXECUTE') OR has_function_privilege('anon','public.record_watch_progress(uuid,integer,integer,boolean,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Watch privilege leak';END IF;
 g:=public.register_live_watch_grant('fa110000-0000-4000-8000-000000000002','fa110000-0000-4000-8000-000000000002','fa150000-0000-4000-8000-000000000001','fixture_watch_asset',120000,floor(extract(epoch FROM clock_timestamp()))::bigint+100);
 IF g IS NULL OR g->>'nextSequence'<>'1' THEN RAISE EXCEPTION 'Watch grant missing';END IF;
 PERFORM set_config('fixture.watch_id',g->>'id',true);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fa110000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"fa110000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa110000-0000-4000-8000-000000000002"}',true);
DO $$ DECLARE j jsonb; wid uuid:=current_setting('fixture.watch_id')::uuid; BEGIN
 j:=public.record_watch_progress(wid,1,0,true,true);
 IF j->>'accepted'<>'true' OR j->>'creditedMs'<>'0' THEN RAISE EXCEPTION 'First heartbeat incorrectly credited';END IF;
 IF public.record_watch_progress(wid,1,10000,true,true)->>'replayed'<>'true' THEN RAISE EXCEPTION 'Duplicate heartbeat';END IF;
 IF public.record_watch_progress(wid,2,10000,true,true)->>'accepted'<>'false' THEN RAISE EXCEPTION 'Early heartbeat accepted';END IF;
END $$;
RESET ROLE;
UPDATE student_social_private.watch_sessions SET last_at=clock_timestamp()-interval '15 seconds' WHERE viewer_id='fa110000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DO $$ DECLARE j jsonb;wid uuid:=current_setting('fixture.watch_id')::uuid; BEGIN
 j:=public.record_watch_progress(wid,2,12000,true,true);
 IF j->>'creditedMs'<>'12000' THEN RAISE EXCEPTION 'Bounded playback incorrect %',j;END IF;
 j:=public.my_activity_dashboard(7);
 IF j->'watch'->>'estimatedWatchMs'<>'12000' OR j->'watch'->'continueWatching'->0->>'positionMs'<>'12000' OR j->'watch'->'creatorAudience'->>'distinctReportingViewers'<>'0' THEN RAISE EXCEPTION 'Watch dashboard mismatch %',j;END IF;
END $$;
RESET ROLE;
UPDATE student_social_private.watch_sessions SET last_at=clock_timestamp()-interval '15 seconds' WHERE viewer_id='fa110000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.record_watch_progress(current_setting('fixture.watch_id')::uuid,3,110000,true,false)->>'creditedMs'<>'0' THEN RAISE EXCEPTION 'Seek credited as watch time';END IF;END $$;
SELECT set_config('request.jwt.claim.sub','fa110000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"fa110000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa110000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE j jsonb; BEGIN
 BEGIN PERFORM public.record_watch_progress(current_setting('fixture.watch_id')::uuid,4,111000,true,true);RAISE EXCEPTION 'Foreign watch session accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 j:=public.my_activity_dashboard(7);
 IF j->'watch'->>'estimatedWatchMs'<>'0' OR j->'watch'->'creatorAudience'->>'estimatedWatchMs'<>'12000' OR j->'watch'->'creatorAudience'->>'distinctReportingViewers'<>'1' OR jsonb_array_length(j->'watch'->'continueWatching')<>0 THEN RAISE EXCEPTION 'Creator aggregate isolation mismatch';END IF;
END $$;
RESET ROLE;
-- Existing watch regression has produced one 12-second covered interval and an uncredited seek.
INSERT INTO student_social_private.watch_daily(viewer_id,content_id,day,watch_ms) VALUES
 ('fa110000-0000-4000-8000-000000000002','fa150000-0000-4000-8000-000000000001',(now() AT TIME ZONE 'Africa/Lagos')::date-1,20000),
 ('fa110000-0000-4000-8000-000000000002','fa150000-0000-4000-8000-000000000001',(now() AT TIME ZONE 'Africa/Lagos')::date-8,10000);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fa110000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"fa110000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa110000-0000-4000-8000-000000000002"}',true);
DO $$ DECLARE d jsonb; BEGIN
 d:=public.my_activity_dashboard();
 IF d->'watch'->'coverage'->'recent'->0->>'coveredMs'<>'12000' OR d->'watch'->'coverage'->>'estimatedCompletedVideos'<>'0' OR d->'weeklyComparison'->'metrics'->'estimatedWatchMs'->>'recent'<>'20000' OR d->'weeklyComparison'->'metrics'->'estimatedWatchMs'->>'prior'<>'10000' THEN RAISE EXCEPTION 'Coverage or weekly comparison failed %',d;END IF;
 IF public.watch_preference(false)->>'enabled'<>'false' THEN RAISE EXCEPTION 'Opt-out failed';END IF;
 BEGIN PERFORM public.record_watch_progress(current_setting('fixture.watch_id')::uuid,4,111000,true,true);RAISE EXCEPTION 'Opt-out ignored';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF public.watch_preference()->>'existingHistoryRetained'<>'true' THEN RAISE EXCEPTION 'Privacy history semantics';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF public.register_live_watch_grant('fa110000-0000-4000-8000-000000000002','fa110000-0000-4000-8000-000000000002','fa150000-0000-4000-8000-000000000001','fixture_watch_asset',120000,floor(extract(epoch FROM clock_timestamp()))::bigint+100) IS NOT NULL THEN RAISE EXCEPTION 'Opt-out grant allowed';END IF;
 IF has_table_privilege('authenticated','student_social_private.watch_coverage','SELECT') OR has_function_privilege('anon','public.watch_preference(boolean)','EXECUTE') THEN RAISE EXCEPTION 'Privacy privilege leak';END IF;
END $$;
-- Test own summary export even when optional telemetry is off.
SET LOCAL ROLE authenticated;
DO $$ DECLARE j jsonb; BEGIN
 j:=public.my_watch_export('daily',NULL,NULL,1);
 IF jsonb_array_length(j->'items')<>1 OR j->'items'->0->>'estimatedWatchMs'<>'10000' OR j->'nextCursor'->>'afterContentId' IS NULL THEN RAISE EXCEPTION 'Own export page mismatch %',j;END IF;
 j:=public.my_watch_export('daily',(j->'nextCursor'->>'afterContentId')::uuid,(j->'nextCursor'->>'afterDay')::date,100);
 IF jsonb_array_length(j->'items')<>2 OR j->>'nextCursor' IS NOT NULL THEN RAISE EXCEPTION 'Export cursor mismatch %',j;END IF;
 IF jsonb_array_length(public.my_watch_export('coverage')->'items')<>1 THEN RAISE EXCEPTION 'Own coverage export missing';END IF;
 BEGIN PERFORM public.creator_video_retention('fa150000-0000-4000-8000-000000000001');RAISE EXCEPTION 'Foreign retention access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 j:=public.my_recommendations(20);
 IF j->>'machineLearning'<>'false' OR jsonb_array_length(j->'items')<>1 OR j->'items'->0->>'id'<>'fa150000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Recommendation mismatch %',j;END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','fa110000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"fa110000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa110000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN
 IF jsonb_array_length(public.my_watch_export('daily')->'items')<>0 OR public.creator_video_retention('fa150000-0000-4000-8000-000000000001')->>'reason'<>'insufficient_reporting_viewers' THEN RAISE EXCEPTION 'Creator export or small cohort privacy';END IF;
END $$;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT ('fa110000-0000-4000-8000-00000000000'||i)::uuid,'coverage'||i||'@example.invalid',now() FROM generate_series(4,7) i;
INSERT INTO student_social_private.watch_coverage(viewer_id,content_id,asset_id,duration_ms,covered,updated_at)
 SELECT id,'fa150000-0000-4000-8000-000000000001','fixture_watch_asset',120000,int4multirange(int4range(0,120000,'[)')),now()
 FROM auth.users WHERE id IN ('fa110000-0000-4000-8000-000000000004','fa110000-0000-4000-8000-000000000005','fa110000-0000-4000-8000-000000000006','fa110000-0000-4000-8000-000000000007');
SET LOCAL ROLE authenticated;
DO $$ DECLARE j jsonb; BEGIN
 j:=public.creator_video_retention('fa150000-0000-4000-8000-000000000001');
 IF j->>'reportingViewers'<>'5' OR (j->>'estimatedMeanCoveragePercent')::numeric<>82 OR (j->>'estimatedCompletionPercent')::numeric<>80 OR (j->'segments'->0->>'fullSegmentCoveragePercent')::numeric<>100 OR (j->'segments'->1->>'fullSegmentCoveragePercent')::numeric<>80 THEN RAISE EXCEPTION 'Retention aggregate mismatch %',j;END IF;
END $$;
RESET ROLE;
ROLLBACK;
