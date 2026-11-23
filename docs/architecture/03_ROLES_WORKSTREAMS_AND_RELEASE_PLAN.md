# Student Creators — Roles, Decision Rights, Workstreams and Delivery Gates

**Version:** Operating plan v0.1 · 23 November 2026 · **direct commits to main, one repository**: srdataml-droid/Student-creator-.
**Status:** Proposed team and feature plan. No volunteer assignment has been accepted; names, permissions, deadlines, team capacity and budgets are NOT presumed.
**Founder-updated active rollout:** **ONE** consenting verified student first, then **100**, then **1,000**, with independent security/reliability and founder approval gates. The earlier 5–10 / 80–100 alpha plan below is superseded wherever it conflicts with this one-student-first requirement; see Issue #12.
**Product:** social video and student creator economy, NOT a school-management platform.

## A. Teams represent functions, not 16 salaries
Founder is the decision owner; AI assists implementation and research but is not a legal/accountable operator. People who volunteer can perform bounded tasks only with informed agreement and access appropriate to their role. A student content creator already available to the founder may serve as a **creator persona/tester**, not a data reviewer, admin or product owner by default. Ask them what they want to do.

| Role / function | Responsibilities | Required output | First-pilot coverage | Approval / access |
|---|---|---|---|---|
| Founder / product owner | Define success, scope, fees, ethical and business decisions | Signed decision log, prioritized backlog, beta go/no-go | Founder | Final product/financial approvals |
| Product manager | Convert user behavior into acceptance criteria, roadmap, dependencies | PRD slice, stories, user-journey and decision board | Founder + AI | No production data by default |
| User researcher | Interview consented creators and buyers, examine actual habits | Research questions, synthesized findings, evidence gaps | Volunteers + founder | No uncontrolled identity files |
| Creator community lead | Recruit creators; onboarding and feedback | Opt-in roster, first-upload support, recurring-use notes | Interested student volunteers | No financial/admin permissions |
| Product designer / UX writer | Responsive workflows, creator studio, accessible copy, permission settings | Figma/design spec, navigation, component states, usability tasks | AI-assisted + volunteer tests | No student ID documents |
| Frontend engineer | Feed, profile, creator studio, media controls, earnings UI | PRs/code, UI tests, accessibility | Founder + AI, optional developer | App UI code only |
| Backend/API engineer | Auth endpoints, business rules, content/creator modules | Secure API and contract tests | Founder + AI | Secrets confined to trusted services |
| Database/data engineer | SQL schema, migrations, permission policies, backups, indexes | Reviewed migration, RLS tests, restore evidence | Founder + AI, specialist review | Staging limited credentials |
| Video/media engineer | Secure direct upload, validation, encode, signed playback, performance | Upload/playback SLOs, protection tests, cost model | Founder + provider | Scoped media credentials |
| Payments/finance engineer | PSP adapter, checkout, ledger, webhook retries, refund, payout eligibility | Financial state diagrams, idempotency tests, reconciliation report | Founder + AI + external reviewer | No live money without explicit approval |
| Security/privacy engineer | Threat model, authorization, student ID minimization, secret review | Abuse cases, ASVS-aligned checklist, privacy decisions | Founder + reviewer | Access limited to scoped test data |
| Trust & safety / moderator | Creator blocks, reports, plagiarism/copyright, appeals | Case playbook, audit, moderation queue and response target | Selected trusted helper after training | Explicit least-privilege staff permissions |
| QA / test engineer | Positive/negative cases, unit/integration, Playwright, real Android | Evidence tied to commit, browser/device check results | Founder, volunteers for usability, AI | Synthetic accounts, not private production data |
| SRE / DevOps | Deployment, CI, monitoring, health, backup/restore, incident response | Staging and rollback proof, on-call/triage procedure | Founder + managed vendors | Deploy rights held by founder |
| Analytics / AI engineer | Instrument core events; baseline recommendation tests and later ML evals | Event catalog, cohort dashboard, model evaluation dataset | Founder + AI | Privacy-reduced product events |
| Growth / partnerships | Campus outreach, referrals, creator/brand collaborations | Channel plan, cost per activated creator, retention reports | Volunteers as interested | Outreach material reviewed |
| Customer support | Answer access complaints, refund tickets, technical onboarding | Ticket state, response policy, escalation | Founder + helper | No full PSP secrets or legal IDs |
| Legal/accounting adviser | Terms, copyright, youth/student privacy, PSP/cross-border payout review | External opinion/approval before live money | Specialist as needed | Separately authorized |

