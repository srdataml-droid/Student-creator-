# AI Tools, Time Model, Cost Triggers and Multiple-Account Hygiene
**Version:** 2026-11-23 · Estimates are planning scenarios, not observed benchmarks or commitments.
**Objective:** AI-assisted solo founder, opt-in helpers; proof-driven 5–10-user alpha and 80–100-student pilot. Do not spend enterprise money to run 100 users.

## A. Minimal primary stack (not 30 subscriptions)
| Stage / job | FIRST CHOICE | When to use it | Alternative / condition | Do NOT use |
|---|---|---|---|---|
| Opportunity research & PRD | ChatGPT + first-party sources + Markdown GitHub docs | Before a substantial feature, 45–90min | Notion (already connected) for private notes ONLY if required; avoid duplicated backlog | AI-generated fictional interviews |
| Engineering issue/leadership/goal tracking | GitHub Issues + repo Markdown now; GitHub Projects UI board/iterations if configured | Every issue/sprint; weekly review | Notion for personal organizer if chosen; no two sources of truth | Separate planning repos/accounts for identical backlog |
| Design & flows | Figma or free/open-source Penpot for editable design; Mermaid in Git | Only when interaction needs mockups; ~2–4h per focused flow | AI-assisted design exploration, direct CSS prototyping | Large beautification work before user journey functions |
| Code changes | OpenAI Codex or GitHub Copilot with repo-local AGENTS.md/skills | Small targeted modules with acceptance tests | ChatGPT as reviewer or debugger using precise file context | Unreviewed massive one-shot app rewrite |
| Source management | Existing GitHub repository + research branch + deliberate main merge | Every unit of work | None | Creating duplicate app repo or fake collaborator identities |
| Local code | Existing Node 22+, Next.js/React, node:test and SQLite for development | Source iteration, isolated tests | Adopt TS incrementally when valuable | Stack rewrite, premature extra frameworks |
| Production data | Dedicated Supabase Postgres/Auth/RLS after isolated staging approval | When hosted multi-user pilot demands it | Another managed PostgreSQL if justified | Serverless production with local SQLite file |
| Video | Managed Cloudflare Stream **candidate** (validate signed token, upload, pricing), Mux **alternative** | Once private video/pilot ready | tus for resumable uploads when needed | Self-built transcoding/CDN/WebRTC at 100 users |
| Payments | Paystack test environment, current official webhook/verification docs | Only after approved checkout contract | Flutterwave after merchant/corridor requirement comparison | Fake creator balances or treating browser redirect as payment |
| Testing | Existing Node built-in test + PostgreSQL contract jobs + Playwright for E2E | Every relevant change; browser for risky journeys | React Testing Library for complex component behavior | Claiming code generated means tested |
| Monitoring | App logs + GitHub Actions initially; Sentry/PostHog when deployed | Staging and alpha, with privacy-minimized events | Provider logs and built-in dashboards | Tracking student ID/private DMs |
| Live classes | LiveKit managed later | After actual demand | Alternative hosted room provider | Building live RTC stack now |
| AI recommendations | deterministic feed, A/B eval sheet first | When real watch data exists | Python LightGBM/embeddings later | GPU training before traffic |
| Collaboration | Repo issues + short task assignment + private consented meetings | Assign non-sensitive work | Notion private docs for personal leadership | Exposing student data to broad volunteers |

Tool choice is intentionally **conditional**. A provider mentioned is not connected or installed merely because it appears here. Check current merchant eligibility, service terms, costs and API behavior before sign-up.

## B. When AI helps and when human work dominates
~~~mermaid
flowchart TD
  Need["Defined task + test evidence needed"] --> Type{"Task type?"}
  Type -->|Research/PRD| Chat["ChatGPT: synthesize source, diagram, decision"]
  Type -->|UI exploration| Design["Figma/Penpot: editable prototype"]
  Type -->|Code/test/debug| Coding["Codex/Copilot: small patch + tests"]
  Type -->|Payment/privacy/release| Senior["Senior reviewer + owner, risk-gated"]
  Chat --> Check["Human checks real sources/users"]
  Design --> Check
  Coding --> Run["Run actual tests, DB checks and browser"]
  Senior --> Run
  Check --> Issue["GitHub issue, acceptance/effort and decision"]
  Run --> Issue
  Issue --> Merge{"Exact-source verification?"}
  Merge -->|No| Coding
  Merge -->|Yes| Done["Controlled merge/deploy with monitoring"]
~~~

## C. Time estimates — *active hours*, AI assisted; not billed API minutes
Assumptions: existing app foundation; founder works **15 focused hours/week**, optional helpers **2–6 hours/week total each** not guaranteed; AI coding help; no app rewrite; no external approvals included. Human review, failed tests and source debugging are included in ranges, but every estimate can overrun. Learning/practice overlaps feature work and must not be added twice.

