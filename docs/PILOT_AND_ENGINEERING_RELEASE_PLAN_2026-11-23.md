# Student Creators — 80–100-student engineering pilot and release gates
**Date:** 2026-11-23 | **Status:** proposed delivery plan; baseline is code on `srdataml-droid/Student-creator-`, not the old learning repo.

## Mission for first real pilot

Prove one repeatable loop: verified student -> original video/post -> creator-controlled free/paid access -> viewer discovers -> valid engagement or paid entitlement -> auditable creator earning -> creator returns to publish again. This is the commercially essential slice. Audience target: 80–100 authentic verified students, with a proposed initial 5–10-person alpha before wider invitations.

The first version is **creator-first**, not a university subject-card LMS. Communities, DMs, tutors and night classes form the later full product; preserve useful existing local code.

## Baseline and evidence as inspected 2026-11-23

- Canonical project: `srdataml-droid/Student-creator-` (`main`, public). Public README explicitly identifies the application.
- Main README documents: creator-first feed, public creator profiles, follows, local MP4 uploads, moderation, SQLite accounts, local DMs, bookmarks, comments, likes, communities and study sessions. GitHub PRs #1, #2, #4, #5 were merged.
- Existing product/progress docs state no production verified deployment, payment gateway transactions, paid-entitlement runtime, creator bank settlements, Supabase production auth/RLS or live media transcoding. CI/test claims are **historical** and must be rechecked at the exact new commit.
- Separate `srdataml-droid/school-learning-platform` has prior foundational work; **do not overwrite newer Student-creator- source or copy folders blindly.** Compare files and tests first, port individual proven changes only when beneficial.
- The destination repository is currently public. Do not commit school ID images, personal information, passwords, secrets, payment tokens, proprietary negotiations or private student data.

## Proposed staged delivery

### Gate 0 — Repository and product alignment
- Inspect `main`, open branches, active PRs, CI and existing production/staging credentials.
- Map each product requirement to actual code/test evidence: present, partial, missing, blocked.
- Update screen/navigation expectations: phone bottom nav, tablet hamburger, desktop top nav.
- Confirm independent school ID verification path, privacy/age scope and policy for graduation.
- No deployment or real-money transaction implied.

**Exit:** accepted feature checklist, no duplicate work or unreviewed source overwrite.

### Gate 1 — Creator identity, portfolio and social feed
- Finish stable onboarding, student verification and separate public handle/profile identity.
- Publish original videos, metadata, content ownership notice and moderation status.
- Feed with For You/Following, public creator profiles, follow, likes, comments, bookmarks.
- Complete browser and mobile tests, including first-use empty state and low-data playback.

**Exit:** 2 independently verified test users can publish and view permissible content; negative access tests pass.

### Gate 2 — Creator permissions and paid viewing access
- Add creator-specific `view/comment/message` blocks and server-level enforcement, abuse reporting and appeals.
- Define free (`0`) versus paid price (>= ₦200) and access type, duration, revocation/refund terms.
- Protected upload/media and short-lived private playback tokens; never return unrestricted paid media file URLs.
- Implement purchase-entitlement DB model and exact authorization checks without provider keys first.
- Use video transcoding/provider sandbox before scaling; retain local development adapter as rollback reference.

**Exit:** blocked users and nonbuyers cannot obtain playback; legitimate entitled buyers can; paid-buyer-block policy tested.

### Gate 3 — Safe commercial transactions and creator accounting
- Configure a **dedicated** Student Creators staging Supabase/PostgreSQL project and verify Auth/RLS before migration.
- Integrate PSP sandbox with server reference+amount+currency checks and verified webhook signatures.
- Atomic idempotent entitlement + double-entry/balanced ledger + audit; refunds, concurrent retries and chargebacks covered.
- Creator sales dashboard separates gross, fees, pending, settled, available, refunded.
- Payout requests implemented in sandbox; live withdrawals require licensed provider registration/approval and KYC.

**Exit:** real sandbox provider evidence; duplicated callbacks never double-credit; no pending/failed payment unlocks access.

### Gate 4 — Safe pilot operations and limited deployment
- Staging deploy, production-like browser/E2E, payment threat model, accessibility, upload limits, private ID storage, backups with restored copy.
- Establish admin verification queue, support inbox, abuse/moderation/dispute workflow and incident contacts.
- Pilot 5–10 testers, then expand incrementally to 80–100 students if gate measurements and quality are acceptable.
- Track creator activation, viewer retention, purchase conversion, subscription/refund support demand and streaming costs.

**Exit:** measured repeated usage and financially correct transactions; founder approves public paid release separately.

### Gate 5 — Social earning expansion
- More sophisticated communities, DM requests/negotiation, paid night classes and scheduling; build on existing locally tested foundations.
- Creator subscriptions, portfolios, shared project evidence, notifications, referrals (funded/capped).
- Consider sponsored creator programs and qualified-view rewards only when funding and anti-fraud are operational.

