# Leadership, Goal Setting and Milestone Roadmap
**Drafted:** Monday 2026-11-23 | **Status:** proposed dates, not calendar invites, appointed roles, committed volunteer capacity, actual milestones configured in GitHub Projects, or guaranteed release dates.
**Goal:** a small, safe and useful Student Creators app; student creators retain copyrights, viewers purchase ACCESS, 5–10 student alpha then up to 80–100 verified students.
**Single source of truth:** GitHub Issues and architecture docs in srdataml-droid/Student-creator-. This planning branch is researches-and-tasks; merge only after review.

## 1. North-star outcome and OKRs (proposed; founder approval needed)
**Outcome hypothesis:** Verified students create original content, other students genuinely consume it, and at least some voluntarily buy access because it is valuable.

| Objective | Proposed measurable key results | Guardrail |
|---|---|---|
| O1: Creator value works | 5–10 alpha testers complete join -> upload -> review -> watch; 20 active creators is an **aspirational pilot target**, not observed | No fabricated users, videos or approvals |
| O2: Legitimate paid access | Sandbox buyer gets one permitted playback entitlement after confirmed test payment; zero unauthorized test grants and zero duplicate financial journal entries | No live payout or misleading balances |
| O3: Strong user trust | Creator view/comment/DM blocks enforced on backend; test blocked paid buyer dispute; identity not disclosed to volunteers | Human review of privacy/appeals |
| O4: Sustainable infrastructure | Track real delivery minutes, cost per viewing hour, upload error rate, refunds and payment fees in an actual test environment | Do not promise a fixed margin from NGN 200 |
| O5: Measured growth | When gates pass: invite up to 80–100 students; report weekly verified members, active creators, posts, return viewers and meaningful sales | Do not reward fake referrals |
| O6: Repeatable engineering | Every shipped feature cites exact commit, passing CI, appropriate browser/security checks and rollback notes | No unverified "complete" statuses |

## 2. Dependency-first roadmap — scenarios, not deadlines
### Iteration cadence: one-week cycles; founder baseline 15 focused hours/week
| Phase | Proposed calendar window | Exit criteria | Key human signoff |
|---|---|---|---|
| M0 — setup and audit | Nov 23–Dec 6, 2026 | Research branch/docs/skills reviewed; actual main CI/source inventory; tasks triaged | Founder + tech reviewer |
| M1 — verified user/creator core | Dec 7–Jan 3, 2027 | identity risk review; creator feed/profile/onboarding usability; content rights and media policy | Founder, UX tester, privacy/security |
| M2 — protected content & blocks | Jan 4–Feb 7, 2027 | backend view/comment/DM rules, protected media grants and attack tests | Founder + security/QA |
| M3 — commerce sandbox & ledger | Feb 8–Mar 21, 2027 | PSP sandbox, idempotent financial postings, refunds, payouts disabled | Founder + independent finance/security |
| M4 — hosted alpha & recovery | Mar 22–Apr 18, 2027 | staging Postgres/RLS/media, browser+Android smoke, backup restore, 5–10 consented testers | Founder go/no-go |
| M5 — pilot expansion | Apr 19–May 16, 2027 | up to 80–100 students if alpha metrics and permission reviews support expansion | Founder + operations/support |

**Dates are illustrative** and must be revised after M0 audit, provider eligibility and actual founder capacity are confirmed. Success can come earlier; security blockers can move phases back. Do NOT launch live paid commerce because a calendar date arrived. This roadmap covers roughly 25 weeks, consistent with the ~183–364h active-work model at 15h/wk plus approvals/contingency.

## 3. Critical path map
~~~mermaid
flowchart LR
  M0["M0 Verify main + team skills"] --> ID["Identity/roles + private evidence"]
  ID --> Media["Content moderation + private media"]
  Media --> Block["View/comment/DM authorization"]
  Block --> Price["Price/license & order snapshot"]
  Price --> PSP["Test PSP verification + idempotent journal"]
  PSP --> E2E["Hosted RLS, browser E2E, backup and incident test"]
  E2E --> Alpha["5-10 consented testers"]
  Alpha --> Gate{"Safety/retention/cost evidence acceptable?"}
  Gate -->|No| Fix["Iterate and retest"]
  Fix --> E2E
  Gate -->|Yes| Pilot["80-100 opt-in student pilot"]
  M0 --> UX["UX prototypes + creator feedback (parallel)"]
  UX --> Alpha
