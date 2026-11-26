BEGIN;
DO $$ BEGIN
 IF has_table_privilege('service_role','public.media_source_uploads','INSERT,UPDATE,DELETE') OR has_function_privilege('authenticated','public.claim_live_media_source()','EXECUTE') OR has_function_privilege('anon','public.reserve_live_media_source(uuid,uuid,text,bigint,text)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe media quarantine privileges'; END IF;
 IF public.claim_live_media_source() IS NOT NULL OR public.begin_live_media_dispatch('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',repeat('a',64),'ClamAV fixture') IS NOT NULL THEN RAISE EXCEPTION 'Nonexistent source dispatch'; END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('fa110000-0000-4000-8000-000000000001','creator@example.invalid',now()),('fa110000-0000-4000-8000-000000000002','buyer@example.invalid',now()),('fa110000-0000-4000-8000-000000000003','reviewer@example.invalid',now());
INSERT INTO public.institutions(id,slug,name) VALUES('fa120000-0000-4000-8000-000000000001','fixture-media-source','Synthetic');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('fa130000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fixture','Synthetic');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('fa140000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001','MEDIA19','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'fa120000-0000-4000-8000-000000000001','Synthetic',now() FROM auth.users WHERE id IN ('fa110000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000002');
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status,reviewer_id,review_reason,reviewed_at,published_at) VALUES('fa150000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','fa140000-0000-4000-8000-000000000001','Synthetic payment lesson',now(),'fixture-media-source',repeat('a',64),'draft',NULL,NULL,NULL,NULL);

DO $$
DECLARE creator uuid:='fa110000-0000-4000-8000-000000000001'; other_user uuid:='fa110000-0000-4000-8000-000000000002'; content uuid:='fa150000-0000-4000-8000-000000000001'; source uuid; old_source uuid; lease uuid; reservation uuid; a jsonb; b jsonb;
BEGIN
 a:=public.reserve_live_media_source(creator,content,'video/mp4',100,repeat('a',64));
 source:=(a->>'id')::uuid;
 IF source IS NULL OR a->>'state'<>'reserved' THEN RAISE EXCEPTION 'Source reservation failed'; END IF;
 IF public.reserve_live_media_source(other_user,content,'video/mp4',100,repeat('a',64)) IS NOT NULL THEN RAISE EXCEPTION 'Foreign reservation'; END IF;
 IF public.reserve_live_media_source(creator,content,'video/mp4',100,repeat('a',64))->>'id' IS DISTINCT FROM source::text THEN RAISE EXCEPTION 'Reservation replay'; END IF;
 IF public.reserve_live_media_source(creator,content,'video/mp4',101,repeat('a',64))->>'conflict' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Metadata changed'; END IF;
 old_source:=source;
 IF public.restart_live_media_source(other_user,content,source) OR NOT public.restart_live_media_source(creator,content,source) OR public.queue_live_media_source(creator,content,source) THEN RAISE EXCEPTION 'Media restart ownership or stale source failure';END IF;
 a:=public.reserve_live_media_source(creator,content,'video/mp4',100,repeat('a',64));source:=(a->>'id')::uuid;
 IF source IS NULL OR source=old_source OR NOT EXISTS(SELECT 1 FROM public.media_source_uploads WHERE id=old_source AND superseded_at IS NOT NULL) OR public.get_live_media_source(creator,content)->>'id' IS DISTINCT FROM source::text THEN RAISE EXCEPTION 'Superseded source not isolated';END IF;
 IF public.queue_live_media_source(other_user,content,source) OR NOT public.queue_live_media_source(creator,content,source) THEN RAISE EXCEPTION 'Queue ownership'; END IF;
 a:=public.claim_live_media_source();lease:=(a->>'leaseId')::uuid;
 IF a->>'id' IS DISTINCT FROM source::text OR lease IS NULL THEN RAISE EXCEPTION 'Claim failed'; END IF;
 IF public.begin_live_media_dispatch(source,lease,repeat('b',64),'ClamAV fixture') IS NOT NULL THEN RAISE EXCEPTION 'Digest mismatch'; END IF;
 IF NOT public.fail_live_media_source(source,lease,'inconclusive') THEN RAISE EXCEPTION 'Retry failed'; END IF;
 b:=public.claim_live_media_source();
 IF b->>'leaseId' IS NULL OR b->>'leaseId'=lease::text THEN RAISE EXCEPTION 'Lease reused'; END IF;
 lease:=(b->>'leaseId')::uuid;
 a:=public.begin_live_media_dispatch(source,lease,repeat('a',64),'ClamAV fixture');
 reservation:=(a->>'reservationId')::uuid;
 IF reservation IS NULL THEN RAISE EXCEPTION 'Dispatch denied'; END IF;
 IF public.restart_live_media_source(creator,content,source) THEN RAISE EXCEPTION 'Dispatching upload could be superseded';END IF;
 PERFORM public.apply_mux_live_snapshot(reservation,'fixture_media_upload',NULL,NULL,'waiting');
 PERFORM public.apply_mux_live_snapshot(reservation,'fixture_media_upload','fixture_media_asset','fixture_media_playback','ready');
 IF EXISTS(SELECT 1 FROM public.content_assets WHERE content_id=content) THEN RAISE EXCEPTION 'Premature clean release'; END IF;
 IF public.finish_live_media_dispatch(source,lease,'fixture_wrong_upload') THEN RAISE EXCEPTION 'Foreign upload'; END IF;
 IF NOT public.finish_live_media_dispatch(source,lease,'fixture_media_upload') THEN RAISE EXCEPTION 'Finish failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.content_assets WHERE content_id=content AND scan_verdict='clean' AND processing_status='ready' AND private_object_key='private/mux/fixture_media_asset') THEN RAISE EXCEPTION 'Clean source not bound'; END IF;
END $$;
ROLLBACK;