| Use case / deliverable | Estimated founder active hours with AI | Main bottleneck |
|---|---:|---|
| Audit current GitHub main, CI, API/routes and build | 5–9 h | Access/tooling/runner availability |
| Product outcomes + limited creator interviews | 5–10 h | Scheduling real student feedback |
| Map actual C4, security boundary and ADRs | 5–10 h | Correct source understanding |
| Build creator feed/profile accessibility adjustments | 10–20 h | Real-device testing and UI states |
| Hosted student verification/privacy and RLS | 16–32 h | Auth/RLS, lawful ID evidence rules |
| Creator view/comment/DM restrictions | 12–25 h | Multi-account bypass/authorization tests |
| Media upload/private playback + failure recovery | 20–40 h | Provider, media processing and actual network |
| Price/licenses and checkout/order contract | 12–24 h | Rules about existing paid access and fees |
| PSP sandbox, webhook idempotency and ledger | 30–55 h | Concurrent transactions, refunds, reconciliation |
| E2E browser + security regressions | 20–40 h | Test environments and flaky provider boundaries |
| Staging, monitoring, backup/restore and incident drill | 20–40 h | External service/configuration and verification |
| First real alpha 5–10 and changes | 12–24 h | Real student availability, support and bugs |
| Expansion to 80–100 people, support and metrics | 16–35 h | Onboarding, evidence and abuse support |

**Total if all sequential:** 183–364 active founder hours, before major external/legal/provider delays. At 15 focused hours/week this is approximately 12.2–24.3 weeks. Some tasks overlap and volunteers may reduce workload; provider delays, extra product complexity and poor electricity can extend the calendar. **Don't treat 4 weeks as a promise of live PSP monetization.**

### Estimation formula
Founder's active calendar weeks = sum of non-overlapping founder hours / sustainable weekly focused hours.
Example: 210 h / 15 h per week = 14 weeks before schedule/risk contingency. Add 20–30% buffer for unexpected integration/approval/rework: around 17–18 weeks. Parallel independent student/UX feedback may shorten critical path only if release gates remain intact.

### AI performance is a hypothesis, not guaranteed multiple
- AI is very useful for first drafts, boilerplate, low-risk refactoring, research, test cases and describing code.
- AI may increase cost when requirements are vague, many files change, tests don't exist or bugs get repeated.
- Track **actual** time: context prep + generation + edit + tests + review + correction; compare against estimates weekly rather than using fabricated industry speed-ups.
- Separate token/credit spend, hosting cost and human labor cost. Do not depend on free credits surviving the entire pilot.

## D. Account strategy (legitimate separation, never bypass terms)
Founder may have multiple accounts for legitimate boundaries: personal development, business organization, production admin, read-only test users and sandbox payment entities. Creating additional identities to bypass subscription limits, vendor rate limits, free-trial restrictions, security review or KYC is unsafe and may violate terms.

**Suggested separation, if/when needed:**
1. One personal owner identity with passkeys/MFA and recovery methods, no shared password.
2. One organization/team workspace with explicit invitations and least-privilege contributor permissions. Do not transfer a public private-data project without verifying permissions.
3. Separate staging and production vendor projects/keys, preferably under the SAME verified business owner/organization.
4. Three or four synthetic **test application users** (creator, permitted viewer, blocked viewer, moderator) ONLY in staging; use test emails and provider sandbox transactions.
5. Financial provider accounts only with authorized, accurate business identity and required verification.
6. Scoped service accounts for CI/CD with rotated credentials and secret storage, not in Git; a staff member should never share owner's authenticator or token.

### Account risk checklist
- Different work vs production environments; distinct PSP test and live keys.
- MFA and recovery method for owner; record authorized admin roster in a PRIVATE safe place, not this public repo.
- Service keys server-side and narrowly scoped; revoke unused collaborators promptly.
- Vendor ToS and tax/KYC compliance checked before additional accounts.
- No duplicated fake customer accounts for paid referrals, artificial engagement or fabricated user metrics.
- Public repo: architecture can be public, but private student identity, personal contacts, API secrets and commercial terms must not be uploaded.

## E. Provider decision points
- Hosted database = only after source audit, dedicated staging project, versioned migration+RLS tests.
- Video = only after protected paid-content access verified and accurate bandwidth comparison.
- PSP = only after commercial terms confirmed, verified test/live account eligibility and refund policy.
- Design = use cheapest editable tool that lets users test a real workflow; avoid paid design subscriptions until real bottleneck.
- AI subscriptions = choose 1 primary coding assistant and use others only if genuinely improving speed/quality; monitor weekly spend.
