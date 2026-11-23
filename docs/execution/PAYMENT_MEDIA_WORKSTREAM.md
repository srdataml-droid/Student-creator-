# Payment integrity and protected media execution ledger

Spec: founder's M01–M17 request, Issue #11 and architecture/02_DOMAIN_DATA_AND_SECURITY_CONTRACTS.md.
Initial main: 8b31e07bdddac33b3bc604fafb7be77ddede374c. PR #28 is OPEN, DRAFT, unmerged (API checked 2026-11-23).
Baseline: Node v24.22.3; npm test: 180 tests, 180 pass, 0 fail.
No AGENTS.md on main. Read research branch AGENTS.md and payments-ledger, secure-content-access, qa-release skills without merging the draft.

## Implementation plan

User explicitly requested autonomous execution on main; no extra branch or approval gate.
Use existing Node/SQLite commerce, Paystack adapter, HttpOnly session-bound media grants and private filesystem.
Do not replace these with a second implementation. PostgreSQL remains a staged future hosting schema.

1. Add failing real-SQLite integrity tests: immutable snapshots; trusted verification; refunds/chargebacks; durable inbox; rollback; concurrent separate processes; interruption/reopen; reconciliation.
2. Extend commerce schema additively: immutable test-only order terms; append-only balanced financial events; inbox with durable references and payload digests; reversal and dispute records. Existing paid records remain intact.
3. Reuse server Paystack verifier for both browser-triggered reconciliation and signed webhook processing. Durable inbox acceptance precedes acknowledgment; retries verify again, never grant from the payload. Production and live keys remain disabled.
4. Add authenticated HTTP order status/reconciliation and support dispute paths; webhook uses raw bytes and configured server-only test adapter. Refund and chargeback simulation remains nonproduction, not a provider refund API.
5. Integrate entitlement revocation and restriction disputes with existing grant checks. Add pseudonymous per-session dynamic watermark and no-referrer headers. No browser screenshot prevention claim or new segmented streaming infrastructure.
6. Run full Node suite, locked Next build, PostgreSQL contracts, Chromium synthetic flow and dedicated paid-payment-to-playback flow. Review independently, fix findings, commit main, fast-forward push only, verify remote and update #11/#10.

Review focus: second transaction on paid reference must be retained; reversal before success must never reactivate access; block/unblock must preserve dispute; stale actor objects must not bypass current account status; crash between inbox receipt and fulfillment must retry safely.

## Milestones

- [x] M01 repository verification and baseline
- [x] M02 immutable orders
- [x] M03 trusted payment verification
- [x] M04 atomic fulfillment
- [x] M05 duplicate/concurrency protection
- [x] M06 financial integrity
- [x] M07 recovery/reconciliation
- [x] M08 refunds/chargebacks
- [x] M09 restrictions/disputes
- [x] M10 playback grants
- [x] M11 private media
- [x] M12 capture mitigation
- [x] M13 synthetic payment tests
- [x] M14 media security tests
- [x] M15 regression/integration
- [ ] M16 GitHub commits/evidence
- [x] M17 independent end-to-end verification

## Rulings

- Extend the real local SQLite runtime; do not pretend staged PostgreSQL tables are the application's active database. Cost: hosted PostgreSQL payment fulfillment remains a separate future integration.
- Explicit synthetic terms only: NGN, test environment, zero platform commission, provider fee bearer undecided, no payouts or settlement. A test entitlement has no production license validity. Cost: no production charging until policy approval.
- Synthetic reversals revoke entitlement; creator viewing blocks immediately deny playback and open a durable review case, without erasing purchase or financial history. Unblocking permits fresh grants, retaining the case. Cost: commercial refund decisions require operator review.

## Verified implementation and milestone evidence

Scope: runnable **local synthetic** application, not a financial or hosted production launch. No real PSP request, charge, withdrawal, refund, payout, student ID document or deployment was performed. Paystack transport is mocked; SQLite and PostgreSQL engines are real.

