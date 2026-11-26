\set ON_ERROR_STOP on
BEGIN;
-- CI-only session fixtures inside this rollback transaction.
UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at,now()) WHERE email_confirmed_at IS NULL;
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users ON CONFLICT(id) DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true), set_config('request.jwt.claims',jsonb_build_object('sub','22222222-2222-4222-8222-222222222222','role','authenticated','session_id','22222222-2222-4222-8222-222222222222')::text,true);
DO $$ BEGIN
 IF has_table_privilege(current_user,'public.content_likes','INSERT,DELETE') THEN RAISE EXCEPTION 'direct like mutation exposed'; END IF;
 PERFORM public.social_like_action('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',false);
 IF public.social_like_action('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',true)->>'liked'<>'true' THEN RAISE EXCEPTION 'like missing'; END IF;
 IF public.social_like_action('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',true)->>'replayed'<>'true' THEN RAISE EXCEPTION 'duplicate like'; END IF;
 IF public.social_like_action('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',false)->>'liked'<>'false' THEN RAISE EXCEPTION 'unlike failed'; END IF;
 FOR i IN 1..59 LOOP
  PERFORM public.social_like_action('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',true);
  PERFORM public.social_like_action('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',false);
 END LOOP;
 BEGIN PERFORM public.social_like_action('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',true); RAISE EXCEPTION 'quota bypass' USING ERRCODE='22000'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LIKE_RATE_LIMIT' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_view) VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',true) ON CONFLICT(creator_id,viewer_id) DO UPDATE SET deny_view=true;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.social_like_action('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',true); RAISE EXCEPTION 'blocked like accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: hosted like quota, replay, direct mutation denial and independent view block';
