-- Disposable PostgreSQL only: fake payments simulate a backend state transition.
-- No real PSP calls, Supabase users, monetary funds or media bytes.
\set ON_ERROR_STOP on
\echo 'Paid access RLS: verified creator, pending buyer, paid buyer and revocation'
-- Previous comments test deliberately deactivated the course; reset test-only fixture.
UPDATE public.courses SET active=true
 WHERE id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
-- Free published comment is visible to verified, unblocked students before pricing.
SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer; yes boolean;
BEGIN
 SELECT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') INTO yes;
 IF NOT yes THEN RAISE EXCEPTION 'Free published synthetic lesson not viewable'; END IF;
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>1 THEN RAISE EXCEPTION 'Free comment expected 1, got %',n; END IF;
END $$;
RESET ROLE;

INSERT INTO public.listings(id,content_id,creator_id,price_kobo,currency,state)
VALUES('33333333-3333-4333-8333-333333333333',
 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',20000,'NGN','active');

SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer; yes boolean;
BEGIN
 SELECT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') INTO yes;
 IF yes THEN RAISE EXCEPTION 'Unpaid verified buyer can view paid lesson'; END IF;
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>0 THEN RAISE EXCEPTION 'Unpaid buyer read paid comment %',n; END IF;
 BEGIN
   INSERT INTO public.entitlements(buyer_id,content_id,order_id)
   VALUES('22222222-2222-4222-8222-222222222222',
   'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
   '44444444-4444-4444-8444-444444444444');
   RAISE EXCEPTION 'Browser inserted entitlement';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>1 THEN RAISE EXCEPTION 'Author lost access to their published work'; END IF;
END $$;
RESET ROLE;

-- This row remains pending: having an order must never confer access.
INSERT INTO public.orders(id,buyer_id,listing_id,content_id,creator_id,idempotency_key,
 amount_kobo,platform_fee_bps,platform_fee_kobo,creator_gross_share_kobo,environment,status)
VALUES('44444444-4444-4444-8444-444444444444',
'22222222-2222-4222-8222-222222222222',
'33333333-3333-4333-8333-333333333333',
'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
'11111111-1111-4111-8111-111111111111',
'paid_access_contract_001',20000,0,0,20000,'test','pending');
SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE yes boolean;
BEGIN
 SELECT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') INTO yes;
 IF yes THEN RAISE EXCEPTION 'Pending payment unlocked paid content'; END IF;
END $$;
RESET ROLE;

-- A hypothetical trusted server has verified a synthetic charge.
UPDATE public.orders SET status='paid',paid_at=now()
WHERE id='44444444-4444-4444-8444-444444444444';
INSERT INTO public.entitlements(buyer_id,content_id,order_id,state)
VALUES('22222222-2222-4222-8222-222222222222',
 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
 '44444444-4444-4444-8444-444444444444','active');
SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE n integer; yes boolean;
BEGIN
 SELECT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') INTO yes;
 IF NOT yes THEN RAISE EXCEPTION 'Verified paid entitlement refused'; END IF;
 SELECT count(*) INTO n FROM public.content_comments;
 IF n<>1 THEN RAISE EXCEPTION 'Paid buyer could not view approved comment'; END IF;
END $$;
RESET ROLE;

-- Refund/dispute revocation must immediately close the read gate.
UPDATE public.entitlements SET state='revoked'
WHERE order_id='44444444-4444-4444-8444-444444444444';
SET ROLE authenticated;
DO $$ DECLARE yes boolean;
BEGIN
 SELECT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') INTO yes;
 IF yes THEN RAISE EXCEPTION 'Revoked paid entitlement remained active'; END IF;
END $$;
RESET ROLE;

UPDATE public.entitlements SET state='active'
WHERE order_id='44444444-4444-4444-8444-444444444444';
INSERT INTO public.creator_restrictions(creator_id,viewer_id,deny_view)
VALUES('11111111-1111-4111-8111-111111111111',
'22222222-2222-4222-8222-222222222222',true);
SET ROLE authenticated;
DO $$ DECLARE yes boolean;
BEGIN
 SELECT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') INTO yes;
 IF yes THEN RAISE EXCEPTION 'Creator-blocked paid buyer still has access'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.creator_restrictions
WHERE creator_id='11111111-1111-4111-8111-111111111111'
AND viewer_id='22222222-2222-4222-8222-222222222222';
UPDATE public.student_profiles SET suspended=true
WHERE user_id='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE yes boolean;
BEGIN
 SELECT public.can_view_published_content('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') INTO yes;
 IF yes THEN RAISE EXCEPTION 'Suspended paid buyer still has access'; END IF;
END $$;
RESET ROLE;
\echo 'PASS: no entitlement without verified paid order, plus revocation and block enforcement'
