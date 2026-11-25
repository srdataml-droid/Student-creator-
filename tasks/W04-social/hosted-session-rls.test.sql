\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.social_message_action('preference',_enabled=>true);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','Revocation fixture message');
DO $ BEGIN IF (SELECT count(*) FROM public.social_messages)<>1 THEN RAISE EXCEPTION 'active session cannot read own history'; END IF;
 IF public.social_session_state()->>'student'<>'true' OR public.social_session_state()->>'admin'<>'false' OR public.social_session_state()->>'userId'<>'22222222-2222-4222-8222-222222222222' THEN RAISE EXCEPTION 'student state incorrect'; END IF;
END $;
SELECT set_config('request.jwt.claim.session_id','11111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
 IF student_social_private.active_session() OR (SELECT count(*) FROM public.social_messages)<>0 THEN RAISE EXCEPTION 'foreign session accepted'; END IF;
 BEGIN PERFORM public.social_message_action('preference',_enabled=>true); RAISE EXCEPTION 'foreign session wrote preference'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.session_id','not-a-uuid',true);
DO $$ BEGIN IF student_social_private.active_session() THEN RAISE EXCEPTION 'invalid claim accepted'; END IF; END $$;
SELECT set_config('request.jwt.claim.session_id','22222222-2222-4222-8222-222222222222',true);
RESET ROLE;
UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE user_id='22222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF student_social_private.active_session() THEN RAISE EXCEPTION 'expired session accepted'; END IF; END $$;
RESET ROLE;
DELETE FROM auth.sessions WHERE user_id='22222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF student_social_private.active_session() OR (SELECT count(*) FROM public.social_messages)<>0 OR (SELECT count(*) FROM public.content_items)<>0 THEN RAISE EXCEPTION 'revoked session read data'; END IF;
 BEGIN PERFORM public.social_discover(); RAISE EXCEPTION 'revoked session discovered content'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM student_social_private.message_action('send','11111111-1111-4111-8111-111111111111','Blocked by revocation',NULL,NULL); RAISE EXCEPTION 'private helper bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.social_follow_action('11111111-1111-4111-8111-111111111111',true); RAISE EXCEPTION 'revoked follow'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.social_notification_action('preferences'); RAISE EXCEPTION 'revoked preferences'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','{"text":"Revoked comment","creationKey":"revocation_comment_01"}'); RAISE EXCEPTION 'revoked comment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.platform_staff SET role='admin' WHERE user_id='99999999-9999-4999-8999-999999999999';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
SELECT set_config('request.jwt.claim.session_id','99999999-9999-4999-8999-999999999999',true);
DO $ BEGIN IF public.social_session_state()->>'admin'<>'true' OR public.social_session_state()->>'student'<>'false' THEN RAISE EXCEPTION 'admin role state incorrect'; END IF; END $;
SELECT public.social_report_queue('message');
RESET ROLE;
DELETE FROM auth.sessions WHERE user_id='99999999-9999-4999-8999-999999999999';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.social_report_queue('message'); RAISE EXCEPTION 'revoked admin queue'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: current signed session, cross-subject claim, expiry and sign-out revocation checks';
