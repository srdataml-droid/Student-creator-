# Student Creators — Researches & Tasks: Start Here
**Created:** 2026-11-23 | **Branch:** researches-and-tasks | **Target:** srdataml-droid/Student-creator- only
**Nature:** Evidence-grounded analysis and implementation plan, not a deployed feature, hired team, or verified CI result.

## How to read this packet
- This file: what published practitioners teach us and Mermaid flow diagrams.
- 01_SYSTEM_ARCHITECTURE_DECISIONS.md: complete architecture, current/target distinction, security and financial invariants.
- 02_ROLE_SKILLS_AND_LEARNING.md: all necessary responsibilities, competency/learning tasks and accountability.
- 03_AI_TOOLS_TIME_AND_ACCOUNTS.md: minimal AI/tool stack, precise use cases, effort estimates and account safeguards.
- 04_GOALS_ROADMAP_AND_LEADERSHIP.md: staged calendar, critical path, goal-setting rituals, delivery gates, risks and weekly reviews.
- 05_EXECUTION_TASK_CATALOG.md: scoped issue/task catalog, effort, dependencies and evidence rules.
- AGENTS.md and .agents/skills: repository-local instructions for compatible coding agents.
- Prior source of truth: docs/EXPERT_ROLES_AND_OPEN_SOURCE_PLAYBOOK_2026-11-23.md and docs/architecture/01, 02, 03; **do not erase or silently contradict these documents**.

## Sources and what we actually learned
Sources already studied in earlier research and reopened from this repo in this session; items below include direct primary-source links. The implication column is *our proposal*, not an endorsement from the source.

| Researcher / organization | Actual public contribution / finding | Proposed Student Creators use |
|---|---|---|
| Teresa Torres — Product Talk | Outcome -> customer opportunities -> candidate solutions -> assumption tests; story-based customer interviews. https://www.producttalk.org/opportunity-solution-trees/ | Ask our student creator to attempt an upload/purchase workflow; record actual friction before designing another feature. |
| Marty Cagan — SVPG | Product discovery/delivery and desirability, usability, viability, feasibility. https://www.svpg.com/product-model-concepts/ | Product owner checks feature value as well as code completion. |
| Simon Brown — C4 | Context -> containers -> components -> optional code details. https://c4model.com/ ; https://github.com/structurizr/structurizr | Map real boundaries and deployment dependencies before paid-media implementation. |
| Brandur Leach — reliable APIs | Idempotency keys, transactional phases and recovery of external payment calls. https://brandur.org/idempotency-keys ; https://github.com/brandur/rocket-rides-atomic | Never create duplicate entitlements, payouts or ledger records during PSP retries/timeouts. |
| Jon Dahl/Mux + tus | Video encoding/streaming complexity and resumable uploads. https://www.mux.com/blog/video-is-too-hard ; https://github.com/tus/tusd | Use mature streaming service; handle interrupted Nigerian mobile connections. |
| Kent C. Dodds — Testing Library | Test application behavior as users experience it; favor useful integration coverage. https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications | Verify creator, buyer and moderator tasks instead of only mocking React buttons. |
| Google eng-practices | Small, comprehensible changes with correctness, tests, complexity and maintainability reviewed. https://google.github.io/eng-practices/review/reviewer/standard.html | Tiny test-gated changes and reproducible evidence, even with AI code generation. |
| Paystack engineering | 2026 dashboard rebuild reused established backend and stressed early AI evaluation. https://paystack.com/blog/product-engineering/introducing-the-new-paystack-dashboard-rebuilt-for-the-first-time-in-10-years | Improve the existing app instead of rewriting it; establish AI eval tests where used. |
| Eugene Yan + Chip Huyen | Industry recommendation research and ML system/design evaluation. https://github.com/eugeneyan/applied-ml ; https://github.com/chiphuyen/machine-learning-systems-design | Begin with rule-based feed relevance and measured outcomes, ML later. |
| Google SRE, Charity Majors | Production correctness includes operational visibility and recovery. https://sre.google/books/ ; https://www.honeycomb.io/author/charity | Alert on failed purchases, unauthorized access, video errors and restore backups. |
| OWASP | Server authorization, least privilege and threat-based test practices. https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html | Enforce viewer/blocker permissions at API, database and media layer. |

