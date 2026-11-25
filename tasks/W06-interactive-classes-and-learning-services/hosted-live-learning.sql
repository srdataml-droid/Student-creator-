-- Week 6 hosted class and learning schema, integrated with canonical current-session guards.
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
  provider_event_id text PRIMARY KEY CHECK(length(provider_event_id) BETWEEN 8 AND 128),
  class_id uuid NOT NULL REFERENCES public.interactive_classes(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK(kind IN ('joined','left')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Durable provider room teardown is server-owned. A closed SQL row does not
-- by itself invalidate signed LiveKit tokens or remove active participants.
CREATE TABLE public.learning_room_closures (
  class_id uuid PRIMARY KEY REFERENCES public.interactive_classes(id),
  room_name text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Server-only participant eviction/revocation queue.
-- Never allow a client to choose provider identities or revoke another user's grant.
CREATE TABLE public.learning_participant_removals (
  class_id uuid NOT NULL REFERENCES public.interactive_classes(id),
  student_id uuid NOT NULL REFERENCES public.student_profiles(user_id),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  revoke_token_ts bigint NOT NULL CHECK(revoke_token_ts>0),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(class_id,student_id)
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
CREATE TABLE public.learning_dispute_decisions (
  request_id uuid PRIMARY KEY REFERENCES public.personal_learning_requests(id),
  outcome text NOT NULL CHECK(outcome IN ('resume_guidance','return_to_review','cancel_service')),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 1000),
  decided_by uuid NOT NULL REFERENCES auth.users(id),
  decided_at timestamptz NOT NULL DEFAULT now()
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
ALTER TABLE public.learning_room_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_participant_removals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_learning_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_learning_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_dispute_decisions ENABLE ROW LEVEL SECURITY;
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
-- Browser sees only the creator's own slots. Student discovery is served by
-- the audited API after campus and creator message restriction checks; do not
-- bypass profile RLS with an unsafe cross-user join.
CREATE POLICY creator_availability_owner_read ON public.creator_availability
FOR SELECT TO authenticated USING (creator_id=(SELECT auth.uid()));
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
 public.interactive_class_presence,public.learning_room_closures,public.learning_participant_removals,public.creator_availability,public.personal_learning_requests,
 public.personal_learning_disputes,public.learning_dispute_decisions,public.learning_refund_reviews,public.learning_notifications
 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.interactive_classes,public.interactive_class_enrollments,
 public.interactive_class_presence,public.creator_availability,public.personal_learning_requests,
 public.personal_learning_disputes,public.learning_notifications TO authenticated;
GRANT ALL ON public.interactive_classes,public.interactive_class_enrollments,
 public.interactive_class_presence,public.learning_room_closures,public.learning_participant_removals,public.creator_availability,public.personal_learning_requests,
 public.personal_learning_disputes,public.learning_dispute_decisions,public.learning_refund_reviews,public.learning_notifications TO service_role;

-- Class/service entitlements and money mutations are deliberately NOT created here:
-- Week 5 must own the authoritative order, PSP verification, balanced journal,
-- refund reversals and scoped resource entitlements. Never invent payment success.

-- Current sessions and enrollment remain required for every authenticated data surface.
CREATE POLICY learning_current_session ON public.interactive_classes AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible())) WITH CHECK((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible()));
CREATE POLICY learning_current_session ON public.interactive_class_enrollments AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible())) WITH CHECK((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible()));
CREATE POLICY learning_current_session ON public.interactive_class_presence AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible())) WITH CHECK((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible()));
CREATE POLICY learning_current_session ON public.creator_availability AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible())) WITH CHECK((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible()));
CREATE POLICY learning_current_session ON public.personal_learning_requests AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible())) WITH CHECK((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible()));
CREATE POLICY learning_current_session ON public.personal_learning_disputes AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible())) WITH CHECK((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible()));
CREATE POLICY learning_current_session ON public.learning_notifications AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible())) WITH CHECK((SELECT student_creators_private.current_session_active()) AND (SELECT public.current_student_eligible()));
-- Only selected class metadata is visible to a student. Provider names and request keys are private.
REVOKE SELECT ON public.interactive_classes FROM authenticated;
GRANT SELECT(id,institution_id,course_id,host_id,title,description,starts_at,ends_at,capacity,price_kobo,currency,status,created_at,updated_at) ON public.interactive_classes TO authenticated;
REVOKE SELECT ON public.personal_learning_requests FROM authenticated;
GRANT SELECT(id,institution_id,student_id,creator_id,kind,description,budget_kobo,quote_kobo,state,created_at,updated_at) ON public.personal_learning_requests TO authenticated;
ALTER TABLE public.interactive_classes ADD COLUMN provider_ready boolean NOT NULL DEFAULT false;
ALTER TABLE public.learning_room_closures ADD COLUMN lease_id uuid, ADD COLUMN lease_until timestamptz, ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.learning_participant_removals ADD COLUMN lease_id uuid, ADD COLUMN lease_until timestamptz, ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
-- Class scheduling and private learning services. Free lifecycle only until a
-- separate real-payment entitlement contract is approved; never accept test money.
CREATE FUNCTION student_social_private.learning_action(_action text,_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); campus uuid; cid uuid; peer uuid; c public.interactive_classes%ROWTYPE; s public.personal_learning_requests%ROWTYPE; enrolled integer; st timestamptz; en timestamptz; cap integer; title_text text; description_text text; key_text text; reason_text text; price bigint; state_text text; target uuid; out jsonb;
BEGIN
 IF NOT student_creators_private.current_session_active() OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(_input)<>'object' OR length(_input::text)>8192 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT institution_id INTO campus FROM public.student_profiles WHERE user_id=actor;
 IF campus IS NULL OR NOT EXISTS(SELECT 1 FROM public.institutions WHERE id=campus AND active) THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _action='create_class' THEN
  cid:=(_input->>'courseId')::uuid; st:=(_input->>'startsAt')::timestamptz; en:=(_input->>'endsAt')::timestamptz;
  cap:=(_input->>'capacity')::integer; title_text:=btrim(_input->>'title'); description_text:=coalesce(_input->>'description',''); key_text:=_input->>'creationKey'; price:=coalesce((_input->>'priceKobo')::bigint,0);
  IF cid IS NULL OR st IS NULL OR en IS NULL OR cap IS NULL OR title_text IS NULL OR key_text IS NULL OR length(title_text) NOT BETWEEN 5 AND 120 OR length(description_text)>1200 OR key_text !~ '^[A-Za-z0-9_-]{16,128}$' OR cap NOT BETWEEN 2 AND 50 OR en<=st OR en>st+interval '4 hours' OR price<>0 THEN RAISE EXCEPTION 'INVALID_INPUT_OR_PAID_CLASS_UNAVAILABLE' USING ERRCODE='22023'; END IF;
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
  INSERT INTO public.interactive_classes(id,institution_id,course_id,host_id,title,description,starts_at,ends_at,capacity,price_kobo,room_name,creation_key) VALUES(target,campus,cid,actor,title_text,description_text,st,en,cap,0,'wk-class-'||target::text,key_text);
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
   IF c.status<>'scheduled' OR actor=c.host_id THEN RAISE EXCEPTION 'CLASS_ACCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
   UPDATE public.interactive_class_enrollments SET state='withdrawn',updated_at=now() WHERE class_id=c.id AND student_id=actor AND state='enrolled';
   RETURN jsonb_build_object('id',c.id,'status','withdrawn');
  END IF;
  IF c.host_id<>actor THEN RAISE EXCEPTION 'HOST_REQUIRED' USING ERRCODE='42501'; END IF;
  IF _action='open' THEN
   IF c.status NOT IN ('scheduled','room_open') OR now()<c.starts_at-interval '15 minutes' OR now()>=c.ends_at OR c.price_kobo<>0 THEN RAISE EXCEPTION 'CLASS_ACCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
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
  IF _action='quote_help' AND actor=s.creator_id AND s.state IN ('requested','quoted') THEN
   price:=(_input->>'quoteKobo')::bigint; IF price IS NULL OR price<0 OR price>1000000000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   UPDATE public.personal_learning_requests SET quote_kobo=price,state='quoted',updated_at=now() WHERE id=s.id; state_text:='quoted';
  ELSIF _action='accept_help' AND actor=s.student_id AND s.state='quoted' AND s.quote_kobo=0 AND (_input->>'quoteKobo')::bigint=0 THEN state_text:='accepted';
  ELSIF _action='start_help' AND actor=s.creator_id AND s.state='accepted' AND s.quote_kobo=0 THEN state_text:='in_progress';
  ELSIF _action='submit_help' AND actor=s.creator_id AND s.state='in_progress' THEN state_text:='submitted';
  ELSIF _action='complete_help' AND actor=s.student_id AND s.state='submitted' THEN state_text:='completed';
  ELSIF _action='cancel_help' AND s.state IN ('requested','quoted','accepted') THEN state_text:='cancelled';
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
REVOKE ALL ON FUNCTION student_social_private.learning_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION student_social_private.learning_action(text,jsonb) TO authenticated;
CREATE FUNCTION public.hosted_learning_action(_action text,_input jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_social_private.learning_action(_action,_input); $$;
REVOKE ALL ON FUNCTION public.hosted_learning_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_learning_action(text,jsonb) TO authenticated;

CREATE FUNCTION public.authorized_hosted_class_room(_actor uuid,_class uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('room',c.room_name,'identity','student-'||_actor::text,'role',CASE WHEN c.host_id=_actor THEN 'host' ELSE 'participant' END,'capacity',c.capacity,'endsAt',c.ends_at,'ready',c.provider_ready)
 FROM public.interactive_classes c JOIN public.student_profiles p ON p.user_id=_actor JOIN public.courses co ON co.id=c.course_id JOIN public.institutions i ON i.id=c.institution_id
 WHERE c.id=_class AND p.institution_id=c.institution_id AND co.active AND i.active AND c.room_name='wk-class-'||c.id::text AND c.status='room_open' AND c.price_kobo=0 AND now()>=c.starts_at-interval '15 minutes' AND now()<c.ends_at AND public.affiliation_eligible(_actor) AND public.affiliation_eligible(c.host_id)
 AND NOT EXISTS(SELECT 1 FROM public.creator_restrictions WHERE creator_id=c.host_id AND viewer_id=_actor AND deny_view)
 AND (c.host_id=_actor OR (c.provider_ready AND EXISTS(SELECT 1 FROM public.interactive_class_enrollments WHERE class_id=c.id AND student_id=_actor AND state='enrolled') AND NOT EXISTS(SELECT 1 FROM public.learning_participant_removals WHERE class_id=c.id AND student_id=_actor)));
$$;
REVOKE ALL ON FUNCTION public.authorized_hosted_class_room(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorized_hosted_class_room(uuid,uuid) TO service_role;
CREATE FUNCTION public.mark_hosted_class_ready(_actor uuid,_class uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.interactive_classes SET provider_ready=true,updated_at=now() WHERE id=_class AND host_id=_actor AND status='room_open' AND ends_at>now() AND public.affiliation_eligible(_actor);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.mark_hosted_class_ready(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_hosted_class_ready(uuid,uuid) TO service_role;
CREATE FUNCTION public.record_hosted_class_presence(_event text,_class uuid,_actor uuid,_kind text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _event IS NULL OR length(_event) NOT BETWEEN 8 AND 128 OR _kind NOT IN ('joined','left') OR public.authorized_hosted_class_room(_actor,_class) IS NULL THEN RETURN false; END IF;
 INSERT INTO public.interactive_class_presence(provider_event_id,class_id,user_id,kind) VALUES(_event,_class,_actor,_kind) ON CONFLICT(provider_event_id) DO NOTHING; RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.record_hosted_class_presence(text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_hosted_class_presence(text,uuid,uuid,text) TO service_role;

-- Durable room teardown and eviction jobs. The worker has no authority over payment.
CREATE FUNCTION public.claim_hosted_learning_cleanup() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_c public.learning_room_closures%ROWTYPE; row_p public.learning_participant_removals%ROWTYPE; lease uuid:=gen_random_uuid();
BEGIN
 WITH expired AS (UPDATE public.interactive_classes SET status='completed',provider_ready=false,updated_at=now() WHERE status='room_open' AND ends_at<=now() RETURNING id,room_name)
 INSERT INTO public.learning_room_closures(class_id,room_name) SELECT id,room_name FROM expired ON CONFLICT DO NOTHING;
 SELECT * INTO row_c FROM public.learning_room_closures WHERE state='pending' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF FOUND THEN
  UPDATE public.learning_room_closures SET lease_id=lease,lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE class_id=row_c.class_id;
  RETURN jsonb_build_object('kind','room','classId',row_c.class_id,'room',row_c.room_name,'lease',lease,'attempt',row_c.attempts+1);
 END IF;
 SELECT * INTO row_p FROM public.learning_participant_removals WHERE state='pending' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF FOUND THEN
  UPDATE public.learning_participant_removals SET lease_id=lease,lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE class_id=row_p.class_id AND student_id=row_p.student_id;
  RETURN jsonb_build_object('kind','participant','classId',row_p.class_id,'studentId',row_p.student_id,'room','wk-class-'||row_p.class_id::text,'identity','student-'||row_p.student_id::text,'lease',lease,'revokeTokenTs',row_p.revoke_token_ts);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.claim_hosted_learning_cleanup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hosted_learning_cleanup() TO service_role;
CREATE FUNCTION public.finish_hosted_learning_cleanup(_class uuid,_student uuid,_lease uuid,_success boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _student IS NULL THEN
  -- Two successful deletes, separated by the join-token TTL, close a race with old join tokens.
  UPDATE public.learning_room_closures SET state=CASE WHEN _success AND attempts>=2 AND updated_at<=now()-interval '120 seconds' THEN 'done' ELSE 'pending' END,next_attempt_at=now()+CASE WHEN _success THEN interval '125 seconds' ELSE interval '30 seconds' END,lease_id=NULL,lease_until=NULL WHERE class_id=_class AND state='pending' AND lease_id=_lease AND lease_until>now();
 ELSE
  UPDATE public.learning_participant_removals SET state=CASE WHEN _success THEN 'done' ELSE 'pending' END,next_attempt_at=now()+interval '30 seconds',lease_id=NULL,lease_until=NULL WHERE class_id=_class AND student_id=_student AND state='pending' AND lease_id=_lease AND lease_until>now();
 END IF;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.finish_hosted_learning_cleanup(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_hosted_learning_cleanup(uuid,uuid,uuid,boolean) TO service_role;
