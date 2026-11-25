-- Run after migration 0021; rollback-only fixture, no real identities or bytes.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('f2210000-0000-4000-8000-000000000001'),('f2210000-0000-4000-8000-000000000002');
INSERT INTO public.institutions(id,slug,name) VALUES('f2220000-0000-4000-8000-000000000001','fixture-runtime-22','Synthetic');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('f2230000-0000-4000-8000-000000000001','f2220000-0000-4000-8000-000000000001','fixture','Synthetic');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('f2240000-0000-4000-8000-000000000001','f2220000-0000-4000-8000-000000000001','f2230000-0000-4000-8000-000000000001','RUNTIME22','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) VALUES('f2210000-0000-4000-8000-000000000001','f2220000-0000-4000-8000-000000000001','Synthetic',now());
INSERT INTO public.platform_staff(user_id,role,active) VALUES('f2210000-0000-4000-8000-000000000002','moderator',true);
INSERT INTO public.verification_requests(user_id,institution_id,method,status,private_evidence_path,expires_at)
 VALUES('f2210000-0000-4000-8000-000000000001','f2220000-0000-4000-8000-000000000001','manual_id','pending','private/synthetic-only',now()+interval '1 hour');
DO $$ BEGIN
 IF NOT has_table_privilege('service_role','public.content_items','SELECT')
 OR NOT has_column_privilege('service_role','public.content_items','creation_key','INSERT')
 OR NOT has_column_privilege('service_role','public.content_items','status','UPDATE')
 OR NOT has_column_privilege('service_role','public.audit_events','action','INSERT')
 OR has_column_privilege('service_role','public.content_items','creator_id','UPDATE')
 OR has_table_privilege('service_role','public.content_items','DELETE')
 OR has_table_privilege('service_role','public.ledger_entries','INSERT')
 OR has_table_privilege('service_role','public.entitlements','INSERT')
 OR has_table_privilege('service_role','public.orders','UPDATE')
 OR has_table_privilege('service_role','public.student_profiles','UPDATE')
 OR has_table_privilege('service_role','public.audit_events','UPDATE')
 THEN RAISE EXCEPTION 'Unexpected service runtime privilege'; END IF;
 IF NOT has_column_privilege('authenticated','public.verification_requests','status','SELECT')
 OR has_column_privilege('authenticated','public.verification_requests','private_evidence_path','SELECT')
 OR has_column_privilege('authenticated','public.verification_requests','reviewer_id','SELECT')
 OR NOT has_column_privilege('authenticated','public.content_comments','body','SELECT')
 OR has_column_privilege('authenticated','public.content_comments','creation_key','SELECT')
 OR has_column_privilege('authenticated','public.content_comments','creation_hash','SELECT')
 OR has_column_privilege('anon','public.content_comments','body','SELECT')
 THEN RAISE EXCEPTION 'Private client columns exposed'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE item uuid; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id='f2210000-0000-4000-8000-000000000001')
 OR NOT EXISTS(SELECT 1 FROM public.platform_staff WHERE user_id='f2210000-0000-4000-8000-000000000002')
 OR NOT EXISTS(SELECT 1 FROM public.courses WHERE id='f2240000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'Trusted REST read privilege missing'; END IF;
 INSERT INTO public.content_items(creator_id,institution_id,course_id,title,rights_attested_at,status,creation_key,creation_hash)
 VALUES('f2210000-0000-4000-8000-000000000001','f2220000-0000-4000-8000-000000000001',
 'f2240000-0000-4000-8000-000000000001','Synthetic draft',now(),'draft','fixture_runtime_key_22',repeat('a',64))
 RETURNING id INTO item;
 PERFORM set_config('fixture.runtime.item',item::text,true);
 BEGIN
  UPDATE public.content_items SET creator_id='f2210000-0000-4000-8000-000000000002' WHERE id=item;
  RAISE EXCEPTION 'Creator ownership rewrite permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
INSERT INTO public.content_assets(content_id,private_object_key,mime_type,bytes,processing_status,scan_verdict)
 VALUES(current_setting('fixture.runtime.item')::uuid,'private/runtime-fixture-22','image/png',100,'ready','clean');
SET LOCAL ROLE service_role;
DO $$ DECLARE item uuid:=current_setting('fixture.runtime.item')::uuid; BEGIN
 IF NOT public.submit_content_for_review(item,'f2210000-0000-4000-8000-000000000001','draft')
 THEN RAISE EXCEPTION 'Invoker submission failed'; END IF;
 UPDATE public.content_items SET status='published',reviewer_id='f2210000-0000-4000-8000-000000000002',
 review_reason='Synthetic approval',reviewed_at=now(),published_at=now() WHERE id=item;
 IF NOT FOUND OR (SELECT count(*) FROM public.audit_events WHERE target_id=item AND action IN ('lesson.review.submitted','lesson.moderated.published'))<>2
 THEN RAISE EXCEPTION 'Atomic moderation audit failed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM private_evidence_path FROM public.verification_requests;
  RAISE EXCEPTION 'Evidence path read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM creation_hash FROM public.content_comments;
  RAISE EXCEPTION 'Comment internal hash read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
