# Student Creators — System Architecture, C4 Views and Deployment Boundaries

**Version:** Architecture baseline v0.1, 23 November 2026
**Repository/branch:** srdataml-droid/Student-creator- / main ONLY.
**Scope:** Student Creators Platform (one project; Worthkind umbrella). **Status:** architecture specification, not deployed infrastructure or verified production implementation.
**Authority:** docs/PRODUCT_SCOPE.md, docs/CREATOR_FIRST_PRODUCT_BLUEPRINT_2026-11-23.md, docs/CONTENT_ACCESS_COPYRIGHT_BLOCKING_2026-11-23.md, actual README/source on main. Do not replace the creator-first feed with a school LMS.

## 0. Verified current state vs proposed architecture

| Concern | Observed in current main code/docs | Target / not yet proven |
|---|---|---|
| App | Next.js 16 / React 19 web app in apps/web, server-side main feed | Phone bottom navigation, tablet drawer, desktop top nav refined and device-tested |
| Local backend | Node 22+ local-core with SQLite persisted on one machine | Hosted Postgres/Auth with strict server and RLS authorization |
| Feed | apps/web/app/page.jsx composes courses/lessons; FeedExperience.jsx renders social posts | Content-first discovery beyond course categories, scalable feed and ranking |
| Media | local MP4, source URL /api/local/lessons/{id}/video rendered by video element, 25 MiB dev limit | Private upload/processing, signed permissioned playback, adaptive bitrate, CDN and data-saving |
| Social | Follows, likes, comments, bookmarking, profiles, course communities, DMs described in progress | Hosted identities, robust privacy, safe event delivery, anti-abuse moderation |
| Payments | packages/payment-core/src/payments.mjs and paystack-client.mjs contain isolated validation/client primitives | PSP sandbox checkout, reconciled orders, idempotent atomic entitlements, ledger, refunds, eligibility-gated payouts |
| Deploy | README states not publicly deployed; local SQLite disabled on stateless hosting | Staging with managed services, performance/security/restore tests and gradual pilot |
| AI | No verified ranking-model production system | Simple rule ranking at MVP; eval-driven recommendations/moderation later |

**Critical gap:** today's local video URL approach is appropriate only for approved free development content. DO NOT make that URL or its static sibling publicly accessible for paid media; authenticated server authorization followed by expiring media tokens is needed before paid-content launch.

## 1. Nonnegotiable domain rules
1. A verified student is a creator and a viewer with the same account, and may have multiple permissible content interests.
2. Creator owns copyright to original works they have the legal rights to publish; a buyer purchases limited ACCESS, not ownership or source code/media.
3. Public preview != full protected playback; viewer eligibility, creator block, moderation, territorial policy and paid entitlement all require server-side checks.
4. Student ID/private legal identity cannot appear on public profiles or be available to ordinary volunteers.
5. Paid orders are verified by trusted PSP evidence and recorded exactly once; balances derive from auditable ledger records, not view counts.
6. Campus relevance improves search/discovery but should not fence off legitimate public creator content.
7. Each release must have a reproducible test/CI result and real-device evidence for important flows.

## 2. C4 — System context (users + external services)
~~~mermaid
flowchart TD
  Student["Verified student: viewer + creator"] -->|watch, upload, interact, pay| Platform["Student Creators Platform"]
  Visitor["Visitor / potential student"] -->|public previews + signup| Platform
  CreatorTester["Opt-in student creator tester"] -->|upload tests and UX feedback, no special privileges| Platform
  Mod["Moderator / student verification reviewer"] -->|moderation, verify, appeals| Platform
  Support["Support + finance operator"] -->|refund/dispute/ledger investigation| Platform
  Founder["Founder, product and engineering owner"] -->|policies, releases, audit| Platform

  Platform -->|charge / verified webhook / payout if eligible| PSP["Licensed payment service provider"]
  Platform -->|protected upload / encode / playback| Video["Managed video/streaming service"]
  Platform -->|email and notifications| Notify["Messaging delivery provider"]
  Platform -->|DB/Auth/Storage| Data["Managed PostgreSQL and Auth (target)"]
  Platform -->|opt-in analytics / incidents| Telemetry["Monitoring and analytics provider"]
  Platform -.->|future scheduled live class| Live["Real-time live-session provider"]
~~~

No external service above has been asserted connected or approved for production.

## 3. C4 — Target container view (logical components; one deployable backend at first)
~~~mermaid
flowchart LR
  Web["Web/PWA: Next.js React"] --> API["Server API / auth boundary"]
  Admin["Moderator + ops console"] --> API
  API --> Identity["Student identity + verification module"]
  API --> Creator["Creator profiles + portfolio module"]
  API --> Content["Content + media metadata module"]
  API --> Social["Feed, follow, comment, block module"]
  API --> Communities["Messages, groups, classes module"]
  API --> Entitlement["Entitlement / playback authorizer"]
  API --> Commerce["Order + PSP adapter"]
  API --> Finance["Ledger / settlement + disputes"]
  API --> Safety["Moderation, appeals, reports"]
  Identity --> DB[("Managed PostgreSQL")]
  Creator --> DB
  Content --> DB
  Social --> DB
  Communities --> DB
  Entitlement --> DB
  Commerce --> DB
  Finance --> DB
  Safety --> DB
  Content --> Media["Video upload, transcode + CDN"]
  Entitlement --> Media
  Commerce --> Payment["PSP"]
  Finance --> Payment
  API --> Jobs["Durable jobs / scheduled reconciliation"]
  Jobs --> DB
  API --> Analytics["Event and ops telemetry"]
~~~

