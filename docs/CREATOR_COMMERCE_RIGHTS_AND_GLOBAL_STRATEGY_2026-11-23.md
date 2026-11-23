# Student Creators — monetization, content access and global-readiness research
**Date:** 2026-11-23 | **Status:** design proposal; pricing/commission/payout decisions unresolved; no production payments authorized.

## 1. Revenue model and order of implementation

**Primary monetization** is direct paid **access** to original creator-owned video/post content and approved services, not the sale of copyright. Nigerian pilot: free (₦0) or paid (minimum ₦200), creator sets price. Other potential streams: paid night classes, tutoring/explanations, paid communities or memberships, creator subscriptions, tips, sponsorship and later advertisement/qualified-view sharing. Do not activate optional streams as if already implemented.

| Stream | Buyer or funder | Creator entitlement | Business share | Proposed stage |
|---|---|---|---|---|
| Free video | No buyer fee | Views, engagement, portfolio | No direct commission | Launch |
| Paid video/access | Viewer | Contractual access for defined terms | Disclosed commission | First commercial release |
| Paid night class | Attendee | Session attendance | Disclosed fee | After stable core purchase flow |
| Approved tutoring/help | Student requesting guidance | Agreed scope/meeting/deliverable | Disclosed fee | After messaging and dispute controls |
| Creator membership | Recurring supporter | Plan-scoped access until cancellation/expiry | Disclosed fee | Later |
| Sponsorship or ads | Real advertiser | Qualified and funded revenue allocation | Agreed share | Measured pilot, later |
| Referral incentive | Platform's approved budget | Capped and fraud-checked reward | Expense, not revenue | Controlled acquisition pilot |

**Never promise a fixed amount per raw view.** YouTube shares eligible ad/fan-funding revenue; TikTok emphasizes qualified views and eligibility; skill/content platforms have subscriptions and direct sales. Actual watch counts are *analytics* until attributable funded revenue is validated. Research references:
- https://support.google.com/youtube/answer/72857
- https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program
- https://support.patreon.com/
- https://paystack.com/pricing
- https://developers.cloudflare.com/stream/pricing/

## 2. Proposed qualified-view monetization policy

Open video -> watch telemetry -> human/fraud/rate filters -> qualified view -> funding source (ad impression, sponsor campaign or funded pool) -> eligibility/revenue reconciliation -> creator allocation -> pending earnings -> settlement -> available balance -> payout.

Exclusions may include duplicate/inorganic playback, self-watching for rewards, bot traffic, suspicious device/account clusters and invalid sponsorship impressions. Use a documented, appealable policy with privacy protections. Reserve creator rewards only from **funded and reconciled** revenue, net of applicable costs. Do not use fictional views or unsponsored viewing to create cash liabilities.

Illustrative arithmetic (not promised CPM): sponsor funds ₦100,000; approved creator pool 50% = ₦50,000; 100,000 qualified sponsored views yields ₦500 per 1,000. Real rates will vary with sponsor terms and valid eligible traffic.

## 3. Ownership versus access

- Creator holds rights to their original work subject to applicable law, employment/school contracts and third-party rights.
- Creator grants platform limited revocable or contractually defined hosting, transcoding, preview and delivery rights necessary to operate the service.
- A paid viewer gets an **access entitlement** with clear identity, scope, duration, territory (if applicable), limits and refund consequences. It does not confer copyright, redistribution, download/source or sublicensing rights.
- Record ownership attestations, publish/moderation decisions, purchase price snapshots and audit trails.
- Keep paid storage/video access private. Short-lived signed playback tokens require live server authorization: valid student status, not suspended, content active, viewer not blocked under policy, and a valid free or paid entitlement.
- DRM/signed URLs/watermarks can deter copying; absolute screenshot/screen-recording prevention is not possible. Provide copyright notice/takedown, dispute and appeal workflows.
- If a creator blocks a buyer who has paid, apply a published rule governing cancellation, access revocation, refund or review; do not silently erase contractual purchase rights.

## 4. Account blocking and ban evasion

