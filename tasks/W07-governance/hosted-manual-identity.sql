-- Manual verification decisions require an explicitly approved policy.
-- Verified provider affiliations are handled by the separate institution adapter.
CREATE TABLE public.manual_verification_policy(
 singleton boolean PRIMARY KEY CHECK(singleton),enabled boolean NOT NULL DEFAULT false,
 policy_version text,max_valid_days integer CHECK(max_valid_days BETWEEN 1 AND 730),approved_at timestamptz,
 CHECK(NOT enabled OR (policy_version IS NOT NULL AND max_valid_days IS NOT NULL AND approved_at IS NOT NULL))
);
INSERT INTO public.manual_verification_policy(singleton) VALUES(true);
CREATE TABLE public.manual_verification_grants(
 request_id uuid PRIMARY KEY REFERENCES public.verification_requests(id),
 user_id uuid NOT NULL REFERENCES public.student_profiles(user_id),institution_id uuid NOT NULL REFERENCES public.institutions(id),
 reviewer_id uuid NOT NULL REFERENCES auth.users(id),policy_version text NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(),valid_until timestamptz NOT NULL,
 revoked_at timestamptz,revoked_by uuid REFERENCES auth.users(id),revocation_reason text,
 CHECK(user_id<>reviewer_id),CHECK(valid_until>approved_at),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL))
);
CREATE INDEX manual_verification_user ON public.manual_verification_grants(user_id,approved_at DESC);
CREATE UNIQUE INDEX manual_verification_one_current ON public.manual_verification_grants(user_id) WHERE revoked_at IS NULL;
ALTER TABLE public.manual_verification_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_verification_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_verification_policy,public.manual_verification_grants FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.affiliation_eligible(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
 SELECT 1 FROM public.student_profiles p WHERE p.user_id=_user_id AND p.verified_at IS NOT NULL AND NOT p.suspended
 AND (
  EXISTS(SELECT 1 FROM public.institution_affiliations a JOIN public.institution_integrations i ON i.provider_id=a.provider_id AND i.institution_id=a.institution_id
   WHERE a.user_id=p.user_id AND a.institution_id=p.institution_id AND a.affiliation_role='student' AND a.enrollment_state='active' AND a.valid_until>now() AND i.enabled)
  OR (NOT EXISTS(SELECT 1 FROM public.institution_affiliations a WHERE a.user_id=p.user_id)
  AND (NOT EXISTS(SELECT 1 FROM public.manual_verification_grants g WHERE g.user_id=p.user_id)
   OR EXISTS(SELECT 1 FROM public.manual_verification_grants g JOIN public.verification_requests v ON v.id=g.request_id JOIN public.institutions i ON i.id=g.institution_id
    WHERE g.user_id=p.user_id AND g.institution_id=p.institution_id AND g.revoked_at IS NULL AND g.valid_until>now() AND v.status='approved' AND i.active)))
 )
 );
