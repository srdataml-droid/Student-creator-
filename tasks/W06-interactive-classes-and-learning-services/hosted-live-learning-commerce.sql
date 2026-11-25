-- Live learning commerce uses the same Paystack verification and reversal boundary.
-- Separate resource snapshots are necessary because lesson orders have content/listing FKs.
-- Never turn on this gate without approved class/service terms and release acceptance.
CREATE TABLE live_finance.learning_gate(singleton boolean PRIMARY KEY CHECK(singleton),allow_checkout boolean NOT NULL DEFAULT false,terms_version text,approved_at timestamptz,CHECK(NOT allow_checkout OR (terms_version IS NOT NULL AND approved_at IS NOT NULL)));
INSERT INTO live_finance.learning_gate(singleton) VALUES(true);
CREATE TABLE live_finance.learning_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reference text NOT NULL UNIQUE CHECK(reference ~ '^ll_[0-9a-f]{32}$'),
 buyer_id uuid NOT NULL REFERENCES auth.users(id),creator_id uuid NOT NULL REFERENCES auth.users(id),
 kind text NOT NULL CHECK(kind IN ('class','service')),resource_id uuid NOT NULL,buyer_email text NOT NULL CHECK(length(buyer_email) BETWEEN 3 AND 254),
 amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 20000 AND 1000000000),currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
 terms_version text NOT NULL,refund_policy_version text NOT NULL,platform_fee_bps integer NOT NULL CHECK(platform_fee_bps BETWEEN 0 AND 10000),fee_bearer text NOT NULL CHECK(fee_bearer IN ('creator','platform')),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','paid_review','refunded')),
 init_state text NOT NULL DEFAULT 'claimed' CHECK(init_state IN ('claimed','ready','uncertain')),authorization_url text CHECK(length(authorization_url)<=2048),
 reserved_until timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),paid_at timestamptz,
 UNIQUE(buyer_id,request_key),UNIQUE(buyer_id,kind,resource_id),CHECK(buyer_id<>creator_id),CHECK((init_state='ready')=(authorization_url IS NOT NULL)),CHECK((state='pending')=(paid_at IS NULL))
);
CREATE INDEX learning_live_reservations ON live_finance.learning_orders(kind,resource_id,reserved_until) WHERE state='pending';
CREATE TABLE live_finance.learning_receipts(
 transaction_id text PRIMARY KEY CHECK(transaction_id ~ '^[1-9][0-9]{0,19}$'),order_id uuid NOT NULL REFERENCES live_finance.learning_orders(id),reference text NOT NULL,amount_kobo bigint NOT NULL CHECK(amount_kobo>=20000),fee_kobo bigint NOT NULL CHECK(fee_kobo BETWEEN 0 AND amount_kobo),duplicate boolean NOT NULL,delivered boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(NOT duplicate OR NOT delivered),UNIQUE(transaction_id,order_id)
);
CREATE UNIQUE INDEX learning_one_primary ON live_finance.learning_receipts(order_id) WHERE NOT duplicate;
CREATE TABLE live_finance.learning_journal(
 transaction_id text NOT NULL,order_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('charge','creator','platform','fee','refund','reverse_creator','reverse_platform')),
 debit_account text NOT NULL CHECK(debit_account IN ('processor_clearing','gross_pending','creator_pending','platform_pending','review_liability','duplicate_liability')),
 credit_account text NOT NULL CHECK(credit_account IN ('processor_clearing','gross_pending','creator_pending','platform_pending','review_liability','duplicate_liability')),
 amount_kobo bigint NOT NULL CHECK(amount_kobo>0),currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(transaction_id,kind),FOREIGN KEY(transaction_id,order_id) REFERENCES live_finance.learning_receipts(transaction_id,order_id),CHECK(debit_account<>credit_account)
);
CREATE TABLE live_finance.learning_refunds(transaction_id text PRIMARY KEY REFERENCES live_finance.learning_receipts(transaction_id),provider_event text NOT NULL UNIQUE,amount_kobo bigint NOT NULL CHECK(amount_kobo>=20000),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE live_finance.learning_inbox(
 transaction_id text PRIMARY KEY CHECK(transaction_id ~ '^[1-9][0-9]{0,19}$'),order_id uuid NOT NULL REFERENCES live_finance.learning_orders(id),reference text NOT NULL,payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'received' CHECK(state IN ('received','processing','failed','processed','dead_letter')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),lease_id uuid,lease_until timestamptz,next_retry_at timestamptz NOT NULL DEFAULT now(),received_at timestamptz NOT NULL DEFAULT now(),CHECK((state='processing')=(lease_id IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX learning_inbox_due ON live_finance.learning_inbox(next_retry_at,received_at) WHERE state IN ('received','failed','processing');
ALTER TABLE live_finance.learning_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.learning_gate FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE live_finance.learning_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.learning_orders FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE live_finance.learning_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.learning_receipts FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE live_finance.learning_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.learning_journal FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE live_finance.learning_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.learning_refunds FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE live_finance.learning_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_finance.learning_inbox FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER learning_receipts_append_only BEFORE UPDATE OR DELETE ON live_finance.learning_receipts FOR EACH ROW EXECUTE FUNCTION live_finance.deny_mutation();
CREATE TRIGGER learning_journal_append_only BEFORE UPDATE OR DELETE ON live_finance.learning_journal FOR EACH ROW EXECUTE FUNCTION live_finance.deny_mutation();
CREATE TRIGGER learning_refunds_append_only BEFORE UPDATE OR DELETE ON live_finance.learning_refunds FOR EACH ROW EXECUTE FUNCTION live_finance.deny_mutation();
CREATE FUNCTION live_finance.learning_order_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','init_state','authorization_url','paid_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','init_state','authorization_url','paid_at']) OR (OLD.state='refunded' AND NEW.state<>'refunded') OR (OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN RAISE EXCEPTION 'IMMUTABLE_LEARNING_ORDER' USING ERRCODE='23514'; END IF;
 IF NEW.state='paid' AND NOT EXISTS(SELECT 1 FROM live_finance.learning_receipts r WHERE r.order_id=NEW.id AND r.delivered AND NOT r.duplicate AND NOT EXISTS(SELECT 1 FROM live_finance.learning_refunds f WHERE f.transaction_id=r.transaction_id)) THEN RAISE EXCEPTION 'VERIFIED_LEARNING_RECEIPT_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION live_finance.learning_order_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER learning_order_immutable BEFORE UPDATE OR DELETE ON live_finance.learning_orders FOR EACH ROW EXECUTE FUNCTION live_finance.learning_order_guard();
CREATE FUNCTION live_finance.cross_resource_tx_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('live:tx:'||NEW.transaction_id,0));
 IF (TG_TABLE_NAME='receipts' AND EXISTS(SELECT 1 FROM live_finance.learning_receipts WHERE transaction_id=NEW.transaction_id)) OR (TG_TABLE_NAME='learning_receipts' AND EXISTS(SELECT 1 FROM live_finance.receipts WHERE transaction_id=NEW.transaction_id)) THEN RAISE EXCEPTION 'CROSS_RESOURCE_TRANSACTION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION live_finance.cross_resource_tx_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER learning_tx_unique BEFORE INSERT ON live_finance.learning_receipts FOR EACH ROW EXECUTE FUNCTION live_finance.cross_resource_tx_guard();
CREATE TRIGGER lesson_tx_unique_across_learning BEFORE INSERT ON live_finance.receipts FOR EACH ROW EXECUTE FUNCTION live_finance.cross_resource_tx_guard();
CREATE FUNCTION live_finance.learning_eligible(_buyer uuid,_kind text,_resource uuid,_creator uuid,_amount bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT _buyer<>_creator AND public.affiliation_eligible(_buyer) AND public.affiliation_eligible(_creator)
 AND NOT EXISTS(SELECT 1 FROM public.creator_restrictions WHERE creator_id=_creator AND viewer_id=_buyer AND (deny_view OR (_kind='service' AND deny_message)))
 AND CASE _kind
 WHEN 'class' THEN EXISTS(SELECT 1 FROM public.interactive_classes c JOIN public.student_profiles p ON p.user_id=_buyer AND p.institution_id=c.institution_id JOIN public.courses co ON co.id=c.course_id JOIN public.institutions i ON i.id=c.institution_id WHERE c.id=_resource AND c.host_id=_creator AND c.price_kobo=_amount AND co.active AND i.active AND c.status IN ('scheduled','room_open') AND c.ends_at>now() AND NOT EXISTS(SELECT 1 FROM public.learning_participant_removals WHERE class_id=c.id AND student_id=_buyer))
 WHEN 'service' THEN EXISTS(SELECT 1 FROM public.personal_learning_requests s JOIN public.institutions i ON i.id=s.institution_id WHERE s.id=_resource AND s.student_id=_buyer AND s.creator_id=_creator AND s.quote_kobo=_amount AND s.state='quoted' AND i.active AND NOT EXISTS(SELECT 1 FROM public.social_contact_blocks WHERE (blocker_id,blocked_id) IN ((_buyer,_creator),(_creator,_buyer))))
 ELSE false END
$$;
REVOKE ALL ON FUNCTION live_finance.learning_eligible(uuid,text,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION live_finance.learning_has_paid(_buyer uuid,_kind text,_resource uuid,_creator uuid,_amount bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM live_finance.learning_orders o JOIN live_finance.learning_receipts r ON r.order_id=o.id AND r.delivered AND NOT r.duplicate WHERE o.buyer_id=_buyer AND o.kind=_kind AND o.resource_id=_resource AND o.creator_id=_creator AND o.amount_kobo=_amount AND o.state='paid' AND NOT EXISTS(SELECT 1 FROM live_finance.learning_refunds f WHERE f.transaction_id=r.transaction_id))
$$;
REVOKE ALL ON FUNCTION live_finance.learning_has_paid(uuid,text,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.reserve_live_learning_checkout(_buyer uuid,_kind text,_resource uuid,_key text,_terms text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o live_finance.learning_orders%ROWTYPE; p live_finance.runtime_gate%ROWTYPE; c public.interactive_classes%ROWTYPE; s public.personal_learning_requests%ROWTYPE; creator uuid; price bigint; email text; hold_until timestamptz; n integer;
BEGIN
 IF _buyer IS NULL OR _kind IS NULL OR _kind NOT IN ('class','service') OR _resource IS NULL OR _key IS NULL OR _key !~ '^[A-Za-z0-9_-]{16,128}$' OR _terms IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO p FROM live_finance.runtime_gate WHERE singleton AND allow_checkout AND terms_version=_terms FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM live_finance.learning_gate WHERE singleton AND allow_checkout AND terms_version=_terms) THEN RETURN NULL; END IF;
 SELECT lower(trim(u.email)) INTO email FROM auth.users u WHERE u.id=_buyer AND u.email_confirmed_at IS NOT NULL;
 IF email IS NULL OR NOT public.affiliation_eligible(_buyer) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('live:learning:buyer:'||_buyer::text,0));
 IF _kind='class' THEN
  SELECT * INTO c FROM public.interactive_classes WHERE id=_resource FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  creator:=c.host_id;price:=c.price_kobo;hold_until:=least(c.ends_at,now()+interval '15 minutes');
 ELSE
  SELECT * INTO s FROM public.personal_learning_requests WHERE id=_resource FOR UPDATE;
  IF NOT FOUND OR s.student_id<>_buyer THEN RETURN NULL; END IF;
  creator:=s.creator_id;price:=s.quote_kobo;hold_until:=now()+interval '30 minutes';
 END IF;
 SELECT * INTO o FROM live_finance.learning_orders WHERE buyer_id=_buyer AND request_key=_key;
 IF FOUND AND (o.kind<>_kind OR o.resource_id<>_resource) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
 IF NOT FOUND THEN SELECT * INTO o FROM live_finance.learning_orders WHERE buyer_id=_buyer AND kind=_kind AND resource_id=_resource; END IF;
 IF FOUND THEN
  IF o.terms_version<>_terms OR o.buyer_email<>email THEN RETURN NULL; END IF;
  IF o.state<>'pending' THEN RETURN jsonb_build_object('orderId',o.id,'status',o.state); END IF;
  IF o.reserved_until<=now() OR NOT live_finance.learning_eligible(_buyer,_kind,_resource,o.creator_id,o.amount_kobo) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('orderId',o.id,'reference',o.reference,'amountKobo',o.amount_kobo,'buyerEmail',o.buyer_email,'domain','live','status',o.init_state,'create',false,'authorizationUrl',o.authorization_url);
 END IF;
 IF price IS NULL OR price<20000 OR NOT live_finance.learning_eligible(_buyer,_kind,_resource,creator,price) THEN RETURN NULL; END IF;
 IF _kind='class' THEN
  SELECT (SELECT count(*) FROM public.interactive_class_enrollments WHERE class_id=c.id AND state='enrolled')+(SELECT count(*) FROM live_finance.learning_orders WHERE kind='class' AND resource_id=c.id AND state='pending' AND reserved_until>now()) INTO n;
  IF n>=c.capacity-1 THEN RETURN NULL; END IF;
 END IF;
 INSERT INTO live_finance.learning_orders(reference,buyer_id,creator_id,kind,resource_id,buyer_email,amount_kobo,terms_version,refund_policy_version,platform_fee_bps,fee_bearer,request_key,reserved_until)
 VALUES('ll_'||replace(gen_random_uuid()::text,'-',''),_buyer,creator,_kind,_resource,email,price,_terms,p.refund_policy_version,p.platform_fee_bps,p.fee_bearer,_key,hold_until) RETURNING * INTO o;
 RETURN jsonb_build_object('orderId',o.id,'reference',o.reference,'amountKobo',o.amount_kobo,'buyerEmail',email,'domain','live','status','claimed','create',true);
END $$;
CREATE FUNCTION public.finish_live_learning_checkout(_order uuid,_url text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _url IS NOT NULL AND (length(_url)>2048 OR _url !~ '^https://(checkout[.]paystack[.]com|paystack[.]com)/[^[:space:]#]+$' OR position(chr(92) in _url)>0) THEN RETURN false; END IF;
 UPDATE live_finance.learning_orders SET init_state=CASE WHEN _url IS NULL THEN 'uncertain' ELSE 'ready' END,authorization_url=_url WHERE id=_order AND init_state='claimed' AND state='pending';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.live_learning_can_return(_buyer uuid,_reference text,_terms text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM live_finance.learning_orders o JOIN live_finance.runtime_gate p ON p.singleton AND p.allow_checkout AND p.terms_version=_terms JOIN live_finance.learning_gate l ON l.singleton AND l.allow_checkout AND l.terms_version=_terms WHERE o.buyer_id=_buyer AND o.reference=_reference AND o.terms_version=_terms AND o.state='pending' AND o.init_state='ready' AND o.reserved_until>now() AND live_finance.learning_eligible(o.buyer_id,o.kind,o.resource_id,o.creator_id,o.amount_kobo))
$$;
CREATE FUNCTION public.live_learning_order_snapshot(_reference text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('orderId',id,'reference',reference,'amountKobo',amount_kobo,'buyerEmail',buyer_email,'domain','live') FROM live_finance.learning_orders WHERE reference=_reference
$$;
CREATE FUNCTION public.record_live_learning_charge(_reference text,_tx text,_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid; prev live_finance.learning_inbox%ROWTYPE;
BEGIN
 IF _reference IS NULL OR _reference !~ '^ll_[0-9a-f]{32}$' OR _tx IS NULL OR _tx !~ '^[1-9][0-9]{0,19}$' OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
 SELECT id INTO oid FROM live_finance.learning_orders WHERE reference=_reference;
 IF oid IS NULL THEN RETURN 'unknown'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('live:tx:'||_tx,0));
 IF EXISTS(SELECT 1 FROM live_finance.receipts WHERE transaction_id=_tx) OR EXISTS(SELECT 1 FROM live_finance.charge_inbox WHERE transaction_id=_tx) THEN RETURN 'collision'; END IF;
 SELECT * INTO prev FROM live_finance.learning_inbox WHERE transaction_id=_tx;
 IF FOUND THEN RETURN CASE WHEN prev.order_id=oid THEN 'duplicate' ELSE 'collision' END; END IF;
 INSERT INTO live_finance.learning_inbox(transaction_id,order_id,reference,payload_sha256) VALUES(_tx,oid,_reference,_digest);
 RETURN 'accepted';
END $$;
CREATE FUNCTION public.claim_live_learning_charge() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e live_finance.learning_inbox%ROWTYPE;
BEGIN
 UPDATE live_finance.learning_inbox SET state='dead_letter',lease_id=NULL,lease_until=NULL WHERE state='processing' AND attempts=8 AND lease_until<=clock_timestamp();
 SELECT * INTO e FROM live_finance.learning_inbox WHERE attempts<8 AND ((state IN ('received','failed') AND next_retry_at<=clock_timestamp()) OR (state='processing' AND lease_until<=clock_timestamp())) ORDER BY next_retry_at,received_at,transaction_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE live_finance.learning_inbox SET state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds' WHERE transaction_id=e.transaction_id RETURNING * INTO e;
 RETURN jsonb_build_object('key','ll:'||e.transaction_id,'leaseId',e.lease_id,'reference',e.reference,'providerTx',e.transaction_id);
END $$;
CREATE FUNCTION public.retry_live_learning_charge(_tx text,_lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE live_finance.learning_inbox SET state=CASE WHEN attempts=8 THEN 'dead_letter' ELSE 'failed' END,lease_id=NULL,lease_until=NULL,next_retry_at=clock_timestamp()+make_interval(secs=>least(3600,15*(1<<attempts))) WHERE transaction_id=_tx AND state='processing' AND lease_id=_lease AND lease_until>clock_timestamp();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.settle_live_learning_charge(_tx text,_lease uuid,_amount bigint,_fee bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e live_finance.learning_inbox%ROWTYPE; o live_finance.learning_orders%ROWTYPE; c public.interactive_classes%ROWTYPE; s public.personal_learning_requests%ROWTYPE; dup boolean; delivered boolean:=false; account text; commission bigint;
BEGIN
 IF _tx IS NULL OR _amount IS NULL OR _fee IS NULL OR _fee<0 OR _fee>_amount THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('live:tx:'||_tx,0));
 SELECT * INTO e FROM live_finance.learning_inbox WHERE transaction_id=_tx AND state='processing' AND lease_id=_lease AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO o FROM live_finance.learning_orders WHERE id=e.order_id FOR UPDATE;
 IF NOT FOUND OR o.amount_kobo<>_amount OR o.reference<>e.reference THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM live_finance.receipts WHERE transaction_id=_tx) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM live_finance.learning_receipts WHERE transaction_id=_tx) THEN RETURN false; END IF;
 dup:=EXISTS(SELECT 1 FROM live_finance.learning_receipts WHERE order_id=o.id AND NOT duplicate);
 IF NOT dup AND o.state<>'pending' THEN RETURN false; END IF;
 IF NOT dup AND o.reserved_until>now() THEN
  IF o.kind='class' THEN
   SELECT * INTO c FROM public.interactive_classes WHERE id=o.resource_id FOR UPDATE;
   delivered:=FOUND AND live_finance.learning_eligible(o.buyer_id,o.kind,o.resource_id,o.creator_id,o.amount_kobo) AND (SELECT count(*) FROM public.interactive_class_enrollments WHERE class_id=c.id AND state='enrolled')<c.capacity-1;
  ELSE
   SELECT * INTO s FROM public.personal_learning_requests WHERE id=o.resource_id FOR UPDATE;
   delivered:=FOUND AND live_finance.learning_eligible(o.buyer_id,o.kind,o.resource_id,o.creator_id,o.amount_kobo);
  END IF;
 END IF;
 account:=CASE WHEN dup THEN 'duplicate_liability' WHEN delivered THEN 'gross_pending' ELSE 'review_liability' END;
 commission:=round(o.amount_kobo::numeric*o.platform_fee_bps/10000)::bigint;
 INSERT INTO live_finance.learning_receipts(transaction_id,order_id,reference,amount_kobo,fee_kobo,duplicate,delivered) VALUES(_tx,o.id,o.reference,_amount,_fee,dup,delivered);
 INSERT INTO live_finance.learning_journal(transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) VALUES(_tx,o.id,'charge','processor_clearing',account,_amount);
 IF delivered THEN
  IF commission>0 THEN INSERT INTO live_finance.learning_journal(transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) VALUES(_tx,o.id,'platform','gross_pending','platform_pending',commission); END IF;
  IF _amount>commission THEN INSERT INTO live_finance.learning_journal(transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) VALUES(_tx,o.id,'creator','gross_pending','creator_pending',_amount-commission); END IF;
 END IF;
 IF _fee>0 THEN INSERT INTO live_finance.learning_journal(transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) VALUES(_tx,o.id,'fee',CASE WHEN NOT delivered THEN account WHEN o.fee_bearer='creator' THEN 'creator_pending' ELSE 'platform_pending' END,'processor_clearing',_fee); END IF;
 IF NOT dup THEN
  UPDATE live_finance.learning_orders SET state=CASE WHEN delivered THEN 'paid' ELSE 'paid_review' END,paid_at=now() WHERE id=o.id;
  IF delivered AND o.kind='class' THEN
   INSERT INTO public.interactive_class_enrollments(class_id,student_id,state) VALUES(o.resource_id,o.buyer_id,'enrolled') ON CONFLICT(class_id,student_id) DO UPDATE SET state='enrolled',updated_at=now();
  ELSIF delivered THEN UPDATE public.personal_learning_requests SET state='accepted',updated_at=now() WHERE id=o.resource_id;
  ELSE INSERT INTO public.learning_refund_reviews(resource_kind,resource_id,student_id,reason) VALUES(o.kind,o.resource_id,o.buyer_id,'Verified payment could not deliver resource') ON CONFLICT DO NOTHING;
  END IF;
 ELSE INSERT INTO public.learning_refund_reviews(resource_kind,resource_id,student_id,reason) VALUES(o.kind,o.resource_id,o.buyer_id,'Duplicate verified payment requires review') ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO public.audit_events(action,target_kind,target_id,correlation_id) VALUES(CASE WHEN delivered THEN 'learning.payment.verified' ELSE 'learning.payment.review' END,'learning_order',o.id,_tx);
 INSERT INTO public.learning_notifications(user_id,kind,resource_id,body) VALUES(o.buyer_id,CASE WHEN delivered THEN 'payment.confirmed' ELSE 'payment.review' END,o.resource_id,CASE WHEN delivered THEN 'Payment confirmed' ELSE 'Payment requires reconciliation' END) ON CONFLICT DO NOTHING;
 UPDATE live_finance.learning_inbox SET state='processed',lease_id=NULL,lease_until=NULL WHERE transaction_id=_tx AND lease_id=_lease AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'LEARNING_PAYMENT_LEASE_EXPIRED'; END IF;
 RETURN true;
END $$;
CREATE FUNCTION live_finance.apply_learning_refund(_tx text,_event text,_amount bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r live_finance.learning_receipts%ROWTYPE; o live_finance.learning_orders%ROWTYPE; account text; commission bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('live:tx:'||_tx,0));
 SELECT * INTO r FROM live_finance.learning_receipts WHERE transaction_id=_tx;
 IF NOT FOUND OR r.amount_kobo IS DISTINCT FROM _amount THEN RETURN false; END IF;
 SELECT * INTO o FROM live_finance.learning_orders WHERE id=r.order_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM live_finance.learning_refunds WHERE transaction_id=_tx) THEN RETURN true; END IF;
 INSERT INTO live_finance.learning_refunds(transaction_id,provider_event,amount_kobo) VALUES(_tx,_event,_amount);
 account:=CASE WHEN r.duplicate THEN 'duplicate_liability' WHEN r.delivered THEN 'gross_pending' ELSE 'review_liability' END;
 commission:=round(o.amount_kobo::numeric*o.platform_fee_bps/10000)::bigint;
 IF r.delivered THEN
  IF commission>0 THEN INSERT INTO live_finance.learning_journal(transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) VALUES(_tx,o.id,'reverse_platform','platform_pending','gross_pending',commission); END IF;
  IF _amount>commission THEN INSERT INTO live_finance.learning_journal(transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) VALUES(_tx,o.id,'reverse_creator','creator_pending','gross_pending',_amount-commission); END IF;
 END IF;
 INSERT INTO live_finance.learning_journal(transaction_id,order_id,kind,debit_account,credit_account,amount_kobo) VALUES(_tx,o.id,'refund',account,'processor_clearing',_amount);
 IF NOT r.duplicate THEN
  UPDATE live_finance.learning_orders SET state='refunded' WHERE id=o.id;
  IF r.delivered AND o.kind='class' THEN
   UPDATE public.interactive_class_enrollments SET state='withdrawn',updated_at=now() WHERE class_id=o.resource_id AND student_id=o.buyer_id;
   INSERT INTO public.learning_participant_removals(class_id,student_id,revoke_token_ts,reason) VALUES(o.resource_id,o.buyer_id,extract(epoch from clock_timestamp())::bigint,'Verified full refund') ON CONFLICT DO NOTHING;
  ELSIF r.delivered THEN UPDATE public.personal_learning_requests SET state=CASE WHEN state='completed' THEN state ELSE 'cancelled' END,updated_at=now() WHERE id=o.resource_id; END IF;
 END IF;
 INSERT INTO public.audit_events(action,target_kind,target_id,correlation_id) VALUES('learning.refund.verified','learning_order',o.id,_tx);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION live_finance.apply_learning_refund(text,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_live_learning_checkout(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_live_learning_checkout(uuid,text,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.finish_live_learning_checkout(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_live_learning_checkout(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.live_learning_can_return(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_learning_can_return(uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.live_learning_order_snapshot(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_learning_order_snapshot(text) TO service_role;
REVOKE ALL ON FUNCTION public.record_live_learning_charge(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_live_learning_charge(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_live_learning_charge() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_live_learning_charge() TO service_role;
REVOKE ALL ON FUNCTION public.retry_live_learning_charge(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_live_learning_charge(text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.settle_live_learning_charge(text,uuid,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_live_learning_charge(text,uuid,bigint,bigint) TO service_role;

CREATE OR REPLACE FUNCTION student_social_private.learning_action(_action text,_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); campus uuid; cid uuid; peer uuid; c public.interactive_classes%ROWTYPE; s public.personal_learning_requests%ROWTYPE; enrolled integer; st timestamptz; en timestamptz; cap integer; title_text text; description_text text; key_text text; reason_text text; price bigint; state_text text; target uuid; out jsonb;
BEGIN
 IF NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(_input) IS DISTINCT FROM 'object' OR length(_input::text)>8192 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT institution_id INTO campus FROM public.student_profiles WHERE user_id=actor;
 IF campus IS NULL OR NOT EXISTS(SELECT 1 FROM public.institutions WHERE id=campus AND active) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _action='create_class' THEN
  cid:=(_input->>'courseId')::uuid; st:=(_input->>'startsAt')::timestamptz; en:=(_input->>'endsAt')::timestamptz;
  cap:=(_input->>'capacity')::integer; title_text:=btrim(_input->>'title'); description_text:=coalesce(_input->>'description',''); key_text:=_input->>'creationKey'; price:=coalesce((_input->>'priceKobo')::bigint,0);
  IF cid IS NULL OR st IS NULL OR en IS NULL OR cap IS NULL OR title_text IS NULL OR key_text IS NULL OR length(title_text) NOT BETWEEN 5 AND 120 OR length(description_text)>1200 OR key_text !~ '^[A-Za-z0-9_-]{16,128}$' OR cap NOT BETWEEN 2 AND 50 OR en<=st OR en>st+interval '4 hours' OR price<0 OR price>1000000000 OR (price>0 AND price<20000) THEN RAISE EXCEPTION 'INVALID_INPUT_OR_PAID_CLASS_UNAVAILABLE' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':class',0));
  SELECT * INTO c FROM public.interactive_classes WHERE host_id=actor AND creation_key=key_text;
  IF FOUND THEN
   IF (c.course_id,c.starts_at,c.ends_at,c.capacity,c.title,c.description,c.price_kobo) IS DISTINCT FROM (cid,st,en,cap,title_text,description_text,price) THEN RAISE EXCEPTION 'CREATION_KEY_CONFLICT' USING ERRCODE='23505'; END IF;
   RETURN jsonb_build_object('id',c.id,'status',c.status,'replayed',true);
  END IF;
  IF st<=now() OR st>now()+interval '90 days' OR NOT EXISTS(SELECT 1 FROM public.courses WHERE id=cid AND institution_id=campus AND active) THEN RAISE EXCEPTION 'CLASS_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.interactive_classes WHERE host_id=actor AND status IN ('scheduled','room_open') AND starts_at<en AND ends_at>st) THEN RAISE EXCEPTION 'CLASS_TIME_CONFLICT' USING ERRCODE='23505'; END IF;
  IF (SELECT count(*) FROM public.interactive_classes WHERE host_id=actor AND starts_at>now() AND status='scheduled')>=30 THEN RAISE EXCEPTION 'CLASS_RATE_LIMIT' USING ERRCODE='22023'; END IF;
  target:=gen_random_uuid();
  INSERT INTO public.interactive_classes(id,institution_id,course_id,host_id,title,description,starts_at,ends_at,capacity,price_kobo,room_name,creation_key) VALUES(target,campus,cid,actor,title_text,description_text,st,en,cap,price,'wk-class-'||target::text,key_text);
  RETURN jsonb_build_object('id',target,'status','scheduled','replayed',false);
 ELSIF _action IN ('enroll','withdraw','open','complete','cancel','remove_participant') THEN
  target:=(_input->>'classId')::uuid;
  SELECT * INTO c FROM public.interactive_classes WHERE id=target FOR UPDATE;
  IF NOT FOUND OR c.institution_id<>campus OR NOT public.affiliation_eligible(c.host_id) OR NOT EXISTS(SELECT 1 FROM public.courses WHERE id=c.course_id AND active) OR EXISTS(SELECT 1 FROM public.creator_restrictions WHERE creator_id=c.host_id AND viewer_id=actor AND deny_view) THEN RAISE EXCEPTION 'CLASS_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF _action='enroll' THEN
   IF actor=c.host_id OR c.status NOT IN ('scheduled','room_open') OR now()>=c.ends_at OR c.price_kobo<>0 OR EXISTS(SELECT 1 FROM public.learning_participant_removals WHERE class_id=c.id AND student_id=actor) THEN RAISE EXCEPTION 'CLASS_ACCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.interactive_class_enrollments WHERE class_id=c.id AND student_id=actor AND state='enrolled') THEN RETURN jsonb_build_object('id',c.id,'status','enrolled','replayed',true); END IF;
   SELECT count(*) INTO enrolled FROM public.interactive_class_enrollments WHERE class_id=c.id AND state='enrolled';
   IF enrolled>=c.capacity-1 THEN RAISE EXCEPTION 'CLASS_FULL' USING ERRCODE='23505'; END IF;
   INSERT INTO public.interactive_class_enrollments(class_id,student_id,state) VALUES(c.id,actor,'enrolled') ON CONFLICT(class_id,student_id) DO UPDATE SET state='enrolled',updated_at=now();
   RETURN jsonb_build_object('id',c.id,'status','enrolled');
  ELSIF _action='withdraw' THEN
   IF c.status<>'scheduled' OR actor=c.host_id OR c.price_kobo<>0 THEN RAISE EXCEPTION 'CLASS_ACCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
   UPDATE public.interactive_class_enrollments SET state='withdrawn',updated_at=now() WHERE class_id=c.id AND student_id=actor AND state='enrolled';
   RETURN jsonb_build_object('id',c.id,'status','withdrawn');
  END IF;
  IF c.host_id<>actor THEN RAISE EXCEPTION 'HOST_REQUIRED' USING ERRCODE='42501'; END IF;
  IF _action='open' THEN
   IF c.status NOT IN ('scheduled','room_open') OR now()<c.starts_at-interval '15 minutes' OR now()>=c.ends_at THEN RAISE EXCEPTION 'CLASS_ACCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
   UPDATE public.interactive_classes SET status='room_open',updated_at=now() WHERE id=c.id;
   RETURN jsonb_build_object('id',c.id,'status','room_open');
  ELSIF _action='remove_participant' THEN
   peer:=(_input->>'studentId')::uuid; reason_text:=btrim(_input->>'reason');
   IF c.status<>'room_open' OR peer=actor OR peer IS NULL OR reason_text IS NULL OR length(reason_text) NOT BETWEEN 8 AND 500 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM public.learning_participant_removals WHERE class_id=c.id AND student_id=peer) THEN RETURN jsonb_build_object('id',c.id,'status','removal_pending_or_done','replayed',true); END IF;
   UPDATE public.interactive_class_enrollments SET state='withdrawn',updated_at=now() WHERE class_id=c.id AND student_id=peer AND state='enrolled';
   IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_ACCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
   INSERT INTO public.learning_participant_removals(class_id,student_id,revoke_token_ts,reason) VALUES(c.id,peer,extract(epoch from clock_timestamp())::bigint,reason_text);
   INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(actor,'learning.participant.removed','interactive_class',c.id,reason_text);
   RETURN jsonb_build_object('id',c.id,'status','removal_pending');
  ELSE
   state_text:=CASE WHEN _action='complete' THEN 'completed' ELSE 'cancelled' END;
   IF c.status=state_text THEN RETURN jsonb_build_object('id',c.id,'status',state_text,'replayed',true); END IF;
   IF c.status NOT IN ('scheduled','room_open') OR (_action='complete' AND c.status<>'room_open') THEN RAISE EXCEPTION 'CLASS_ACCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
   reason_text:=CASE WHEN _action='cancel' THEN btrim(_input->>'reason') ELSE NULL END;
   IF _action='cancel' AND (reason_text IS NULL OR length(reason_text) NOT BETWEEN 8 AND 500) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   UPDATE public.interactive_classes SET status=state_text,provider_ready=false,cancel_reason=reason_text,updated_at=now() WHERE id=c.id;
   INSERT INTO public.learning_room_closures(class_id,room_name) VALUES(c.id,c.room_name) ON CONFLICT(class_id) DO NOTHING;
   IF state_text='cancelled' THEN INSERT INTO public.learning_refund_reviews(resource_kind,resource_id,student_id,reason) SELECT 'class',c.id,buyer_id,'Paid class cancelled' FROM live_finance.learning_orders WHERE kind='class' AND resource_id=c.id AND state='paid' ON CONFLICT DO NOTHING; END IF;
   INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(actor,'learning.class.'||state_text,'interactive_class',c.id,reason_text);
   RETURN jsonb_build_object('id',c.id,'status',state_text,'closurePending',true);
  END IF;
 ELSIF _action='request_help' THEN
  peer:=(_input->>'creatorId')::uuid; key_text:=_input->>'creationKey'; description_text:=btrim(_input->>'description'); state_text:=_input->>'kind'; price:=coalesce((_input->>'budgetKobo')::bigint,0);
  IF peer IS NULL OR peer=actor OR key_text IS NULL OR key_text !~ '^[A-Za-z0-9_-]{16,128}$' OR description_text IS NULL OR length(description_text) NOT BETWEEN 20 AND 2000 OR state_text IS NULL OR state_text NOT IN ('tutoring','assignment_explanation','project_guidance') OR price<0 OR price>1000000000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id=peer AND institution_id=campus) OR NOT public.affiliation_eligible(peer) OR EXISTS(SELECT 1 FROM public.creator_restrictions WHERE creator_id=peer AND viewer_id=actor AND (deny_message OR deny_view)) OR EXISTS(SELECT 1 FROM public.social_contact_blocks WHERE (blocker_id,blocked_id) IN ((actor,peer),(peer,actor))) THEN RAISE EXCEPTION 'CREATOR_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':learning',0));
  SELECT * INTO s FROM public.personal_learning_requests WHERE student_id=actor AND creation_key=key_text;
  IF FOUND THEN
   IF (s.creator_id,s.description,s.kind,s.budget_kobo) IS DISTINCT FROM (peer,description_text,state_text,price) THEN RAISE EXCEPTION 'CREATION_KEY_CONFLICT' USING ERRCODE='23505'; END IF;
   RETURN jsonb_build_object('id',s.id,'status',s.state,'replayed',true);
  END IF;
  IF (SELECT count(*) FROM public.personal_learning_requests WHERE student_id=actor AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'REQUEST_RATE_LIMIT' USING ERRCODE='22023'; END IF;
  INSERT INTO public.personal_learning_requests(institution_id,student_id,creator_id,kind,description,budget_kobo,creation_key) VALUES(campus,actor,peer,state_text,description_text,price,key_text) RETURNING id INTO target;
  RETURN jsonb_build_object('id',target,'status','requested');
 ELSIF _action IN ('quote_help','accept_help','start_help','submit_help','complete_help','cancel_help','dispute_help') THEN
  target:=(_input->>'requestId')::uuid;
  SELECT * INTO s FROM public.personal_learning_requests WHERE id=target FOR UPDATE;
  IF NOT FOUND OR s.institution_id<>campus OR actor NOT IN (s.student_id,s.creator_id) THEN RAISE EXCEPTION 'LEARNING_ACCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _action='quote_help' AND actor=s.creator_id AND s.state IN ('requested','quoted') AND NOT EXISTS(SELECT 1 FROM live_finance.learning_orders WHERE kind='service' AND resource_id=s.id) THEN
   price:=(_input->>'quoteKobo')::bigint; IF price IS NULL OR price<0 OR price>1000000000 OR (price>0 AND price<20000) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   UPDATE public.personal_learning_requests SET quote_kobo=price,state='quoted',updated_at=now() WHERE id=s.id; state_text:='quoted';
  ELSIF _action='accept_help' AND actor=s.student_id AND s.state='quoted' AND s.quote_kobo=0 AND (_input->>'quoteKobo')::bigint=0 THEN state_text:='accepted';
  ELSIF _action='start_help' AND actor=s.creator_id AND s.state='accepted' AND (s.quote_kobo=0 OR live_finance.learning_has_paid(s.student_id,'service',s.id,s.creator_id,s.quote_kobo)) THEN state_text:='in_progress';
  ELSIF _action='submit_help' AND actor=s.creator_id AND s.state='in_progress' THEN state_text:='submitted';
  ELSIF _action='complete_help' AND actor=s.student_id AND s.state='submitted' THEN state_text:='completed';
  ELSIF _action='cancel_help' AND s.state IN ('requested','quoted','accepted') THEN state_text:='cancelled';
   IF s.quote_kobo>0 AND live_finance.learning_has_paid(s.student_id,'service',s.id,s.creator_id,s.quote_kobo) THEN INSERT INTO public.learning_refund_reviews(resource_kind,resource_id,student_id,reason) VALUES('service',s.id,s.student_id,'Paid service cancelled') ON CONFLICT DO NOTHING; END IF;
  ELSIF _action='dispute_help' AND s.state IN ('in_progress','submitted') THEN
   reason_text:=btrim(_input->>'reason'); IF reason_text IS NULL OR length(reason_text) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   INSERT INTO public.personal_learning_disputes(request_id,reporter_id,reason) VALUES(s.id,actor,reason_text); state_text:='disputed';
  ELSE RAISE EXCEPTION 'LEARNING_ACCESS_FORBIDDEN_OR_PAYMENT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  UPDATE public.personal_learning_requests SET state=state_text,updated_at=now() WHERE id=s.id;
  INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'learning.request.'||state_text,'personal_learning_request',s.id);
  INSERT INTO public.learning_notifications(user_id,kind,resource_id,body) VALUES(CASE WHEN actor=s.student_id THEN s.creator_id ELSE s.student_id END,'help.'||state_text,s.id,'Learning request updated') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('id',s.id,'status',state_text);
 END IF;
 RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
END $$;
CREATE OR REPLACE FUNCTION public.authorized_hosted_class_room(_actor uuid,_class uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('room',c.room_name,'identity','student-'||_actor::text,'role',CASE WHEN c.host_id=_actor THEN 'host' ELSE 'participant' END,'capacity',c.capacity,'endsAt',c.ends_at,'ready',c.provider_ready)
 FROM public.interactive_classes c JOIN public.student_profiles p ON p.user_id=_actor JOIN public.courses co ON co.id=c.course_id JOIN public.institutions i ON i.id=c.institution_id
 WHERE c.id=_class AND p.institution_id=c.institution_id AND co.active AND i.active AND c.room_name='wk-class-'||c.id::text AND c.status='room_open' AND now()>=c.starts_at-interval '15 minutes' AND now()<c.ends_at AND public.affiliation_eligible(_actor) AND public.affiliation_eligible(c.host_id)
 AND NOT EXISTS(SELECT 1 FROM public.creator_restrictions WHERE creator_id=c.host_id AND viewer_id=_actor AND deny_view)
 AND (c.host_id=_actor OR (c.provider_ready AND EXISTS(SELECT 1 FROM public.interactive_class_enrollments WHERE class_id=c.id AND student_id=_actor AND state='enrolled') AND NOT EXISTS(SELECT 1 FROM public.learning_participant_removals WHERE class_id=c.id AND student_id=_actor) AND (c.price_kobo=0 OR live_finance.learning_has_paid(_actor,'class',c.id,c.host_id,c.price_kobo))));
$$;

ALTER TABLE live_finance.reversal_inbox DROP CONSTRAINT reversal_inbox_provider_id_check;
ALTER TABLE live_finance.reversal_inbox ADD CONSTRAINT reversal_inbox_provider_id_check CHECK(provider_id ~ '^[1-9][0-9]{0,19}$' OR (event_type='refund.processed' AND provider_id ~ '^(lc|ll)_[0-9a-f]{32}:[0-9a-f]{64}$' AND split_part(provider_id,':',2)=payload_sha256));
CREATE OR REPLACE FUNCTION public.enqueue_live_reversal_event(_event text,_id text,_digest text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _event IS NULL OR _event NOT IN ('refund.processed','charge.dispute.create','charge.dispute.remind','charge.dispute.resolve') OR _id IS NULL OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' OR (_id !~ '^[1-9][0-9]{0,19}$' AND NOT (_event='refund.processed' AND _id ~ '^(lc|ll)_[0-9a-f]{32}:[0-9a-f]{64}$' AND split_part(_id,':',2)=_digest)) THEN RETURN 'invalid'; END IF;
 INSERT INTO live_finance.reversal_inbox(event_type,provider_id,payload_sha256) VALUES(_event,_id,_digest) ON CONFLICT DO NOTHING;
 RETURN CASE WHEN FOUND THEN 'accepted' ELSE 'duplicate' END;
END $$;
CREATE OR REPLACE FUNCTION public.live_reversal_receipt(_tx text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('reference',r.reference,'amountKobo',r.amount_kobo,'transactionId',r.transaction_id,'domain','live') FROM live_finance.receipts r JOIN public.orders o ON o.id=r.order_id WHERE r.transaction_id=_tx AND o.environment='live'
 UNION ALL SELECT jsonb_build_object('reference',r.reference,'amountKobo',r.amount_kobo,'transactionId',r.transaction_id,'domain','live') FROM live_finance.learning_receipts r WHERE r.transaction_id=_tx
$$;
CREATE OR REPLACE FUNCTION public.apply_live_refund_event(_id text,_lease uuid,_tx text,_amount bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e live_finance.reversal_inbox%ROWTYPE; receipt jsonb;
BEGIN
 SELECT * INTO e FROM live_finance.reversal_inbox WHERE event_type='refund.processed' AND provider_id=_id AND state='processing' AND lease_id=_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 receipt:=public.live_reversal_receipt(_tx);
 IF receipt IS NULL OR (receipt->>'amountKobo')::bigint IS DISTINCT FROM _amount OR (_id LIKE '%:%' AND split_part(_id,':',1) IS DISTINCT FROM receipt->>'reference') THEN RETURN false; END IF;
 IF receipt->>'reference' LIKE 'll_%' THEN IF NOT live_finance.apply_learning_refund(_tx,'paystack-refund:'||_id,_amount) THEN RETURN false; END IF;
 ELSE PERFORM public.live_record_reversal(receipt->>'reference',_tx,'paystack-refund:'||_id,'refund',_amount,'NGN','live'); END IF;
 UPDATE live_finance.reversal_inbox SET state='processed',lease_id=NULL,lease_until=NULL,reason=NULL,next_retry_at=NULL WHERE event_type=e.event_type AND provider_id=e.provider_id;
 RETURN true;
END $$;