## Diagram 1 — Full discovery-to-production loop (lessons from roles)
~~~mermaid
flowchart TD
  V["Founder: vision & mission"] --> PM["Product management: measurable outcome"]
  PM --> UR["User research: real student/creator behavior"]
  UR --> O["Opportunity-solution tree; test assumptions"]
  O --> UX["UX: prototype, journeys and accessibility"]
  UX --> ARCH["Architecture: C4 + data boundaries + ADR"]
  ARCH --> SEC["Security/privacy + threat model"]
  SEC --> AC["QA: acceptance tests including failure paths"]
  AC --> BUILD["AI-assisted engineer: small scoped implementation"]
  BUILD --> CI["Unit, integration, database and browser tests"]
  CI --> PASS{"Pass on exact commit?"}
  PASS -->|No| BUILD
  PASS -->|Yes| REVIEW["Code review + finance/privacy review when needed"]
  REVIEW --> STAGE["Staging, recovery drill, measured performance"]
  STAGE --> GATE{"Founder release gate approved?"}
  GATE -->|No| ARCH
  GATE -->|Yes| PILOT["5-10 student alpha, then up to 80-100 pilot"]
  PILOT --> DATA["Observe activation, retention, creator income, cost & incidents"]
  DATA --> PM
~~~

## Diagram 2 — Product capability and people relationships
~~~mermaid
flowchart LR
  Founder["Founder/PM"] --> Prod["One student creator application"]
  Viewer["Verified student: viewer & possible creator"] --> Prod
  Creator["Verified student: creator & possible viewer"] --> Prod
  Helper["Opt-in student creator tester / volunteer"] -->|Feedback only| Prod
  Trust["Moderator/verification/support"] --> Prod
  Prod --> Identity["Private verification + identity service"]
  Prod --> Feed["Content studio, social feed, follows, messages"]
  Prod --> Safety["Moderation, creator-specific view/comment/DM blocks"]
  Prod --> Media["Protected video upload and signed delivery"]
  Prod --> Ent["Paid viewing license/entitlement"]
  Ent --> PSP["Approved PSP checkout + confirmation"]
  Ent --> Ledger["Immutable allocations + refunds/reconciliation"]
  Prod --> Portfolio["Creator portfolio and insights"]
  Prod --> Ops["Monitoring, backups, support, security"]
~~~

## Diagram 3 — Trustworthy money and content access
~~~mermaid
flowchart TD
  Upload["Creator owns original work; attests rights"] --> Review["Media processing + moderation"]
  Review --> Published["Approved listing; free or >= NGN 200 access"]
  Published --> Buyer["Viewer sees preview/license terms"]
  Buyer --> Checks{"Platform/creator block and eligibility?"}
  Checks -->|Deny| Deny["No playback; dispute/appeal path"]
  Checks -->|Allow| Free{"Free?"}
  Free -->|Yes| Token["Short-lived playback authorization"]
  Free -->|No| Order["Trusted immutable price/order snapshot"]
  Order --> PSP["Approved PSP checkout"]
  PSP --> Verify{"Server verifies reference, amount, currency, status?"}
  Verify -->|No| Pending["Pending/failed/reconciliation; no unlock"]
  Verify -->|Yes| Atomic["Atomic idempotent entitlement + ledger journal"]
  Atomic --> Token
  Atomic --> CreatorBalance["Creator pending earnings"]
  CreatorBalance --> Cleared{"Provider settled + risk cleared?"}
  Cleared -->|No| Pending
  Cleared -->|Yes| Payout["Eligible payout via approved provider"]
  Token --> Stream["Protected media delivery"]
~~~

## Diagram 4 — How skill learning becomes shipped work
~~~mermaid
flowchart LR
  Read["Read public primary source"] --> Note["Extract actual lesson + URL"]
  Note --> Teach["Founder explains it in own words"]
  Teach --> Small["Reproduce small sandbox experiment"]
  Small --> Test["Write test for successful + failure cases"]
  Test --> Apply["Apply only to scoped Student Creators module"]
  Apply --> Evidence["Run tests, verify commit, document limitation"]
  Evidence --> Library["Update reusable Worthkind knowledge & relevant issue"]
