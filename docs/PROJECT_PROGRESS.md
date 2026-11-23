# Student Creators Platform — implementation checklist

**Repository:** `srdataml-droid/Student-creator-` (this repository, not the older school-learning-platform)
**Execution mode:** in-session engineering with GitHub commits/checkpoints; no unsupported background agent.
**Current stage (one-student-first):** local creator-first feed, independently verified Chromium browser path, 176 Node tests, verified student content access, creator-owned restrictions, one invited-student enrollment gate and synthetic CLI backup/restore. Hosted Auth/RLS/media, DRM, real student/device acceptance and payments remain unverified. **Rollout is 1 → 100 → 1,000**, only with distinct gates (#12).

| Stage | Feature | Status | Evidence / gap |
|---|---|---|---|
| 1 | Product scope, social creator journeys, content integrity rules | Documented | `docs/PRODUCT_SCOPE.md` |
| 2 | Code destination and app bootstrapping | Implemented | Source files in this repository; main branch history |
| 3 | Responsive creator/social homepage | Implemented and CI-built | `apps/web/app/page.jsx`, `FeedExperience.jsx`; CI run 44884987176 passed build |
| 4 | Public creator profiles | Implemented and CI-built | `apps/web/app/creators/[creatorId]`; CI 44885052917 succeeded |
| 5 | Student registration, campus verification and course catalog | SQLite implemented, tested | Local APIs and integration tests; onboarding requires admin |
| 6 | Upload/publish original text and MP4, moderator review | SQLite implemented, tested | Local API, 25 MiB limit; not virus-scanned or transcoded |
| 7 | DMs, blocks/reports, course communities | SQLite implemented, tested | Private APIs and tests; live realtime absent |
| 8 | Search, saved posts, study sessions | SQLite implemented, tested | Local integration tests |
| 9 | Creator follows and Following feed | Locally implemented; CI verified | `creator_follows`, follow API, profile button and Node tests; fresh-main CI 45225768951 |
| 10 | Post likes, comments, follow notifications | **Likes + moderated comments merged/tested locally** | [PR #2](https://github.com/srdataml-droid/Student-creator-/pull/2) + [PR #4](https://github.com/srdataml-droid/Student-creator-/pull/4), main `338b1457`; authenticated replay-safe likes, comment removal/report review, synthetic HTTP + disposable PG CI success. Follow notifications remain planned; nothing deployed. |
| 11 | Creator profile names, photos, original-work type and pricing controls | **Public name/handle implemented locally; media and pricing planned** | Owner-scoped alias API/UI, public-only-after-approval behavior, SQLite and draft PostgreSQL RLS contracts tested in CI. Never expose legal ID/email. Photos, original-work classification and pricing remain unimplemented. |
| 12 | Premium posts/subscriptions and entitlement access | Planned/blocked | Dedicated managed DB and PSP sandbox required |
| 13 | Creator bank setup and PSP settlement split | Blocked | Provider eligibility, user approval, finance/legal review |
| 14 | Creator sales dashboard, refunds/reconciliation | Planned | Transactional ledger + actual provider evidence |
| 15 | Production Auth/RLS/storage and moderation | Blocked | Dedicated Supabase project not supplied |
| 16 | Browser E2E, load, accessibility, backups and monitoring | **Synthetic Chromium browser smoke CI passed; broader acceptance incomplete** | GitHub Actions 45267112092 passed 1/1 Playwright end-to-end test; Android, load, accessibility and independent restore remain outstanding |
| 17 | Staging deployment and production verification | Not started | Real hosted deployment, security audit, pilot, explicit launch gate |

## Exact continuation
1. Inspect latest `main` commit and its GitHub Actions test, web-build and disposable DB job conclusions.
2. If any CI failed, inspect first failed step and fix before feature work.
3. Likes, comments and public creator aliases are on `main`; preserve them while adding follow notifications and hosted persistence. Check exact-main CI after every commit.
4. Preserve verified creator-alias privacy and cross-school access checks in future changes; photos, original-work classification and pricing/entitlements remain separately gated.
5. Separate accepted data model for paid posts and subscriptions from free content, then integrate with dedicated Supabase and PSP sandbox only when available.

**Security:** The app is not deployed. SQLite is only a development store. Do not unlock paid media on browser return; only trusted verified server-side payment and atomic entitlement updates may grant access. Provider secrets stay server-side. No school IDs, fake creator earnings or seed-user credentials in Git.

**Review boundary (historical):** earlier workflow used team-reviewed PRs. **Superseded for current founder-directed architecture phase:** use only this repository and direct, small, tested commits to `main` (see latest update below).

## New comment workflow — 22 November 2026
- Existing PR #2 on main already implements likes: this branch deliberately **does not** replace, duplicate or reset that code.
- Local development server now has POST/GET comments, persistent idempotency, 20-comments/hour cap, author-owned soft removal and report/independent administrator hide/dismiss actions. Public replies display a pseudonym, never personal email.
- PostgreSQL `db/migrations/0002_creator_comments.sql` keeps browser mutation of comment and moderation tables denied; all access-control tests run on disposable PostgreSQL CI only. This is not yet a hosted authenticated implementation.
- Still blocked: approved Student Creators Supabase project and media storage, production authentication, actual moderation operations and audits, real-device/browser accessibility testing, paid content entitlements and settlement.

## Public creator aliases — implementation checkpoint (22 November 2026)

- **Code:** new `creator_public_profiles` SQLite development table with account-owned updates, case-insensitive unique ASCII handles, Latin-script display names, platform/campus authority reservations, short text-only bio, 5-changes/hour audit throttle and no account-email publication. Existing bookmarks, likes, comments, followers and messages remain unchanged.
- **UI:** `/studio` self-editable public profile and `/creators/[creatorId]` display self-chosen aliases only after independently reviewed publication. Student verification is not permission to impersonate school administration.
- **Tests:** pure alias-validation tests, synthetic HTTP integration tests for failed auth, unauthorised claims, duplicate handles, persistence and public visibility; disposable PostgreSQL 17 migration/contract `0003_creator_public_profiles.sql` + `creator_public_profiles.sql` with RLS, revoked/suspended/denied-published access and no browser mutation privileges. Test results must be bound to final head SHA; writing test files does not prove success.
- **Still blocked externally:** dedicated hosted Supabase project and verified Auth/write service, real public browser/mobile checks, production security operations and any paid content/PSP settlement. SQLite is temporary development/rollback only.

## 23 November 2026 — founder-directed single-main architecture update

**Current instruction superseding older branch advice in this tracker:** use **only** `srdataml-droid/Student-creator-` and commit architecture work directly to `main` unless the founder explicitly changes that rule. Do not transfer/recreate app in the old school-learning-platform repository. Keep commits small and verify each resulting main SHA.

**New documents (documentation/architecture only):**
- `docs/architecture/01_SYSTEM_CONTEXT_AND_CONTAINERS.md`: current vs target component/system context and deployment boundary.
- `docs/architecture/02_DOMAIN_DATA_AND_SECURITY_CONTRACTS.md`: conceptual ERD, state machines, authorization/entitlement decisions, API sketches and financial invariants.
- `docs/architecture/03_ROLES_WORKSTREAMS_AND_RELEASE_PLAN.md`: 18 functional responsibilities (which can overlap), work IDs W00–W14, owner approvals and pilot acceptance.

**Specific source findings:** existing `apps/web/app/FeedExperience.jsx` embeds local MP4 URL `/api/local/lessons/{id}/video`; the current backend includes a Paystack adapter and local money validation but no verified live paid entitlement. Paid-media authorization, verified webhook settlement, live Supabase/Auth/RLS, hosted video/CDN and pilot readiness remain NOT IMPLEMENTED/UNVERIFIED. No secrets, personal details of volunteers, student ID evidence or live transactions were changed here.

**Next engineering step:** W00 fresh main CI/test/build and existing route/schema inventory; then W03/W04/W05 safe identity/media creator access restrictions before paid commerce W06/W07. No application source or deployed behavior changed by this architecture milestone.

**Evidence discipline:** GitHub file-write success verifies documentation was committed, not that the full app passed tests. Check exact post-commit GitHub Actions or local runtime before making verification claims.

## 23 November 2026 — implemented and verified access-control increment (#9, #10)

**Exact application/database-contract baseline:** `d907694a9a320d1422a90d2315df971b3a782b37`. [GitHub Actions 45225243967](https://github.com/srdataml-droid/Student-creator-/actions/runs/45225243967): **171/171 Node tests passing**, Next.js locked production build **passed**, PostgreSQL 17 disposable RLS/contracts **passed**. These are CI results, **not** real Playwright/device tests, a staged Supabase migration or a deployed application.

- `301afd3`: whitelisted browser feed preview fields so full text and editorial review records do not cross the Server Component boundary.
- `6193d51`: owner-scoped persistent local creator restriction rules (view/comment/direct message), authenticated routes, audit and independent negative tests.
- `63d2c63` + `b76dfeb`: require a verified student and creator view authorization for full lesson JSON, SSR lesson page, notes downloads, comment reads and video GET/HEAD/ranges. Repaired the pre-existing backup/video tests that relied on anonymous playback. Search no longer includes private lesson text.
- `83dc10c`: Creator Studio panel to set, edit and clear independent student-account restrictions. UI passed Next production build but **manual browser acceptance has not occurred**.
- `a55de71` + `f03279c` + `d907694`: disposable PostgreSQL draft migration `db/migrations/0004_creator_restrictions.sql`, owner-only restriction-row read policy, verified-creator viewing predicate and protected published-comment RLS. A failed initial SQL-test revision was fixed; final disposable contract passed. **Draft only: not applied to hosted Supabase.**

**Issue gates:**
- **#9 W00 — partly verified:** source/routes/CI inspected; real Playwright/browser, hosted staging, production audit and backup restore rehearsal remain unavailable.
- **#10 W03–W05 — local first increment verified:** independent blocking and protected full-content retrieval; next gates are real Auth/RLS/staging, short-lived protected media grants, mobile playback, review/appeals and sign-off. Local rules and RLS draft are **not** a full paid-content or production authorization system.
- **#11 W06–W07 — not yet integrated:** payment-core quote and Paystack adapter tests already existed but no persisted purchase orders, provider-verified sandbox fulfillment, balanced journal, refunds or entitlements are connected to the application. Fee bearer, commission and access duration require founder sign-off before real charges.
- **#12 W10–W11 — not started:** no real 5–10-student alpha or 80–100 pilot, no fabricated user feedback.

**Operational risks:** GitHub reports this repository as public; keep secrets, student ID evidence and financial identifiers out of Git. A later security/privacy review should evaluate the proposed PostgreSQL public-metadata column exposures before applying hosted RLS. Do not enable live payment/withdrawals or production database changes. PR #28 remains unmerged; it is research guidance, not shipped product behavior.

**Effort accounting:** 183–364 AI-assisted founder hours remains a *planning range*. No verified founder time entries were supplied, so actual founder-hours cannot be truthfully reported.

## 23 November 2026 — W00 fresh-main source and CI audit (#9)

**Source revision audited:** `main` `5718f32e4bca06674e24fbfdd5ebe9d9491c4f23` (commit at 2026-11-23 17:15:58 UTC). [Exact-commit GitHub Actions run 45225768951](https://github.com/srdataml-droid/Student-creator-/actions/runs/45225768951) completed successfully: `test` (171/171 Node tests, zero failures, tracked-secret-file guard), `web-build` (`npm ci --no-audit --no-fund`, `npm run build`, Next.js 16.4.6 compiled), and `database-contract` (ephemeral PostgreSQL 17, `db/tests/bootstrap.sql`, migrations `0001`–`0004`, four SQL contract files). This is remote CI evidence, not a local checkout run or hosted-production acceptance. The remote GitHub commit does not expose an editable working-tree status; a separate local clone was unavailable in this audit environment.

**Actual API and user-flow inventory:** `apps/web/app/api/local/[...segments]/route.js` handles GET/POST/HEAD through `packages/local-core/src/http.mjs`: local registration/login/session, admin institutions/course creation and student verification, draft submission/review, creator follow and restrictions, bookmarks, likes, comments, notes and authorized video GET/HEAD/range, DMs, communities and study sessions. Distinct Next API route files also exist for `/api/courses`, `/api/lessons`, `/api/lessons/drafts`, `/api/lessons/[id]/submit` and `/api/lessons/[id]/moderate`. UI route files include feed, sign-in/join, creator studio/profile, lessons, search, saved posts, messages, course communities, study sessions and admin manage. This inventories existing paths; it does not claim browser end-to-end tests were executed.

**Actual data mapping:** `packages/local-core/src/store.mjs` initializes 24 SQLite development tables: `institutions`, `users`, `sessions`, `courses`, `lessons`, `topics`, `lesson_videos`, `creator_follows`, `creator_public_profiles`, `lesson_bookmarks`, `lesson_likes`, `lesson_comments`, `lesson_comment_reports`, `messages`, `user_blocks`, `creator_restrictions`, `message_reports`, `community_members`, `community_posts`, `community_reports`, `study_sessions`, `study_attendees`, `study_session_requests`, and `audit_events`. Future-hosted Postgres definitions are separate drafts in `db/migrations/0001_proposed_core.sql` to `0004_creator_restrictions.sql`; successful ephemeral SQL checks do not mean deployed Supabase RLS.

**Access and privacy boundaries inspected:** `apps/web/lib/feed-preview.mjs` explicitly selects public preview fields (not full lesson text, school-ID evidence or review records). `packages/local-core/src/store.mjs` implements `viewableLesson` with authenticated, verified creator view permission; `getVideoFile` checks publication/reviewer visibility and view permission per request. The `FeedExperience.jsx` play-button state is only a UI hint, not access control; the video and content endpoints are the real local enforcement boundary. Negative Node tests include `packages/local-core/test/creator-restrictions.test.mjs`, `local-flow.test.mjs` and `video-ci.test.mjs`. Local SQLite/media backup-and-restore helpers and tests exist; no independent real-data restore rehearsal or hosted backup was performed.

**Acceptance still open at this audit checkpoint:** no browser/Playwright journey had run on the original audited SHA; the browser check was subsequently added and passed in the separate checkpoint below. Android/mobile acceptance, live Supabase Auth/RLS, protected paid-media entitlement and PSP sandbox fulfillment, hosted staging and independent disaster-restore drill remained pending. Issue #9 stays open. No private ID documents, credentials, live money, deployment, schema activation or new branch were involved.

## 23 November 2026 — W00 reproducible Chromium browser acceptance checkpoint (#9)

**Verified code+CI revision:** `c75293fd595c58f6431f8e62cb849dfd120e755f`; [GitHub Actions run 45267112092](https://github.com/srdataml-droid/Student-creator-/actions/runs/45267112092) **succeeded in all four jobs**: 171 Node tests, locked Next.js production build, ephemeral PostgreSQL 17 schema contracts, and **Playwright browser-alpha (1/1 passing, 6.8 seconds test runtime)**. The browser job installed a pinned temporary `@playwright/test@1.56.1` outside the committed dependency lockfile, downloaded Chromium on `ubuntu-24.04`, bootstrapped an isolated SQLite database under the GitHub runner temp directory, started the actual production-built Next server, and ran `npx playwright test e2e/local-alpha.spec.mjs --workers=1 --reporter=line --trace=retain-on-failure`.

**Browser coverage actually executed:** synthetic administrator logs in and creates a disposable campus/course; two synthetic students register; unverified creator studio status is checked; administrator independently verifies both; creator saves an original draft, uploads the existing synthetic MP4 fixture, submits for review; administrator approves; viewer sees the feed and full lesson, receives successful HTTP 206 byte-range video, publishes a comment and follows the creator. Negative checks assert anonymous draft/published media denial and creator-controlled view restriction blocking authenticated video, comment retrieval and full lesson SSR. Synthetic users, random credentials and uploaded media were runner-local; no real student ID cards, real bank funds, hosted provider credentials or production data were used.

**Recorded failures and repair:** earlier browser job on run 45265703774 failed at Playwright installation because `ubuntu-latest` resolved to unsupported Ubuntu 26.04; fixed by explicitly pinning Ubuntu 24.04. Run 45266003858 reached Chromium but the synthetic administrator did not redirect after sign-in; the test host was changed to documented `localhost` and sanitized HTTP-status diagnostics were added. The final runner launch and browser test passed, without changing the product's authentication or security policy.

**Unfinished acceptance:** one green Chromium smoke is not Android testing, full browser cross-device accessibility, production hosted auth/RLS, paid entitlement playback, sandbox PSP ledger, real creator data privacy review, load capacity or a restore rehearsal. Retain the CI browser smoke for regressions; track these external prerequisites separately before any 5–10-user real alpha and later 80–100-student pilot. Issue #9 should remain open until the broader verification criteria are met.

## 23 November 2026 — W00 audit and one-student engineering checkpoint

**Audited main:** `6025269608ddbf56354dc43768fad7dc5a434f14`; [exact-commit GitHub Actions run 45276243896](https://github.com/srdataml-droid/Student-creator-/actions/runs/45276243896) **four successful jobs**: 176/176 Node tests; Next.js production build; ephemeral PostgreSQL 17 contract tests; Chromium Playwright one synthetic moderated creator/viewer scenario. These are synthetic/local verification, not a hosted/Android or human consent record. This progress-file commit itself requires a fresh exact-main CI check.

**Additional independently tested W00 evidence:** `packages/local-core/test/backup-cli-recovery.test.mjs` invokes the actual `scripts/local-backup.mjs` tool as a separate Node child process with disposable database and valid synthetic MP4. Backup → verify → clean restore recovered approved media, invalidated both old login sessions, required fresh authorized login and refused a corrupted media restore without creating a partial database. Prior unit tests additionally cover symlinks, unexpected files and SQLite corruption. This closes the **synthetic/local** restore drill, not hosted recovery (#23).

**Single-person acceptance:** `packages/local-core/test/single-student-journey.test.mjs` checks invite-only registration, duplicate signup denial, withheld author privileges before admin verification, original rights-attested draft + valid MP4 upload, separate moderation, published byte-range video, logout revocation and no full-content access after logout. Tests `pilot-enrollment.test.mjs` validate invite/cap/concurrency/old sessions. No student beyond the single invite may register when configured; administrator is distinct. No real invite or ID evidence was used.

**Media risk, not a claim of anti-piracy completion:** the local MP4 stream can be fully downloaded by an authorized viewer. At inspected main, a new scoped playback-cookie issuance feature exists, but media GET/HEAD did not yet require verifying that cookie; this was recorded as HIGH in [#10 security review](https://github.com/srdataml-droid/Student-creator-/issues/10#issuecomment-7115331157). Do not count a UI playback button as server enforcement or DRM. See [one-person media threat model](security/ONE_STUDENT_MEDIA_SECURITY_AND_RELEASE_GATES.md).

**W00 completion boundary:** accurate main SHA, latest test/build/browser/database status, source/route/DB/media inventory, local backup restore evidence and remaining real-world blockers have been recorded. W00 can be closed **as a development source/CI audit** when its final SHA's workflow passes. It must not be interpreted as hosting readiness, real student verification, native screenshot prevention or merchant release. #10 (private media/identity), #23 (dedicated hosted staging+real backup), #24 (privacy/copyright terms), and #12 (single consenting human's actual task acceptance) remain open separately. Prior references to an immediate 5–10 or 80–100-person pilot are superseded by **one person first**.
