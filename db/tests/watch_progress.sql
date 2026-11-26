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
ROLLBACK;
