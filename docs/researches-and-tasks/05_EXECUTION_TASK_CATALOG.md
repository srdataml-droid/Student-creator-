# Executable Research, Leadership and Engineering Task Catalog
**Reference branch:** researches-and-tasks. This is a queue, not completed implementation. Open GitHub issues refer here as the contract.
**Existing development issues** (do not duplicate): #9 W00 baseline; #10 W03–W05 identity/content restrictions; #11 W06–W07 commerce; #12 W10–W11 pilot.

## Task specification
Every issue should state:
Task ID, function owner, consulted roles, priority, prerequisites, active-hour estimate (founder+AI), learning source + experiment, files/routes, acceptance and negative test, known external blockers, and evidence URL/commit when finished.
Avoid assigning team members until they accept. A published description of a role is not permission to give that person an account or issue assignment.

## Stage / effort table
| ID | Task / functional lead | AI-assisted active hrs | Dependency | Outcome evidence |
|---|---|---:|---|---|
| R01 | Researcher: observed student creator journey; opportunity tree | 5–10 | Consent & willing testers | Interview summaries (no personal IDs), one assumption test |
| R02 | PM/leadership: 1-pager scope, outcome, 2 active work limit | 3–5 | R01 can run parallel | Prioritized issue, 3 measurable criteria |
| R03 | Architect: reconcile C4 against actual files/API | 5–10 | W00 #9 | Current system map + ADR and test plan |
| R04 | Design: mobile user flows, error/paid-preview states | 8–14 | R01/R03 | Creator completes 3 tasks in prototype |
| R05 | Security/identity: verify user, private ID, roles, appeal | 16–32 | W00/R03 | RLS authorization tests and privacy review |
| R06 | Media: safe upload, retry, processing, private playback | 20–40 | R05 | No unentitled media; upload retry/Android test |
| R07 | Trust/safety: viewing, commenting and DM blocks | 12–25 | R05/R06 | Backend API negative tests and report/refund handling |
| R08 | Payments: copyright/access license price & immutable order | 12–24 | R06/R07, founder fee decision | Price and entitlement test contract |
| R09 | PSP/ledger: sandbox and duplicate/refund reconciliation | 30–55 | R08, PSP sandbox | PSP verified once, balanced entries and tests |
| R10 | QA: Playwright, financial regression, browser/device | 20–40 | R06–R09 | Reproducible CI SHA, browser traces |
| R11 | SRE: hosted staging, restore, observability & incident | 20–40 | R05–R10 | Backup restoration and live error visibility |
| R12 | Community: 5–10-person opt-in alpha | 12–24 | R10/R11 | Genuine creator/viewer walkthroughs |
| R13 | Growth: 80–100 verified student pilot | 16–35 | R12 + approval | Actual creator, retention, spend & safety metrics |
| R14 | Analytics/AI: event taxonomy and rule-based discovery | 5–10 | R05–R07; parallel | Privacy reviewed tracked events, eval set |
| R15 | Legal/finance: copyright, ID retention, PSP eligibility | Variable external | R05/R08 | Owner/provider/qualified review before live money |
| R16 | Leadership: weekly backlog and performance review | ~1 hour/week | R02 | Updated statuses, estimates, risks and evidence links |

**Estimates** are not promised outcomes. R14 and R16 are overlapping support, not extra critical-path stages; do not simply sum everything and promise a date.

## Required artifacts for each functional discipline
Founder/PM → one-page decision, metrics and priority rationale.
Design/UX → tested task flow, error and responsive states.
Architecture → versioned system view, component ownership, ADR.
Backend/DB → interface/data changes, migrations, negative auth tests.
Video → signed grants, retry errors, media delivery and bandwidth budget.
Finance → order/ledger invariants, duplicate webhook and refund scenarios.
QA → tests tied to commit SHA, browser/Android evidence.
Security/privacy → role matrix, threat model, no private ID leak, review decision.
SRE → incident/restore documentation with rehearsal evidence.
Creator success/growth → real opt-in behavior, upload success and return reasons.

## Issue templates and skills
- Use .github/ISSUE_TEMPLATE/task.yml for founder-assigned work with role, priority, estimated hours and evidence.
- Use .github/ISSUE_TEMPLATE/learning.yml for readings with links, practical code experiment and taught-back summary.
- Agent skills in .agents/skills include role-specific procedures for discovery, architecture, access, financial integrity, media, verification and leadership; they are guidance, not autonomous staff or a paid plugin install.
- Root AGENTS.md establishes project nonnegotiable behaviors.

## Current first action
Issue #9: capture the main SHA, run real tests/Next build/DB contract, produce repo route map, and inspect content video URL. Do not move #10 or #11 to verified until backend tests actually pass.
