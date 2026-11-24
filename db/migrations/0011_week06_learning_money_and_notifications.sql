-- WEEK 6 FINANCE & NOTIFICATION CONTRACT — DRAFT STAGING ONLY.
-- Only test in disposable PostgreSQL with Week 1+5 migrations applied.
-- Do not deploy to real Supabase without coordinator authorization and hosted API review.
-- Week 5 remains the owner of trust boundaries, settlement, chargebacks and fee policy.
-- No browser can create paid orders, mark entitlements active, alter ledger,
-- issue refunds or process LiveKit presence/webhooks via this schema.

CREATE TABLE public.learning_purchase_orders (
  reference text PRIMARY KEY CHECK(reference ~ '^lsc_[0-9a-f]{36}$'),
  buyer_id uuid NOT NULL REFERENCES auth.users(id),
  creator_id uuid NOT NULL REFERENCES auth.users(id),
  resource_kind text NOT NULL CHECK(resource_kind IN ('class','service')),
  resource_id uuid NOT NULL,
  buyer_email text NOT NULL CHECK(length(buyer_email)<=254),
  amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 20000 AND 1000000000),
  currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
  payment_environment text NOT NULL DEFAULT 'test' CHECK(payment_environment='test'),
  state text NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','paid','paid_review','refunded','chargeback')),
  provider_transaction_id text UNIQUE,
  provider_fee_kobo bigint NOT NULL DEFAULT 0 CHECK(provider_fee_kobo>=0 AND provider_fee_kobo<=amount_kobo),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  UNIQUE(buyer_id,request_key),UNIQUE(buyer_id,resource_kind,resource_id),
  UNIQUE(reference,buyer_id,resource_kind,resource_id),
  CHECK(buyer_id<>creator_id),
  CHECK((state='pending' AND provider_transaction_id IS NULL AND paid_at IS NULL)
      OR (state<>'pending' AND provider_transaction_id IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX learning_orders_buyer ON public.learning_purchase_orders(buyer_id,created_at DESC);

CREATE TABLE public.learning_payment_entitlements (
  buyer_id uuid NOT NULL REFERENCES auth.users(id),
  resource_kind text NOT NULL CHECK(resource_kind IN ('class','service')),
  resource_id uuid NOT NULL,
  order_reference text NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('active','revoked')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY(buyer_id,resource_kind,resource_id),
  FOREIGN KEY(order_reference,buyer_id,resource_kind,resource_id)
    REFERENCES public.learning_purchase_orders(reference,buyer_id,resource_kind,resource_id),
  CHECK((state='active' AND revoked_at IS NULL)
      OR (state='revoked' AND revoked_at IS NOT NULL))
);

CREATE TABLE public.learning_payment_events (
  order_reference text NOT NULL REFERENCES public.learning_purchase_orders(reference),
  event_key text NOT NULL CHECK(length(event_key) BETWEEN 8 AND 160),
  kind text NOT NULL CHECK(kind IN ('charge','provider_fee','refund','chargeback')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(order_reference,event_key)
);
CREATE TABLE public.learning_payment_ledger (
  order_reference text NOT NULL,
  event_key text NOT NULL,
  line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 32),
  account text NOT NULL CHECK(account IN ('processor_clearing','creator_payable','provider_fee_suspense')),
  debit_kobo bigint NOT NULL DEFAULT 0 CHECK(debit_kobo>=0),
  credit_kobo bigint NOT NULL DEFAULT 0 CHECK(credit_kobo>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(order_reference,event_key,line_no),
  FOREIGN KEY(order_reference,event_key)
    REFERENCES public.learning_payment_events(order_reference,event_key),
  CHECK((debit_kobo>0 AND credit_kobo=0) OR (credit_kobo>0 AND debit_kobo=0))
);
-- A row-level delayed integrity constraint catches unbalanced journals at COMMIT.
CREATE FUNCTION public.week06_learning_ledger_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE debits bigint; credits bigint;
BEGIN
 SELECT coalesce(sum(debit_kobo),0),coalesce(sum(credit_kobo),0)
   INTO debits,credits FROM public.learning_payment_ledger
   WHERE order_reference=NEW.order_reference AND event_key=NEW.event_key;
 IF debits<>credits THEN RAISE EXCEPTION 'Unbalanced Week 6 journal';
 END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER learning_ledger_commit_balanced
AFTER INSERT OR UPDATE ON public.learning_payment_ledger
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.week06_learning_ledger_balanced();

CREATE TABLE public.learning_payment_inbox (
 event_key text PRIMARY KEY,
 order_reference text NOT NULL REFERENCES public.learning_purchase_orders(reference),
 provider_transaction_id text NOT NULL,
 raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','processed','failed')),
 received_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_error_code text
);
CREATE INDEX learning_inbox_retry ON public.learning_payment_inbox(state,lease_until);

CREATE TABLE public.learning_email_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 opt_in boolean NOT NULL DEFAULT false,
 opted_in_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(opt_in=false OR opted_in_at IS NOT NULL)
);
CREATE TABLE public.learning_email_delivery (
 notification_id uuid PRIMARY KEY REFERENCES public.learning_notifications(id),
 state text NOT NULL CHECK(state IN ('sending','sent','retry')),
 attempts integer NOT NULL CHECK(attempts>=0),
 lease_until timestamptz,
 next_attempt_at timestamptz,
 provider_message_id text,
 updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_payment_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_payment_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_payment_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_email_delivery ENABLE ROW LEVEL SECURITY;

-- Browser can see its own immutable receipt / scoped entitlements / preference,
-- but cannot set paid=true, spoof payment evidence or read private operator ledgers.
CREATE POLICY own_learning_order_read ON public.learning_purchase_orders
  FOR SELECT TO authenticated USING (
    buyer_id=(SELECT auth.uid())
    AND EXISTS(SELECT 1 FROM public.student_profiles p
      WHERE p.user_id=(SELECT auth.uid()) AND p.verified_at IS NOT NULL AND NOT p.suspended)
  );
CREATE POLICY own_learning_entitlement_read ON public.learning_payment_entitlements
  FOR SELECT TO authenticated USING (
    buyer_id=(SELECT auth.uid())
    AND EXISTS(SELECT 1 FROM public.student_profiles p
      WHERE p.user_id=(SELECT auth.uid()) AND p.verified_at IS NOT NULL AND NOT p.suspended)
  );
CREATE POLICY own_learning_email_preferences ON public.learning_email_preferences
  FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));

REVOKE ALL ON public.learning_purchase_orders,public.learning_payment_entitlements,
  public.learning_payment_events,public.learning_payment_ledger,public.learning_payment_inbox,
  public.learning_email_preferences,public.learning_email_delivery FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.learning_purchase_orders,public.learning_payment_entitlements,
 public.learning_email_preferences TO authenticated;
GRANT ALL ON public.learning_purchase_orders,public.learning_payment_entitlements,
  public.learning_payment_events,public.learning_payment_ledger,public.learning_payment_inbox,
  public.learning_email_preferences,public.learning_email_delivery TO service_role;

-- Read-only proof: validates actual paid order and scoped entitlement with
-- user + campus + verification; NEVER exposes payment provider keys or balances.
CREATE FUNCTION public.can_join_paid_week06_class(_class_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.interactive_classes c
  JOIN public.interactive_class_enrollments e ON e.class_id=c.id
  JOIN public.student_profiles p ON p.user_id=e.student_id
  WHERE c.id=_class_id AND e.student_id=(SELECT auth.uid())
    AND e.state='enrolled' AND p.verified_at IS NOT NULL AND NOT p.suspended
    AND p.institution_id=c.institution_id
    AND c.status IN ('scheduled','room_open') AND c.ends_at>now()
    AND public.creator_can_view_published(c.host_id)
    AND (c.price_kobo=0 OR EXISTS (
      SELECT 1 FROM public.learning_payment_entitlements ent
      JOIN public.learning_purchase_orders o ON o.reference=ent.order_reference
      WHERE ent.buyer_id=p.user_id AND ent.resource_kind='class'
        AND ent.resource_id=c.id AND ent.state='active'
        AND o.state='paid' AND o.currency='NGN' AND o.payment_environment='test'
        AND o.buyer_id=p.user_id AND o.resource_kind='class'
        AND o.resource_id=c.id AND o.amount_kobo=c.price_kobo
    ))
 );
$$;
REVOKE ALL ON FUNCTION public.can_join_paid_week06_class(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_join_paid_week06_class(uuid) TO authenticated,service_role;

-- These declarations are a *contract*, NOT a production settlement API.
-- Cross-week Week 5 PSP verification, atomic server-side updates, refunds,
-- email sender proof and LiveKit provider integration require further review.