**Exit:** repeat engagement, creator earnings and sustainable margins.

### Gate 6 — Global expansion
- Country-specific institution verification; terms and data controls; locale/language; ISO 4217 pricing; tax and payment/currency quotes.
- International viewers only where PSP supports buyer collection. Add cross-border creator settlements one country at a time after payout approvals.
- Regional ops, fraud, legal and creator support must scale with monetization markets.

## Recommended initial technical stack

| Concern | Preferred starting implementation | Defer until needed |
|---|---|---|
| Frontend | Existing Next.js/React; TypeScript incrementally for new modules; responsive UI | Native Flutter app |
| Backend | Existing Node server domain modules and authorization; tested APIs | Multiple independently deployed microservices |
| Database | Current SQLite for controlled local tests; dedicated Supabase PostgreSQL for staged multiuser | Sharded SQL/analytics warehouse |
| Video | Direct-to-media-provider upload, transcode, signed playback, private entitlements | Own global transcoder/CDN |
| Payments | Licensed PSP sandbox and transparent fees/ledger | Own stored value wallet |
| Background work | Reliable queue for video statuses, notifications, payment retries | Massive event-stream infrastructure |
| Chat/classes | Existing messages -> hosted realtime; WebRTC provider for classes | Custom global realtime network |
| AI | Lightweight moderation/tagging assistance, optional accuracy flags | Own giant foundation model |
| Operations | CI, branch reviews, secrets, structured logs, backup restore, E2E | Enterprise multi-region contracts |

**Key skills to study:** TypeScript/Next.js, SQL isolation/RLS, web authorization, Node background jobs, video streaming/HLS/tus, secure payments/webhook idempotency, accounting ledgers, privacy threat modeling, basic analytics, Playwright/E2E, CI/CD and monitoring. AI helps write code/tests but never substitutes for verification.

## Early team and contributors

- Founder: product decisions, implementation, architecture, release approval and growth strategy.
- Developer collaborators: focused code modules, tests, review and implementation documentation. Assign principle of least privilege and avoid sharing production secrets.
- Student volunteers/friend(s): interview real users, test onboarding, upload watch flows, verify navigation, report bugs, recruit credible student creators with informed consent.
- Trusted reviewer as available: payment integration/security architecture, privacy and banking onboarding.
- Operations for live pilot: identity verification, content reports, refunds and support ownership. These are functions, not necessarily paid hires at day one.

## Suggested four-week *milestone plan*, not a deadline guarantee

- **Week 1:** repository audit, latest CI, feature map, 10–20 student interviews, confirm first campus and compliance boundaries.
- **Week 2:** creator feed + profiles + copyright/access rules + student verification, end-to-end user browser smoke.
- **Week 3:** pricing/entitlements and PSP sandbox ledger with negative and concurrent tests; secure paid media.
- **Week 4:** staged pilot readiness review, backup restore and mobile tests, controlled initial users and feedback.

If any gate fails, fix it before proceeding; don't report deployed merely because local tests pass.

## Data-driven 100-user pilot

Potential targets, to be validated rather than claimed: 80–100 verified users, 20 active creators, repeat publishing, repeated viewer watches, genuine voluntary payments where provider/compliance ready. Record support hours, cost per delivered minute, creator earnings per cohort, returning viewers, net platform revenue after payment/video fees, failed uploads, refund incidence and suspected fake referrals.

## Critical production tests

- Multi-tenant/institution permission leakage, owner-only publishing, ID privacy.
- Expired/suspended/blocked user denied paid/free content as specified; even via direct video URLs.
- Duplicate webhook/retries/concurrency produce exactly one entitlement, one ledger allocation.
- Correct price/currency handling, no free replay from frontend callback.
- Refund and chargeback revocation/compensating entries.
- Upload type/size validation, media scanning/transcode and resumable handling.
- DM and community anti-abuse, moderator roles, support audit.
- Backup restore into isolated environment and realistic slow Android data session.
- GitHub Actions unit/build, PostgreSQL RLS contracts, Playwright smoke and deployment health checks.

## Funding and partner approach

Do not require external investment to run a 100-user alpha. Track burn against actual delivered video minutes, service invoices and accepted provider conditions. YC or other venture accelerators may be future fundraising options **only if accepted**, not assumed funding or operating budget.

## Reusable provider resources

- https://supabase.com/docs/
- https://developers.cloudflare.com/stream/
- https://paystack.com/docs/
- https://docs.livekit.io/
- https://owasp.org/www-project-application-security-verification-standard/

**Release gate:** no real student-ID data, live payments or cross-border payouts without consent, lawful procedures, tested production-grade controls and explicit founder go-live approval.