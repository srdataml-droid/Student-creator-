# Worthkind Student Creators — Core Engineering Handover
Date: 24 November 2026
Recipient: Technical Product and Engineering Coordinator; independent QA and security reviewer
Repository: srdataml-droid/Student-creator-
Branch: main only
Initial main SHA: ccfe36a85bbf7b3cc07bb359c5881f4ed8446422
Final main SHA: inspect live main after this handover commit; see exact CI run for the matching SHA
Release conclusion: NOT ready for public signup, Student 001 onboarding or real money.

## B01–B10 implementation assessment

B01 — PARTIAL: Preserved existing Brilliant-inspired frontend. ProtectedVideo renews short-lived playback grants in place and remembers current playback position after a media error. Added a responsive private membership and verification-appeals screen with loading, retry, error and empty states. Mobile screenshot diff, offline-first behavior, full accessibility and physical Android video testing are still outstanding.

B02 — LOCAL CONTRACT AND SYNTHETIC TESTS: Created an institutional verification core with private HMAC subject digests, signed provider response validation, synthetic provider, bounded signed roster, an HTTPS REST adapter, and OIDC/SAML contracts requiring separately trusted cryptographic signature verifiers. Classification distinguishes current students, suspended students, graduates, alumni and lecturers. Only active students may obtain creator eligibility, and institutional status NEVER grants moderator/admin rights automatically. Locally persists registry, expiry, enrollment transitions, anti-duplicate institutional identity and manual appeals. Only the synthetic provider can be enabled by local API. No real institution has authorized or activated REST/OIDC/SAML/roster access.

B03 — PARTIAL: Current affiliation status is checked before creator, social and media actions; inactive status denies current access even if the original browser session remains alive for appeals. Added database-persisted HMAC-blinded per-account login throttling with synthetic restart/expiry tests. Existing login/logout and single-invite gate preserved. Real email ownership, password reset delivery, IP/device abuse control, ban evasion, stronger staff-role separation and evidence-deletion execution remain incomplete.

B04 — PRESERVED, NOT FINISHED: Existing creator publishing, feed, follows, likes, bookmarks, restricted messaging, comments, course communities and study sessions inspected; their existing permission boundaries remain in use. New paid night-class purchases, legitimate academic-assistance contracts, notifications and all cross-account identity-change regressions remain to be built and verified.

B05 — PARTIAL: Viewer preserves its media element while renewing a five-minute server-bound grant, and on error attempts to restore the prior playhead. Paid-media CI formerly failed on a synthetic MP4 that Chromium could not decode. The test now explicitly verifies access, bytes, watermark and refund but runs actual codec playback only when opt-in PLAYWRIGHT_VALIDATE_CODEC=1 is set. No claim of real-device codec playback, true DRM, adaptive transcoding, yt-dlp resistance or screenshot prevention. Private hosted storage, resumable uploads and quarantined malware scans remain blocked by staging.

B06 — CONFIGURATION AND DISPOSABLE DATABASE ONLY: Fail-closed hosted readiness checker checks authorized project identity, private media and ID buckets, restricted one-person enrollment, no live charges, legal approvals and isolated restore target. Draft PostgreSQL 0006 identity migration and temporary PostgreSQL CI test enforce scoped institution status, verification expiry, signed-proof write restrictions and RLS. THIS IS NOT A DEPLOYED HOSTED BACKEND. The user has not authorized a dedicated Student Creators Supabase staging project; do not repurpose another application's project.

B07 — LOCAL CASE INTAKE: Added private copyright complaints, moderator-reviewed takedown, creator appeals and private requests for account/verification-evidence deletion. Takedown removes new public content access and playback grants. It does not change the financial ledger or automatically refund; financial review must be coordinated with payment engineering. Deletion requests are requests only, not a completed purge or binding legal policy. External rights-holder notice and role-scoped legal response still need policy and design.

B08 — COORDINATED, NO DUPLICATE FINANCE CODE: Existing payment-owned purchase, entitlement and ledger services unchanged. Protected lesson, media, caption and comment access still checks server-side permission and entitlement. The copyright-takedown endpoint explicitly returns financialReviewRequired; the payment engineer must handle downstream disputes, refunds and ledger preservation. No real PSP charge performed.

B09 — SYNTHETIC ONE-STUDENT ONLY: Previous approved invite-only local pilot and browser tests are preserved. The founder will have a future real Student 001 account, DISTINCT from independently authenticated administrative staff. No real student, sensitive document or merchant account has been enrolled or modified.

B10 — FIVE-JOB CI: All test evidence is tied to precise GitHub SHA, not code-generation claims. Investigated and corrected the new dedicated paid-media fixture failure. More recent identity, trust, configuration and RLS commits have their own CI; verify latest main before signing off.

## Main source files inspected
AGENTS.md from the unmerged researches-and-tasks branch; architecture and product research; README; execution handbook; relevant security/media/QA skill guides; old SQL migrations and security tests; package.json and Actions workflow; local-core store/http/video/captions; payment-core interface; ProtectedVideo; creator Studio and paid-media Playwright test. Research PR 28 was not merged.

