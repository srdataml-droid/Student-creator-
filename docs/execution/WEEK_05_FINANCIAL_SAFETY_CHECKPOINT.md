# Week 5 — financial systems checkpoint (2026-11-24)

Assigned branch: `work/week-05`. Canonical repo: `worthkind/Student-creator-`. Related issues #11 and #34. This is a partial implementation checkpoint, not a release or financial certification.

## Source baseline and preserved implementation
- Branch baseline `43669d57440a056416f4827d3e4858000b8af024`; main observed `582c9597004302a9fd0945fcb8fea05041b25782`. The branch diverged by one workspace commit and was seven commits behind main at review; do not merge unrelated work or overwrite Week 1/3/6 changes.
- Inspected the research-branch AGENTS.md, issue #34 and recent comments, issue #11, architecture money/access contracts, payment-media evidence, payment-core, local commerce call sites and staged PostgreSQL money tables. Retain the existing local SQLite commerce engine and Paystack adapter; do not introduce a duplicate runtime.
- Previous workstream evidence describes immutable local orders, signed inbox/recovery, atomic local SQLite receipt/entitlement/journal/audit, duplicate transactions, synthetic reversals and access revocation. This turn has not rerun that complete local app or browser suite. Hosted PostgreSQL staging has orders/attempts/entitlements/ledger tables, not a proven atomic hosted checkout path. Issue #34 remains open.

## Changes
1. `aa1e2a805b9f2ca724e67ba602133d705a04252b`: remove illustrative default 1,000 bps from `quoteLessonPurchase`. Existing local sandbox call explicitly supplies zero; paid order verification rejects below-minimum/zero amount and blank buyer email, and legacy signed webhook decoding rejects array data.
2. `6f2f9c439d9ec7e8f45800ee60973233af1ecb7e`: new live checkout requires server-only `livePaymentsApproved === true` **and** private runtime `PAYSTACK_LIVE_PAYMENTS_ENABLED=1`. No live flag set. Gate is checked per initialization so disabling the flag stops new initialization, while read-only verification of prior charges can continue. The existing production route remains disabled; adapter gate does not establish live app readiness. Fresh checkout URL validation rejects userinfo and nonstandard ports. Week 3 PR #44 separately owns cached URL validation; coordinate to avoid divergence.

## Independently reproducible evidence
Node v22.16.0 in disposable local container. Original payment source/test blobs matched GitHub's exact SHA; all four changed file blobs in the two commits matched the files tested locally. Two test files plus their existing dependencies only:
```sh
node --test packages/payment-core/test/payments.test.mjs packages/payment-core/test/paystack-client.test.mjs
```
- Commission/verification regression: baseline 16/16; after adding four negative tests, 16 pass and 4 fail before fix; 20/20 after fix.
- Gateway gate/URL regression: combined suite 32/32 before new tests; 33 pass, 2 fail before fix; **35/35 after fix**, zero skipped.
- Every gateway call in these tests uses a mock transport. Fake live-domain fixtures are not provider calls. No Paystack request, transaction, refund, payout, live flag, deployment or database mutation performed by Week 5.
- Full repository Node/build/browser/PostgreSQL suite and real test-domain provider verification are NOT rerun in this checkpoint.

## Remaining acceptance, ownership and dependencies
| Area | Current evidence / remaining gate |
|---|---|
| Free access and paid purchasing | Existing local flow; run full browser and hosted authorization/checkout. |
| Orders, server pricing/reference, payment/entitlement atomicity | Existing local implementation; hosted immutable snapshot, server verification and row-lock/transaction implementation and concurrency tests required. |
| Signed inbox, duplicate webhooks, recovery | Existing local signed inbox and lease recovery; real sandbox webhook, scheduler and hosted retry/reconciliation not verified. |
| Creator earnings and transaction history | Local ledger-derived pending earnings; hosted balanced append-only postings, settlement and receipt projection required. Never double-count compatibility journal. |
| Commission | Explicit input only, sandbox zero unchanged; no production fee or fee bearer approved. |
| Refunds, disputes, chargebacks, revocation | Local synthetic compensation and revocation; provider-verified reversals, hosted accounting and access checks remain. |
| Payout eligibility/approval | Disabled; implement approved policy + reserve/approval/reconciliation; do not invent thresholds, eligibility, splits or enable transfer. |
| Customer receipts and financial administration | Existing purchase history and support dispute handling; formal buyer-scoped receipts, staff-scoped review and audit workflow remain. |
| Live payment release | Adapter gate added, production integration and founder/legal/PSP/security approval still required; no real charges. |
| Week 1 | Coordinate dedicated Supabase staging and migration numbering, service-only auth, actual test credentials, env-name mapping, private storage; do not apply money DDL in parallel without coordination. |
| Week 3 | Use verified entitlement only for protected playback; environment separation, immediate revocation, cached checkout URL validation. |
| Week 6 | Paid services use same verified payment/journal contracts; no new price tiers or commission. |

## Provider and distribution review (2026-11-24)
- Paystack official webhook guidance: https://paystack.com/docs/payments/webhooks/ . Use raw bytes and timestamped signing secret, 300-second freshness and constant-time HMAC verification; legacy signature exists for integrations without new signing secret. Do not silently enable fallback or treat signed webhook as fulfillment. Use durable inbox before acknowledgement, server verification and atomic accounting. https://paystack.com/docs/payments/verify-payments/
- Google Play Payments: https://support.google.com/googleplay/android-developer/answer/9858738 and https://support.google.com/googleplay/android-developer/answer/10281818 . Paid videos and digital access sold inside a Play-distributed app generally require Play Billing unless a documented eligible exception/program applies. Keep Paystack for independent web/direct distribution; a Play build must either be consumption-only (no disallowed checkout/steering), or implement Play Billing and backend token verification, acknowledgement and revocation/reconciliation with the same entitlement contract. Do not classify all tutoring or group classes as exempt without reviewing the exact service. Separate build/distribution configuration and test the server cannot accept an untrusted client claim of channel/provider. No Play implementation or store acceptance verified.
- Founder must approve live payments, commission, PSP fee bearer, license terms, refund/payout policies and distribution route separately. This branch is not cleared for live finance.
