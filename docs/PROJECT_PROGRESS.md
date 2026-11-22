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

**Review boundary:** changes are committed directly to the previously empty `main` branch at the owner's explicit request to populate it. Future significant changes should use team-reviewed PRs.

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
