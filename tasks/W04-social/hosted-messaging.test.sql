-- Rollback-only synthetic PostgreSQL contract. Not a hosted Auth test.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES('40000000-0000-4000-8000-000000000001'),('40000000-0000-4000-8000-000000000002'),('40000000-0000-4000-8000-000000000003'),('40000000-0000-4000-8000-000000000004');
INSERT INTO public.institutions(id,slug,name) VALUES('40000000-0000-4000-8000-000000000010','social-contract','Synthetic social school');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('40000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000010','science','Science');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('40000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000011','SOC101','Synthetic course');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at)
SELECT id,'40000000-0000-4000-8000-000000000010','Synthetic Student',CASE WHEN id='40000000-0000-4000-8000-000000000004' THEN NULL ELSE now() END FROM auth.users WHERE id::text LIKE '40000000-0000-4000-8000-00000000000%';
INSERT INTO public.content_items(id,creator_id,institution_id,course_id,title,rights_attested_at,creation_key,creation_hash,status,reviewer_id,review_reason,reviewed_at,published_at)
VALUES('40000000-0000-4000-8000-000000000013','40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000012','Synthetic approved work',now(),'synthetic_social_001',repeat('a',64),'published','40000000-0000-4000-8000-000000000003','Synthetic approval',now(),now());
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF has_table_privilege(current_user,'public.social_messages','SELECT') OR has_function_privilege(current_user,'public.social_message_action(text,uuid,text,boolean,uuid[])','EXECUTE') THEN RAISE EXCEPTION 'anon social access'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF has_table_privilege(current_user,'public.social_messages','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'direct message mutation grant'; END IF;
 BEGIN PERFORM public.social_message_action('send','40000000-0000-4000-8000-000000000002','Before consent'); RAISE EXCEPTION 'consent bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
SELECT public.social_message_action('preference',_enabled=>true);
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
SELECT public.social_message_action('send','40000000-0000-4000-8000-000000000002','Private synthetic question');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.social_messages)<>1 THEN RAISE EXCEPTION 'sender history missing'; END IF;
 BEGIN PERFORM public.social_message_action('read','40000000-0000-4000-8000-000000000002',_ids=>ARRAY[(SELECT id FROM public.social_messages LIMIT 1)]); RAISE EXCEPTION 'sender acknowledged outbound'; EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.social_messages)<>0 OR (SELECT count(*) FROM public.social_message_preferences)<>0 THEN RAISE EXCEPTION 'third party data leak'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000004',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.social_messages)<>0 THEN RAISE EXCEPTION 'pending user data leak'; END IF;
 BEGIN PERFORM public.social_message_action('send','40000000-0000-4000-8000-000000000002','Pending user'); RAISE EXCEPTION 'pending sender bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
DO $$ DECLARE m uuid; BEGIN
 SELECT id INTO STRICT m FROM public.social_messages;
 IF public.social_message_action('read','40000000-0000-4000-8000-000000000001',_ids=>ARRAY[m])->>'marked'<>'1' THEN RAISE EXCEPTION 'ack failed'; END IF;
 IF public.social_message_action('read','40000000-0000-4000-8000-000000000001',_ids=>ARRAY[m])->>'marked'<>'0' THEN RAISE EXCEPTION 'ack replay failed'; END IF;
 IF (SELECT count(*) FROM public.social_message_reads)<>1 THEN RAISE EXCEPTION 'recipient read missing'; END IF;
END $$;
SELECT public.social_message_action('send','40000000-0000-4000-8000-000000000001','Reply to established peer');
SELECT public.social_message_action('block','40000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.social_message_reads)<>0 OR (SELECT count(*) FROM public.social_contact_blocks)<>0 THEN RAISE EXCEPTION 'private read/block leak'; END IF;
 BEGIN PERFORM public.social_message_action('send','40000000-0000-4000-8000-000000000002','Blocked sender'); RAISE EXCEPTION 'block bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
SELECT public.social_message_action('unblock','40000000-0000-4000-8000-000000000001');
RESET ROLE;
INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_message) VALUES('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.social_message_action('send','40000000-0000-4000-8000-000000000002','Creator denied'); RAISE EXCEPTION 'creator message restriction bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.creator_restrictions SET deny_message=false WHERE creator_id='40000000-0000-4000-8000-000000000002' AND viewer_id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 FOR i IN 1..29 LOOP PERFORM public.social_message_action('send','40000000-0000-4000-8000-000000000002','Synthetic quota '||i); END LOOP;
 BEGIN PERFORM public.social_message_action('send','40000000-0000-4000-8000-000000000002','Exceeds quota'); RAISE EXCEPTION 'quota bypass' USING ERRCODE='22000'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MESSAGE_RATE_LIMIT' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: social message consent, roles, read privacy, blocks, creator restriction and quota';
