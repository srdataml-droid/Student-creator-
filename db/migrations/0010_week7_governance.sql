-- Week 7: additive, server-only governance persistence.
-- Review with Weeks 1/2/5 before applying to an APPROVED hosted environment.
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