Concurrent main work was integrated by fast-forward at `8a736ac`, `1120f80`, and `3084bd5c5ae2c65a304d58b025373b6a33b80f1b`. This preserves the other agent's checkout/paywall, purchase library, pricing, refund harness, PostgreSQL RLS, visual changes and immersive viewer. The existing synthetic-refund API now shares compensating accounting and retains a revoked entitlement instead of deleting it. Its regression still verifies four historical journal lines. `commerce_lines` is the canonical financial event journal; `commerce_journal` remains a compatibility projection. Never sum the two as independent cash movements.

| Milestone | Verification status | Reproducible evidence |
|---|---|---|
| M01 | Complete | Initial SHA above; clean clone; PR #28 API confirmed unmerged draft; baseline 180/180. Read main architecture, source/tests, research instructions and relevant skills. |
| M02 | Complete, test terms only | Server-random `sc_` references, buyer/request uniqueness, one order per buyer/content, immutable amount/buyer/creator/content/email/terms/currency/environment/fee snapshot. `payment-integrity.test.mjs`, existing commerce HTTP tests. |
| M03 | Complete with mocked PSP | Existing Paystack client validates success, reference, integer kobo, currency, test environment, customer and transaction identity. Raw-byte timestamped signature verification reused. `payment-integrity`, `payment-recovery`, payment-core suites. |
| M04 | Complete on real SQLite | `BEGIN IMMEDIATE`; payment receipt, order state, entitlement, posted journal, inbox completion and audit commit together. SQL-trigger failure and SIGKILL roll back the actual fulfillment transaction. |
| M05 | Complete | Four separate Node processes race on one SQLite file: one fulfillment, three replays, one receipt/entitlement. Provider transaction PK, event keys, order/entitlement uniqueness. Extra verified transactions create duplicate liabilities and review cases. |
| M06 | Complete for synthetic movements | Append-only sealed balanced journals; gross clearing, creator payable, duplicate payable, zero platform commission, provider fee suspense and reserved settlement-adjustment account. Reconciliation detects incomplete events and missing charge journals. No view-derived earnings. |
| M07 | Complete locally | Durable signed inbox stores reference, transaction ID and payload digest, not PSP PII/body. Retry backoff, rotating pending-order recovery, timeout recovery, reopen, concurrent drains and committed-receipt recovery tested. Explicit local worker CLI supplied; no background deployment claimed. |
| M08 | Complete, synthetic only | Primary/transaction-specific refunds and chargebacks append compensation, retain receipt/history, revoke access and delete old grants. Duplicate reversal, early reversal, late success and later duplicate-charge scenarios tested. No PSP refund/chargeback API activated. |
| M09 | Complete locally | Viewing block revokes grants immediately and opens a buyer-visible durable case. Comment/DM flags remain independent. Reblocking after a resolved case opens a new episode. Buyer sees cases in `/purchases`; current admin can record a resolution through authenticated POST `admin/payment-disputes/{caseKey}` with `{resolution}`. Resolution is audited; it does not by itself move money or override creator security rules. |
| M10 | Complete locally | Existing five-minute hashed HttpOnly grants reused. Issuance authorization now runs under write lock. Every published GET/HEAD/range checks current account, entitlement, creator status, exact viewer/content/session, grant and parent-session expiry. Existing expired/altered/copied/logout tests retained. |
| M11 | Complete for unauthorized local MP4 access; production conditional | Private mode-0700 media directory and mode-0600 objects outside public storage. No bearer in reusable media URL. HTTP and browser negatives plus actual yt-dlp 401; authorized ranges 206. Authorized plaintext copying remains possible. |
| M12 | Supported browser mitigation complete; stronger protection conditional | Session-keyed pseudonymous watermark, moves every nine seconds, survives wrapper fullscreen in Chromium. No email, student ID or raw account ID. Grant rate cap/audit and logout/restriction/refund revocation retained. No native Android code exists, so FLAG_SECURE is inapplicable. |
| M13 | Complete | Success, signature, amount/currency/reference/environment/buyer/status/identity/fee mismatches, duplicates, concurrency, rollback, SIGKILL, recovery, reversals and reconciliation. |
| M14 | Complete in local HTTP/Chromium scope | Visitor, unverified, unpaid, paid, cross-account/session, expired/tampered grants, copied URL, byte ranges, blocked/refunded/suspended access, watermark and private-file exposure checks. |
| M15 | Complete in sandbox scope | Full Node suite, locked Next build, PostgreSQL 17 contracts, original Chromium creator/moderator regression and synthetic paid-payment-to-playback/refund browser test. No GitHub Actions dependency. |
| M16 | Pending remote evidence | Reviewed diff and secret filenames; commit/push verification and issue links recorded in the completion entry below. |
| M17 | Complete locally | `apps/web/e2e/paid-media.spec.mjs`: verified buyer -> HTTP server order -> mocked trusted PSP adapter -> atomic receipt/entitlement/ledger -> decoded/playing MP4 -> moving/fullscreen watermark -> creator restriction/review -> synthetic refund -> range denied. |

