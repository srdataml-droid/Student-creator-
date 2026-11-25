\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES('42000000-0000-4000-8000-000000000001');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) VALUES('42000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Synthetic third reader',now());
-- CI-only session fixtures inside this rollback transaction.
UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at,now()) WHERE email_confirmed_at IS NULL;
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users ON CONFLICT(id) DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true), set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated','session_id','11111111-1111-4111-8111-111111111111')::text,true);
SELECT public.social_message_action('preference',_enabled=>true);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true), set_config('request.jwt.claims',jsonb_build_object('sub','22222222-2222-4222-8222-222222222222','role','authenticated','session_id','22222222-2222-4222-8222-222222222222')::text,true);
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','First private message');
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','Second private message');
SELECT set_config('request.jwt.claim.sub','42000000-0000-4000-8000-000000000001',true), set_config('request.jwt.claims',jsonb_build_object('sub','42000000-0000-4000-8000-000000000001','role','authenticated','session_id','42000000-0000-4000-8000-000000000001')::text,true);
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','Separate conversation');
DO $$ BEGIN
 IF jsonb_array_length(public.social_thread_page('22222222-2222-4222-8222-222222222222')->'messages')<>0 THEN RAISE EXCEPTION 'foreign pair history leaked'; END IF;
 BEGIN PERFORM public.social_inbox_page('22222222-2222-4222-8222-222222222222'); RAISE EXCEPTION 'unowned inbox cursor'; EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true), set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated','session_id','11111111-1111-4111-8111-111111111111')::text,true);
DO $$ DECLARE p jsonb; q jsonb; mid uuid; BEGIN
 p:=public.social_inbox_page(NULL,1);
 IF jsonb_array_length(p->'inbox')<>1 OR p->>'nextBefore' IS NULL THEN RAISE EXCEPTION 'inbox page missing'; END IF;
 q:=public.social_inbox_page((p->>'nextBefore')::uuid,1);
 IF jsonb_array_length(q->'inbox')<>1 OR q->>'nextBefore' IS NOT NULL OR p->'inbox'->0->>'peerId'=q->'inbox'->0->>'peerId' THEN RAISE EXCEPTION 'inbox cursor incorrect'; END IF;
 p:=public.social_thread_page('22222222-2222-4222-8222-222222222222',NULL,1);
 IF jsonb_array_length(p->'messages')<>1 OR p->>'nextBefore' IS NULL THEN RAISE EXCEPTION 'thread page missing'; END IF;
 q:=public.social_thread_page('22222222-2222-4222-8222-222222222222',(p->>'nextBefore')::uuid,1);
 IF q->'messages'->0->>'body'<>'First private message' OR q->>'nextBefore' IS NOT NULL THEN RAISE EXCEPTION 'thread keyset incorrect'; END IF;
 mid:=(p->'messages'->0->>'id')::uuid;
 BEGIN PERFORM public.social_thread_page('42000000-0000-4000-8000-000000000001',mid,1); RAISE EXCEPTION 'foreign peer cursor accepted'; EXCEPTION WHEN no_data_found THEN NULL; END;
 PERFORM public.social_message_action('read','22222222-2222-4222-8222-222222222222',_ids=>ARRAY[mid]);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.social_inbox_page()->'inbox') AS x WHERE x->>'peerId'='22222222-2222-4222-8222-222222222222' AND x->>'unreadCount'='1') THEN RAISE EXCEPTION 'recipient unread count wrong'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: hosted DM keyset history, inbox paging, cross-pair cursor denial, unread counts';