~~~

## What is evidence vs proposal?
- Current code/doc evidence: creator-first Next.js React app, local SQLite, manual student approval, MP4 upload/playback, social features, test/CI workflow, payment-core primitives.
- Proposed and **not** claimed live: multi-user hosted Supabase Auth/RLS, PSP sandbox end-to-end, protected signed playback for paid media, correct cross-border creator payouts, AI recommendations, view-money pool, real pilot results.
- Metrics below are **pilot goals to validate**, not user counts we already achieved.
- Creator testing with the founder's interested student creator requires her informed participation; her identity and conversations are private and not to be documented in this public repo.

## Other Worthkind applications
Reuse the **process** and expert sources, not an accidental Student Creators architecture clone:
- Hotel OS / Worthkind Flow: room holds, booking reconciliation, tenant isolation, support.
- SignalBridge: financial journal invariants, reconciliation, regulatory consent and account integrations.
- USSD Flow: Android network/USSD session reality and permission policy.
- ChurchScreen AI: audio streaming, recognition eval, human confirmation, projection safety.
- Landlord/Tenant: rent ledger, permission scopes and restoration.
- Student Attendance: on-device face matching/privacy and error rates.
All get their own domain threat model, tests and real runtime evidence.


## Implementation and learning issue dashboard (created GitHub issues)
- Existing engineering: [#9 current-source CI audit](https://github.com/srdataml-droid/Student-creator-/issues/9), [#10 creator restriction/identity](https://github.com/srdataml-droid/Student-creator-/issues/10), [#11 sandbox licensed-access commerce](https://github.com/srdataml-droid/Student-creator-/issues/11), [#12 pilot test](https://github.com/srdataml-droid/Student-creator-/issues/12).
- Expert/role study: [#13 Product](https://github.com/srdataml-droid/Student-creator-/issues/13), [#14 Architecture](https://github.com/srdataml-droid/Student-creator-/issues/14), [#15 UX](https://github.com/srdataml-droid/Student-creator-/issues/15), [#16 Authorization](https://github.com/srdataml-droid/Student-creator-/issues/16), [#17 Payments](https://github.com/srdataml-droid/Student-creator-/issues/17), [#18 Video](https://github.com/srdataml-droid/Student-creator-/issues/18), [#19 QA](https://github.com/srdataml-droid/Student-creator-/issues/19), [#20 Leadership](https://github.com/srdataml-droid/Student-creator-/issues/20).
- Operations and policy: [#21 leadership configuration](https://github.com/srdataml-droid/Student-creator-/issues/21), [#22 privacy-safe analytics](https://github.com/srdataml-droid/Student-creator-/issues/22), [#23 staging/backup](https://github.com/srdataml-droid/Student-creator-/issues/23), [#24 policy approval](https://github.com/srdataml-droid/Student-creator-/issues/24).
- Further learning: [#25 analytics/growth](https://github.com/srdataml-droid/Student-creator-/issues/25), [#26 trust/compliance](https://github.com/srdataml-droid/Student-creator-/issues/26), [#27 SRE](https://github.com/srdataml-droid/Student-creator-/issues/27).

### Reusable repo-local skills
Ten role-specific procedures under `.agents/skills/`: product-discovery, architecture-lead, ux-creator-flows, secure-content-access, payments-ledger, media-upload, qa-release, analytics-growth, trust-compliance-operations, team-leadership. These are GitHub files that compatible agents can load, not separate paid app subscriptions or autonomously running workers.

### Actual setup status
- **Done:** plan documents, flows, architecture, branch, GitHub issues and templates, repo agent skills.
- **Not done:** GitHub Projects board/iteration fields, calendar events, external app installs (except any connections the user completes), actual code implementation, PSP sandbox configuration, hosted database, CI test pass on this branch, team assignment or live launch.
- **Next:** run exact-source build and smoke tests, then begin W00/#9; only update statuses with evidence.
