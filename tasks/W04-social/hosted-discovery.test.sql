\set ON_ERROR_STOP on
BEGIN;
-- Reuse synthetic baseline students, not real identities.
UPDATE public.content_items SET status='published',reviewer_id='99999999-9999-4999-8999-999999999999',review_reason='Synthetic approval',reviewed_at=now(),published_at=now()
WHERE id='bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
-- CI-only session fixtures inside this rollback transaction.
UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at,now()) WHERE email_confirmed_at IS NULL;
INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users ON CONFLICT(id) DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true), set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated','session_id','11111111-1111-4111-8111-111111111111')::text,true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.social_discover();
 IF jsonb_array_length(result)<>2 OR result->0->>'institutionId'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' OR result->0 ? 'creation_hash' OR result->0 ? 'review_reason' THEN RAISE EXCEPTION 'feed ranking or allowlist incorrect'; END IF;
 IF jsonb_array_length(public.social_discover('following'))<>0 THEN RAISE EXCEPTION 'following initially nonempty'; END IF;
 IF public.social_follow_action('22222222-2222-4222-8222-222222222222',true)->>'following'<>'true' THEN RAISE EXCEPTION 'follow failed'; END IF;
 IF public.social_follow_action('22222222-2222-4222-8222-222222222222',true)->>'replayed'<>'true' THEN RAISE EXCEPTION 'follow replay failed'; END IF;
 IF public.social_discover('following')->0->>'creatorId'<>'22222222-2222-4222-8222-222222222222' THEN RAISE EXCEPTION 'following feed wrong'; END IF;
 IF jsonb_array_length(public.social_discover('creators','calculus'))<>1 THEN RAISE EXCEPTION 'creator search wrong'; END IF;
 IF has_table_privilege(current_user,'public.social_creator_follows','INSERT') THEN RAISE EXCEPTION 'direct follow mutation'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true), set_config('request.jwt.claims',jsonb_build_object('sub','22222222-2222-4222-8222-222222222222','role','authenticated','session_id','22222222-2222-4222-8222-222222222222')::text,true);
DO $$ BEGIN IF (SELECT count(*) FROM public.social_creator_follows)<>0 THEN RAISE EXCEPTION 'foreign follow graph leak'; END IF; END $$;
RESET ROLE;
INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_view) VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',true) ON CONFLICT(creator_id,viewer_id) DO UPDATE SET deny_view=true;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true), set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated','session_id','11111111-1111-4111-8111-111111111111')::text,true);
DO $$ BEGIN
 IF jsonb_array_length(public.social_discover('following'))<>0 OR jsonb_array_length(public.social_discover('all','calculus'))<>0 THEN RAISE EXCEPTION 'blocked creator discovery leak'; END IF;
 IF (SELECT count(*) FROM public.content_items WHERE id='bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb')<>0 THEN RAISE EXCEPTION 'raw catalog bypass'; END IF;
 IF jsonb_array_length(public.social_discover('creators','calculus'))<>0 THEN RAISE EXCEPTION 'blocked creator search leak'; END IF;
 IF public.social_follow_action('22222222-2222-4222-8222-222222222222',false)->>'following'<>'false' THEN RAISE EXCEPTION 'unfollow failed'; END IF;
 BEGIN PERFORM public.social_follow_action('22222222-2222-4222-8222-222222222222',true); RAISE EXCEPTION 'blocked follow accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: campus-ranked preview feed, follows, creator discovery and raw catalog blocking';
