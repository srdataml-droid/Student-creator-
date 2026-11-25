\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.social_message_action('preference',_enabled=>true);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','Private synthetic notification test');
SELECT public.social_follow_action('11111111-1111-4111-8111-111111111111',true);
SELECT public.social_follow_action('11111111-1111-4111-8111-111111111111',true);
SELECT public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','{"text":"A paid comment","creationKey":"notification_comment_001"}');
DO $$ BEGIN
 IF (SELECT count(id) FROM public.social_notifications)<>0 THEN RAISE EXCEPTION 'actor sees recipient notification'; END IF;
 IF has_column_privilege(current_user,'public.social_notifications','actor_id','SELECT') OR has_table_privilege(current_user,'public.social_notifications','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'notification metadata or write leak'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$ DECLARE mid uuid; BEGIN
 IF (SELECT count(id) FROM public.social_notifications)<>3 THEN RAISE EXCEPTION 'event notification missing or duplicate'; END IF;
 SELECT id INTO STRICT mid FROM public.social_notifications WHERE kind='message';
 PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 BEGIN PERFORM public.social_notification_action('read',jsonb_build_object('id',mid)); RAISE EXCEPTION 'foreign mark read accepted'; EXCEPTION WHEN no_data_found THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 IF public.social_notification_action('read',jsonb_build_object('id',mid))->>'marked'<>'1' THEN RAISE EXCEPTION 'notification not marked'; END IF;
 IF public.social_notification_action('read',jsonb_build_object('id',mid))->>'marked'<>'0' THEN RAISE EXCEPTION 'notification read replay failed'; END IF;
END $$;
SELECT public.social_notification_action('preferences','{"messages":false,"social":false,"community":true}');
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','Delivered with notifications off');
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
 IF (SELECT count(id) FROM public.social_notifications)<>3 OR (SELECT count(*) FROM public.social_messages)<>2 THEN RAISE EXCEPTION 'notification preferences altered delivery or ignored consent'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: notification event dedup, recipient-only read, explicit preferences and independent message delivery';