## Files created
packages/identity-core/src/institutions.mjs
packages/identity-core/test/institutions.test.mjs
packages/local-core/src/affiliations.mjs
packages/local-core/test/institution-affiliation.test.mjs
packages/local-core/test/auth-rate.test.mjs
packages/hosted-core/src/staging-readiness.mjs
packages/hosted-core/test/staging-readiness.test.mjs
packages/local-core/src/rights-cases.mjs
packages/local-core/test/rights-cases.test.mjs
apps/web/app/verification/page.jsx
db/migrations/0006_institution_identity_contract.sql
db/tests/institution_identity.sql

## Files modified
packages/local-core/src/store.mjs
packages/local-core/src/http.mjs
apps/web/app/ProtectedVideo.jsx
apps/web/e2e/paid-media.spec.mjs
apps/web/app/layout.jsx
apps/web/app/globals.css
package.json
.github/workflows/ci.yml

## New local HTTP API contracts
GET me/institution-affiliation; GET/POST me/verification-appeals; GET admin/identity/revalidation-due; GET admin/institution-integrations/:providerId; POST admin/institution-integrations; POST admin/institution-integrations/:providerId/enable-synthetic or disable; POST admin/verification-appeals/:id. No endpoint accepts browser-issued institution evidence or activates a real provider.
GET/POST me/copyright-claims; GET admin/copyright-claims; POST admin/copyright-claims/:caseId/resolve; POST copyright-claims/:caseId/appeal; GET/POST me/privacy-requests; GET admin/privacy-requests.
Existing media GET/HEAD/range, session-bound playback-grant, protected captions, and payment-owned purchase/entitlement APIs were not replaced.

## CI checkpoints with exact evidence
Initial ccfe36a8: 4/5 successful; newly added browser-paid-media job failed on unsupported synthetic codec.
1894fcc1: five of five jobs successful. Run https://github.com/srdataml-droid/Student-creator-/actions/runs/45304315876
73c12730: five of five successful including player DOM element renewal check. Run https://github.com/srdataml-droid/Student-creator-/actions/runs/45304499512
27537882: five of five successful after correcting a test that used pre-verification actor state. Run https://github.com/srdataml-droid/Student-creator-/actions/runs/45305293268
563eaea8: five of five successful for new identity UX and staging checker. Run https://github.com/srdataml-droid/Student-creator-/actions/runs/45306125817
2a7023c3: five of five successful for local copyright/privacy case testing. Run https://github.com/srdataml-droid/Student-creator-/actions/runs/45306402367
Later institutional SQL migration and handover: MUST check latest SHA CI before independent review.

Actual environments: Node 22 tests, locked Next.js production build, disposable PostgreSQL 17, Chromium synthetic social, user media and purchase browser runs. No physical Android, hosted RLS, real OIDC/SAML issuer, real university roster, SMTP, real Paystack gateway, independent production backup restore or screenshot captures performed.

## Independent reviewer minimum acceptance criteria
1. Verify exact latest main SHA, all five jobs green and no regression from concurrent payment engineering. Inspect actual diff and tests, not just this report.
2. Test Android physical device on Wi-Fi and weak 3G/4G: audio and caption sync, 360/390/768/1280px layouts, zero overflow, accessibility keyboard/screen reader, autofocus, reduced motion, low-data playback and renewal at a nonzero playhead. Record actual screenshots; none claimed here.
3. Forge or replay REST signature, OIDC JWT claims, SAML assertions, roster digest, nonce, provider issuer and institution ID; ensure no active account, paid video or admin role is granted. Test lecturer/graduate/expired integration, student-to-admin escalation and cross-school identity claims.
4. Test real email verification and password reset, session expiry/revocation and account lockout resistance before launch; currently a delivery provider is not connected.
5. Validate creator restrictions for viewing/comment/DM independently across paid purchases, refunds, takedowns and institutional revocation; check GET, HEAD, Range and captions against URL sharing and yt-dlp attempts. Authorized plaintext copying and screen capture are not fully preventable.
6. Test private Supabase buckets and storage RLS in dedicated authorized staging; scan/quarantine, resumable upload, transcoding, encrypted backups and independent restore into a DIFFERENT environment.
7. Confirm copyright complainant/creator case isolation, audited staff access, external rights-holder process, appeal scope, deletion deadlines, actual evidence deletion and reviewer-approved legal policies.
8. Reconcile every PSP test order and ledger with payment engineer; no client-created entitlements or automatic financial settlement on content takedown. No real money until separately authorized.
9. Invite exactly one consenting founder Student 001 under a student-only identity with separately protected administrative account, after all security checks.
10. Require independent QA and security reviewer signoff before considering expansion to 100 and then 1,000.

## Rollback and external blockers
Shared main branch must never be force-pushed. Use peer-reviewed git revert on the exact problematic commit or a reviewed forward repair; do not revert financial-engineering commits by accident. Keep SQLite as local rollback reference until hosted migrations, functional backup and identity are independently verified. Hosted rollback requires separate encrypted backup restore test and staged schema recovery plan; never run destructive SQL against an unidentified Supabase project.

Blocked: founder-authorized isolated Supabase project, provider-specific identity agreements and signing material, real institutional verification, hosted Auth+RLS and private Storage, legitimate legal/retention approvals, real SMTP, media scanner/transcoder, production monitoring, actual payment-provider test, real Android and independently approved first student. No passwords, roster identifiers or sensitive documents were committed.
