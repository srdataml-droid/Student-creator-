# Student Creators Platform — implementation checklist

**Repository:** `srdataml-droid/Student-creator-` (this repository, not the older school-learning-platform)
**Execution mode:** in-session engineering with GitHub commits/checkpoints; no unsupported background agent.
**Current stage:** mobile creator feed and persistent social follow system. Review GitHub Actions at the exact commit before merging/deploying.

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
| 9 | Creator follows and Following feed | Implemented, current CI check pending | `creator_follows`, follow API, profile button, new tests |
| 10 | Post likes, comments, follow notifications | **Likes + moderated comments merged/tested locally** | [PR #2](https://github.com/srdataml-droid/Student-creator-/pull/2) + [PR #4](https://github.com/srdataml-droid/Student-creator-/pull/4), main `338b1457`; authenticated replay-safe likes, comment removal/report review, synthetic HTTP + disposable PG CI success. Follow notifications remain planned; nothing deployed. |
| 11 | Creator profile names, photos, original-work type and pricing controls | **Public name/handle in review; media and pricing planned** | Local verified student alias edit with reserved-identity checks, handle uniqueness, public-only-after-approval, PostgreSQL RLS migration and tests on this branch. Never expose legal ID/email. Photos, original-work classification and prices remain unimplemented. |
| 12 | Premium posts/subscriptions and entitlement access | Planned/blocked | Dedicated managed DB and PSP sandbox required |
| 13 | Creator bank setup and PSP settlement split | Blocked | Provider eligibility, user approval, finance/legal review |
| 14 | Creator sales dashboard, refunds/reconciliation | Planned | Transactional ledger + actual provider evidence |
| 15 | Production Auth/RLS/storage and moderation | Blocked | Dedicated Supabase project not supplied |
| 16 | Browser E2E, load, accessibility, backups and monitoring | Incomplete | CI unit/build checks do not equal browser tests |
| 17 | Staging deployment and production verification | Not started | Real hosted deployment, security audit, pilot, explicit launch gate |

## Exact continuation
1. Inspect latest `main` commit and its GitHub Actions test, web-build and disposable DB job conclusions.
2. If any CI failed, inspect first failed step and fix before feature work.
3. Likes and comments already merged with exact-main CI. Verify this public-alias branch's fresh test, web-build, database-contract and post-merge main before marking it done. Follow notifications and hosted persistence remain next work after identifying the app-specific database.
4. Complete and verify creator alias privacy and cross-school public rules; photos, original-work classification and pricing/entitlements remain separately gated.
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
