-- Production checkout bridge; isolated live ledger, no test events.
CREATE TABLE public.live_paystack_checkout (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 init_state text NOT NULL CHECK(init_state IN ('claimed','ready','uncertain')),
 authorization_url text CHECK(length(authorization_url)<=2048),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((init_state='ready')=(authorization_url IS NOT NULL))
);
ALTER TABLE public.live_paystack_checkout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_paystack_checkout FROM PUBLIC,anon,authenticated,service_role;
-- Reuse Week 5 canonical inbox: no parallel queue or competing worker state.
CREATE FUNCTION public.reserve_live_paystack_checkout(_buyer uuid,_content uuid,_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text; o jsonb; r public.live_paystack_checkout; n integer;
BEGIN
 SELECT lower(trim(u.email)) INTO email FROM auth.users u WHERE u.id=_buyer AND u.email_confirmed_at IS NOT NULL;
 IF email IS NULL THEN RETURN NULL; END IF;
 o:=public.live_create_order(_buyer,email,_content,_key);
 IF o->>'status'<>'pending' THEN RETURN jsonb_build_object('status',o->>'status','orderId',o->>'order_id'); END IF;
 IF public.live_get_order(_buyer,o->>'reference')->>'checkoutAllowed' IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
 INSERT INTO public.live_paystack_checkout(order_id,init_state) VALUES((o->>'order_id')::uuid,'claimed') ON CONFLICT(order_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 SELECT * INTO r FROM public.live_paystack_checkout WHERE order_id=(o->>'order_id')::uuid FOR UPDATE;
 RETURN jsonb_build_object('orderId',o->>'order_id','reference',o->>'reference','amountKobo',(o->>'amount_kobo')::bigint,
 'buyerEmail',email,'domain','live','status',r.init_state,'create',n=1,'authorizationUrl',r.authorization_url);
END $$;
CREATE FUNCTION public.finish_live_paystack_checkout(_order uuid,_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _url IS NOT NULL AND (length(_url)>2048 OR _url !~ '^https://(checkout[.]paystack[.]com|paystack[.]com)/[^[:space:]]+$') THEN RETURN false; END IF;
 UPDATE public.live_paystack_checkout SET init_state=CASE WHEN _url IS NULL THEN 'uncertain' ELSE 'ready' END,authorization_url=_url
 WHERE order_id=_order AND init_state='claimed';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.live_paystack_order_snapshot(_reference text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('orderId',o.id,'reference',p.reference,'amountKobo',o.amount_kobo,'buyerEmail',t.buyer_email,'domain','live')
 FROM public.payment_attempts p JOIN public.orders o ON o.id=p.order_id JOIN live_finance.order_terms t ON t.order_id=o.id
 WHERE p.reference=_reference AND p.provider='paystack' AND o.environment='live' AND o.currency='NGN'
$$;
CREATE FUNCTION public.record_live_paystack_charge(_reference text,_tx text,_digest text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF _reference IS NULL OR _reference !~ '^lc_[0-9a-f]{32}$' OR _tx IS NULL OR _tx !~ '^[A-Za-z0-9_-]{1,128}$' OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
 IF public.live_paystack_order_snapshot(_reference) IS NULL THEN RETURN 'unknown'; END IF;
 BEGIN
  r:=public.live_enqueue_charge(_reference,_tx,_digest);
 EXCEPTION WHEN check_violation THEN RETURN 'collision';
 END;
 RETURN CASE WHEN (r->>'replayed')::boolean THEN 'duplicate' ELSE 'accepted' END;
END $$;
CREATE FUNCTION public.claim_live_paystack_charge() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 r:=public.live_claim_charge();
 IF r IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('key',r->>'transactionId','leaseId',r->>'lease','reference',r->>'reference','providerTx',r->>'transactionId');
END $$;
-- The canonical Week 5 inbox row stays locked through receipt application and
-- completion; no second queue and no stale lease can apply through this bridge.
CREATE FUNCTION public.settle_live_paystack_charge(_key text,_lease uuid,_tx text,_amount bigint,_fee bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r live_finance.charge_inbox; o jsonb; done jsonb;
BEGIN
 SELECT * INTO r FROM live_finance.charge_inbox WHERE transaction_id=_key AND state='processing' AND lease_token=_lease AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR r.transaction_id IS DISTINCT FROM _tx THEN RETURN false; END IF;
 o:=public.live_paystack_order_snapshot(r.reference);
 IF o IS NULL THEN RETURN false; END IF;
 PERFORM public.live_apply_charge(r.reference,_tx,_amount,'NGN','live',o->>'buyerEmail',_fee);
 done:=public.live_finish_charge(_tx,_lease,NULL);
 IF done->>'owned' IS DISTINCT FROM 'true' OR done->>'state' IS DISTINCT FROM 'processed' THEN RAISE EXCEPTION 'PAYMENT_LEASE_EXPIRED'; END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.retry_live_paystack_charge(_key text,_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 r:=public.live_finish_charge(_key,_lease,'VERIFICATION_FAILED');
 RETURN coalesce((r->>'owned')::boolean,false);
END $$;
REVOKE ALL ON FUNCTION public.reserve_live_paystack_checkout(uuid,uuid,text),public.finish_live_paystack_checkout(uuid,text),public.live_paystack_order_snapshot(text),public.record_live_paystack_charge(text,text,text),public.claim_live_paystack_charge(),public.settle_live_paystack_charge(text,uuid,text,bigint,bigint),public.retry_live_paystack_charge(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_live_paystack_checkout(uuid,uuid,text),public.finish_live_paystack_checkout(uuid,text),public.live_paystack_order_snapshot(text),public.record_live_paystack_charge(text,text,text),public.claim_live_paystack_charge(),public.settle_live_paystack_charge(text,uuid,text,bigint,bigint),public.retry_live_paystack_charge(text,uuid) TO service_role;