$$;
-- The legacy verified_at fallback is unchanged for pre-existing institutional
-- fixtures/accounts without a grant; new manual approvals always use a grant.
CREATE FUNCTION public.week7_review_manual_identity(_actor uuid,_id uuid,_decision text,_note text,_days integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.verification_requests%ROWTYPE; p public.student_profiles%ROWTYPE; pol public.manual_verification_policy%ROWTYPE; until_at timestamptz;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'verification.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _id IS NULL OR _decision IS NULL OR _decision NOT IN ('approve','reject','revoke') OR _note IS NULL OR length(btrim(_note)) NOT BETWEEN 10 AND 500 OR _note ~ '[[:cntrl:]]' OR (_decision<>'approve' AND _days IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.verification_requests WHERE id=_id;
 IF NOT FOUND OR v.user_id=_actor THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.student_profiles WHERE user_id=v.user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 SELECT * INTO v FROM public.verification_requests WHERE id=_id FOR UPDATE;
 IF v.method<>'manual_id' OR EXISTS(SELECT 1 FROM public.institution_affiliations WHERE user_id=p.user_id) THEN RAISE EXCEPTION 'IDENTITY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
 IF _decision='approve' THEN
  SELECT * INTO pol FROM public.manual_verification_policy WHERE singleton AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_POLICY_REQUIRED' USING ERRCODE='42501'; END IF;
  IF _days IS NULL OR _days NOT BETWEEN 1 AND pol.max_valid_days OR v.status<>'pending' OR v.expires_at<=now() OR p.suspended OR p.institution_id IS DISTINCT FROM v.institution_id OR NOT EXISTS(SELECT 1 FROM public.institutions WHERE id=v.institution_id AND active) OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v.user_id AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND u.is_anonymous IS NOT TRUE AND (u.banned_until IS NULL OR u.banned_until<=now())) OR NOT EXISTS(SELECT 1 FROM public.private_identity_uploads u WHERE u.request_id=v.id AND u.owner_id=v.user_id AND u.state='clean' AND u.object_key=v.private_evidence_path) THEN RAISE EXCEPTION 'IDENTITY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
  until_at:=now()+make_interval(days=>_days);
  UPDATE public.manual_verification_grants SET revoked_at=now(),revoked_by=_actor,revocation_reason='Superseded by independently reviewed verification' WHERE user_id=v.user_id AND revoked_at IS NULL;
  INSERT INTO public.manual_verification_grants(request_id,user_id,institution_id,reviewer_id,policy_version,valid_until) VALUES(v.id,v.user_id,v.institution_id,_actor,pol.policy_version,until_at);
  UPDATE public.verification_requests SET status='approved',reviewer_id=_actor,reviewed_at=now() WHERE id=v.id;
  UPDATE public.student_profiles SET verified_at=now() WHERE user_id=v.user_id;
 ELSIF _decision='reject' THEN
  IF v.status<>'pending' THEN RAISE EXCEPTION 'IDENTITY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
  UPDATE public.verification_requests SET status='rejected',reviewer_id=_actor,reviewed_at=now() WHERE id=v.id;
 ELSE
  IF v.status<>'approved' THEN RAISE EXCEPTION 'IDENTITY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
  UPDATE public.manual_verification_grants SET revoked_at=now(),revoked_by=_actor,revocation_reason=btrim(_note) WHERE request_id=v.id AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_REVIEW_CONFLICT' USING ERRCODE='23505'; END IF;
  UPDATE public.verification_requests SET status='revoked',reviewer_id=_actor,reviewed_at=now() WHERE id=v.id;
  UPDATE public.student_profiles SET verified_at=NULL WHERE user_id=v.user_id;
 END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id,reason) VALUES(_actor,'identity.manual.'||_decision,'verification_request',v.id,btrim(_note));
 RETURN jsonb_build_object('id',v.id,'status',CASE _decision WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'revoked' END,'validUntil',until_at);
END $$;
REVOKE ALL ON FUNCTION public.week7_review_manual_identity(uuid,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_review_manual_identity(uuid,uuid,text,text,integer) TO service_role;

CREATE FUNCTION public.week7_manual_revalidation_queue(_actor uuid,_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF NOT public.week7_staff_has_capability(_actor,'verification.review') THEN RAISE EXCEPTION 'GOVERNANCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.valid_until,q.request_id),'[]'::jsonb) INTO r FROM (SELECT request_id,user_id,institution_id,valid_until FROM public.manual_verification_grants WHERE user_id<>_actor AND revoked_at IS NULL AND valid_until<=now()+interval '30 days' ORDER BY valid_until,request_id LIMIT _limit) q;
 RETURN jsonb_build_object('items',r);
END $$;
REVOKE ALL ON FUNCTION public.week7_manual_revalidation_queue(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week7_manual_revalidation_queue(uuid,integer) TO service_role;