These boxes represent **logical modules**. At 80–100 students do NOT create 10 microservices, separate teams, dedicated Kubernetes or a custom video network. Extract independent services only when load/failure/organizational evidence justifies it.

### In-process feature infrastructure

Implement these boundaries as a **modular monolith**, not independently deployed services and not dynamically loaded third-party code. Each feature/domain package owns its rules and public contracts; infrastructure packages provide adapters for Supabase, Mux, Paystack, LiveKit and messaging. Compose adapters at the application/API edge and inject narrow ports into feature handlers. A domain package must not import provider implementations or another feature's private `src` files. Cross-feature changes use explicit contracts and must preserve callers or version the contract deliberately. Enforce the import graph with automated source-boundary tests. New provider integrations must be replaceable adapters, never provider calls embedded in UI or domain rules. `platform-core` owns generic transport primitives; the existing LiveKit room and token implementation now lives in `livekit-provider`; `local-core` retains compatibility re-exports while hosted routes import the provider boundary directly.

Current implementation evidence: `packages/content-core/src/supabase-draft-store.mjs`, `submission-api.mjs` and `moderation-api.mjs` now receive auth through injection from the web API composition edge instead of importing `hosted-core`. `packages/livekit-provider` isolates LiveKit token and room-service code from local and hosted runtime packages. These changes establish the pattern for other cross-package dependencies; they do not claim all package boundaries are already clean.

## 4. Module boundaries and data ownership

| Module | Responsible for | Must NOT do |
|---|---|---|
| Identity | auth, verification status, private ID evidence lifecycle, roles and account sanctions | Expose student cards to feed, volunteers or creator APIs |
| Profiles/portfolio | public alias, bio, allowed published work, skill/contribution record | Infer identity from legal verification data |
| Creator/content | rights attestation, post draft/review/publish, pricing terms references, media status | Accept client-only approval of paid access |
| Social/discovery | follow, like, comment, search, feed, creator blocks | Publish restricted/private media URLs |
| Communities/classes | scope, membership, DM permissions, sessions, attendance | Treat a paid booking as live class authorization without entitlement |
| Authorization/entitlements | resolve access grants, block precedence, paid licenses, expiry, revoke/refund | Derive access solely from browser redirect, query param or cached feed |
| Orders/PSP | locked price quote, provider request, signed webhook validation, order state | Credit money merely because PSP initiation returned OK |
| Ledger/payout | balanced journal, creator/platform allocation, reconciliation, available/pending earnings, payout reservation | Treat analytics or estimated earnings as bank balance |
| Moderation/support | reports, rights claims, admin review, abuse enforcement, creator block disputes | Permit unlogged direct access to private identity data |
| Telemetry/ops | feature and platform metrics, errors, alerts, incident runbooks | Log ID documents, private messages or PSP secrets |

## 5. Existing repository mapping (verified through source and docs)
- apps/web/app/page.jsx: current home/feed aggregation. apps/web/app/FeedExperience.jsx: feed UI, video element and social actions.
- apps/web/app/creators/[creatorId] (per README/progress): creator public profile.
- packages/local-core: local SQLite sessions, lessons, verification, moderation, media and social features (per repo docs).
- packages/payment-core/src/payments.mjs: NGN price-floor validation, sample quote math and **legacy** webhook HMAC verifier (not yet complete public PSP flow).
- packages/payment-core/src/paystack-client.mjs: server-only PSP adapter; its comment explicitly says caller must persist orders and atomically fulfill entitlements.
- db/migrations/0001_proposed_core.sql and later social migrations: future PostgreSQL drafts, not confirmed applied in hosted DB.
- .github/workflows/ci.yml: tests, Next build, ephemeral PostgreSQL contract. Past CI success is not current-commit proof.

### Technology / build decisions
- **Keep the existing JavaScript/Next.js and Node 22 application.** New TypeScript can be adopted incrementally; no rewrite only to change language.
- Local SQLite remains a development/rollback adapter. Hosted multi-user pilot requires a verified dedicated PostgreSQL/Supabase setup and permission tests.
- Use an established video provider for secured media; compare its actual delivery, signed token, upload and data-efficient playback terms before selecting.
- Use a licensed PSP's sandbox and provider-approved business structure for paid access and payouts.
- Start with deterministic feed rules and basic measurement. No GPU or custom ranking model for the first 100 users.

## 6. Deployment, trust and reliability boundaries
Development: local Node + SQLite + test media; synthetic/test payments only.
Staging: private hosted environment, dedicated PostgreSQL/Auth with RLS + isolated payment sandbox and test video provider + user-consent test data. Real browser/device paths must pass.
Pilot production: creator privacy/content policies, PSP approval if live billing, legal/privacy review, secure media, monitoring, backup/restore rehearsal, incident support and controlled access.
Growth/global: country-currency pricing/FX/PSP routing, jurisdictional rights, qualified-view revenue, global creator payout only if explicitly supported.

Trust boundaries:
- Browser is untrusted; never accept content owner, price, verification, roles or entitlement solely from frontend fields.
- PSP webhook source verification is necessary but insufficient: lookup/reference/amount/currency/environment/status also must match a durable order.
- Raw student ID evidence and bank credentials are sensitive, separately authorized and minimized.
- Media URLs for paid assets must not be permanent public files.
- Creator block must be evaluated on every new access token grant; already-issued tokens require carefully bounded lifetime and revocation policy.

## 7. How to keep architecture current
Before implementing a feature: identify desired user result, module owner, API/data contract, risk cases, tests, and whether current implementation differs.
After a change: update this map only when implementation actually changes, record exact commit + CI/build + staging + security results, and do not claim planned diagrams represent deployed infrastructure.