### Collaboration expectations
- Roles can overlap. Volunteers can work asynchronously with short, defined tasks; do not hand out administrator access as thanks for helping.
- Any collaborator on GitHub gets only necessary permissions, and current repo is PUBLIC; never post keys, student cards or personal chats as issues.
- Teams communicate through a single GitHub project/issues and docs in THIS repo; do not create a separate project repository as a coordination workaround.
- Founder explicitly requires **one repository and main branch only** for this phase. Small documented and tested commits go straight to main; do not create feature branches or cross-repository copies unless owner later changes this policy. A current GitHub workflow permits push to main; check CI on every commit. Main-only increases risk, so use tiny reversible commits and independent test checks.

## B. Owner / contributor decision rights
| Decision | Accountable | Consulted | Evidence before approval |
|---|---|---|---|
| User problems/priority | Founder | Student creator tester, viewers, PM | Research observations + measurable outcome |
| UX flow | Founder + design lead | Creator tester, QA, accessibility | Usability task completion and screenshot/video evidence |
| Architecture choices | Founder + engineering lead | Security, media/PSP specialists | C4 diagrams, ADR, cost/tradeoffs, test plan |
| Paid content rules | Founder | Creators, buyers, legal, payments | License terms, refunds, dispute scenarios |
| Creator ban/refund policy | Founder | Trust/safety, support, legal | Safety impact and fair resolution mechanics |
| Commission, withdrawal threshold, payouts | Founder | Finance/PSP/legal reviewers | Math, provider eligibility, approval and ledger invariants |
| Identity handling | Founder | Privacy adviser and verification operator | Minimal lawful data, retention, appeal and RLS tests |
| Go-live | Founder | Engineering, QA, operations | Exact commit CI + E2E + restore + incident/release checklist |

## C. Workstreams and acceptance (tracked as work IDs, not claims completed)

| ID | Workstream / role lead | Deliverable | Depends on | Acceptance evidence |
|---|---|---|---|---|
| W00 | Founder + Eng | Current main audit and CI baseline | None | Actual repo SHA, tests, build, current routes and migration inventory |
| W01 | PM + Research + Creator | One consenting student's pilot flow and later expansion research | W00 | One opt-in task record; clear use-case and success metric without fabricating interviews |
| W02 | UX + Frontend | Mobile creator-first feed/studio/profile and responsive navigation | W00/W01 | Signed-off usability tasks and mobile layout checks |
| W03 | Identity + Backend | Private verification, eligibility, appeals and roles | W00 | API/permission tests, no legal identity leak, moderation audit |
| W04 | Content + Media | Safe creator uploads, rights declaration, transcoding and protected playback | W03 | Failed upload/processing test, blocked unauthenticated media, Android low-data test |
| W05 | Trust & Safety | Separate view/comment/DM blocks, reports, appeals and paid-buyer block handling | W03/W04 | Server denial tests and refund review procedure |
| W06 | Commerce + Finance | Creator price NGN 0 or >= 200, order snapshot, sandbox PSP verification | W03/W04/W05 | Tests for tampered price, wrong payment, signature mismatch, duplicate events |
| W07 | Database + Finance | One-time entitlements and balanced journal, refunds, reconciliation | W06 | Atomic transactions, duplicate/concurrent callback tests, manual audit |
| W08 | Creator Experience | Earnings dashboard and creator portfolio | W07 for money, W03 for portfolio | Derived figures correct, no fake earnings, creator profile privacy |
| W09 | SRE + Security | Dedicated hosted DB/Auth/Media staging, backups, monitoring and rollout | W03–W08 | Hosted RLS, restore drill, alerts, auth, video and checkout E2E |
| W10 | QA + Product | Private alpha with exactly **1** consenting student | W09 | Independent real-device tests, consent and feedback, no open critical issue |
| W11 | Growth + Support | Future **100-student** pilot, then **1,000** only after a second release gate | W10 | Proven one-person alpha, staged capacity/security costs and founder approvals; no automatic scaling |
| W12 | Community + UX | Reliable DMs, campus communities, classes and tutoring | W11 prioritization | Permission, session and class access tests |
| W13 | Growth + Finance | Funded sponsorships, referral reward caps, qualifying-view policies | Validated economics | Sponsor funds received, no pay per unqualified raw view |
| W14 | International + Legal | Country currency/identity/tax and payout readiness | W11 and local partner research | End-to-end supported local payment/payout & compliance per market |