Creator may independently restrict: `VIEW`, `COMMENT`, `MESSAGE`, `FOLLOW` or `ALL` where applicable. Enforce on backend routes, query scopes, signed playback issue and private messaging authorization. Existing account-bound purchases do not automatically transfer to replacement accounts. Evaluate suspected evasion via verified student identity, moderation events, rate limits, duplicate-document checks and fair human review. Avoid asserting that a matching IP, campus Wi-Fi or device fingerprint proves the same person; use consent/legal basis and appeal procedures.

## 5. Transaction ledger and state machine

Order created (price + currency + creator commission terms snapshotted) -> provider checkout -> server confirms reference, amount, currency, environment, actual paid status and signature -> atomic idempotent update to order, entitlement, ledger and audit -> buyer access granted -> settlement and fraud checks -> creator pending / available -> eligible payout request -> provider transfer -> final confirmation/reconciliation.

Explicit failure paths: pending, canceled, underpaid, spoofed client callback, duplicate webhook, provider timeout, refund, chargeback, reversed transfer, blocked paid buyer, content removed, partially delivered class. A dashboard counter must never substitute for an append-only or balanced financial journal. Store monetary values in integer minor units (with currency-specific precision), not JS floating point.

For launch, integrate a licensed PSP for holding/settling funds rather than operating an unlicensed custodial wallet. Provider terms, KYC, eligibility and account/business registration must be verified. Paystack's Starter-vs-Registered transfer eligibility and app-store billing restrictions require separate decisions before production withdrawals/native purchases:
- https://paystack.com/docs/transfers/
- https://paystack.com/docs/payments/split-payments/
- https://support.google.com/googleplay/android-developer/answer/9858738

## 6. Initial cost and unit-economics research

Infrastructure cost is usage-dependent; no enterprise headcount or millions of video minutes required for first 80–100 students. **Example assumption:** 100 students × 15 minutes of viewing × 10 active days/month = 15,000 delivered video minutes. At published Cloudflare Stream list pricing of USD $1/1,000 delivered minutes, indicative *delivery* is $15/month. A 1,000-minute purchased storage capacity tier is approximately $5/month. This is not a full-service quote and excludes bandwidth elsewhere, live sessions, taxes, AI, PSP fees, support and engineering time.

For an illustrative ₦200 sale with a 15% hypothetical commission: platform gross ₦30, creator ₦170 before fee allocation; Paystack's published local 1.5% transaction fee (fixed ₦100 waived below ₦2,500 at the time researched) would be ₦3. This leaves ₦27 *before* streaming, hosting, support and other expenses. **The commission is not yet approved.**

Track: video delivered minutes and storage; payout expense; gateway cost; free viewing subsidized; gross merchandise value vs platform revenue; repeat creator publishing; converted paid views; verified refunds; cost to acquire a genuine user.

## 7. Optional referral program

Verified account receives a referral ID/link -> invited student registers -> identity verification -> anti-self-referral check -> genuine qualifying activity -> reward eligibility and budget cap -> non-cash credit/benefit or later approved cash reward -> fraud audit and clawback rules. Do not pay for raw signups, fake views or reciprocal bot circles. Start with capped non-cash incentives, document how users can claim and appeal.

## 8. Global currency and creator settlement

One shared platform with market-aware institution catalog, language, policies, verification and currency/payment configurations. Store content offer's native currency/amount, checkout currency, payment provider reference, charged amount, FX quote ID/rate/time, taxes, processing cost, creator settlement currency and credited amount. Price conversion must reflect an actual provider quote; changing only symbols is misleading.

**Separate international buyers from international creator payouts.** Phase 1 Nigeria creators and local buyers; phase 2 eligible international viewers for Nigerian creators; phase 3 country-by-country creators only when local verification, settlement, KYC, refund/tax and transfer corridors are proven. Do not declare worldwide payout support without provider approval.

## 9. Future investment feature is not an MVP requirement

Creator-set savings thresholds or explicitly authorized transfer instructions to regulated third-party investment providers are exploratory. No AI should autonomously debit creator accounts or trade securities absent independently reviewed legal/provider authorization and explicit user control. Keep this outside the pilot.

## Research and uncertainty boundary

This file is a product/engineering research handoff, not a price lock or legal opinion. Revalidate provider pricing, YouTube/TikTok rules, Nigerian data/privacy/copyright requirements, and permitted transaction types before deployment. Company commission, buy-access duration, paid-block policy, payout minimum and country launch sequence remain founder decisions.