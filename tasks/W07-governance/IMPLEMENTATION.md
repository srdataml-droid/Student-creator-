# Week 7 Governance — implementation and handoff
Repository: worthkind/Student-creator-; branch: work/week-07; review PR #49.
Status: local development integration and proposed PostgreSQL controls, not production readiness.

## Reuse rather than duplicate
- Student verification, suspension and reinstatement: packages/local-core/src/store.mjs, Week 2 hosted identity.
- Institution appeals: packages/local-core/src/affiliations.mjs, db/migrations/0006_institution_identity_contract.sql.
- Copyright claims, takedowns and appeal, privacy deletion **intake only**: packages/local-core/src/rights-cases.mjs.
- Community and message reports: existing local store/report APIs.
- Content moderation: packages/content-core/src/moderation-api.mjs, Week 3.
- Payment disputes and financial journal: packages/local-core/src/commerce.mjs, Week 5.
- Current audit: audit_events in SQLite and PostgreSQL, plus content-state audit trigger.

## Implemented locally (not deployed)
- packages/local-core/src/governance.mjs: trusted persisted scopes for governance_owner, verification_reviewer, content_moderator, privacy_reviewer, finance_reviewer, incident_responder and auditor. An owner may delegate only to an existing administrator; it cannot promote a student via an API field.
- Existing local administrative HTTP paths now require the matching capability; the existing domain methods still own all actual moderation, appeals and financial logic.
- New local administration API handles staff roles, privacy-safe dashboard counts, incident reporting/state transitions, action history and retention policy **proposals only**.
- Bounded incidents (10 per staff actor per hour); strict states open -> investigating -> contained -> resolved. Critical incident reporter cannot approve their own closure.
- Appended SQLite audit trigger blocks UPDATE/DELETE. History responses exclude raw audit details.
- /manage/governance UI shows authorized capabilities and workflows. Only development SQLite mode is supported.
- No automatic account deletion, data purging, paid-content refund, student ID disclosure or live PSP mutation.

## Proposed hosted data boundary
db/migrations/0010_week7_governance.sql creates private governance role grants, incident cases and retention proposals. Each table has RLS enabled with no browser policy and grants only for the service role. PostgreSQL audit update/delete rejection extends existing audit.
db/tests/week7_governance.sql checks direct browser denials, invalid role, service-only writes and audit immutability.
No migration was applied to Supabase; a hosted service endpoint and Auth verifier remain pending.

## Role and audit flow
~~~mermaid
flowchart TD
  Auth["Trusted current staff session"] --> DB["Verify current active staff and stored role"]
  DB --> Scope{"Required capability assigned?"}
  Scope -->|No| Denied["Deny, no private data"]
  Scope -->|Yes| Type{"Action"}
  Type --> Verification["Week 2: verification and appeals"]
  Type --> Moderation["Week 3: moderation and copyright"]
  Type --> Finance["Week 5: dispute review, not ledger override"]
  Type --> Incident["Week 7: incident triage"]
  Type --> Privacy["Week 7: deletion-request intake and retention proposals"]
  Verification --> Audit["Durable audit event"]
  Moderation --> Audit
  Finance --> Audit
  Incident --> Audit
  Privacy --> Audit
  Audit --> Dash["Scoped governance dashboard"]
~~~

## Verification still required
- packages/local-core/test/governance.test.mjs exercises visitor/student/unassigned staff denial, role isolation, false escalation, incident rate/state, independent critical closure, retention non-deletion and audit tampering.
- Disposable PostgreSQL contract test added to CI.
- Do not mark any test pass without exact commit/run evidence; GitHub connector commits are not test executions.
- This branch predates several Week 1 main changes, and PR #49 currently has a merge conflict. Independently reconcile main and run the full five CI jobs before merging.
- Hosted Supabase Auth, actual private document access/retention, real-time operator UI, finance review/approval and incident response are not complete.
- Founder-approved copyright, privacy and payout policies are still needed; no invented policies or live money.

## Next coordinated engineering
1. Confirm exact CI result and repair source regressions on work/week-07.
2. Reconcile with latest main while preserving Week 1 hosted/identity/Mux changes.
3. Wire service-only governance stores to Week 1 Auth/session and current-platform-staff checks.
4. Bind Week 2 appeals/verification, Week 3 moderation/copyright and Week 5 dispute queues to scoped operator capabilities without duplicating their business transactions.
5. Test private student evidence, IDOR, cross-institution and role escalation against actual hosted staging, with reversible synthetic records.
6. Obtain owner/legal approvals for any live deletion, retention schedule or financial dispute resolution.
7. Verify a real local/staging operator workflow, logs, backup restore and privacy controls.

New code was authored for this repository. No outside upstream code or licenses were copied. Never store actual student IDs, credentials or financial records in this public repository.
