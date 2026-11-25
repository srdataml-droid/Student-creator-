BEGIN;
INSERT INTO auth.users(id) VALUES ('f1310000-0000-4000-8000-000000000001'),('f1310000-0000-4000-8000-000000000002'),('f1310000-0000-4000-8000-000000000003');
INSERT INTO public.institutions(id,slug,name) VALUES('f1320000-0000-4000-8000-000000000001','fixture-identity-13','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name) VALUES
 ('f1310000-0000-4000-8000-000000000001','f1320000-0000-4000-8000-000000000001','Synthetic');
INSERT INTO public.platform_staff(user_id,role,active) VALUES('f1310000-0000-4000-8000-000000000003','admin',true);
INSERT INTO public.verification_requests(id,user_id,institution_id,method,status,expires_at) VALUES
 ('f1330000-0000-4000-8000-000000000001','f1310000-0000-4000-8000-000000000001','f1320000-0000-4000-8000-000000000001','manual_id','pending',now()+interval '1 hour');
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.private_identity_uploads','SELECT')
 OR has_table_privilege('anon','public.private_identity_uploads','INSERT')
 OR has_function_privilege('authenticated','public.record_private_identity_scan(uuid,uuid,text,text,text)','EXECUTE')
 OR has_function_privilege('anon','public.reserve_private_identity_upload(uuid,uuid,text,integer,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Identity upload grants are unsafe'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE owner uuid:='f1310000-0000-4000-8000-000000000001'; other uuid:='f1310000-0000-4000-8000-000000000002';
 admin_id uuid:='f1310000-0000-4000-8000-000000000003'; req uuid:='f1330000-0000-4000-8000-000000000001';
 r jsonb; job jsonb; upload uuid; d text:=repeat('a',64);
BEGIN
 IF public.reserve_private_identity_upload(other,req,'application/pdf',100,d) IS NOT NULL THEN RAISE EXCEPTION 'Cross-account reserve'; END IF;
 r:=public.reserve_private_identity_upload(owner,req,'application/pdf',100,d);
 IF r IS NULL OR r->>'state'<>'reserved' THEN RAISE EXCEPTION 'Reservation failed'; END IF;
 upload:=(r->>'id')::uuid;
 IF public.reserve_private_identity_upload(owner,req,'application/pdf',100,d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'Replay changed object'; END IF;
 IF public.reserve_private_identity_upload(owner,req,'application/pdf',100,repeat('b',64)) IS DISTINCT FROM '{"conflict":true}'::jsonb THEN RAISE EXCEPTION 'Changed file accepted'; END IF;
 IF public.mark_private_identity_uploaded(other,req,upload,d) THEN RAISE EXCEPTION 'Cross-account finalization'; END IF;
 IF public.claim_private_identity_scan() IS NOT NULL THEN RAISE EXCEPTION 'Reserved file claimable'; END IF;
 IF NOT public.mark_private_identity_uploaded(owner,req,upload,d) THEN RAISE EXCEPTION 'Upload finalization failed'; END IF;
 IF public.get_private_identity_review_object(admin_id,req) IS NOT NULL THEN RAISE EXCEPTION 'Quarantined file accessible'; END IF;
 job:=public.claim_private_identity_scan();
 IF job->>'id' IS DISTINCT FROM upload::text OR job->>'leaseId' IS NULL THEN RAISE EXCEPTION 'Claim failed'; END IF;
 IF public.claim_private_identity_scan() IS NOT NULL THEN RAISE EXCEPTION 'Concurrent lease'; END IF;
 IF public.record_private_identity_scan(upload,gen_random_uuid(),d,'clean','synthetic-scanner') THEN RAISE EXCEPTION 'Wrong lease accepted'; END IF;
 IF public.record_private_identity_scan(upload,(job->>'leaseId')::uuid,repeat('b',64),'clean','synthetic-scanner') THEN RAISE EXCEPTION 'Mismatched digest accepted'; END IF;
 IF NOT public.record_private_identity_scan(upload,(job->>'leaseId')::uuid,d,'inconclusive','synthetic-scanner') THEN RAISE EXCEPTION 'Inconclusive state failed'; END IF;
 IF public.get_private_identity_review_object(admin_id,req) IS NOT NULL THEN RAISE EXCEPTION 'Inconclusive file accessible'; END IF;
 IF public.claim_private_identity_scan() IS NOT NULL THEN RAISE EXCEPTION 'Retry delay bypassed'; END IF;
 PERFORM set_config('test.identity.first_lease',job->>'leaseId',true);
END $$;
RESET ROLE;
UPDATE public.private_identity_uploads SET next_scan_at=now()-interval '1 second' WHERE request_id='f1330000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ DECLARE owner uuid:='f1310000-0000-4000-8000-000000000001'; other uuid:='f1310000-0000-4000-8000-000000000002';
 admin_id uuid:='f1310000-0000-4000-8000-000000000003'; req uuid:='f1330000-0000-4000-8000-000000000001';
 job jsonb; upload uuid; d text:=repeat('a',64);
BEGIN
 job:=public.claim_private_identity_scan();upload:=(job->>'id')::uuid;
 IF upload IS NULL OR job->>'leaseId'=current_setting('test.identity.first_lease') THEN RAISE EXCEPTION 'Retry lease missing'; END IF;
 IF public.record_private_identity_scan(upload,current_setting('test.identity.first_lease')::uuid,d,'clean','synthetic-scanner') THEN RAISE EXCEPTION 'Stale lease accepted'; END IF;
 IF NOT public.record_private_identity_scan(upload,(job->>'leaseId')::uuid,d,'clean','synthetic-scanner') THEN RAISE EXCEPTION 'Clean transition failed'; END IF;
 IF public.record_private_identity_scan(upload,(job->>'leaseId')::uuid,d,'malicious','synthetic-scanner') THEN RAISE EXCEPTION 'Terminal verdict changed'; END IF;
 IF public.get_private_identity_review_object(owner,req) IS NOT NULL OR public.get_private_identity_review_object(other,req) IS NOT NULL THEN RAISE EXCEPTION 'Nonstaff read'; END IF;
 IF public.get_private_identity_review_object(admin_id,req)->>'objectKey' IS DISTINCT FROM job->>'objectKey' THEN RAISE EXCEPTION 'Admin review failed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.verification_requests WHERE id='f1330000-0000-4000-8000-000000000001' AND status='pending' AND private_evidence_path IS NOT NULL)
 THEN RAISE EXCEPTION 'Evidence association changed approval state'; END IF;
 IF (SELECT count(*) FROM public.audit_events WHERE target_id='f1330000-0000-4000-8000-000000000001' AND action='identity.evidence.access_requested')<>1
 THEN RAISE EXCEPTION 'Access audit missing'; END IF;
END $$;
ROLLBACK;
