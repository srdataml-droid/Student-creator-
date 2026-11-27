BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('fa110000-0000-4000-8000-000000000001','creator@example.invalid',now()),('fa110000-0000-4000-8000-000000000002','buyer@example.invalid',now()),('fa110000-0000-4000-8000-000000000003','reviewer@example.invalid',now());
INSERT INTO public.institutions(id,slug,name) VALUES('fa120000-0000-4000-8000-000000000001','fixture-media-source','Synthetic');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('fa130000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fixture','Synthetic');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('fa140000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001','MEDIA19','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'fa120000-0000-4000-8000-000000000001','Synthetic',now() FROM auth.users WHERE id IN ('fa110000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000002');
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status,reviewer_id,review_reason,reviewed_at,published_at) VALUES('fa150000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fa140000-0000-4000-8000-000000000001','Synthetic payment lesson',now(),'fixture-media-source',repeat('a',64),'draft',NULL,NULL,NULL,NULL);

UPDATE public.content_items SET status='published',reviewer_id='fa110000-0000-4000-8000-000000000003',review_reason='Synthetic approval',reviewed_at=now(),published_at=now() WHERE id='fa150000-0000-4000-8000-000000000001';
INSERT INTO auth.sessions(id,user_id) VALUES('fa110000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001'),('fa110000-0000-4000-8000-000000000002','fa110000-0000-4000-8000-000000000002');
INSERT INTO public.social_creator_follows(follower_id,creator_id) VALUES('fa110000-0000-4000-8000-000000000002','fa110000-0000-4000-8000-000000000001');
INSERT INTO public.content_bookmarks(user_id,content_id) VALUES('fa110000-0000-4000-8000-000000000002','fa150000-0000-4000-8000-000000000001');
DO $$ BEGIN IF has_function_privilege('anon','public.my_activity_dashboard(integer)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous dashboard access';END IF; END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fa110000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"fa110000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa110000-0000-4000-8000-000000000002"}',true);
DO $$ DECLARE d jsonb; BEGIN
 d:=public.my_activity_dashboard();
 IF jsonb_array_length(d->'daily')<>7 OR d->'totals'->>'saved'<>'1' OR d->'totals'->>'following'<>'1' OR d->'totals'->>'published'<>'0' OR d->>'currentFollowers'<>'0' OR d->>'watchMetricsAvailable'<>'false' THEN RAISE EXCEPTION 'Student dashboard isolation/count mismatch %',d;END IF;
 BEGIN PERFORM public.my_activity_dashboard(100);RAISE EXCEPTION 'Unbounded range';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','fa110000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"fa110000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa110000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE d jsonb; BEGIN
 d:=public.my_activity_dashboard(28);
 IF jsonb_array_length(d->'daily')<>28 OR d->'totals'->>'saved'<>'0' OR d->'totals'->>'published'<>'1' OR d->'totals'->>'newFollowers'<>'1' OR d->>'currentFollowers'<>'1' THEN RAISE EXCEPTION 'Creator dashboard isolation/count mismatch %',d;END IF;
END $$;
RESET ROLE;
ROLLBACK;