## Database changes and migration safety

`packages/local-core/src/commerce-schema.mjs` runs inside a SQLite transaction. It adds order terms/payment-state columns, entitlement state, immutable identity triggers, receipt/event/line/reversal/dispute/inbox/recovery tables and journal balance/sealing triggers. It backfills old paid journal pairs and the other agent's `synthetic_refunds`, preserving four-line historical journals and reconstructing a revoked entitlement when the old refund implementation deleted it. Migration is idempotent and tested on a real legacy-shaped SQLite database. Corrupt/unbalanced legacy financial data causes migration failure rather than guessed balances.

No new hosted PostgreSQL migration was applied or authored in this workstream. Concurrent main's staged `0005_paid_access_security.sql` was preserved and tested with 0001–0004. PostgreSQL contracts establish staged schema/RLS behavior; **they do not prove PostgreSQL payment fulfillment**, which is not this application's runtime.

Use a verified local backup before upgrading an existing development file. Do not downgrade only the application after a refund: old code does not understand retained revoked entitlements. Restore a matching verified database/media backup or keep the new authorization layer. No production database was touched.

## Test commands and actual observed output

Environment: Node v24.22.3, Next 16.4.6, system Chromium, temporary Playwright 1.56.1, PostgreSQL 17.12, yt-dlp 2026.10.26. Web dependencies installed with `npm ci --prefix apps/web --no-audit --no-fund`; Playwright installed temporarily with `--no-save --no-package-lock`.

```
npm test
# Latest full-suite summary is recorded in the completion entry below.
# Earlier verified merged run: tests 205; pass 205; fail 0; cancelled 0; skipped 0; todo 0.

NEXT_TELEMETRY_DISABLED=1 npm run build --prefix apps/web
# exit 0; compiled successfully; static pages generated; /watch/[lessonId] included.

node --test packages/local-core/test/payment-integrity.test.mjs \
  packages/local-core/test/payment-recovery.test.mjs \
  packages/local-core/test/paid-media-security.test.mjs \
  packages/local-core/test/commerce-migration.test.mjs
# Focused actual engine tests are also included by npm test.
```

Browser reproduction (separate local terminal for server; keep JSON/session material private):

```sh
node scripts/seed-payment-browser-fixture.mjs /tmp/unique-private-payment-fixture.json
export LOCAL_SQLITE_PATH="$(node -p 'JSON.parse(require("node:fs").readFileSync("/tmp/unique-private-payment-fixture.json")).path')"
APP_DATA_MODE=local npm run start --prefix apps/web -- -p 3000
# In another terminal, using the same private fixture:
PAYMENT_FIXTURE_FILE=/tmp/unique-private-payment-fixture.json \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  npx --prefix apps/web playwright test --config=apps/web/playwright.payment.config.mjs \
  --workers=1 --reporter=line
# actual output: 1 passed (12.0s), 0 failed; includes actual MP4 play/currentTime > 0.
```

Omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when using Playwright's installed Chromium. The fixture output file is created exclusively with mode 0600; use a new path per seed. The synthetic fixtures have extra negative-test actors, not enrolled real students. The paid test chooses the creator's own campus/course and creates a fresh work/order, so prior browser test data cannot change its target.

Original browser regression executed against the production build using synthetic administrator environment values and Chromium executable override in a temporary config:

