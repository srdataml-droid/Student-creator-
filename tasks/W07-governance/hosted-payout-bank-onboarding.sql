-- Durable payout onboarding. All public RPCs below are service-role only.
-- Never activates the existing payout or transfer gates.
CREATE TABLE student_payout_private.bank_requests(
 id uuid PRIMARY KEY,creator_id uuid NOT NULL REFERENCES auth.users(id),
 bank_code text NOT NULL CHECK(bank_code ~ '^[0-9]{3,6}$'),
 last4 text NOT NULL CHECK(last4 ~ '^[0-9]{4}$'),
 envelope text CHECK(envelope IS NULL OR (length(envelope)<=2048 AND envelope ~ '^v1[.][a-f0-9]{24}[.][a-f0-9]{32}[.]([a-f0-9]{2})+$')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','reviewed','processing','uncertain','active','rejected','cancelled')),
 evidence_ref text CHECK(evidence_ref ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 reviewer uuid REFERENCES auth.users(id),registrar uuid REFERENCES auth.users(id),
 lease uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(reviewer IS NULL OR reviewer<>creator_id),
 CHECK(registrar IS NULL OR (registrar<>creator_id AND registrar<>reviewer)),
 CHECK((state IN ('pending','reviewed','processing','uncertain'))=(envelope IS NOT NULL))
);
CREATE UNIQUE INDEX bank_request_one_open ON student_payout_private.bank_requests(creator_id) WHERE state IN ('pending','reviewed','processing','uncertain');
CREATE INDEX bank_request_creator_time ON student_payout_private.bank_requests(creator_id,created_at DESC);
ALTER TABLE student_payout_private.bank_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON student_payout_private.bank_requests FROM PUBLIC,anon,authenticated,service_role;

-- Reuse existing payout advisory lock. A bank change cannot invalidate an
-- unresolved withdrawal or move a reserved payment to a new account.
CREATE FUNCTION student_payout_private.bank_change_allowed(_creator uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM live_finance.payout_requests r
 LEFT JOIN live_finance.payout_transfers t ON t.payout_id=r.id
 WHERE r.creator_id=_creator AND (r.state='pending_review' OR
 (r.state='reserved' AND (t.bank_state IS NULL OR t.bank_state='unconfirmed' OR t.stage='review' OR (t.provider_status='reversed' AND t.bank_state='paid')))))
$$;
REVOKE ALL ON FUNCTION student_payout_private.bank_change_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.creator_bank_submission(_actor uuid,_session uuid,_id uuid,_bank text,_last4 text,_envelope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.affiliation_eligible(_actor) THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _bank IS NULL OR _last4 IS NULL OR _envelope IS NULL THEN RAISE EXCEPTION 'BANK_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_actor::text||':payout',0));
 IF NOT student_payout_private.bank_change_allowed(_actor) OR EXISTS(SELECT 1 FROM student_payout_private.bank_requests WHERE creator_id=_actor AND state IN ('pending','reviewed','processing','uncertain')) THEN RAISE EXCEPTION 'BANK_CONFLICT' USING ERRCODE='23505'; END IF;
 INSERT INTO student_payout_private.bank_requests(id,creator_id,bank_code,last4,envelope) VALUES(_id,_actor,_bank,_last4,_envelope);
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.bank.submitted','payout_bank',_id);
 RETURN jsonb_build_object('id',_id,'state','pending');
END $$;
CREATE FUNCTION public.creator_bank_status(_actor uuid,_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.affiliation_eligible(_actor) THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('requests',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC),'[]'::jsonb) FROM
 (SELECT id,bank_code,last4,state,created_at,updated_at FROM student_payout_private.bank_requests WHERE creator_id=_actor ORDER BY created_at DESC LIMIT 10) q),
 'recipientVerified',EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence WHERE creator_id=_actor AND revoked_at IS NULL AND verified_at<=now() AND valid_until>now()));
