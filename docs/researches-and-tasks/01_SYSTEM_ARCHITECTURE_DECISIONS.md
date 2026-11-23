# Architecture Decision Pack — Student Creators
**Source:** Current srdataml-droid/Student-creator- on main as inspected 2026-11-23; prior docs/architecture/01,02 and docs/PROJECT_PROGRESS.md.
**Status:** Proposed design, NOT implementation. Do not apply migrations or enable live PSP transactions from this file.

## 1. Current source inventory vs intended system
| Layer | Observed in current code/docs | Target when ready |
|---|---|---|
| Web UI | Next.js/React (apps/web); home/FeedExperience; creator studio/profiles | Mobile-first For You/Following, portfolio, licensed checkout, responsive navigation |
| Server and data | Node 22+ local-core with SQLite, file-backed media, manual admin verification | Dedicated hosted Postgres + Auth/RLS, private identity evidence and migration rollback |
| Social | Follows, likes, comments, bookmarks, opt-in DMs, course communities | Granular server-authorized view/comment/DM restriction, reports and appeals |
| Media | Local MP4 via /api/local/lessons/{id}/video | Private upload/encode, secure preview, signed short-lived playback, low-data variants |
| Payment | packages/payment-core isolated quote/Paystack client; legacy webhook HMAC check in current code | PSP test/live configuration reviewed, idempotent order/entitlement and ledger, reconciliation |
| Release | .github/workflows/ci.yml currently triggers main/feat branches; repo not deployed | CI on research branch and main, staged hosted tests, backups, monitoring and pilot |

## 2. Context and components (target, logical not 10 microservices)
~~~mermaid
flowchart TB
  Client["Browser/PWA + Android testing devices"] --> UI["Next.js frontend: Feed, Studio, Profiles, Purchase"]
  UI --> Server["Authenticated Node/Next server API"]
  Admin["Admin / review console"] --> Server
  Server --> User["Auth & student verification"]
  Server --> Content["Creator content + media state"]
  Server --> Social["Feed / follow / comments / restrictions"]
  Server --> Rights["Access license/entitlement policy"]
  Server --> Order["Order and PSP gateway"]
  Server --> Ledger["Ledger, refund, reconciliation, payouts"]
  Server --> Trust["Reports, copyright & moderation"]
  Server --> Metrics["Operational and product telemetry"]
  User --> DB[("Postgres staging/prod; SQLite development")]
  Content --> DB
  Social --> DB
  Rights --> DB
  Order --> DB
  Ledger --> DB
  Trust --> DB
  Content --> Video["Managed encoded video storage/CDN"]
  Rights --> Video
  Order --> PSP["PSP sandbox then approved production"]
  Ledger --> PSP
  Server --> Queue["Background task queue/recovery (as needed)"]
  Queue --> DB
~~~

### Deployment decision
At 80–100 students: **one modular application**, managed services where sensible; avoid Kubernetes, separate media server/SFU, multiple regional DBs or AI GPUs. Keep existing JavaScript implementation; introduce TypeScript incrementally only where it improves safety. Local SQLite is not a viable stateless multi-user production database. Introduce approved Postgres staging migration carefully with negative access tests.

## 3. Domain architecture
~~~mermaid
flowchart LR
  Account["Student account & private verification"] --> Profile["Creator profile"]
  Profile --> Content["Copyright-owned content"]
  Content --> Version["Published version + access terms"]
  Version --> Access["Viewer entitlement"]
  Order["Immutable buyer order"] --> Access
  Order --> Event["PSP verified event"]
  Event --> Journal["Balanced ledger journal"]
  Journal --> Earnings["Pending -> cleared -> payable -> paid"]
  Profile --> Restriction["View/comment/message restriction"]
  Restriction --> Policy["Server access decision"]
  Access --> Policy
  Version --> Policy
  Policy --> Grant["Expiring playback grant"]
~~~

### Non-negotiable invariants
1. A creator owns the original content they have rights to; purchase is a **scoped access license**, not intellectual property transfer.
2. Every new paid playback grant checks creator blocks, moderation, user eligibility and a valid buyer entitlement. No public permanent paid URLs. Streaming cannot absolutely stop screen recording.
3. Price is free or NGN >= 200 in integer minor units for the pilot. Creator commission/PSP fee bearer currently UNDECIDED; do not confuse illustrative payment-core defaults with founder-approved pricing.
4. Payment callbacks and network retries are idempotent. Server verification matches reference, amount, currency, environment and order. Atomic DB transaction grants one entitlement and posts a balanced journal.
5. Refund/chargeback writes compensating transactions and applies explicit access terms. Creator-blocked paid users get a defined safety/dispute path.
6. Login/private student verification is separate from the public profile; campus shared IP is not a reliable uniqueness key.
7. Financial provider secrets and student card images stay outside GitHub, logs, public analytics and unapproved volunteer access.

## 4. Quality, security & compliance review gates
- Positive/negative authorization, cross-account RLS and role separation.
- AI-assisted code needs targeted tests, clean CI, real browser and slow-network manual verification.
- Copyright policy, report/takedown/appeals and age/privacy rules need founder and qualified review.
- Production settlement/payout must wait for PSP account eligibility and lawful terms; international buyer cards do not mean global creator payouts.
- Every acceptance claim linked to exact source commit/test run; documentation is not a green check on application features.

## 5. ADR starter list
- ADR-001: one existing repository, small modular monolith, managed services; research branch for plans only.
- ADR-002: creator retains ownership; viewer obtains access entitlement.
- ADR-003: backend authorization and short-lived playback grants for paid content.
- ADR-004: immutable order snapshots, atomic fulfillment/journal, external PSP reconciliation.
- ADR-005: minimum ID evidence, privacy review, manual verification and appeals.
- ADR-006: begin feed ranking with simple rules; only later fit/evaluate ML with legitimate evidence.
- ADR-007: independent human approval for live PSP charges and regulatory actions.
- ADR-008: no speculative new accounts solely to evade subscription, payment or platform limits.

## Reusable expert source links
- C4: https://c4model.com/
- Brandur payments: https://brandur.org/idempotency-keys
- Paystack docs: https://paystack.com/docs/payments/webhooks/
- tus uploads: https://github.com/tus/tusd
- Video.js: https://github.com/videojs/video.js
- OWASP authorization: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
