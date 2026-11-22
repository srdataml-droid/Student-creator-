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
| 10 | Post likes, comments, follow notifications | **Comments in review** | Likes are merged in PR #2. This PR adds verified-student comments, owner soft-removal, private reports, independent moderation, HTTP integration tests and a separate PostgreSQL RLS contract. Follow notifications remain planned. No hosted database migration applied. |
| 11 | Creator profile names, photos, original-work type and pricing controls | Planned | Creator identity vs school verification, privacy |
| 12 | Premium posts/subscriptions and entitlement access | Planned/blocked | Dedicated managed DB and PSP sandbox required |
| 13 | Creator bank setup and PSP settlement split | Blocked | Provider eligibility, user approval, finance/legal review |
| 14 | Creator sales dashboard, refunds/reconciliation | Planned | Transactional ledger + actual provider evidence |
| 15 | Production Auth/RLS/storage and moderation | Blocked | Dedicated Supabase project not supplied |
| 16 | Browser E2E, load, accessibility, backups and monitoring | Incomplete | CI unit/build checks do not equal browser tests |
| 17 | Staging deployment and production verification | Not started | Real hosted deployment, security audit, pilot, explicit launch gate |

## Exact continuation
1. Inspect latest `main` commit and its GitHub Actions test, web-build and disposable DB job conclusions.
2. If any CI failed, inspect first failed step and fix before feature work.
3. Verify the exact head SHA and test, web-build and database-contract checks on the likes PR. Likes are local-only until a dedicated Student Creators Supabase project is confirmed; PostgreSQL RLS schema is a CI-tested draft, not deployed. This comments PR must pass exact-head local HTTP and disposable PostgreSQL checks before merge. Follow notifications and hosted persistence remain next work after identifying the correct app-specific database.
4. Add creator profile custom display names with anti-impersonation controls; keep legal student identifiers private.
5. Separate accepted data model for paid posts and subscriptions from free content, then integrate with dedicated Supabase and PSP sandbox only when available.

**Security:** The app is not deployed. SQLite is only a development store. Do not unlock paid media on browser return; only trusted verified server-side payment and atomic entitlement updates may grant access. Provider secrets stay server-side. No school IDs, fake creator earnings or seed-user credentials in Git.

**Review boundary:** changes are committed directly to the previously empty `main` branch at the owner's explicit request to populate it. Future significant changes should use team-reviewed PRs.

## New comment workflow — 22 November 2026
- Existing PR #2 on main already implements likes: this branch deliberately **does not** replace, duplicate or reset that code.
- Local development server now has POST/GET comments, persistent idempotency, 20-comments/hour cap, author-owned soft removal and report/independent administrator hide/dismiss actions. Public replies display a pseudonym, never personal email.
- PostgreSQL `db/migrations/0002_creator_comments.sql` keeps browser mutation of comment and moderation tables denied; all access-control tests run on disposable PostgreSQL CI only. This is not yet a hosted authenticated implementation.
- Still blocked: approved Student Creators Supabase project and media storage, production authentication, actual moderation operations and audits, real-device/browser accessibility testing, paid content entitlements and settlement.
