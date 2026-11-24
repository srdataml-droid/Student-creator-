-- Disposable PostgreSQL Week 6 contract (NO hosted staging changes, money, real users or rooms).
\set ON_ERROR_STOP on
\echo 'Week 6: role-scoped classes and personalized tutoring, no client financial mutations'
BEGIN;
INSERT INTO auth.users(id) VALUES('33333333-3333-4333-8333-333333333333');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at)
VALUES('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Synthetic Third Student',now());
INSERT INTO public.interactive_classes(id,institution_id,course_id,host_id,title,starts_at,ends_at,capacity,price_kobo,room_name,creation_key)
VALUES('66666666-6666-4666-8666-666666666666',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
       '11111111-1111-4111-8111-111111111111',
       'Original night class',now()+interval '1 hour',now()+interval '2 hours',12,23000,
       'wk-class-66666666-6666-4666-8666-666666666666','week06-unique-key-2026');
INSERT INTO public.interactive_class_enrollments(class_id,student_id,state)
VALUES('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','enrolled');
INSERT INTO public.creator_availability(creator_id,slots_json)
VALUES('11111111-1111-4111-8111-111111111111','[{"day":2,"start":"19:00","end":"21:00"}]');
INSERT INTO public.personal_learning_requests(id,institution_id,student_id,creator_id,kind,description,quote_kobo,creation_key)
VALUES('77777777-7777-4777-8777-777777777777',
'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
'33333333-3333-4333-8333-333333333333',
'11111111-1111-4111-8111-111111111111','assignment_explanation',
'Please explain the reasoning and steps, not prepare assessed work for submission.',32000,'week06-service-unique-2026');
INSERT INTO public.learning_notifications(id,user_id,kind,resource_id,body)
VALUES('88888888-8888-4888-8888-888888888888',
'33333333-3333-4333-8333-333333333333','class_reminder',
'66666666-6666-4666-8666-666666666666','The night class is scheduled soon');
INSERT INTO public.learning_refund_reviews(id,resource_kind,resource_id,student_id,reason)
VALUES('99999999-9999-4999-8999-999999999998','class',
'66666666-6666-4666-8666-666666666666',
'33333333-3333-4333-8333-333333333333','Requires Week 5 verified settlement and policy');

-- Cross-institution referential integrity is not a UI-only check.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.interactive_classes(institution_id,course_id,host_id,title,starts_at,ends_at,capacity,price_kobo,room_name,creation_key)
    VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
    'Forged cross institution class',now()+interval '1 hour',now()+interval '2 hours',12,0,
    'wk-class-fake-cross','week06-illegal-cross-id');
    RAISE EXCEPTION 'Cross-campus class row inserted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

SET request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.interactive_classes;
 IF n<>1 THEN RAISE EXCEPTION 'Class visibility to eligible student not working: %',n;END IF;
 SELECT count(*) INTO n FROM public.interactive_class_enrollments;
 IF n<>1 THEN RAISE EXCEPTION 'Student enrollment not visible: %',n;END IF;
 SELECT count(*) INTO n FROM public.creator_availability;
 IF n<>0 THEN RAISE EXCEPTION 'Non-owner read creator slots directly despite private profile gate: %',n;END IF;
 SELECT count(*) INTO n FROM public.personal_learning_requests;
 IF n<>1 THEN RAISE EXCEPTION 'Requester cannot see own tutoring request: %',n;END IF;
 SELECT count(*) INTO n FROM public.learning_notifications;
 IF n<>1 THEN RAISE EXCEPTION 'Own reminder not visible: %',n;END IF;
 BEGIN
   PERFORM 1 FROM public.learning_refund_reviews;
   RAISE EXCEPTION 'Student could read server-only refund queue';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   INSERT INTO public.interactive_class_enrollments(class_id,student_id,state) VALUES(
    '66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','withdrawn');
   RAISE EXCEPTION 'Browser could forge enrollment writes';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   UPDATE public.personal_learning_requests SET state='completed'
   WHERE id='77777777-7777-4777-8777-777777777777';
   RAISE EXCEPTION 'Browser completed tutoring workflow directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.creator_availability;
 IF n<>1 THEN RAISE EXCEPTION 'Creator cannot read own availability: %',n;END IF;
 SELECT count(*) INTO n FROM public.personal_learning_requests;
 IF n<>1 THEN RAISE EXCEPTION 'Creator cannot see assigned request: %',n;END IF;
 SELECT count(*) INTO n FROM public.learning_notifications;
 IF n<>0 THEN RAISE EXCEPTION 'Creator read another student reminder: %',n;END IF;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.interactive_classes;
 IF n<>0 THEN RAISE EXCEPTION 'Cross-campus class leak: %',n;END IF;
 SELECT count(*) INTO n FROM public.personal_learning_requests;
 IF n<>0 THEN RAISE EXCEPTION 'Cross-campus help-request leak: %',n;END IF;
 SELECT count(*) INTO n FROM public.learning_notifications;
 IF n<>0 THEN RAISE EXCEPTION 'Cross-account private notification leak: %',n;END IF;
END $$;
RESET ROLE;

SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.interactive_classes;
    RAISE EXCEPTION 'Anonymous browser read restricted class details';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: Week 6 verified/campus-scoped browser reads, server-only writes, and private financial review'
