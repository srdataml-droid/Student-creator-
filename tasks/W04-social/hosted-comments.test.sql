\set ON_ERROR_STOP on
BEGIN;
-- CI-only session fixtures inside this rollback transaction.
UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at,now()) WHERE email_confirmed_at IS NULL;
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users ON CONFLICT(id) DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true), set_config('request.jwt.claims',jsonb_build_object('sub','22222222-2222-4222-8222-222222222222','role','authenticated','session_id','22222222-2222-4222-8222-222222222222')::text,true);
DO $$ DECLARE root uuid; child uuid; BEGIN
 root:=(public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','{"text":"Synthetic paid learner question","creationKey":"hosted_paid_comment_001"}')->>'id')::uuid;
 child:=(public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',jsonb_build_object('text','Synthetic reply','creationKey','hosted_paid_comment_002','replyTo',root))->>'id')::uuid;
 IF (SELECT count(id) FROM public.content_comments WHERE id IN(root,child))<>2 THEN RAISE EXCEPTION 'paid comment/reply missing'; END IF;
 IF public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',jsonb_build_object('text','Synthetic reply','creationKey','hosted_paid_comment_002','replyTo',root))->>'replayed'<>'true' THEN RAISE EXCEPTION 'reply replay failed'; END IF;
 BEGIN PERFORM public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',jsonb_build_object('text','Nested reply','creationKey','hosted_paid_comment_003','replyTo',child)); RAISE EXCEPTION 'nested reply accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.social_comment_action('remove','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',jsonb_build_object('commentId',root));
 IF (SELECT count(id) FROM public.content_comments WHERE id IN(root,child))<>0 THEN RAISE EXCEPTION 'hidden parent or child exposed'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_comment) VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',true) ON CONFLICT(creator_id,viewer_id) DO UPDATE SET deny_comment=true;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') THEN RAISE EXCEPTION 'comment-only block changed paid view'; END IF;
 BEGIN PERFORM public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','{"text":"Comment despite restriction","creationKey":"hosted_paid_comment_004"}'); RAISE EXCEPTION 'comment restriction bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM public.creator_restrictions WHERE creator_id='11111111-1111-4111-8111-111111111111' AND viewer_id='22222222-2222-4222-8222-222222222222';
UPDATE public.entitlements SET state='revoked' WHERE buyer_id='22222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.social_comment_action('post','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','{"text":"Refunded entitlement","creationKey":"hosted_paid_comment_005"}'); RAISE EXCEPTION 'refund bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(id) FROM public.content_comments WHERE content_id='aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa')<>0 THEN RAISE EXCEPTION 'refunded thread exposed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: hosted comment/reply ownership, entitlement revocation, creator comment-only block and hidden descendants';