~~~

## 4. Weekly leadership operating system
Monday (20–30 min): choose one primary user outcome, at most TWO active technical issues; record blockers and available hours.
Tuesday–Thursday: AI-assisted coding/research against one issue, implement negative tests before significant merge. Keep source and API contracts synchronized.
Friday (30 min): evidence review: test result, actual commit, UI proof, cost and security exceptions.
Saturday or whenever volunteers available: 20-minute creator walkthrough, opt-in interviews and quick defect triage.
Sunday or rest day: retrospective: new evidence, objective updated, next issue priority, hours spent vs estimate.

**One-line standup template:** Done [link+proof] / Today [issue] / Blocked [reason+owner] / Next [test] / Time spent [hours].
**Review template:** Goal, observed metric, changed feature, risk, exact commit, test/build/browser evidence, owner approval, decision and next action.
**Definition of done:** acceptance satisfied + tests actually run + security/recovery considerations + documentation updated + exact source recorded + release owner confirms. Tests green is necessary but not sufficient for a production money feature.

## 5. Work states and goals
- Status: Proposed → Ready (has owner + acceptance) → In progress (one primary assignee) → In review (test evidence attached) → Verified (evidence reviewed) → Released (staging/production specifically named) → Measured (actual user observation).
- Blocked is a separate status label, not a reason to falsely mark a feature done.
- Priority: P0 prevents unsafe/incorrect data or money; P1 blocks core creator-to-viewer experience; P2 quality/retention; P3 later growth ideas.
- Learn/Build linkage: every learning task links to one issue with an experiment and an artifact; don't mistake reading 10 articles for 10 implemented features.
- Weekly budget: founder 15 active hours; increase only if sustainable. Volunteer tasks are **opt-in** and not assumed completed.
- Each working session start with nearest failed test, not a 100-feature backlog.

## 6. Risk register
| Risk | Why it matters | Prevention / owner |
|---|---|---|
| Public repo and student privacy | School ID leaks, private creator relationship or credentials could be public | Founder review, secrets scanning, no real identity evidence in Git |
| Payment approval/settlement | Sandbox implementation doesn't imply merchant can split payouts | Founder + PSP + specialist legal review |
| Scope creep | AI makes extra screens cheap to generate but expensive to maintain | PM one outcome/feature, two in-progress max |
| Weak network/power | Upload and remote development sessions interrupted | Resumable uploads, local test fallback, short sessions and time buffer |
| Volunteer coordination | People cannot be assumed available | Small scoped tasks, explicit availability/consent |
| False belief in AI quality | Generated code may bypass RLS or repeat payments | Security tests, manual inspection, independent review |
| Multi-account policy | Duplicated accounts may violate vendor terms or weaken security | Legitimate role separation, MFA, no trial/usage-limit evasion |
| Too much planning | Reports grow while app doesn't ship | Weekly proof of one verified technical or user task |

## 7. Setting an actual project board (requires separate GitHub Projects UI setup)
Use GitHub Issues as the implemented tracker now; if the founder wants a visual board, in the existing GitHub account use Projects → New project, create table/board/roadmap views; define fields Priority, Status, Owner, Start date, Target date, Estimate h, Actual h, Workstream, Evidence, Risk, Iteration. GitHub Projects supports iteration and date fields, but the connected action set in this session does **not** expose create-project/field/milestone configuration; this document does NOT claim it created the board.
Official: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/quickstart-for-projects

## 8. Promotion rule for our planning branch
Keep production source on main; this research/docs branch is for review of instructions, plans and issue definitions only, as newly requested. Once reviewed, merge using an approved test/verification process; do NOT automatically merge risky code. Future engineering code may continue main-only if that is the founder's current preference, but review blast radius and restore readiness.
