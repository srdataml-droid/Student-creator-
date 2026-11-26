BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('6c000000-0000-4000-8000-000000000001','host@example.invalid',now()),('6c000000-0000-4000-8000-000000000002','learner@example.invalid',now()),('6c000000-0000-4000-8000-000000000003','other@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users WHERE id::text LIKE '6c000000-%';
INSERT INTO public.institutions(id,slug,name) VALUES('6c000000-0000-4000-8000-000000000010','fixture-class-1','Synthetic campus');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('6c000000-0000-4000-8000-000000000011','6c000000-0000-4000-8000-000000000010','science','Synthetic science');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('6c000000-0000-4000-8000-000000000012','6c000000-0000-4000-8000-000000000010','6c000000-0000-4000-8000-000000000011','CLASS1','Synthetic class');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'6c000000-0000-4000-8000-000000000010','Synthetic student',now() FROM auth.users WHERE id::text LIKE '6c000000-%';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE v jsonb; c jsonb; BEGIN
 v:=jsonb_build_object('courseId','6c000000-0000-4000-8000-000000000012','startsAt',now()+interval '5 minutes','endsAt',now()+interval '2 hours','title','Synthetic free class','capacity',2,'creationKey','fixture-class-creation-key','priceKobo',0);
 c:=public.hosted_learning_action('create_class',v);
 IF public.hosted_learning_action('create_class',v)->>'id'<>c->>'id' THEN RAISE EXCEPTION 'class replay failed'; END IF;
 PERFORM set_config('fixture.class_id',c->>'id',true);
 BEGIN PERFORM public.hosted_learning_action('create_class',v||'{"priceKobo":20000}'); RAISE EXCEPTION 'paid class accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF has_table_privilege(current_user,'public.interactive_classes','INSERT') OR has_column_privilege(current_user,'public.interactive_classes','room_name','SELECT') THEN RAISE EXCEPTION 'unsafe direct class permissions'; END IF;
 PERFORM public.hosted_learning_action('open',jsonb_build_object('classId',c->>'id'));
END $$;
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000002"}',true);
SELECT public.hosted_learning_action('enroll',jsonb_build_object('classId',current_setting('fixture.class_id')));
DO $$ BEGIN
 BEGIN PERFORM public.hosted_learning_action('complete',jsonb_build_object('classId',current_setting('fixture.class_id'))); RAISE EXCEPTION 'nonhost completed class'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege(current_user,'public.mark_hosted_class_ready(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'client provider mutation'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000003',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000003"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.hosted_learning_action('enroll',jsonb_build_object('classId',current_setting('fixture.class_id'))); RAISE EXCEPTION 'capacity bypass'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE c uuid:=current_setting('fixture.class_id')::uuid; h uuid:='6c000000-0000-4000-8000-000000000001'; l uuid:='6c000000-0000-4000-8000-000000000002'; BEGIN
 IF public.authorized_hosted_class_room(l,c) IS NOT NULL THEN RAISE EXCEPTION 'participant before provider ready'; END IF;
 IF NOT public.mark_hosted_class_ready(h,c) OR public.authorized_hosted_class_room(l,c)->>'role'<>'participant' THEN RAISE EXCEPTION 'ready grant failed'; END IF;
 IF NOT public.record_hosted_class_presence('EV_fixture_001',c,l,'joined') OR public.record_hosted_class_presence('EV_fixture_001',c,l,'joined') THEN RAISE EXCEPTION 'presence replay failed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000001"}',true);
SELECT public.hosted_learning_action('complete',jsonb_build_object('classId',current_setting('fixture.class_id')));
RESET ROLE;
DO $$ DECLARE c uuid:=current_setting('fixture.class_id')::uuid; j jsonb; BEGIN
 IF public.authorized_hosted_class_room('6c000000-0000-4000-8000-000000000001',c) IS NOT NULL THEN RAISE EXCEPTION 'closed room granted'; END IF;
 j:=public.claim_hosted_learning_cleanup();
 IF j->>'classId'<>c::text OR public.claim_hosted_learning_cleanup() IS NOT NULL THEN RAISE EXCEPTION 'cleanup lease not exclusive'; END IF;
 IF public.finish_hosted_learning_cleanup(c,NULL,gen_random_uuid(),true) OR NOT public.finish_hosted_learning_cleanup(c,NULL,(j->>'lease')::uuid,true) THEN RAISE EXCEPTION 'cleanup lease validation failed'; END IF;
 IF (SELECT state FROM public.learning_room_closures WHERE class_id=c)<>'pending' THEN RAISE EXCEPTION 'second cleanup skipped'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000002"}',true);
SELECT set_config('fixture.help_id',public.hosted_learning_action('request_help','{"creatorId":"6c000000-0000-4000-8000-000000000001","description":"Please explain this synthetic lesson problem","kind":"tutoring","creationKey":"fixture-help-request-key","budgetKobo":0}')->>'id',true);
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000001"}',true);
SELECT public.hosted_learning_action('quote_help',jsonb_build_object('requestId',current_setting('fixture.help_id'),'quoteKobo',0));
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000002"}',true);
SELECT public.hosted_learning_action('accept_help',jsonb_build_object('requestId',current_setting('fixture.help_id'),'quoteKobo',0));
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000001"}',true);
SELECT public.hosted_learning_action('start_help',jsonb_build_object('requestId',current_setting('fixture.help_id')));
SELECT public.hosted_learning_action('submit_help',jsonb_build_object('requestId',current_setting('fixture.help_id')));
SELECT set_config('request.jwt.claim.sub','6c000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"6c000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"6c000000-0000-4000-8000-000000000002"}',true);
SELECT public.hosted_learning_action('complete_help',jsonb_build_object('requestId',current_setting('fixture.help_id')));
RESET ROLE;
ROLLBACK;
