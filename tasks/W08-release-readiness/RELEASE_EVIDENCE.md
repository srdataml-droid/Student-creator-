# Week 8 — release evidence and stop gates

Scope: founder's November 24 parallel assignment; existing Next.js shell retained. No design replacement, new dependencies, provider calls, credentials, or production release. Branch originally diverged from main (one unique research-only task, seven main commits missing); coordinate synchronization before integration.

## Implemented in this slice (not yet verified)
- Root segment loading and error boundaries; generic messages only, user-triggered render retry, no automatic mutation replay. Root-layout failures and expected API errors require separate coverage.
- Browser network-state notice (navigator.onLine is a hint, not an availability probe). No service worker, private-data offline cache or transaction queue.
- Keyboard skip-link stacking and sticky navigation focus margins; mobile tab minimum height.
- Added a synthetic 360px Chromium regression in the existing browser-alpha job for offline/reconnect, keyboard skip link, and horizontal overflow. The pre-existing browser-alpha and browser-paid-media journeys remain intact.

References consulted: https://nextjs.org/docs/app/api-reference/file-conventions/error and https://nextjs.org/docs/app/api-reference/file-conventions/loading . Original implementation using documented framework interfaces; no upstream source copied, dependencies added, or external scripts executed. Exact pinned package version is in apps/web/package.json; no claim of reviewed upstream source revision.

## Evidence required before release
| Gate | Required evidence | Status |
|---|---|---|
| Responsive and keyboard | 320/360/412/768/1280 widths; keyboard-only and manual screen reader; all auth, content, chat, class, settings, moderation, payment routes | Partial code; tests pending |
| Loading/errors/offline | Slow network, failed GET and mutations, reconnect; no duplicate orders or stale cross-account data; no inaccessible private content | Partial code; tests pending |
| Media and bandwidth | Mux signed playback, captions, adaptive bitrate and bytes transferred on throttled connection; no eager protected media download | Pending Week 3/provider acceptance |
| Browser | exact PR head five CI jobs; browser-alpha and browser-paid-media; then integrated staging browser tests | Pending |
| Android emulator | reproducible build, API and navigation, session expiry/logout, offline, rotation, low-memory and process death | Not run; no native implementation verified |
| Physical Android | consenting tester, exact build SHA/version, model/API, real network and accessibility, recorded results | Not run |
| Mobile sessions | approved client architecture, secure platform-backed token storage if native, token revocation, no tokens in logs/URLs; server-side authorization retained | Pending Week 2 |
| Play release | owner-approved package name, current target API, signed AAB, secure upload-key custody, store listing and actual screenshots, privacy/data-safety disclosures, content rating, reviewer access, deletion, reporting/blocking, applicable testing track and billing compliance | Pending |
| Vercel staging | exact deployed commit, secret names only, HTTPS and gated enrollment/payments; no production promotion | Pending Week 1 |
| Sentry/Firebase | configuration and consent, redaction of identity/documents/DMs/tokens/payment details, synthetic alert/delivery evidence | Not configured/verified |
| Performance and dependencies | reproducible locked build; dependency audit and triage; measured mobile web vitals, network/media bytes and error budgets; authorized security scan | Pending |
| Rollback | recorded last known good deployment and compatible schema, rollback rehearsal in isolation; verify auth/access and financial reconciliation; no destructive production rollback | Pending |

## Distribution rules
Google Play official references (recheck at submission): https://support.google.com/googleplay/android-developer/answer/9858738 and https://support.google.com/googleplay/android-developer/answer/13327111 and https://support.google.com/googleplay/android-developer/answer/18265346 . Do not embed unrestricted web Paystack checkout in a Play-distributed app for digital goods unless a documented applicable policy exception/program permits it; coordinate with Week 5. Account deletion must have an in-app and external request path where required. UGC moderation/reporting/blocking must actually function. Do not assert compliance based on a checklist alone.

## Rollback procedure (not executed)
1. Stop promotion, keep registration and live payments disabled; record failing SHA/deployment and symptoms without sensitive data.
2. Identify a previously tested compatible deployment and database migration state. Coordinate with Week 1/5 before any rollback affecting schema, ledger or entitlements.
3. With founder approval, restore the known-good application deployment in staging first. Test health, authentication, cross-account denials, media entitlements and sandbox payment idempotency. Do not reverse/delete financial records to roll back app code.
4. Record results and owner approval. No production promotion or store submission without explicit approval.

No physical device, emulator, hosted acceptance, signing, release or monitoring evidence was obtained in this slice. One-student pilot remains separately gated; 100 and 1,000 are later gates.
