-- Disposable GitHub Actions source database ONLY.
DO $$ BEGIN IF current_database()<>'campus_ci' THEN RAISE EXCEPTION 'Not disposable CI source'; END IF; END $$;
INSERT INTO auth.users(id) VALUES('f2010000-0000-4000-8000-000000000001'),('f2010000-0000-4000-8000-000000000002');
INSERT INTO public.institutions(id,slug,name) VALUES('f2020000-0000-4000-8000-000000000001','fixture-restore-20','Synthetic restore campus');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) VALUES
('f2010000-0000-4000-8000-000000000001','f2020000-0000-4000-8000-000000000001','Synthetic restore student A',now()),
('f2010000-0000-4000-8000-000000000002','f2020000-0000-4000-8000-000000000001','Synthetic restore student B',now());
SELECT public.record_verified_mux_delivery('fixture_restore_20',repeat('a',64),'video.asset.ready','fixture_asset_restore');
