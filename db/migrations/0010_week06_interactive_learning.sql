-- Week 6 proposed hosted schema; DO NOT APPLY TO LIVE PROJECT WITHOUT REVIEW.
-- No user-controlled payment success, refunds or LiveKit room grants in browser SQL.
-- Server-owned writes only; current wired implementation remains local SQLite.
-- Depending on Week 1's core student_profiles + courses and verified-student security.
CREATE TABLE public.interactive_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  course_id uuid NOT NULL,
  host_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 5 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description)<=1200),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 2 AND 50),
  price_kobo bigint NOT NULL CHECK (price_kobo BETWEEN 0 AND 1000000000),
  currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','room_open','completed','cancelled')),
  room_name text NOT NULL UNIQUE,
  creation_key text NOT NULL CHECK(length(creation_key) BETWEEN 16 AND 128),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(host_id,creation_key),
  FOREIGN KEY(course_id,institution_id) REFERENCES public.courses(id,institution_id),
  FOREIGN KEY(host_id,institution_id) REFERENCES public.student_profiles(user_id,institution_id),
  CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '4 hours')
);
CREATE INDEX classes_course_start ON public.interactive_classes(institution_id,course_id,starts_at);

CREATE TABLE public.interactive_class_enrollments (
  class_id uuid NOT NULL REFERENCES public.interactive_classes(id),
  student_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
  state text NOT NULL CHECK(state IN ('enrolled','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(class_id,student_id)
);
CREATE TABLE public.interactive_class_presence (
  provider_event_id uuid PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES public.interactive_classes(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK(kind IN ('joined','left')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.creator_availability (
  creator_id uuid PRIMARY KEY REFERENCES public.student_profiles(user_id),
  slots_json jsonb NOT NULL CHECK(jsonb_typeof(slots_json)='array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.personal_learning_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  student_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('tutoring','assignment_explanation','project_guidance')),
  description text NOT NULL CHECK(length(trim(description)) BETWEEN 20 AND 2000),
  budget_kobo bigint CHECK(budget_kobo BETWEEN 0 AND 1000000000),
  quote_kobo bigint CHECK(quote_kobo BETWEEN 0 AND 1000000000),
  state text NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','quoted','accepted','in_progress','submitted','completed','rejected','cancelled','disputed')),
  creation_key text NOT NULL CHECK(length(creation_key) BETWEEN 16 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,creation_key),
  CHECK(student_id<>creator_id),
  FOREIGN KEY(student_id,institution_id) REFERENCES public.student_profiles(user_id,institution_id),
  FOREIGN KEY(creator_id,institution_id) REFERENCES public.student_profiles(user_id,institution_id)
);
CREATE TABLE public.personal_learning_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.personal_learning_requests(id),
  reporter_id uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 1000),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
  resolution text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.learning_refund_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_kind text NOT NULL CHECK(resource_kind IN ('class','service')),
  resource_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES auth.users(id),
  state text NOT NULL DEFAULT 'pending_review' CHECK(state IN ('pending_review','recorded')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_kind,resource_id,student_id)
);
CREATE TABLE public.learning_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL,
  resource_id uuid NOT NULL,
  body text NOT NULL CHECK(length(body)<=500),
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,kind,resource_id)
);

-- All financial/room secrets remain outside these browser-readable tables.
ALTER TABLE public.interactive_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactive_class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactive_class_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_learning_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_learning_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_refund_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY classes_same_verified_campus ON public.interactive_classes
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.student_profiles p
    WHERE p.user_id=(SELECT auth.uid()) AND p.institution_id=interactive_classes.institution_id
      AND p.verified_at IS NOT NULL AND NOT p.suspended)
  AND public.creator_can_view_published(host_id)
);
CREATE POLICY own_or_host_class_enrollments ON public.interactive_class_enrollments
FOR SELECT TO authenticated USING (
  student_id=(SELECT auth.uid())
  OR EXISTS(SELECT 1 FROM public.interactive_classes c WHERE c.id=class_id AND c.host_id=(SELECT auth.uid()))
);
CREATE POLICY own_or_host_class_presence ON public.interactive_class_presence
FOR SELECT TO authenticated USING (
  user_id=(SELECT auth.uid())
  OR EXISTS(SELECT 1 FROM public.interactive_classes c WHERE c.id=class_id AND c.host_id=(SELECT auth.uid()))
);
CREATE POLICY creator_availability_same_campus ON public.creator_availability
FOR SELECT TO authenticated USING (
  creator_id=(SELECT auth.uid())
  OR (EXISTS(SELECT 1 FROM public.student_profiles viewer
     JOIN public.student_profiles creator ON creator.user_id=creator_id
     WHERE viewer.user_id=(SELECT auth.uid()) AND viewer.institution_id=creator.institution_id
       AND viewer.verified_at IS NOT NULL AND NOT viewer.suspended)
     AND public.creator_can_view_published(creator_id))
);
CREATE POLICY learning_request_participants_only ON public.personal_learning_requests
FOR SELECT TO authenticated USING (
  (student_id=(SELECT auth.uid()) OR creator_id=(SELECT auth.uid()))
  AND EXISTS(SELECT 1 FROM public.student_profiles p WHERE p.user_id=(SELECT auth.uid())
    AND p.institution_id=personal_learning_requests.institution_id AND p.verified_at IS NOT NULL AND NOT p.suspended)
);
CREATE POLICY learning_dispute_participants_only ON public.personal_learning_disputes
FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.personal_learning_requests r
    WHERE r.id=request_id AND (r.student_id=(SELECT auth.uid()) OR r.creator_id=(SELECT auth.uid())))
);
CREATE POLICY learning_notifications_owner_only ON public.learning_notifications
FOR SELECT TO authenticated USING (
  user_id=(SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.student_profiles p WHERE p.user_id=(SELECT auth.uid())
    AND p.verified_at IS NOT NULL AND NOT p.suspended)
);
-- The refund review queue is never browser-readable. A service operator must
-- verify an actual charge/refund against Week 5 ledger and policy.
REVOKE ALL ON public.interactive_classes,public.interactive_class_enrollments,
 public.interactive_class_presence,public.creator_availability,public.personal_learning_requests,
 public.personal_learning_disputes,public.learning_refund_reviews,public.learning_notifications
 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.interactive_classes,public.interactive_class_enrollments,
 public.interactive_class_presence,public.creator_availability,public.personal_learning_requests,
 public.personal_learning_disputes,public.learning_notifications TO authenticated;
GRANT ALL ON public.interactive_classes,public.interactive_class_enrollments,
 public.interactive_class_presence,public.creator_availability,public.personal_learning_requests,
 public.personal_learning_disputes,public.learning_refund_reviews,public.learning_notifications TO service_role;

-- Class/service entitlements and money mutations are deliberately NOT created here:
-- Week 5 must own the authoritative order, PSP verification, balanced journal,
-- refund reversals and scoped resource entitlements. Never invent payment success.
