BEGIN;
INSERT INTO auth.users(id,email_confirmed_at,is_anonymous) VALUES
 ('f2110000-0000-4000-8000-000000000001',now(),false),
 ('f2110000-0000-4000-8000-000000000002',now(),false);
INSERT INTO auth.sessions(id,user_id,not_after) VALUES
 ('f2120000-0000-4000-8000-000000000001','f2110000-0000-4000-8000-000000000001',now()+interval '1 hour'),
 ('f2120000-0000-4000-8000-000000000002','f2110000-0000-4000-8000-000000000002',now()+interval '1 hour'),
 ('f2120000-0000-4000-8000-000000000003','f2110000-0000-4000-8000-000000000001',now()-interval '1 hour');
INSERT INTO public.institutions(id,slug,name) VALUES ('f2130000-0000-4000-8000-000000000001','fixture-session-21','Synthetic campus');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES ('f2140000-0000-4000-8000-000000000001','f2130000-0000-4000-8000-000000000001','fixture','Synthetic');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES ('f2150000-0000-4000-8000-000000000001','f2130000-0000-4000-8000-000000000001','f2140000-0000-4000-8000-000000000001','SESSION21','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) VALUES
 ('f2110000-0000-4000-8000-000000000001','f2130000-0000-4000-8000-000000000001','Synthetic A',now()),
 ('f2110000-0000-4000-8000-000000000002','f2130000-0000-4000-8000-000000000001','Synthetic B',now());
INSERT INTO public.verification_requests(id,user_id,institution_id,method,status,expires_at) VALUES
 ('f2160000-0000-4000-8000-000000000001','f2110000-0000-4000-8000-000000000001','f2130000-0000-4000-8000-000000000001','manual_id','pending',now()+interval '1 hour');
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash) VALUES
 ('f2170000-0000-4000-8000-000000000001','f2110000-0000-4000-8000-000000000001','f2130000-0000-4000-8000-000000000001','f2150000-0000-4000-8000-000000000001','Synthetic draft',now(),'fixture_session_draft_21',repeat('a',64)),
 ('f2170000-0000-4000-8000-000000000002','f2110000-0000-4000-8000-000000000002','f2130000-0000-4000-8000-000000000001','f2150000-0000-4000-8000-000000000001','Synthetic published',now(),'fixture_session_public_21',repeat('b',64));
UPDATE public.content_items SET status='published',reviewer_id='f2110000-0000-4000-8000-000000000001',review_reason='Synthetic review',reviewed_at=now(),published_at=now()
 WHERE id='f2170000-0000-4000-8000-000000000002';
INSERT INTO public.listings(id,content_id,creator_id,price_kobo,state) VALUES
 ('f2180000-0000-4000-8000-000000000001','f2170000-0000-4000-8000-000000000002','f2110000-0000-4000-8000-000000000002',20000,'active');
INSERT INTO public.orders(id,buyer_id,listing_id,content_id,creator_id,idempotency_key,amount_kobo,platform_fee_bps,platform_fee_kobo,creator_gross_share_kobo,environment,status) VALUES
 ('f2190000-0000-4000-8000-000000000001','f2110000-0000-4000-8000-000000000001','f2180000-0000-4000-8000-000000000001','f2170000-0000-4000-8000-000000000002','f2110000-0000-4000-8000-000000000002','fixture_session_order_21',20000,0,0,20000,'test','paid');
INSERT INTO public.entitlements(buyer_id,content_id,order_id) VALUES
 ('f2110000-0000-4000-8000-000000000001','f2170000-0000-4000-8000-000000000002','f2190000-0000-4000-8000-000000000001');
INSERT INTO public.content_comments(content_id,author_id,body,creation_key,creation_hash) VALUES
 ('f2170000-0000-4000-8000-000000000002','f2110000-0000-4000-8000-000000000002','Synthetic comment','fixture_session_comment_21',repeat('c',64));
DO $$ BEGIN
 IF has_schema_privilege('anon','student_creators_private','USAGE') OR
 has_function_privilege('anon','student_creators_private.current_session_active()','EXECUTE') OR
 NOT has_function_privilege('authenticated','student_creators_private.current_session_active()','EXECUTE')
 THEN RAISE EXCEPTION 'Private session predicate privileges unsafe'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE a uuid:='f2110000-0000-4000-8000-000000000001'; b uuid:='f2110000-0000-4000-8000-000000000002'; sid text;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','session_id','f2120000-0000-4000-8000-000000000001')::text,true);
 IF NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible()
 OR (SELECT count(*) FROM public.student_profiles WHERE user_id IN (a,b))<>1
 OR NOT EXISTS(SELECT 1 FROM public.verification_requests WHERE user_id=a)
 OR NOT EXISTS(SELECT 1 FROM public.content_items WHERE id='f2170000-0000-4000-8000-000000000001')
 OR NOT EXISTS(SELECT 1 FROM public.orders WHERE buyer_id=a)
 OR NOT EXISTS(SELECT 1 FROM public.entitlements WHERE buyer_id=a)
 OR NOT EXISTS(SELECT 1 FROM public.content_comments WHERE content_id='f2170000-0000-4000-8000-000000000002')
 THEN RAISE EXCEPTION 'Active session lost expected own access'; END IF;
 INSERT INTO public.content_likes(user_id,content_id) VALUES(a,'f2170000-0000-4000-8000-000000000002');
 FOREACH sid IN ARRAY ARRAY['f2120000-0000-4000-8000-000000000002','f2120000-0000-4000-8000-000000000003','malformed','f2120000-0000-4000-8000-000000000004'] LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','session_id',sid)::text,true);
  IF student_creators_private.current_session_active() OR public.current_student_eligible() OR
   EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id=a) OR EXISTS(SELECT 1 FROM public.verification_requests WHERE user_id=a) OR
   EXISTS(SELECT 1 FROM public.content_items WHERE id='f2170000-0000-4000-8000-000000000001') OR
   EXISTS(SELECT 1 FROM public.orders WHERE buyer_id=a) OR EXISTS(SELECT 1 FROM public.entitlements WHERE buyer_id=a) OR
   EXISTS(SELECT 1 FROM public.content_likes WHERE user_id=a) OR EXISTS(SELECT 1 FROM public.content_comments WHERE content_id='f2170000-0000-4000-8000-000000000002') OR
   public.can_view_published_content('f2170000-0000-4000-8000-000000000002')
   THEN RAISE EXCEPTION 'Inactive/wrong session bypassed RLS or RPC'; END IF;
  DELETE FROM public.content_likes WHERE user_id=a;
  IF FOUND THEN RAISE EXCEPTION 'Stale session deleted like'; END IF;
 END LOOP;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 IF student_creators_private.current_session_active() THEN RAISE EXCEPTION 'Missing session accepted'; END IF;
END $$;
RESET ROLE;
DELETE FROM auth.sessions WHERE id='f2120000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f2110000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f2120000-0000-4000-8000-000000000001"}',true);
DO $$ BEGIN
 IF student_creators_private.current_session_active() OR EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id='f2110000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Deleted session remained usable'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.content_items WHERE id='f2170000-0000-4000-8000-000000000002')
 OR EXISTS(SELECT 1 FROM public.content_items WHERE id='f2170000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Anonymous public preview contract changed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
