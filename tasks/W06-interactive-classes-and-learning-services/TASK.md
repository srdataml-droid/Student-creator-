# Week 06 — Interactive classes and personalized student/creator learning services

**Owner/workstream:** Week 6 only. Branch: `work/week-06`. Canonical repository: `worthkind/Student-creator-`. Source coordination: Issue #34 and draft PR #46. No edits to Week 1/5 branches or main.

## Source review and reuse
- Reused original existing `packages/local-core/src/store.mjs`, `http.mjs`, verification/creator restrictions, `studySessions` scheduling conventions, SQLite transaction/audit system and `apps/web/lib/local-client.js`. Existing *study rounds* are preserved untouched.
- Reused the Week 5 **payment trust boundary**: a browser-supplied success flag, a content purchase, or a pending order **cannot** grant class/service access. New read-only interface required from Week 5: `paymentEntitlements.hasActiveEntitlement({buyerId,resourceKind:'class'|'service',resourceId})` returning true only for an ACTIVE, verified, unreversed service-specific entitlement. Until passed by trusted server code, paid class join and paid service start fail with HTTP 402. This is not full Week 5 order/payout wiring.
- Week 1 has not shipped a complete compatible LiveKit runtime SDK in this branch. `livekit-class-tokens.mjs` uses original Node `crypto`-only JWT HS256 signatures with room scoping, 300s TTL and least-privilege grants. This **does not connect a browser WebRTC session**. Each reissued token has an independently randomized JWT ID; cancellation/finish durably queues room deletion, but provider deletion must be performed by a trusted Week 1 RoomService worker. A 5-minute previously minted token can still be presented until expiry absent provider-side removal; do not claim strict token revocation. Replace/adapt to Week 1's audited LiveKit SDK/room service when it is available; never ship this local-only runtime as production media.
- LiveKit upstream reference: [livekit/node-sdks](https://github.com/livekit/node-sdks), commit `e2a591213dd1223f6540e9ba3ade6182c8058388`, Apache-2.0 license; [LiveKit token/grant docs](https://docs.livekit.io/frontends/reference/tokens-grants/), and [room service](https://docs.livekit.io/reference/other/roomservice-api/). No upstream source or package imported, installed or executed; no dependency/telemetry or external provider network requests were introduced. Crypto implementation and tests are original.
- Existing repo has local SQLite dev data and draft hosted PostgreSQL migrations. Week 6 local writes use the existing transaction/audit system. New `db/migrations/0010_week06_interactive_learning.sql` is a **proposal** with default-deny RLS; it is only tested on disposable PostgreSQL CI, not applied to hosted staging.

## Implemented source and API paths

**Server domain:** `packages/local-core/src/learning-services.mjs`; token issuer: `src/livekit-class-tokens.mjs`; registration in `store.mjs`; routes under existing `/api/local/*` in `http.mjs`.

| Flow | API (all authenticated and verified) | Security |
| --- | --- | --- |
| Create/discover class | `POST/GET courses/:id/classes`, `GET classes/:id`, `GET me/classes` | Same campus, verified host, creator view restrictions, server-computed price in integer NGN kobo, idempotent creation |
| Enroll/withdraw | `POST classes/:id/enroll` and `.../withdraw` | Capacity counted atomically, duplicate-safe; paid enrollment does not unlock room |
| Room lifecycle | `POST classes/:id/open`, `.../finish`, `.../cancel` | Host-only; strict schedule window; cancelled/completed class cannot issue fresh tokens |
| Authorized LiveKit grant | `POST classes/:id/room-token` | Fresh role/session/creator/paid-entitlement checks; host can publish, participant subscribe-only; 300s token. Reconnection repeats server check |
| Verified attendance | Trusted `recordVerifiedPresence` store method, `GET classes/:id/attendance` host-only | Signed provider webhook verifier must be injected; there is intentionally NO browser endpoint to self-report attendance |
| Availability | `POST me/creator-availability`, `GET creators/:id/availability` | Verified creator owns updates, safe schedule and cross-campus/message restriction checks |
| Personalized requests | `POST learning-requests`, `GET me/learning-requests`, `GET learning-requests/:id` | Safe tutoring, explanation, project guidance only; request idempotency, consent, prohibited submission-language filtering |
| Quote/accept | `POST learning-requests/:id/quote`, `.../accept`, `.../reject` | Creator only quotes/rejects; requester accepts *exact* quoted amount. No fabricated service tier or commission |
| Work progress | `POST learning-requests/:id/start`, `.../submit`, `.../confirm`, `.../cancel` | Creator starts/submits, requester confirms; paid start requires verified Week 5 service entitlement |
| Dispute/refund | `POST learning-requests/:id/dispute`, admin `GET admin/learning-disputes`, `POST admin/learning-disputes/:id/resolve`, `GET admin/learning-refund-reviews` | Durable cases and audit; REFUND REVIEW ONLY, never processor actions/ledger mutation |
| Notifications | `GET me/learning-notifications`, `POST learning-notifications/:id/read`, admin `POST admin/learning-reminders/queue` | Recipient only; durable local outbox, no fabricated email/push delivery |

**Web UX:** `/classes` and `/learning-help` pages, plus creator-profile tutoring entry point and primary navigation. These pages use the actual local APIs, not mock arrays or fake enrollment/earnings.

## Verification

- Targeted synthetic integration tests: `packages/local-core/test/learning-services.test.mjs` (3 full-scenario tests, including cross-campus, role spoofing, cancellation, bogus prices, grant signing and logout); ongoing extensions required for Week 1 provider verification.
- Hosted persistence *draft* tested only in disposable PostgreSQL: `db/tests/week06_interactive_learning.sql`; checks same-campus verified viewing, cross-account privacy and browser denial of payment/attendance/entitlement writes. The migration must undergo Week 1 independent hosted RLS review and coordination before staging deployment.
- Commands: `npm test`; `npm ci --prefix apps/web && npm run build --prefix apps/web`; GitHub Actions `database-contract`, `browser-alpha`, `browser-paid-media` (PR run).
- **Hard gate:** Five exact-PR-head jobs must pass. A green SDK token-unit test is NOT a real LiveKit stream or reconnect test.

## Outstanding release/integration gates (do NOT mark complete)

- [ ] Week 1 LiveKit provider keys and real room lifecycle integration: create/delete room, audio/video track publish/subscribe, reconnect after network interruption, participant removal/token revocation, signed webhook verification, remote attendance and room-suspension test.
- [ ] Real LiveKit join between two physical or independently controlled clients (one host, one learner), real Android low-bandwidth behavior, expired token and canceled-session checks at provider.
- [ ] Week 5 paid-class/service purchase orders, Paystack sandbox verification, balanced ledger and LIVE entitlements with exact kind/resource claims, refund and payout approval workflows; no browser flags.
- [ ] Real hosted Supabase migration after approved overlap check, API implementation using Auth/tenant RLS and isolated backup restore; local SQLite is not suitable for serverless Vercel hosting.
- [ ] Notification delivery via configured Resend/push system with consent and retry; existing local outbox is not a delivery provider.
- [ ] Founder/legal approval of cancellation/refund policies and academic integrity reporting. No paid tiers, commissions, or refunds invented.
- [ ] Independent permissions/security and frontend mobile accessibility/browser acceptance; no launch, no real enrollment or money.

## Honest status

**Local Week 6 workflows and role checks are executable and synthetic-testable; provider-backed real-time streaming and financial fulfillment are NOT proven.** A scheduled class / issued JWT is not a functioning live class. Do not merge or release without independent PR review and the cross-week handoffs above.

## 24 Nov 2026 independent hardening checkpoint

- Added `learning_room_closures` durable queue and admin-only `drainRoomClosures()` with provider deletion retries and audit; no provider call occurs in tests except a locally injected synthetic mock.
- Rechecks service entitlements at work submission as well as start. Creator blocking / reversal / reconnect and canceled room tests added, without claiming already-issued LiveKit token revocation.
- Hosted `creator_availability` RLS deliberately restricts direct browser reads to **the creator's own slots**. An earlier wider SELECT policy attempted to join a different student's RLS-private profile; disposable Postgres tests detected its denial. Cross-student availability remains a server API concern with campus/message-block checks.
- Explicit `work/week-06` branch-push CI trigger was added because the unmerged PR is currently **merge-conflicted with `main`**, which suppresses PR synchronize workflow runs. Keep draft PR unmerged for coordinator to resolve conflicts and review Week 1/5 overlap.
- Encrypted LiveKit webhook verification and real capture/stream tests are still not performed; use the official LiveKit `WebhookReceiver` with **raw body and signed JWT sha256 claim** when Week 1 integrates. Never trust a browser-supplied `presence` event.
