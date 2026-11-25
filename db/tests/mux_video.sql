BEGIN;
INSERT INTO auth.users(id) VALUES('f1410000-0000-4000-8000-000000000001'),('f1410000-0000-4000-8000-000000000002'),('f1410000-0000-4000-8000-000000000003');
INSERT INTO public.institutions(id,slug,name) VALUES('f1420000-0000-4000-8000-000000000001','fixture-mux-14','Synthetic');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('f1430000-0000-4000-8000-000000000001','f1420000-0000-4000-8000-000000000001','fixture','Synthetic');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('f1440000-0000-4000-8000-000000000001','f1420000-0000-4000-8000-000000000001','f1430000-0000-4000-8000-000000000001','MUX14','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) VALUES
 ('f1410000-0000-4000-8000-000000000001','f1420000-0000-4000-8000-000000000001','Synthetic creator',now()),
 ('f1410000-0000-4000-8000-000000000002','f1420000-0000-4000-8000-000000000001','Synthetic buyer',now());
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash)
VALUES('f1450000-0000-4000-8000-000000000001','f1410000-0000-4000-8000-000000000001','f1420000-0000-4000-8000-000000000001','f1440000-0000-4000-8000-000000000001','Synthetic Mux lesson',now(),'fixture_mux_key_14',repeat('a',64));
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.mux_video_uploads','SELECT') OR
 has_function_privilege('authenticated','public.apply_mux_test_snapshot(uuid,text,text,text,text)','EXECUTE')
 OR has_function_privilege('anon','public.authorized_mux_test_playback(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Mux storage authorization unsafe'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE creator uuid:='f1410000-0000-4000-8000-000000000001'; buyer uuid:='f1410000-0000-4000-8000-000000000002';
 lesson uuid:='f1450000-0000-4000-8000-000000000001'; r jsonb; reservation uuid;
BEGIN
 IF public.reserve_mux_test_upload(buyer,lesson) IS NOT NULL THEN RAISE EXCEPTION 'Cross-owner upload'; END IF;
 r:=public.reserve_mux_test_upload(creator,lesson);reservation:=(r->>'id')::uuid;
 IF r->>'create' IS DISTINCT FROM 'true' OR reservation IS NULL THEN RAISE EXCEPTION 'Reservation failed'; END IF;
 IF public.reserve_mux_test_upload(creator,lesson)->>'create' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Duplicate provider creation'; END IF;
 IF public.apply_mux_test_snapshot(reservation,'fixture_upload_14',NULL,NULL,'waiting')->>'state' IS DISTINCT FROM 'waiting' THEN RAISE EXCEPTION 'Waiting state failed'; END IF;
 IF public.apply_mux_test_snapshot(reservation,'fixture_upload_14','fixture_asset_14','fixture_playback_14','ready')->>'state' IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'Ready state failed'; END IF;
 IF public.apply_mux_test_snapshot(reservation,'fixture_upload_14','fixture_asset_14',NULL,'processing')->>'state' IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'Stale downgrade'; END IF;
 IF public.apply_mux_test_snapshot(reservation,'other_upload_14','fixture_asset_14',NULL,'processing') IS NOT NULL THEN RAISE EXCEPTION 'Upload binding changed'; END IF;
 IF public.authorized_mux_test_playback(creator,lesson) IS NOT NULL THEN RAISE EXCEPTION 'Draft playback issued'; END IF;
END $$;
RESET ROLE;
UPDATE public.content_items SET status='published',reviewer_id='f1410000-0000-4000-8000-000000000003',review_reason='Synthetic approval',reviewed_at=now(),published_at=now()
WHERE id='f1450000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF public.authorized_mux_test_playback('f1410000-0000-4000-8000-000000000001','f1450000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'Mux ready bypassed clean scan'; END IF;
END $$;
-- Synthetic clean record simulates separately verified fixture; no provider scan.
INSERT INTO public.content_assets(content_id,private_object_key,mime_type,bytes,processing_status,scan_verdict)
VALUES('f1450000-0000-4000-8000-000000000001','private/mux/fixture_asset_14','video/mp4',100,'ready','clean');
DO $$ BEGIN
 IF public.authorized_mux_test_playback('f1410000-0000-4000-8000-000000000002','f1450000-0000-4000-8000-000000000001') IS NULL THEN RAISE EXCEPTION 'Free eligible viewer denied'; END IF;
END $$;
INSERT INTO public.listings(id,content_id,creator_id,price_kobo) VALUES('f1460000-0000-4000-8000-000000000001','f1450000-0000-4000-8000-000000000001','f1410000-0000-4000-8000-000000000001',20000);
DO $$ BEGIN
 IF public.authorized_mux_test_playback('f1410000-0000-4000-8000-000000000002','f1450000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'Unpaid viewer allowed'; END IF;
END $$;
INSERT INTO public.orders(id,buyer_id,listing_id,content_id,creator_id,idempotency_key,amount_kobo,platform_fee_bps,platform_fee_kobo,creator_gross_share_kobo,environment,status)
VALUES('f1470000-0000-4000-8000-000000000001','f1410000-0000-4000-8000-000000000002','f1460000-0000-4000-8000-000000000001','f1450000-0000-4000-8000-000000000001','f1410000-0000-4000-8000-000000000001','fixture_mux_order_14',20000,0,0,20000,'test','paid');
INSERT INTO public.entitlements(buyer_id,content_id,order_id) VALUES('f1410000-0000-4000-8000-000000000002','f1450000-0000-4000-8000-000000000001','f1470000-0000-4000-8000-000000000001');
DO $$ BEGIN
 IF public.authorized_mux_test_playback('f1410000-0000-4000-8000-000000000002','f1450000-0000-4000-8000-000000000001') IS NULL THEN RAISE EXCEPTION 'Paid test buyer denied'; END IF;
END $$;
UPDATE public.entitlements SET state='revoked' WHERE order_id='f1470000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF public.authorized_mux_test_playback('f1410000-0000-4000-8000-000000000002','f1450000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'Revoked playback allowed'; END IF;
END $$;
UPDATE public.entitlements SET state='active' WHERE order_id='f1470000-0000-4000-8000-000000000001';
INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_view) VALUES('f1410000-0000-4000-8000-000000000001','f1410000-0000-4000-8000-000000000002',true);
DO $$ DECLARE r uuid; BEGIN
 IF public.authorized_mux_test_playback('f1410000-0000-4000-8000-000000000002','f1450000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'Blocked playback allowed'; END IF;
 SELECT id INTO r FROM public.mux_video_uploads WHERE content_id='f1450000-0000-4000-8000-000000000001';
 IF public.apply_mux_test_snapshot(r,'fixture_upload_14','fixture_asset_14',NULL,'deleted')->>'state' IS DISTINCT FROM 'deleted' THEN RAISE EXCEPTION 'Deletion failed'; END IF;
 IF public.apply_mux_test_snapshot(r,'fixture_upload_14','fixture_asset_14','fixture_playback_14','ready')->>'state' IS DISTINCT FROM 'deleted' THEN RAISE EXCEPTION 'Deleted asset reopened'; END IF;
 IF public.authorized_mux_test_playback('f1410000-0000-4000-8000-000000000001','f1450000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'Deleted playback allowed'; END IF;
END $$;
ROLLBACK;
