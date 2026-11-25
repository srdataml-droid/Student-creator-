-- Week 1 provider boundary on Week 5 test-only accounting contract.
-- Existing database-owner gate is required for new orders. No live payment path.
CREATE TABLE public.hosted_paystack_checkout (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 init_state text NOT NULL CHECK(init_state IN ('claimed','ready','uncertain')),
 authorization_url text CHECK(length(authorization_url)<=2048),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((init_state='ready')=(authorization_url IS NOT NULL))
);
CREATE TABLE public.hosted_paystack_inbox (
 event_key text PRIMARY KEY,
 reference text NOT NULL CHECK(reference ~ '^sc_[0-9a-f]{32}$'),
 provider_tx text NOT NULL CHECK(provider_tx ~ '^[A-Za-z0-9_-]{1,128}$'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'received' CHECK(state IN ('received','processing','processed','failed')),
 lease_id uuid,lease_until timestamptz,next_retry_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hosted_paystack_checkout ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_paystack_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hosted_paystack_checkout,public.hosted_paystack_inbox FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.reserve_hosted_paystack_checkout(_buyer uuid,_content uuid,_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text; o jsonb; r public.hosted_paystack_checkout; n integer;
BEGIN
 SELECT lower(trim(u.email)) INTO email FROM auth.users u WHERE u.id=_buyer AND u.email_confirmed_at IS NOT NULL;
 IF email IS NULL THEN RETURN NULL; END IF;
 o:=public.week05_create_test_order(_buyer,email,_content,_key);
 IF o->>'status'<>'pending' THEN RETURN jsonb_build_object('status',o->>'status','orderId',o->>'order_id'); END IF;
 INSERT INTO public.hosted_paystack_checkout(order_id,init_state) VALUES((o->>'order_id')::uuid,'claimed') ON CONFLICT(order_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 SELECT * INTO r FROM public.hosted_paystack_checkout WHERE order_id=(o->>'order_id')::uuid FOR UPDATE;
 RETURN jsonb_build_object('orderId',o->>'order_id','reference',o->>'reference','amountKobo',(o->>'amount_kobo')::bigint,
 'buyerEmail',email,'domain','test','status',r.init_state,'create',n=1,'authorizationUrl',r.authorization_url);
END $$;
CREATE FUNCTION public.finish_hosted_paystack_checkout(_order uuid,_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _url IS NOT NULL AND (length(_url)>2048 OR _url !~ '^https://(checkout[.]paystack[.]com|paystack[.]com)/[^[:space:]]+$') THEN RETURN false; END IF;
 UPDATE public.hosted_paystack_checkout SET init_state=CASE WHEN _url IS NULL THEN 'uncertain' ELSE 'ready' END,authorization_url=_url
 WHERE order_id=_order AND init_state='claimed';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.hosted_paystack_order_snapshot(_reference text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('orderId',o.id,'reference',p.reference,'amountKobo',o.amount_kobo,'buyerEmail',t.buyer_email,'domain','test')
 FROM public.payment_attempts p JOIN public.orders o ON o.id=p.order_id JOIN week05_finance.order_terms t ON t.order_id=o.id
 WHERE p.reference=_reference AND p.provider='paystack' AND o.environment='test' AND o.currency='NGN'
$$;
CREATE FUNCTION public.record_hosted_paystack_charge(_reference text,_tx text,_digest text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; existing text; n integer;
BEGIN
 IF _reference IS NULL OR _reference !~ '^sc_[0-9a-f]{32}$' OR _tx IS NULL OR _tx !~ '^[A-Za-z0-9_-]{1,128}$' OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
 IF public.hosted_paystack_order_snapshot(_reference) IS NULL THEN RETURN 'unknown'; END IF;
 k:='charge:'||_reference||':'||_tx;
 INSERT INTO public.hosted_paystack_inbox(event_key,reference,provider_tx,payload_sha256) VALUES(k,_reference,_tx,_digest) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=1 THEN RETURN 'accepted'; END IF;
 SELECT payload_sha256 INTO existing FROM public.hosted_paystack_inbox WHERE event_key=k;
 RETURN CASE WHEN existing=_digest THEN 'duplicate' ELSE 'collision' END;
END $$;
CREATE FUNCTION public.claim_hosted_paystack_charge() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hosted_paystack_inbox;
BEGIN
 UPDATE public.hosted_paystack_inbox SET state='failed',lease_id=NULL,lease_until=NULL,next_retry_at=NULL WHERE state='processing' AND lease_until<=now() AND attempts>=5;
 SELECT * INTO r FROM public.hosted_paystack_inbox WHERE attempts<5 AND (state='received' OR (state='failed' AND next_retry_at<=now()) OR (state='processing' AND lease_until<=now())) ORDER BY created_at,event_key LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.hosted_paystack_inbox SET state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',next_retry_at=NULL WHERE event_key=r.event_key RETURNING * INTO r;
 RETURN jsonb_build_object('key',r.event_key,'leaseId',r.lease_id,'reference',r.reference,'providerTx',r.provider_tx);
END $$;
-- Fulfilment and inbox completion are atomic. A stale lease may never settle.
CREATE FUNCTION public.settle_hosted_paystack_charge(_key text,_lease uuid,_tx text,_amount bigint,_fee bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hosted_paystack_inbox; o jsonb;
BEGIN
 SELECT * INTO r FROM public.hosted_paystack_inbox WHERE event_key=_key AND state='processing' AND lease_id=_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND OR r.provider_tx IS DISTINCT FROM _tx THEN RETURN false; END IF;
 o:=public.hosted_paystack_order_snapshot(r.reference);
 IF o IS NULL THEN RETURN false; END IF;
 PERFORM public.week05_apply_test_charge(r.reference,_tx,_amount,'NGN','test',o->>'buyerEmail',_fee);
 UPDATE public.hosted_paystack_inbox SET state='processed',lease_id=NULL,lease_until=NULL,next_retry_at=NULL WHERE event_key=_key;
 RETURN true;
END $$;
CREATE FUNCTION public.retry_hosted_paystack_charge(_key text,_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.hosted_paystack_inbox SET state='failed',lease_id=NULL,lease_until=NULL,next_retry_at=CASE WHEN attempts<5 THEN now()+make_interval(secs=>30*attempts) ELSE NULL END WHERE event_key=_key AND state='processing' AND lease_id=_lease AND lease_until>now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.reserve_hosted_paystack_checkout(uuid,uuid,text),public.finish_hosted_paystack_checkout(uuid,text),public.hosted_paystack_order_snapshot(text),public.record_hosted_paystack_charge(text,text,text),public.claim_hosted_paystack_charge(),public.settle_hosted_paystack_charge(text,uuid,text,bigint,bigint),public.retry_hosted_paystack_charge(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_hosted_paystack_checkout(uuid,uuid,text),public.finish_hosted_paystack_checkout(uuid,text),public.hosted_paystack_order_snapshot(text),public.record_hosted_paystack_charge(text,text,text),public.claim_hosted_paystack_charge(),public.settle_hosted_paystack_charge(text,uuid,text,bigint,bigint),public.retry_hosted_paystack_charge(text,uuid) TO service_role;
