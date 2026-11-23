# Main execution handbook

GitHub Issues are authoritative; this handbook is an execution companion, not a second tracker. Main only, one repository, maximum two active engineering issues. Current checkpoint: 732920328390a329fb0c17ec7e191b1e87ca2185; CI 45267457299 four successful jobs. No new feature is certified by this document.

## Workstream task contracts

### W00 — Baseline and QA
- Tracker: #9 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: QA / architecture; dependencies: None.
- [ ] Inspect exact main, routes, migrations, CI and browser assertions; test real Android, accessibility and recovery.
- [ ] Acceptance and adverse tests: Exact SHA, green CI, device and restore evidence; anonymous and blocked routes denied.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W01 — Discovery
- Tracker: #12 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Product / research; dependencies: W00.
- [ ] Start with one consenting student; observe signup, discovery and creation; record actual feedback.
- [ ] Acceptance and adverse tests: Consent, observed tasks and founder-approved success metric; no invented interviews.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W02 — UX and frontend
- Tracker: #9 / #12 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Design / frontend; dependencies: W00/W01.
- [ ] Preserve creator-first feed; responsive studio, profile, navigation, loading/error/empty states.
- [ ] Acceptance and adverse tests: Mobile and desktop screenshots, keyboard and screen-reader checks; no overflow.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W03 — Identity
- Tracker: #10 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Backend / privacy; dependencies: W00.
- [ ] Private verification, roles, retention/deletion, appeals; staged Auth and RLS.
- [ ] Acceptance and adverse tests: Cross-account denial, unverified denial, no raw identity leaks, operator audit.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W04 — Media
- Tracker: #10 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Media / security; dependencies: W03.
- [ ] Quarantine, probe, scan, transcode; private storage and short-lived session-bound grants; recheck entitlement and blocks; watermark where appropriate.
- [ ] Acceptance and adverse tests: Expired/tampered/replayed grants, guessed URLs, GET/HEAD/ranges, blocked users denied; Android playback. Screen capture and authenticated extraction cannot be guaranteed impossible.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W05 — Trust and safety
- Tracker: #10 / #24 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Trust / backend; dependencies: W03/W04.
- [ ] Independent view/comment/DM controls, reporting, copyright complaints, appeals and paid-buyer disputes.
- [ ] Acceptance and adverse tests: Server enforcement across routes; shared IP alone never grounds ban; refund policy approval.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W06 — Checkout
- Tracker: #11 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Payments; dependencies: W03–W05.
- [ ] Free or >= NGN200, integer kobo immutable order; trusted sandbox PSP verification.
- [ ] Acceptance and adverse tests: Wrong amount/currency/reference/environment/status, forged and duplicate events denied.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W07 — Entitlements and ledger
- Tracker: #11 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Finance / database; dependencies: W06.
- [ ] Atomic unique entitlement and balanced journal, reconciliation, refund/chargeback compensations.
- [ ] Acceptance and adverse tests: Concurrent callbacks, rollback, retries, partial failure and ledger invariants; no real charges.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W08 — Creator portfolio and earnings
- Tracker: #11 / #12 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Frontend / finance; dependencies: W03; W07 for earnings.
- [ ] Profile portfolio and ledger-derived earnings with pending/available/refunded distinctions.
- [ ] Acceptance and adverse tests: Correct totals, ownership and privacy tests; no fake earnings or live payouts.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W09 — Staging and operations
- Tracker: #23 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: SRE / security; dependencies: W03–W08.
- [ ] Dedicated approved DB/Auth/media, migrations, alerts, rollback, backup restore.
- [ ] Acceptance and adverse tests: Hosted RLS, restore to isolated target, end-to-end sandbox checkout and media, cost approval.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W10 — First student alpha
- Tracker: #12 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: QA / product; dependencies: W09.
- [ ] One real consenting student first, with synthetic counterpart accounts; expand to 5–10 only after acceptance.
- [ ] Acceptance and adverse tests: Real-device evidence, consent, feedback, no critical issues; founder go/no-go.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W11 — Pilot
- Tracker: #12 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Growth / support; dependencies: W10.
- [ ] Expand gradually toward 80–100 then 1,000 only after measured gates and explicit approval.
- [ ] Acceptance and adverse tests: Real activation, retention, reliability, costs, disputes; no synthetic metrics.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W12 — Community
- Tracker: #12 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Backend / UX; dependencies: W11 prioritization.
- [ ] DMs, campus communities, classes and tutoring; permissions and moderation.
- [ ] Acceptance and adverse tests: Cross-account access denial, session expiry, class entitlement and report handling.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W13 — Rewards
- Tracker: #21 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Growth / finance; dependencies: Validated economics.
- [ ] Funded sponsorships and referral caps; anti-abuse qualification.
- [ ] Acceptance and adverse tests: Funding evidence, budget caps, fraud tests; no unfunded reward promises.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

### W14 — International
- Tracker: #21 / #24 (cross-cutting links are not substitutes for dedicated issues where needed).
- Lead function: Legal / finance; dependencies: W11.
- [ ] Country-specific identity, currency, taxes, PSP and payout eligibility.
- [ ] Acceptance and adverse tests: Per-market legal/provider approval and sandbox E2E before launch.
- [ ] Record actual source paths, test commands/results, exact main SHA, CI, independent review, rollback and remaining blockers in linked issue.

## Execution order and safety
Start #9 and #10. Review existing implementation before changes. Research #11/#24 independently without integration or a third active engineering issue. Use small reversible main commits; run targeted tests before push and verify exact-commit CI afterward. Stop unsafe changes, not independent unblocked work. No real IDs, secrets, real money or unapproved deployments. Founder approves legal, budget, fee, payout, retention, paid-buyer dispute and pilot expansion decisions. Actual hours unknown; retain 183–364h baseline, log real hours only.

## Folder ownership
- `apps/web/`: existing Next.js UI, API adapters and browser E2E; preserve routes.
- `packages/local-core/`: local business rules, storage, HTTP and video validation; keep local development mode.
- `packages/payment-core/`: payment contracts and ledger logic; no duplicate payment engine.
- `db/migrations/`: ordered SQL and RLS; disposable tests before approved staging.
- `.github/workflows/`: CI; exact SHA evidence.
- `docs/architecture/`: canonical system/domain/release contracts.
- `docs/execution/`: this handbook and future evidence indexes; issue comments hold task status.
- `.agents/skills/`: role instructions where present; research branch remains reference until selectively reviewed. Do not relocate runtime files merely for aesthetics. Add modules only after inspecting existing conventions and dependencies.

## Completion gate
Proposed → Ready → Doing → In Review → Verified → Released → Measured; Blocked is explicit. Code written is not completion. Independent reviewer checks actual diff, positive/negative tests, secrets, privacy, concurrency and rollback. Record evidence before checking any item. No background worker implied.