```
npx --prefix apps/web playwright test --config=/tmp/student-playwright.config.mjs \
  local-alpha.spec.mjs --workers=1 --reporter=line
# actual output: 1 passed (10.3s).
# checkpoints: free playback; paid draft; price/upload/submit; review;
# paywall at 390x844; pending order/history; comments and creator revocation.
```

Fresh PostgreSQL cluster (roles in bootstrap are cluster-wide, so use a fresh cluster, not merely another database in a previously bootstrapped cluster):

```sh
psql -v ON_ERROR_STOP=1 -f db/tests/bootstrap.sql \
  -f db/migrations/0001_proposed_core.sql \
  -f db/migrations/0002_creator_comments.sql \
  -f db/migrations/0003_creator_public_profiles.sql \
  -f db/migrations/0004_creator_restrictions.sql \
  -f db/migrations/0005_paid_access_security.sql \
  -f db/tests/smoke.sql -f db/tests/creator_public_profiles.sql \
  -f db/tests/creator_restrictions.sql -f db/tests/comments.sql -f db/tests/paid_access.sql
```

Actual output: exit 0, all five contract scripts report PASS: core schema/RLS/submission/audit; aliases/ownership; restrictions; comments/reports; paid entitlement/revocation/blocking. Ran using a private `/tmp` Unix socket and port 55433, with no production connection. Initial attempt to reuse cluster roles failed `role "anon" already exists`; a fresh disposable cluster fixed the harness isolation issue.

Actual unauthorized download checks against the running built server:

```
yt-dlp --no-cache-dir --skip-download http://localhost:3000/api/local/lessons/CONTENT_ID/video
# exit 1: Unable to download webpage: HTTP Error 401: Unauthorized
# direct fetch of the same URL with Range: bytes=0-4 -> 401
```

Production guard checks: direct settlement -> `TEST_SETTLEMENT_DISABLED`; simulated reversal -> `SANDBOX_PAYMENTS_DISABLED`; recovery CLI exits 1 without sandbox configuration and prints no key/provider body. `git diff --check` succeeds; tracked secret-file scan reports 0 (the empty `.env.example` is permitted).

Observed development failures were investigated and corrected: missing schema/functions before implementation (RED tests); reviewer-discovered accounting/auth/recovery races (RED then GREEN); old synthetic-refund compatibility/migration (RED then GREEN); webhook environment names aligned with the existing template (RED then GREEN); development hot-reload loops caused browser failures, so final browser runs used the built server; paid browser fixture initially chose a different campus after another test added courses, fixed to creator-owned course. A merged browser regression initially expected 503 but received 403 for disabled production checkout; the handler now preserves 503 with owner lookup and no financial call. No failing final check is silently omitted.

## Financial evidence (kobo, synthetic)

For a verified 20,000 charge and observed 100 provider fee:

```
{"balanced":true,"debitKobo":20100,"creditKobo":20100,"grossKobo":20000,
 "reversedKobo":0,"creatorPendingKobo":20000,"duplicateLiabilityKobo":0,
 "providerFeeKobo":100,"platformFeeKobo":0,"settlementAdjustmentKobo":0,"payoutEnabled":false}
```

After the synthetic primary refund:

```
{"balanced":true,"debitKobo":40100,"creditKobo":40100,"grossKobo":20000,
 "reversedKobo":20000,"creatorPendingKobo":0,"duplicateLiabilityKobo":0,
 "providerFeeKobo":100,"platformFeeKobo":0,"settlementAdjustmentKobo":0,"payoutEnabled":false}
# entitlement: revoked
```

Provider costs remain in **fee suspense**, without charging a creator or approving a commercial fee bearer. Legacy/missing provider fees have no observed fee posting; zero in those old records is not a verified PSP settlement cost. Settlement remains disabled: the reserved adjustment account has zero movements. An extra distinct charge after refund produces gross 40,000, reversed 20,000 and duplicate liability 20,000 until that specific transaction is synthetically refunded. The primary entitlement stays revoked; refunding only a duplicate does not revoke a valid primary entitlement.

## Recovery operation