END $$;
CREATE FUNCTION public.creator_bank_cancel(_actor uuid,_session uuid,_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.affiliation_eligible(_actor) THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_actor::text||':payout',0));
 UPDATE student_payout_private.bank_requests SET state='cancelled',envelope=NULL,updated_at=now() WHERE id=_id AND creator_id=_actor AND state IN ('pending','reviewed');
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.bank.cancelled','payout_bank',_id);
 RETURN true;
END $$;
CREATE FUNCTION public.staff_bank_queue(_actor uuid,_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at),'[]'::jsonb) FROM
 (SELECT id,creator_id,bank_code,last4,state,created_at,reviewer FROM student_payout_private.bank_requests WHERE creator_id<>_actor AND state IN ('pending','reviewed','processing','uncertain') ORDER BY created_at LIMIT 100) q);
END $$;
CREATE FUNCTION public.staff_bank_details(_actor uuid,_session uuid,_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r student_payout_private.bank_requests%ROWTYPE;
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM student_payout_private.bank_requests WHERE id=_id AND creator_id<>_actor AND state IN ('pending','reviewed');
 IF NOT FOUND THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.bank.details_viewed','payout_bank',_id);
 RETURN jsonb_build_object('creatorId',r.creator_id,'id',r.id,'envelope',r.envelope);
END $$;
CREATE FUNCTION public.staff_bank_review(_actor uuid,_session uuid,_id uuid,_decision text,_evidence text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid;
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _decision IS NULL OR _decision NOT IN ('approve','reject') OR _evidence IS NULL OR _evidence !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN RAISE EXCEPTION 'BANK_INVALID' USING ERRCODE='22023'; END IF;
 SELECT creator_id INTO owner_id FROM student_payout_private.bank_requests WHERE id=_id AND creator_id<>_actor;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':payout',0));
 UPDATE student_payout_private.bank_requests SET state=CASE WHEN _decision='approve' THEN 'reviewed' ELSE 'rejected' END,
 envelope=CASE WHEN _decision='approve' THEN envelope ELSE NULL END,reviewer=_actor,evidence_ref=_evidence,updated_at=now()
 WHERE id=_id AND state='pending';
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.bank.'||_decision,'payout_bank',_id);
 RETURN true;
END $$;
CREATE FUNCTION public.staff_bank_claim(_actor uuid,_session uuid,_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r student_payout_private.bank_requests%ROWTYPE; owner_id uuid;
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT creator_id INTO owner_id FROM student_payout_private.bank_requests WHERE id=_id AND creator_id<>_actor;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':payout',0));
 IF NOT public.affiliation_eligible(owner_id) OR NOT student_payout_private.bank_change_allowed(owner_id) THEN RETURN NULL; END IF;
 UPDATE student_payout_private.bank_requests SET state='processing',registrar=_actor,lease=gen_random_uuid(),updated_at=now()
 WHERE id=_id AND state='reviewed' AND reviewer<>_actor AND public.week7_staff_has_capability(reviewer,'finance.review')
 RETURNING * INTO r;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.bank.registration_claimed','payout_bank',_id);
 RETURN jsonb_build_object('id',r.id,'creatorId',r.creator_id,'lease',r.lease,'envelope',r.envelope);
