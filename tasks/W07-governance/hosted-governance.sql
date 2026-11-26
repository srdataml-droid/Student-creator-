-- Week 7: additive, server-only governance persistence.
-- Hosted integration: require current Auth sessions at the server boundary; policy proposals do not execute.
-- Does not approve legal retention rules, production deletion or payment action.
-- Retains Week 1 public.platform_staff auth source instead of a second auth model.

CREATE TABLE IF NOT EXISTS public.governance_staff_role_grants (
  user_id uuid NOT NULL REFERENCES public.platform_staff(user_id),
  role text NOT NULL CHECK(role IN (
    'governance_owner','verification_reviewer','content_moderator',
    'privacy_reviewer','finance_reviewer','incident_responder','auditor'
  )),
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,role)
);
CREATE INDEX IF NOT EXISTS governance_staff_by_role
  ON public.governance_staff_role_grants(role,user_id);

CREATE TABLE IF NOT EXISTS public.governance_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK(category IN (
    'unauthorized_access','account_compromise','suspected_fraud',
    'availability','data_exposure','other'
  )),
  severity text NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  summary text NOT NULL CHECK(length(summary) BETWEEN 20 AND 1000),
  state text NOT NULL DEFAULT 'open'
    CHECK(state IN ('open','investigating','contained','resolved')),
  reporter_id uuid NOT NULL REFERENCES public.platform_staff(user_id),
  last_actor_id uuid NOT NULL REFERENCES public.platform_staff(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS governance_incidents_queue
  ON public.governance_incidents(state,created_at);

CREATE TABLE IF NOT EXISTS public.governance_retention_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset text NOT NULL CHECK(dataset IN (
    'verification_evidence','login_sessions','analytics_events','user_reports','audit_events'
  )),
  days integer NOT NULL CHECK(days BETWEEN 1 AND 3650),
  rationale text NOT NULL CHECK(length(rationale) BETWEEN 20 AND 500),
  proposed_by uuid NOT NULL REFERENCES public.platform_staff(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','rejected')),
  reviewed_by uuid REFERENCES public.platform_staff(user_id),
  reviewed_at timestamptz
);
-- There is no 'approved' state, scheduled purge procedure or browser policy.
-- Approved policies, legal holds and full execution require later founder review.

ALTER TABLE public.governance_staff_role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_retention_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.governance_staff_role_grants,public.governance_incidents,
  public.governance_retention_proposals FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.governance_staff_role_grants,public.governance_incidents,
  public.governance_retention_proposals TO service_role;
-- No browser SELECT or INSERT/UPDATE/DELETE policies. App backend must check
-- current Auth session, active platform_staff and scoped governance role.

CREATE OR REPLACE FUNCTION public.week7_reject_audit_rewrite()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY' USING ERRCODE='42501';
END;
$$;
REVOKE ALL ON FUNCTION public.week7_reject_audit_rewrite() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER week7_audit_update_block BEFORE UPDATE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.week7_reject_audit_rewrite();
CREATE TRIGGER week7_audit_delete_block BEFORE DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.week7_reject_audit_rewrite();
-- A database superuser may disable triggers; independently anchored backups/
-- logging and production retention/legal-hold plans are still required.

GRANT SELECT(id,actor_id,action,target_kind,target_id,created_at) ON public.audit_events TO service_role;

-- Week 7 operational RPCs. Apply only AFTER 0010_week7_governance.sql
-- to the identified dedicated staging database and after disposable CI passes.
-- Service-role-only: callers have verified a CURRENT Supabase staff Auth session.
-- Every mutation and its audit entry share one database transaction.
-- No student ID/media, message body, ledger or payment settlement is read here.

CREATE OR REPLACE FUNCTION public.week7_staff_has_capability(_actor uuid,_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.platform_staff s
  JOIN public.governance_staff_role_grants g ON g.user_id=s.user_id
  WHERE s.user_id=_actor AND s.active=true AND
    ((g.role='governance_owner' AND _capability IN ('staff.assign','dashboard.read','audit.read','verification.review','content.moderate','community.moderate','copyright.review','privacy.review','finance.review','incident.read','incident.write','retention.propose','retention.review')) OR
    (g.role='verification_reviewer' AND _capability IN ('dashboard.read','verification.review')) OR
    (g.role='content_moderator' AND _capability IN ('dashboard.read','content.moderate','community.moderate','copyright.review')) OR
    (g.role='privacy_reviewer' AND _capability IN ('dashboard.read','privacy.review','retention.propose')) OR
    (g.role='finance_reviewer' AND _capability IN ('dashboard.read','finance.review')) OR
    (g.role='incident_responder' AND _capability IN ('dashboard.read','incident.read','incident.write')) OR
    (g.role='auditor' AND _capability IN ('dashboard.read','audit.read','incident.read')))
 );
$$;
REVOKE ALL ON FUNCTION public.week7_staff_has_capability(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_staff_has_capability(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.week7_open_incident(
 _actor uuid,_category text,_severity text,_summary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid; _recent bigint;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'incident.write') THEN
  RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF _category IS NULL OR _category NOT IN (
  'unauthorized_access','account_compromise','suspected_fraud',
  'availability','data_exposure','other')
  OR _severity IS NULL OR _severity NOT IN ('low','medium','high','critical')
  OR _summary IS NULL OR length(btrim(_summary)) NOT BETWEEN 20 AND 1000
  OR _summary ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'INVALID_INCIDENT' USING ERRCODE='22023';
 END IF;
 -- Prevent concurrent requests by one operator evading the sliding window.
 PERFORM pg_advisory_xact_lock(hashtextextended(_actor::text,1797));
 SELECT count(*) INTO _recent FROM public.governance_incidents
  WHERE reporter_id=_actor AND created_at>now()-interval '1 hour';
 IF _recent>=10 THEN RAISE EXCEPTION 'GOVERNANCE_RATE_LIMIT' USING ERRCODE='P0001';END IF;
 INSERT INTO public.governance_incidents(category,severity,summary,reporter_id,last_actor_id)
 VALUES(_category,_severity,btrim(_summary),_actor,_actor) RETURNING id INTO _id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason)
 VALUES(_actor,'governance.incident.opened','governance_incident',_id,_category||'/'||_severity);
 RETURN jsonb_build_object('id',_id,'state','open','severity',_severity,'category',_category);
END;
$$;
REVOKE ALL ON FUNCTION public.week7_open_incident(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_open_incident(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.week7_transition_incident(
 _actor uuid,_incident_id uuid,_next text,_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _current public.governance_incidents%ROWTYPE;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'incident.write') THEN
  RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500
  OR _note ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'INVALID_INCIDENT_DECISION' USING ERRCODE='22023';
 END IF;
 SELECT * INTO _current FROM public.governance_incidents
  WHERE id=_incident_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INCIDENT_NOT_FOUND' USING ERRCODE='P0002';END IF;
 IF NOT (
  (_current.state='open' AND _next='investigating') OR
  (_current.state='investigating' AND _next='contained') OR
  (_current.state='contained' AND _next='resolved')
 ) THEN RAISE EXCEPTION 'INCIDENT_STATE_CONFLICT' USING ERRCODE='P0001';END IF;
 IF _current.severity='critical' AND _next='resolved'
  AND _current.reporter_id=_actor THEN
  RAISE EXCEPTION 'INDEPENDENT_REVIEW_REQUIRED' USING ERRCODE='42501';
 END IF;
 UPDATE public.governance_incidents SET state=_next,last_actor_id=_actor,
  updated_at=now() WHERE id=_incident_id AND state=_current.state;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason)
 VALUES(_actor,'governance.incident.transitioned','governance_incident',
  _incident_id,_current.state||'->'||_next||'; '||btrim(_note));
 RETURN jsonb_build_object('id',_incident_id,'state',_next);
END;
$$;
REVOKE ALL ON FUNCTION public.week7_transition_incident(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_transition_incident(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.week7_propose_retention(
 _actor uuid,_dataset text,_days integer,_rationale text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'retention.propose') THEN
  RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF _dataset IS NULL OR _dataset NOT IN (
  'verification_evidence','login_sessions','analytics_events','user_reports','audit_events')
  OR _days IS NULL OR _days NOT BETWEEN 1 AND 3650 OR _rationale IS NULL
  OR length(btrim(_rationale)) NOT BETWEEN 20 AND 500 OR _rationale ~ '[[:cntrl:]]'
 THEN RAISE EXCEPTION 'INVALID_RETENTION_PROPOSAL' USING ERRCODE='22023';END IF;
 INSERT INTO public.governance_retention_proposals(dataset,days,rationale,proposed_by)
 VALUES(_dataset,_days,btrim(_rationale),_actor) RETURNING id INTO _id;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason)
 VALUES(_actor,'governance.retention.proposed','governance_retention',_id,_dataset);
 RETURN jsonb_build_object('id',_id,'state','proposed','policyApproved',false,'automaticDeletion',false);
END;
$$;
REVOKE ALL ON FUNCTION public.week7_propose_retention(uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_propose_retention(uuid,text,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.week7_reject_retention(
 _actor uuid,_proposal_id uuid,_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _state text;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'retention.review') THEN
  RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500
  OR _note ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'INVALID_RETENTION_DECISION' USING ERRCODE='22023';
 END IF;
 SELECT state INTO _state FROM public.governance_retention_proposals
  WHERE id=_proposal_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RETENTION_NOT_FOUND' USING ERRCODE='P0002';END IF;
 IF _state='rejected' THEN RETURN jsonb_build_object('id',_proposal_id,'state','rejected','replayed',true,'automaticDeletion',false);END IF;
 IF _state<>'proposed' THEN RAISE EXCEPTION 'RETENTION_CONFLICT' USING ERRCODE='P0001';END IF;
 UPDATE public.governance_retention_proposals SET state='rejected',
  reviewed_by=_actor,reviewed_at=now() WHERE id=_proposal_id AND state='proposed';
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason)
 VALUES(_actor,'governance.retention.rejected','governance_retention',_proposal_id,btrim(_note));
 RETURN jsonb_build_object('id',_proposal_id,'state','rejected','replayed',false,'automaticDeletion',false);
END;
$$;
REVOKE ALL ON FUNCTION public.week7_reject_retention(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_reject_retention(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.week7_assign_staff_role(
 _actor uuid,_staff uuid,_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _inserted integer;
BEGIN
 PERFORM pg_advisory_xact_lock(9007001);
 IF NOT public.week7_staff_has_capability(_actor,'staff.assign') THEN
  RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF _role IS NULL OR _role NOT IN (
  'governance_owner','verification_reviewer','content_moderator',
  'privacy_reviewer','finance_reviewer','incident_responder','auditor')
 THEN RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_staff WHERE user_id=_staff AND active=true)
 THEN RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE='P0002';END IF;
 INSERT INTO public.governance_staff_role_grants(user_id,role,granted_by)
 VALUES(_staff,_role,_actor) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS _inserted=ROW_COUNT;
 IF _inserted=1 THEN
  INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason)
  VALUES(_actor,'governance.staff.role.granted','platform_staff',_staff,_role);
 END IF;
 RETURN jsonb_build_object('userId',_staff,'role',_role,'replayed',_inserted=0);
END;
$$;
REVOKE ALL ON FUNCTION public.week7_assign_staff_role(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_assign_staff_role(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.week7_revoke_staff_role(
 _actor uuid,_staff uuid,_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _removed integer;
BEGIN
 PERFORM pg_advisory_xact_lock(9007001);
 IF NOT public.week7_staff_has_capability(_actor,'staff.assign') THEN
  RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF _role IS NULL OR _role NOT IN (
  'governance_owner','verification_reviewer','content_moderator',
  'privacy_reviewer','finance_reviewer','incident_responder','auditor')
 THEN RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE='22023';END IF;
 -- Global lock serializes independent last-owner revocations.
 IF _role='governance_owner' THEN
  PERFORM pg_advisory_xact_lock(9007001);
  IF EXISTS(SELECT 1 FROM public.governance_staff_role_grants
   WHERE user_id=_staff AND role=_role)
   AND EXISTS(SELECT 1 FROM public.platform_staff WHERE user_id=_staff AND active)
   AND (SELECT count(*) FROM public.governance_staff_role_grants g JOIN public.platform_staff s ON s.user_id=g.user_id WHERE g.role='governance_owner' AND s.active)<=1
  THEN RAISE EXCEPTION 'LAST_OWNER_REQUIRED' USING ERRCODE='42501';END IF;
 END IF;
 DELETE FROM public.governance_staff_role_grants WHERE user_id=_staff AND role=_role;
 GET DIAGNOSTICS _removed=ROW_COUNT;
 IF _removed=1 THEN
  INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason)
  VALUES(_actor,'governance.staff.role.revoked','platform_staff',_staff,_role);
 END IF;
 RETURN jsonb_build_object('userId',_staff,'role',_role,'revoked',_removed=1);
END;
$$;
REVOKE ALL ON FUNCTION public.week7_revoke_staff_role(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_revoke_staff_role(uuid,uuid,text) TO service_role;