For an explicitly configured, nonproduction, isolated test installation only, privately set `LOCAL_PAYMENT_SANDBOX=1`, `LOCAL_SQLITE_PATH` and `PAYSTACK_TEST_SECRET_KEY`, then run `node scripts/local-payment-reconcile.mjs`. It drains due signed inbox events and rotates due pending orders, emits counts only, returns 2 if unresolved, and can safely be invoked again. No scheduler or deployment was created. Without keys, all automated tests and the browser fixture use mocked PSP transports.

Webhook configuration reuses existing server-only `PAYSTACK_WEBHOOK_KEY_ID` and `PAYSTACK_WEBHOOK_SIGNING_SECRET`; POST `/api/local/payments/webhook` requires `Paystack-Signature`, persists before ACK and never fulfills from event data. No legacy-signature fallback is silently enabled. API credentials and webhook signing material are separate. Browser callbacks only request server verification through the existing `/orders/{reference}/confirm` route.

## Independent review and remaining conditions

A fresh reviewer inspected SQLite, payment/media code and tests. Seven important findings were reproduced and fixed: transaction-specific reversal, grant authorization under lock, persisted preview/session state, rotating recovery, receipt-based inbox completion, draft-only balanced event sealing, and repeat restriction review episodes. Additional regressions corrected the early-reversal audit description and tested actual browser decoding/playback. Review did not certify live PSP, staged PostgreSQL fulfillment, later UI commits or real devices. No deferred minor finding remains from that review.

HLS/DASH was evaluated and not added for one synthetic buyer: introducing manifests, segments and key delivery would create additional authorization surfaces without removing capture risk. A future segmented implementation must protect all three through the same current entitlement/restriction boundary and private storage. DRM requires an approved packaging/license provider, protected keys, supported devices and commercial terms; none is falsely represented as active. There is no native Android app. Browsers offer no reliable universal OS recording/screenshot detection; Screen Capture API control is not detection of unrelated recording software. Watermark overlays can be removed by an authorized client, and even DRM cannot stop an external camera.

Intentional disabled features: all production financial mutations (`NODE_ENV=production`), live keys/charges/refunds/transfers, payouts/withdrawals, real settlement, unapproved commissions/fee-bearing, production license duration/renewal/repurchase rules, hosted PostgreSQL payment fulfillment, public storage/CDN, segmented encryption keys/DRM and native capture controls. KYC, tax/legal/refund/licensing decisions, merchant eligibility, private hosted storage/auth, real PSP sandbox credentials/network acceptance and physical-device acceptance remain genuine release dependencies. They did not block synthetic implementation.

Verdict for this workstream: **PASS WITH CONDITIONS** — verified local synthetic flow; no production or absolute anti-copying claim. Keep #11 and #10 open for their remaining hosted/provider/legal acceptance.

## Sources and changed-file inventory

Official PSP references checked 2026-11-23: [Paystack webhook authentication](https://paystack.com/docs/payments/webhooks/) and [server verification](https://paystack.com/docs/payments/verify-payments/). Their current contract supports raw-byte HMAC-SHA512 with timestamped signing material and separate server transaction verification. [Brandur's idempotency research](https://brandur.org/idempotency-keys) informed persisted phases and safe recovery; application-engine tests establish the actual behavior here.

Modified: `.env.example`; `packages/payment-core/src/payments.mjs`, `paystack-client.mjs`; `packages/local-core/src/commerce.mjs`, `store.mjs`, `http.mjs`; `packages/local-core/test/commerce.test.mjs`; `apps/web/app/ProtectedVideo.jsx`, `globals.css`, `purchases/page.jsx`.

Created: `packages/local-core/src/commerce-schema.mjs`; `packages/local-core/test/commerce-migration.test.mjs`, `payment-integrity.test.mjs`, `payment-recovery.test.mjs`, `paid-media-security.test.mjs`; `packages/local-core/test/helpers/commerce-fixture.mjs`, `fulfillment-worker.mjs`, `restriction-worker.mjs`; `apps/web/e2e/paid-media.spec.mjs`; `apps/web/playwright.payment.config.mjs`; `scripts/local-payment-reconcile.mjs`; `scripts/seed-payment-browser-fixture.mjs`; this execution/evidence document. Existing video primitives, financial allocation primitives, PostgreSQL migrations, and other agents' feature files were reused.
