\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.social_set_creator_restriction('22222222-2222-4222-8222-222222222222',false,true,false);
SELECT public.social_message_action('preference',_enabled=>true);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$ BEGIN
 IF NOT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') THEN RAISE EXCEPTION 'comment restriction disabled paid view'; END IF;
 BEGIN PERFORM public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','{"text":"Restricted comment","creationKey":"restriction_comment_001"}'); RAISE EXCEPTION 'comment restriction bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM public.creator_restrictions)<>0 THEN RAISE EXCEPTION 'foreign restriction details leaked'; END IF;
END $$;
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','Comment-only restriction allows message');
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.social_set_creator_restriction('22222222-2222-4222-8222-222222222222',false,false,true);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$ BEGIN
 IF NOT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') THEN RAISE EXCEPTION 'message restriction disabled paid view'; END IF;
 BEGIN PERFORM public.social_message_action('send','11111111-1111-4111-8111-111111111111','Blocked message'); RAISE EXCEPTION 'message restriction bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.social_set_creator_restriction('22222222-2222-4222-8222-222222222222',true,false,false);
DO $$ BEGIN
 IF public.social_set_creator_restriction('22222222-2222-4222-8222-222222222222',true,false,false)->>'replayed'<>'true' THEN RAISE EXCEPTION 'restriction replay failed'; END IF;
 IF has_table_privilege(current_user,'public.social_creator_access_review_cases','SELECT') THEN RAISE EXCEPTION 'private finance handoff leaked'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$ BEGIN
 IF public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') THEN RAISE EXCEPTION 'view block did not revoke new access'; END IF;
 IF (SELECT count(*) FROM public.content_items WHERE id='aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa')<>0 THEN RAISE EXCEPTION 'view block metadata leaked'; END IF;
END $$;
SELECT public.social_message_action('send','11111111-1111-4111-8111-111111111111','View-only restriction allows message');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.social_creator_access_review_cases WHERE viewer_id='22222222-2222-4222-8222-222222222222')<>1 THEN RAISE EXCEPTION 'paid access review handoff missing or duplicated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.entitlements WHERE buyer_id='22222222-2222-4222-8222-222222222222' AND state='active') THEN RAISE EXCEPTION 'financial entitlement overwritten'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.social_set_creator_restriction('22222222-2222-4222-8222-222222222222',false,false,false);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$ BEGIN IF NOT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') THEN RAISE EXCEPTION 'unblock did not restore eligible access'; END IF; END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: independent creator restrictions, paid access review handoff and no financial mutation';
