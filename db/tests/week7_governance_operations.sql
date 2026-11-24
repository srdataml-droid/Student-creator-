-- Week 7 server-only RPC tests (disposable PostgreSQL fixture).
\set ON_ERROR_STOP on
\echo 'Week 7 transactional governance operations and browser denial'
INSERT INTO auth.users(id) VALUES('88888888-8888-4888-8888-888888888888');
INSERT INTO public.platform_staff(user_id,role,active)
 VALUES('88888888-8888-4888-8888-888888888888','moderator',true);
INSERT INTO public.governance_staff_role_grants(user_id,role,granted_by)
 VALUES('99999999-9999-4999-8999-999999999999','governance_owner',
 '99999999-9999-4999-8999-999999999999');

SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM public.week7_staff_has_capability('99999999-9999-4999-8999-999999999999','staff.assign');
  RAISE EXCEPTION 'Anon invoked capability lookup';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  PERFORM public.week7_open_incident('99999999-9999-4999-8999-999999999999',
   'availability','low','This browser must not report a privileged incident.');
  RAISE EXCEPTION 'Anon submitted privileged incident';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;

SET ROLE authenticated;
DO $$
BEGIN
 BEGIN
  PERFORM public.week7_assign_staff_role('99999999-9999-4999-8999-999999999999',
   '11111111-1111-4111-8111-111111111111','governance_owner');
  RAISE EXCEPTION 'Browser granted fake staff role';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  PERFORM public.week7_propose_retention('99999999-9999-4999-8999-999999999999',
   'verification_evidence',30,'Fake unauthenticated policy approval');
  RAISE EXCEPTION 'Browser proposed privileged retention';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;

SET ROLE service_role;
DO $$
DECLARE
 _opened jsonb; _id uuid; _retention jsonb; _ret_id uuid;
 _n bigint; _before_audit bigint; _after_audit bigint;
BEGIN
 BEGIN
  PERFORM public.week7_open_incident('11111111-1111-4111-8111-111111111111',
   'availability','low','Unprivileged synthetic account cannot open incident.');
  RAISE EXCEPTION 'Non-staff opened incident';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  PERFORM public.week7_assign_staff_role('99999999-9999-4999-8999-999999999999',
   '11111111-1111-4111-8111-111111111111','auditor');
  RAISE EXCEPTION 'Student gained auditor role';
 EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN
  PERFORM public.week7_open_incident('99999999-9999-4999-8999-999999999999',
   'other','critical','invalid');
  RAISE EXCEPTION 'Short incident summary accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;

 SELECT count(*) INTO _before_audit FROM public.audit_events;
 _opened:=public.week7_open_incident('99999999-9999-4999-8999-999999999999',
   'data_exposure','critical','Synthetic staged data exposure requiring independent containment review.');
 _id:=(_opened->>'id')::uuid;
 IF _opened->>'state'<>'open' THEN RAISE EXCEPTION 'Incident not opened';END IF;
 BEGIN
  PERFORM public.week7_transition_incident('99999999-9999-4999-8999-999999999999',
   _id,'resolved','Cannot skip containment');
  RAISE EXCEPTION 'Invalid incident state transition accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Invalid incident state transition accepted' THEN RAISE;END IF;
 END;
 PERFORM public.week7_transition_incident('99999999-9999-4999-8999-999999999999',
   _id,'investigating','Original synthetic signal verified');
 PERFORM public.week7_transition_incident('99999999-9999-4999-8999-999999999999',
   _id,'contained','Untrusted route disabled in staging');
 BEGIN
  PERFORM public.week7_transition_incident('99999999-9999-4999-8999-999999999999',
   _id,'resolved','Self approving this critical incident');
  RAISE EXCEPTION 'Reporter self-closed critical case';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.week7_assign_staff_role('99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888','incident_responder');
 PERFORM public.week7_transition_incident('88888888-8888-4888-8888-888888888888',
  _id,'resolved','Independent synthetic reviewer accepted remediation');
 SELECT count(*) INTO _n FROM public.governance_incidents WHERE id=_id AND state='resolved';
 IF _n<>1 THEN RAISE EXCEPTION 'Incident resolution missing';END IF;
 SELECT count(*) INTO _after_audit FROM public.audit_events;
 IF _after_audit-_before_audit<>5 THEN
  RAISE EXCEPTION 'Incident audit transaction count mismatched: %',_after_audit-_before_audit;
 END IF;

 BEGIN
  PERFORM public.week7_propose_retention('88888888-8888-4888-8888-888888888888',
   'verification_evidence',30,'Incident role cannot propose retention policy');
  RAISE EXCEPTION 'Incident responder created retention proposal';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 _retention:=public.week7_propose_retention('99999999-9999-4999-8999-999999999999',
   'verification_evidence',30,'Potential 30-day synthetic retention, not an approved policy.');
 _ret_id:=(_retention->>'id')::uuid;
 IF (_retention->>'policyApproved')::boolean THEN RAISE EXCEPTION 'Unapproved policy marked approved';END IF;
 IF (SELECT state FROM public.governance_retention_proposals WHERE id=_ret_id)<>'proposed'
 THEN RAISE EXCEPTION 'Retention proposal changed state without review';END IF;
 PERFORM public.week7_reject_retention('99999999-9999-4999-8999-999999999999',
   _ret_id,'Unapproved duration pending founder and external legal review');
 IF (SELECT state FROM public.governance_retention_proposals WHERE id=_ret_id)<>'rejected'
 THEN RAISE EXCEPTION 'Rejection did not persist';END IF;
 BEGIN
  PERFORM public.week7_revoke_staff_role('99999999-9999-4999-8999-999999999999',
   '99999999-9999-4999-8999-999999999999','governance_owner');
  RAISE EXCEPTION 'Removed last governance owner';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.week7_assign_staff_role('99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888','governance_owner');
 PERFORM public.week7_revoke_staff_role('99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888','governance_owner');
 IF (SELECT count(*) FROM public.governance_staff_role_grants WHERE role='governance_owner')<>1
 THEN RAISE EXCEPTION 'Expected last owner to remain';END IF;
END $$;
RESET ROLE;
\echo 'Week 7 governance operations: scoped, transactional and audited'