### What a work item must include
1. User problem and success metric.
2. Actor journey and failure/abuse path.
3. Owner and contributor role (no guessing a volunteer's consent).
4. Implementation module/data/API impact with versioned diagram.
5. Acceptance tests (happy path, negative path, concurrency and privacy where applicable).
6. Test command, exact commit SHA, CI outcome, and browser/device evidence.
7. Operation/cost/rollback implications.
8. Remaining blockers, owner decision, and proof of completion.

## D. End-to-end user journey responsible by role

~~~mermaid
flowchart TD
  A["Research: understand student creator's last real upload"] --> B["PM: define core creator activation metric"]
  B --> C["Design: signup + studio + feed task"]
  C --> D["Backend/Identity: verify student, guard data"]
  D --> E["Media: upload, validate, approve"]
  E --> F["Frontend/Discovery: publish, view, follow"]
  F --> G["Payments: price/access checkout"]
  G --> H["Database/Finance: entitlement + ledger"]
  H --> I["Safety: blocks and refunds"]
  I --> J["QA/Security: adverse cases and browser E2E"]
  J --> K["SRE: deploy, monitor, restore"]
  K --> L["Growth/Creator tester: real usage feedback"]
  L --> A
~~~

## E. First two engineering cycles (not calendar promises)
**Cycle 0 — evidence:** Check latest main code and CI; reconcile existing UI/routes/data with documents 01 & 02, produce actual C4 mapping and an issue for each verified gap. Confirm volunteer creator can try real tasks without access to secrets. No new payment or data changes.

**Cycle 1 — most consequential safe slice:** Build tests and implement creator-specific view/comment/DM restrictions in development mode with server-side enforcement and an accessible UI; protect media URL authorization and model purchased viewing entitlement. Test using one creator, an allowed student, a blocked student and an unverified visitor. Do not roll out paid media until true PSP and hosted storage protection are proven.

**Cycle 2 — commerce sandbox:** Implement creator access-license price, checkout orders and server-only PSP sandbox event verification; atomic entitlements, balanced ledger, duplicate/replay, refund, race and failure tests. Founder approves real-world revenue fees and PSP capabilities before any live payment.

**Cycle 3 — closed alpha:** Dedicated, approved hosted resources; Playwright, low-data Android tests, backup recovery, alerting, creator rights/reporting and fair paid-buyer disputes. 5–10 testers before 80–100.

### Proposed feature scorecard
- Activation: number of eligible verified students publishing original approved content.
- Viewing: real watch minutes (not fictitious view counts), follows, returning viewers.
- Commerce: valid orders, purchase rate, successful unlock, refund rate, balanced journals.
- Integrity: denied unauthorized token attempts, moderation resolution time, privacy incidents.
- Operations: playback buffering, upload recovery, CI pass, observed API errors, restoration, CDN cost.
- Economics: gross payment vs platform retained commission after PSP/media/support; not equate sales with profit.

## F. Engineering rituals (lean, volunteer-friendly)
- Founder chooses a maximum of 1–2 active critical work items at a time.
- Student creator tester does a 20-minute task-based walkthrough; submits what was easy/confusing and any error evidence, never account passwords.
- Developers write a test first for risky edge cases; coding AI assists and is checked with exact-source tests.
- Before each main commit, run targeted tests locally; after push, verify CI at final main SHA, inspect failures, roll forward or revert if needed.
- Weekly founder review: 1 user insight, 1 shipped/tested workflow, 1 reliability metric, 1 unresolved decision. No need to create branches or duplicate documentation to mark progress.

## G. Open owner choices for first paid pilot
- Price and paid-access duration; creator's copyright/license scope and whether limited downloading is allowed.
- Fee commission and whether PSP fee is deducted from platform share; code default is NOT agreed business policy.
- Payment provider eligibility, settlement currency and refund conditions; payout minimum and timing.
- Creator blocks after purchases, action notification and right to appeal/refund.
- Pilot eligible institutions/age policy, student ID retention and graduation behavior.
- Volunteer responsibilities and permissions based on actual agreement.
- Whether we will use a paid managed video product for all content or only paid videos in first pilot.