END $$;
CREATE FUNCTION public.staff_bank_finish(_actor uuid,_session uuid,_id uuid,_lease uuid,_recipient text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r student_payout_private.bank_requests%ROWTYPE; owner_id uuid;
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT creator_id INTO owner_id FROM student_payout_private.bank_requests WHERE id=_id AND registrar=_actor;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':payout',0));
 SELECT * INTO r FROM student_payout_private.bank_requests WHERE id=_id AND state='processing' AND registrar=_actor AND lease=_lease FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF _recipient IS NULL OR _recipient !~ '^RCP_[A-Za-z0-9]{8,80}$' OR NOT public.affiliation_eligible(owner_id) OR NOT public.week7_staff_has_capability(r.reviewer,'finance.review') OR NOT student_payout_private.bank_change_allowed(owner_id)
 OR EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence WHERE recipient_reference=_recipient AND creator_id<>owner_id AND revoked_at IS NULL)
 THEN
  UPDATE student_payout_private.bank_requests SET state='uncertain',updated_at=now() WHERE id=_id;
  INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.bank.uncertain','payout_bank',_id);
  RETURN false;
 END IF;
 -- Serialize recipient assignment across creators before rechecking uniqueness.
 PERFORM pg_advisory_xact_lock(hashtextextended('student_creators_recipient:'||_recipient,0));
 IF EXISTS(SELECT 1 FROM live_finance.payout_recipient_evidence WHERE recipient_reference=_recipient AND creator_id<>owner_id AND revoked_at IS NULL) THEN
  UPDATE student_payout_private.bank_requests SET state='uncertain',updated_at=now() WHERE id=_id;
  RETURN false;
 END IF;
 INSERT INTO live_finance.payout_recipient_evidence(creator_id,recipient_reference,kyc_evidence_reference,verified_at,valid_until,revoked_at)
 VALUES(owner_id,_recipient,r.evidence_ref,now(),now()+interval '90 days',NULL)
 ON CONFLICT(creator_id) DO UPDATE SET recipient_reference=EXCLUDED.recipient_reference,kyc_evidence_reference=EXCLUDED.kyc_evidence_reference,verified_at=EXCLUDED.verified_at,valid_until=EXCLUDED.valid_until,revoked_at=NULL;
 UPDATE student_payout_private.bank_requests SET state='active',envelope=NULL,updated_at=now() WHERE id=_id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.bank.registered','payout_bank',_id);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.creator_bank_submission(uuid,uuid,uuid,text,text,text),public.creator_bank_status(uuid,uuid),public.creator_bank_cancel(uuid,uuid,uuid),public.staff_bank_queue(uuid,uuid),public.staff_bank_details(uuid,uuid,uuid),public.staff_bank_review(uuid,uuid,uuid,text,text),public.staff_bank_claim(uuid,uuid,uuid),public.staff_bank_finish(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_bank_submission(uuid,uuid,uuid,text,text,text),public.creator_bank_status(uuid,uuid),public.creator_bank_cancel(uuid,uuid,uuid),public.staff_bank_queue(uuid,uuid),public.staff_bank_details(uuid,uuid,uuid),public.staff_bank_review(uuid,uuid,uuid,text,text),public.staff_bank_claim(uuid,uuid,uuid),public.staff_bank_finish(uuid,uuid,uuid,uuid,text) TO service_role;

-- Recover a recipient already created at Paystack. Never dispatch a second
-- creation POST. The old lease is replaced only after a conservative delay.
CREATE FUNCTION public.staff_bank_recovery_claim(_actor uuid,_session uuid,_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r student_payout_private.bank_requests%ROWTYPE; owner_id uuid;
BEGIN
 IF _actor IS NULL OR _session IS NULL OR NOT public.student_creators_session_active(_actor,_session) OR NOT public.week7_staff_has_capability(_actor,'finance.review') THEN RAISE EXCEPTION 'BANK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT creator_id INTO owner_id FROM student_payout_private.bank_requests WHERE id=_id AND creator_id<>_actor;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':payout',0));
 IF NOT public.affiliation_eligible(owner_id) OR NOT student_payout_private.bank_change_allowed(owner_id) THEN RETURN NULL; END IF;
 UPDATE student_payout_private.bank_requests SET state='processing',registrar=_actor,lease=gen_random_uuid(),updated_at=now()
 WHERE id=_id AND reviewer<>_actor AND public.week7_staff_has_capability(reviewer,'finance.review')
 AND (state='uncertain' OR (state='processing' AND updated_at<now()-interval '10 minutes')) RETURNING * INTO r;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(_actor,'payout.bank.recovery_claimed','payout_bank',_id);
 RETURN jsonb_build_object('id',r.id,'creatorId',r.creator_id,'lease',r.lease,'envelope',r.envelope);
END $$;
REVOKE ALL ON FUNCTION public.staff_bank_recovery_claim(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_bank_recovery_claim(uuid,uuid,uuid) TO service_role;
