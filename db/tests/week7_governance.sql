-- Week 7 PostgreSQL governance boundary contract; disposable synthetic CI.
\set ON_ERROR_STOP on
\echo 'Week 7: default-deny governance, strict roles, audit append-only'
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_policies
 WHERE schemaname='public' AND tablename IN (
 'governance_staff_role_grants','governance_incidents','governance_retention_proposals');
 IF n<>0 THEN RAISE EXCEPTION 'Governance browser RLS policies unexpectedly present: %',n; END IF;
END $$;

SET ROLE anon;
DO $$ DECLARE n integer;
BEGIN
 BEGIN SELECT count(*) INTO n FROM public.governance_incidents;
  RAISE EXCEPTION 'Anonymous incident records leaked';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN SELECT count(*) INTO n FROM public.governance_staff_role_grants;
  RAISE EXCEPTION 'Anonymous staff scopes leaked';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.governance_retention_proposals(dataset,days,rationale,proposed_by)
  VALUES('verification_evidence',30,'Forged browser data retention proposal not permitted',
  '99999999-9999-4999-8999-999999999999');
  RAISE EXCEPTION 'Anonymous retention proposal written';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
DO $$ DECLARE n integer;
BEGIN
 BEGIN SELECT count(*) INTO n FROM public.governance_incidents;
  RAISE EXCEPTION 'Authenticated student read private security incidents';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.governance_staff_role_grants(user_id,role)
  VALUES('99999999-9999-4999-8999-999999999999','governance_owner');
  RAISE EXCEPTION 'Authenticated student elevated staff role';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.governance_incidents SET state='resolved';
  RAISE EXCEPTION 'Authenticated student modified incident';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN SELECT count(*) INTO n FROM public.governance_retention_proposals;
  RAISE EXCEPTION 'Authenticated student enumerated privacy policies';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE service_role;
INSERT INTO public.governance_staff_role_grants(user_id,role,granted_by)
 VALUES('99999999-9999-4999-8999-999999999999','content_moderator','99999999-9999-4999-8999-999999999999');
INSERT INTO public.governance_incidents(category,severity,summary,reporter_id,last_actor_id)
 VALUES('data_exposure','critical','Synthetic incident only; no student identity in this fixture.',
 '99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999');
INSERT INTO public.governance_retention_proposals(dataset,days,rationale,proposed_by)
 VALUES('verification_evidence',30,'Proposed test-only retention, not an approved rule.',
 '99999999-9999-4999-8999-999999999999');
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.governance_incidents;
 IF n<>1 THEN RAISE EXCEPTION 'Service-only incident insert failed';END IF;
 SELECT count(*) INTO n FROM public.governance_staff_role_grants;
 IF n<>1 THEN RAISE EXCEPTION 'Service-only staff scope insert failed';END IF;
 SELECT count(*) INTO n FROM public.governance_retention_proposals WHERE state='proposed';
 IF n<>1 THEN RAISE EXCEPTION 'Retention proposal must stay unapproved';END IF;
 BEGIN INSERT INTO public.governance_staff_role_grants(user_id,role)
  VALUES('99999999-9999-4999-8999-999999999999','imaginary_super_admin');
  RAISE EXCEPTION 'Unrecognized role accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE public.audit_events SET action='forged_audit';
  RAISE EXCEPTION 'Audit update allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN DELETE FROM public.audit_events;
  RAISE EXCEPTION 'Audit deletion allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
\echo 'Week 7 server-only governance contract verified (disposable database)'
