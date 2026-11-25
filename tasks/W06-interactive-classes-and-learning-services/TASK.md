# Week 06 — Interactive classes and personalized student/creator learning services

**Owner/workstream:** Week 6 only. Branch: `work/week-06`. Canonical repository: `worthkind/Student-creator-`. Source coordination: Issue #34 and draft PR #46. No edits to Week 1/5 branches or main.

## Source review and reuse
- Reused original existing `packages/local-core/src/store.mjs`, `http.mjs`, verification/creator restrictions, `studySessions` scheduling conventions, SQLite transaction/audit system and `apps/web/lib/local-client.js`. Existing *study rounds* are preserved untouched.
- Reused the Week 5 **payment trust boundary**: a browser-supplied success flag, a content purchase, or a pending order **cannot** grant class/service access. New read-only interface required from Week 5: `paymentEntitlements.hasActiveEntitlement({buyerId,resourceKind:'class'|'service',resourceId})` returning true only for an ACTIVE, verified, unreversed service-specific entitlement. Week 6 now persists separate class/service test-mode orders, verified sandbox receipts and scoped entitlements, with balanced synthetic local journals. Paid join/start fail with HTTP 402 until a trusted test-mode provider confirmation exists. Hosted PostgreSQL settlement/payout wiring remains outside this local implementation.
- Week 1 has not shipped a complete compatible LiveKit runtime SDK in this branch. `livekit-class-tokens.mjs` uses original Node `crypto`-only JWT HS256 signatures with room scoping, 300s TTL and least-privilege grants. Tokens and an explicit browser WebRTC **connection implementation** now exist at `/classes/[classId]/room`, but this implementation has NOT been accepted against real two-client LiveKit streaming. A source/bundle or mocked SDK test is not real video streaming. Each reissued token has an independently randomized JWT ID; cancellation/finish durably queues room deletion, but provider deletion must be performed by a trusted Week 1 RoomService worker. A 5-minute previously minted token can still be presented until expiry absent provider-side removal; do not claim strict token revocation. Replace/adapt to Week 1's audited LiveKit SDK/room service when it is available; never ship this local-only runtime as production media.
- LiveKit upstream reference: [livekit/node-sdks](https://github.com/livekit/node-sdks), commit `e2a591213dd1223f6540e9ba3ade6182c8058388`, Apache-2.0 license; [LiveKit token/grant docs](https://docs.livekit.io/frontends/reference/tokens-grants/), and [room service](https://docs.livekit.io/reference/other/roomservice-api/). No upstream SDK source was copied; original Twirp and webhook crypto adapters now make external requests only when configured and invoked. The browser obtains pinned `livekit-client@2.25.0` UMD from jsDelivr on demand; CDN integrity/vendoring review is still required before production. Crypto implementation and tests are original.
- Existing repo has local SQLite dev data and draft hosted PostgreSQL migrations. Week 6 local writes use the existing transaction/audit system. New `db/migrations/0010_week06_interactive_learning.sql` and `0011_week06_learning_money_and_notifications.sql` are **proposals** with default-deny RLS; they are tested only on disposable PostgreSQL CI, not applied to hosted staging.

## Implemented source and API paths

**Server domain:** `packages/local-core/src/learning-services.mjs`; token issuer: `src/livekit-class-tokens.mjs`; registration in `store.mjs`; routes under existing `/api/local/*` in `http.mjs`.

| Flow | API (all authenticated and verified) | Security |
| --- | --- | --- |
| Create/discover class | `POST/GET courses/:id/classes`, `GET classes/:id`, `GET me/classes` | Same campus, verified host, creator view restrictions, server-computed price in integer NGN kobo, idempotent creation |
| Enroll/withdraw | `POST classes/:id/enroll` and `.../withdraw` | Capacity counted atomically, duplicate-safe; paid enrollment does not unlock room |
| Room lifecycle | `POST classes/:id/open`, `.../finish`, `.../cancel` | Host-only; strict schedule window; cancelled/completed class cannot issue fresh tokens |
| Authorized LiveKit grant | `POST classes/:id/room-token` | Fresh role/session/creator/paid-entitlement checks; host can publish, participant subscribe-only; 300s token. Reconnection repeats server check |
| Verified attendance | Trusted `recordVerifiedPresence` store method, `GET classes/:id/attendance` host-only | LiveKit-authenticated raw-body signed webhook receipt available at `POST livekit/webhook`; browser cannot self-report attendance; real provider acceptance remains pending |
| Availability | `POST me/creator-availability`, `GET creators/:id/availability` | Verified creator owns updates, safe schedule and cross-campus/message restriction checks |
| Personalized requests | `POST learning-requests`, `GET me/learning-requests`, `GET learning-requests/:id` | Safe tutoring, explanation, project guidance only; request idempotency, consent, prohibited submission-language filtering |
| Quote/accept | `POST learning-requests/:id/quote`, `.../accept`, `.../reject` | Creator only quotes/rejects; requester accepts *exact* quoted amount. No fabricated service tier or commission |
| Work progress | `POST learning-requests/:id/start`, `.../submit`, `.../confirm`, `.../cancel` | Creator starts/submits, requester confirms; paid start requires verified Week 5 service entitlement |
| Dispute/refund | `POST learning-requests/:id/dispute`, admin `GET admin/learning-disputes`, `POST admin/learning-disputes/:id/resolve`, `GET admin/learning-refund-reviews` | Durable cases and audit; REFUND REVIEW ONLY, never processor actions/ledger mutation |
| Notifications | `GET me/learning-notifications`, `POST learning-notifications/:id/read`, admin `POST admin/learning-reminders/queue` | Recipient only; durable in-app outbox, verified-email opt-in Resend transport with idempotent retry; no real sending observed |

**Web UX:** `/classes` and `/learning-help` pages, plus creator-profile tutoring entry point and primary navigation. These pages use the actual local APIs, not mock arrays or fake enrollment/earnings.

## Verification

- Targeted synthetic integration tests: `packages/local-core/test/learning-services.test.mjs` (6+ full-scenario tests including cross-campus, role spoofing, cancellation, schedule conflict, grant signing, and paid reversal); ongoing extensions required for Week 1 provider verification.
- Hosted persistence *draft* tested only in disposable PostgreSQL: `db/tests/week06_interactive_learning.sql`; checks same-campus verified viewing, cross-account privacy and browser denial of payment/attendance/entitlement writes. The migration must undergo Week 1 independent hosted RLS review and coordination before staging deployment.
- Commands: `npm test`; `npm ci --prefix apps/web && npm run build --prefix apps/web`; GitHub Actions `database-contract`, `browser-alpha`, `browser-paid-media` (PR run).
- **Hard gate:** Five exact-PR-head jobs must pass. A green SDK token-unit test is NOT a real LiveKit stream or reconnect test.

## Outstanding release/integration gates (do NOT mark complete)

- [ ] LiveKit service signing secret in approved staging, two-client authenticated audio/video publish/subscribe and real reconnect/participant removal tests. Twirp create/delete room, signed webhook and browser client source now implemented, NOT verified against a live provider.
- [ ] Real LiveKit join between two physical or independently controlled clients (one host, one learner), real Android low-bandwidth behavior, expired token and canceled-session checks at provider.
- [ ] Week 5 hosted immutable checkout and operational reconciliation review. Week 6 now implements local test-mode class/service orders, Paystack verify, scoped entitlements, balanced journals, signed webhook inbox, and synthetic reversal; NO real payment or automatic refunds.
- [ ] Real hosted Supabase migration after approved overlap check, API implementation using Auth/tenant RLS and isolated backup restore; local SQLite is not suitable for serverless Vercel hosting.
- [ ] Hosted notification worker deployment and verified-domain Resend acceptance. Source now includes consent-gated verified-email Resend adapter, admin delivery and durable retry, only with mocked provider tests; NO real sends.
- [ ] Founder/legal approval of cancellation/refund policies and academic integrity reporting. No paid tiers, commissions, or refunds invented.
- [ ] Independent permissions/security and frontend mobile accessibility/browser acceptance; no launch, no real enrollment or money.

## Honest status

**Local Week 6 workflows and role checks are executable and synthetic-testable; provider-backed real-time streaming and financial fulfillment are NOT proven.** A scheduled class / issued JWT is not a functioning live class. Do not merge or release without independent PR review and the cross-week handoffs above.

## 24 Nov 2026 independent hardening checkpoint

- Added `learning_room_closures` durable queue and admin-only `drainRoomClosures()` with provider deletion retries and audit; no provider call occurs in tests except a locally injected synthetic mock.
- Rechecks service entitlements at work submission as well as start. Creator blocking / reversal / reconnect and canceled room tests added, without claiming already-issued LiveKit token revocation.
- Hosted `creator_availability` RLS deliberately restricts direct browser reads to **the creator's own slots**. An earlier wider SELECT policy attempted to join a different student's RLS-private profile; disposable Postgres tests detected its denial. Cross-student availability remains a server API concern with campus/message-block checks.
- Explicit `work/week-06` branch-push CI trigger was added because the unmerged PR is currently **merge-conflicted with `main`**, which suppresses PR synchronize workflow runs. Keep draft PR unmerged for coordinator to resolve conflicts and review Week 1/5 overlap.
- LiveKit original signed raw-body HS256 webhook verification and synthetic provider attendance were added and tested. A real provider webhook, camera/mic stream, network reconnect and token revocation remain unverified. Never trust browser-supplied presence.

## Week 06 provider-ready but not tester-ready integration checkpoint

**New source modules:**
- `packages/local-core/src/livekit-room-service.mjs`: server-side LiveKit Twirp create/delete/remove participant, bounded timeout, restricted host, HMAC JWT + exact raw webhook SHA256 signature; never exposes provider key.
- `apps/web/app/classes/[classId]/room/page.jsx`: real LiveKit `Room.connect`, host camera/microphone/screen-share controls, remote playback, reconnection state and fresh scoped backend authorization.
- `packages/local-core/src/learning-payments.mjs`: transactionally persisted sandbox orders, resource-scoped entitlements, Paystack test verification, signed webhook inbox, balanced journal, late-payment review, synthetic refund/chargeback. NO real merchant charges.
- `packages/local-core/src/learning-email.mjs`: verified-email opt-in, consent-aware durable retries, Resend API transport with stable provider idempotency key. No human email was sent.
- `apps/web/app/learning-payments/page.jsx`: real API-backed sandbox purchase history, checkout and verification flow.
- `db/migrations/0011_week06_learning_money_and_notifications.sql`: proposed hosted finance/email tables with deny-by-default RLS and row-deferred double-entry balance check.

**Tester gate (not yet met):** before asking another human to test, founder-approved dedicated hosting must provide valid `LIVEKIT_API_SECRET` (distinct from `livekit_sip`), working Week 1 Supabase Auth/API and isolated additive migration approval, test-mode Paystack configuration (not `sk_live_`), plus two consented verified accounts for one host and one learner. Then independently verify separate-browser connections, camera/mic tracks, low-bandwidth Android, reconnect, removal after cancellation, forged attendance denial, test-only paid access, cancellation/refund reviews, accessibility and email preference behavior. Do not count passing CI as remote streaming acceptance.

**Environment observations (key names only, no secrets):** Vercel project `student-creator` has lowercase `livekit_apikey`, `livekit_project_url`, and `livekit_sip` but no recognizable LiveKit API signing-secret variable. `getLocalStore()` refuses Vercel/serverless, so a preview deployment of this SQLite implementation is not a usable hosted tester environment. Current Supabase `jnkqmlbkkvccnxrgkpno` has main student/commerce tables, but Week 6 tables are not hosted. Do NOT send real invitations or bypass this gate.


## 25 Nov 2026 — latest Week 6 lifecycle hardening

Additional **implemented on `work/week-06`**:
- Browser CI tests now open a synthetic local classroom through trusted test setup, while asserting the **production HTTP route returns 503** when no LiveKit provider is configured. The fake WebRTC client, room-token responses, and provider attendance are explicitly marked **mocked**; this is not an actual video-stream acceptance result.
- A class host may remove a participant for a documented reason via `POST /api/local/classes/:id/remove-participant`; it atomically revokes enrollment, creates a paid-case financial review (not an automatic refund), and persists `learning_participant_removals`. When LiveKit is configured, the server calls `RemoveParticipant` with a `revokeTokenTs` cutoff to prevent the old signed token rejoining; provider failures leave a durable admin-retry job. Host UI shows signed-provider attendance and offers removal, never a browser-forged attendance marker. The proposed hosted schema makes the removal queue **service_role only**.
- A trusted admin may run `POST /api/local/admin/learning-classes/expire` to close class sessions whose end times have passed, queue provider room deletion, and request financial review for unstarted paid sessions. This is currently **an administrative operation, not a deployed recurring scheduler or service-level guarantee**.
- Signed late participant webhooks for already cancelled/completed rooms are acknowledged but ignored, preventing infinite LiveKit retries and preserving attendance integrity; unsigned deliveries are still rejected.
- Synthetic Node integration and isolated browser tests cover eviction, duplicate/late signed events, provider removal retries, paid refund-review coordination, forced expiry, and participant/host media permission UI. No third-party human has been invited.

**Remaining external acceptance:** dedicated hosted Supabase Auth/API integration from Week 1, approved hosted Week 6 migrations, LiveKit API signing secret and dedicated LiveKit test room, test-mode Paystack provider verification, and two consented verified tester accounts on separate real clients. **Do not solicit a human streaming test or claim completion before a fully running hosted staging site with secure credentials exists.** Test payment and cancel/refund with sandbox-only instruments, not live money. Keep PR #46 draft and reconcile merge conflict without overwriting other Week branches.
