# Student Creators Platform

**A campus-first social network and creator marketplace, by Worthkind.** Students can become creators and viewers, share original short/long videos, work they personally completed and may lawfully publish, study notes and projects; follow creators, join course communities, save posts and privately message other students.

**This is the actual application repository:** https://github.com/srdataml-droid/Student-creator-

## What already runs in development
- **Creator-first homepage** at `/`: responsive feed of published creator post previews, verified-student video playback, filtering, local search, and save-post actions.
- **Creator profiles** at `/creators/[creatorId]`: published content, private-message CTA, follow/unfollow and follower count.
- **Following feed:** account-scoped followed creators, stored persistently in the SQLite development database.
- **Approved-post likes:** verified student accounts can like or unlike public lessons with owner-scoped state, duplicate-safe persistence, and rate controls. The local adapter and a proposed PostgreSQL/RLS schema are separate; this is not a hosted social feature yet.
- **Studio:** students submit original text lessons and MP4 videos; a distinct administrator approves or rejects submissions before public discovery.
- **Campus/course discovery**, searchable lessons, bookmarked posts, course communities, one-to-one messages (with opt-in/block/report), and scheduled group study sessions.
- **Local SQLite** persistence and video files, backup/restore, and HTTP tests. Full posts, notes downloads, comment threads and MP4 playback now require a verified student and creator view permission; visitor previews remain public. An admin must create the first campus/courses and verify learners; there are **no fictitious students, posts, payments, view counts or payouts**.

This is a real local Node/Next.js application, **not yet a public multi-user production deployment**. Its file-based SQLite backend is deliberately disabled on stateless serverless hosts. Use dedicated Postgres/Supabase and media infrastructure before public launch.

## One-student alpha registration gate (not a public launch)

The first rollout milestone is **one** privately invited, consenting student. Keep the SQLite test environment isolated. Before launching the local server, set both server-only settings: `PILOT_STUDENT_CAP=1` and `PILOT_STUDENT_EMAIL` to the approved student's normalized email. Enter the real email privately at runtime, **not in a tracked file or GitHub issue**. Restart the server when changing pilot settings; the first-stage local quota does not migrate to hosted Supabase automatically.

The server rejects uninvited registrations and a second student account, and denies old student sessions when the invite changes. An administrator account is separate and may independently verify and moderate. The student should upload only consented original work; no private student ID evidence, production payments or confidential videos should be entered into the public GitHub repository. The gate does **not** prevent an authorized viewer downloading the local plain MP4 or capturing their screen.

This is a development safeguard, **not proof that the app is hosted or suitable for real student identity evidence**. Stage 2 (100) and Stage 3 (1,000) are postponed until security, private media, real-device, backup and operator gates pass. [Authoritative rollout checklist: Issue #12](https://github.com/srdataml-droid/Student-creator-/issues/12).

## Run it locally

Requirements: Node.js **22.16+**, npm, and a local filesystem where the server can persist SQLite and media. On Node 22, `node:sqlite` is experimental.

```bash
git clone https://github.com/srdataml-droid/Student-creator-.git
cd Student-creator-
npm ci --prefix apps/web
npm test
```

Create the first administrator **without putting the password in a checked-in file or shell history**:

```bash
export LOCAL_ADMIN_EMAIL='admin@your-school.example'
read -r -s LOCAL_ADMIN_PASSWORD
export LOCAL_ADMIN_PASSWORD
npm run local:admin
unset LOCAL_ADMIN_PASSWORD LOCAL_ADMIN_EMAIL
```

Start the web app:

```bash
APP_DATA_MODE=local npm run dev --prefix apps/web
```

Open **http://localhost:3000**. Use `/manage` to create a university and courses, `/join` to register a student, then approve the student using the admin panel. Students can publish from `/studio`; approved posts appear in the public creator feed. Video development uploads are limited to 25 MiB and must pass format restrictions. This is not malware scanning or professional media transcoding.

**Important:** No sample content is seeded. The first feed is an intentional, designed invitation to create—not an empty crash. The site will contain actual posts only after creators publish and moderators approve them.

## Verification
GitHub Actions runs unit/SQLite integration tests, a disposable PostgreSQL schema contract, and the pinned Next.js production build. Example successful end-to-end CI for the feed: https://github.com/srdataml-droid/Student-creator-/actions/runs/44884987176 . Each new commit gets its own check; do not assume later commits passed until their own run finishes.

## What is not live
- Supabase authentication, hosted Postgres, storage and production access policies.
- Paystack checkout, creator bank verification/subaccounts, payment splitting, paid content unlocks, recurring subscriptions, refunds or settlements.
- Creator-set paid price display, verified bank payout setup, real earnings balances. Granular creator restriction APIs are implemented in local mode, but settings UI, hosted RLS and paid entitlements remain incomplete.
- Mobile-native app, adaptive video transcoding, production moderation and platform deployment.

The intended **core business model is paid creator content, subscriptions and permissible private tutoring/feedback**, with transparent creator/platform revenue sharing. Ads are **not** required. Payment-domain code exists, but no successful test transaction or production settlement is claimed.

Content must be original or permission-cleared. Buying an example does not transfer its copyright. Do not facilitate submitting another student's work as one's own.

See [project progress](docs/PROJECT_PROGRESS.md) and [product scope](docs/PRODUCT_SCOPE.md). Never commit keys or real student ID documents.


## November 23, 2026 — Creator-first pilot and research handoff

The founder has confirmed the student-only creator-economy model: creators retain copyright; viewers buy limited **access** (not content ownership); the ACTIVE rollout targets **one consenting student first**, then **100**, then **1,000**, each behind independent engineering and founder approval gates (see Issue #12). Creator-controlled view/comment/message restrictions, a secure paid-access model, direct monetization, portfolios, and future globally localized markets are tracked here as **requirements**, not implemented production features.

- [Founder product blueprint and owner decisions](docs/CREATOR_FIRST_PRODUCT_BLUEPRINT_2026-11-23.md)
- [Paid access, creator rights, monetization research and global strategy](docs/CREATOR_COMMERCE_RIGHTS_AND_GLOBAL_STRATEGY_2026-11-23.md)
- [80–100-student pilot and engineering release gates](docs/PILOT_AND_ENGINEERING_RELEASE_PLAN_2026-11-23.md)
- [Product lifecycle and system flow diagrams](docs/PRODUCT_LIFECYCLE_AND_SYSTEM_FLOWS_2026-11-23.md)
- [Detailed creator access, copyright and blocking acceptance contract](docs/CONTENT_ACCESS_COPYRIGHT_BLOCKING_2026-11-23.md)
- [Monetization, qualified-view reward, referrals and global currency notes](docs/MONETIZATION_GLOBAL_AND_REFERRALS_2026-11-23.md)
- [80–100-student engineering test and release matrix](docs/PILOT_100_STUDENTS_RELEASE_PLAN_2026-11-23.md)

**Status:** These documents do not claim video entitlement security, Paystack payments, payouts, Supabase staging or public deployment are complete. Continue development in this repository rather than the older `school-learning-platform`.

## Architecture and workstream planning — 23 November 2026

This active repository uses **main** for the current founder-directed work; no alternative application repo or feature branch is being created for this architecture phase.

- [C4 architecture and system boundaries](docs/architecture/01_SYSTEM_CONTEXT_AND_CONTAINERS.md) — actual local app vs proposed hosted platform; users, services, deployment and trust boundaries.
- [Domains, API/data contracts, licensing and security](docs/architecture/02_DOMAIN_DATA_AND_SECURITY_CONTRACTS.md) — creator copyright, purchasing *access*, content restrictions, identity, transactions and tests.
- [Team roles, deliverables and implementation workstreams](docs/architecture/03_ROLES_WORKSTREAMS_AND_RELEASE_PLAN.md) — role ownership, creator-tester involvement, W00–W14 work items and staged pilot gates.
- [Expert and open-source engineering research](docs/EXPERT_ROLES_AND_OPEN_SOURCE_PLAYBOOK_2026-11-23.md) — source-linked product, architecture, payment, video and reliability practices.

**Status:** The links above are architecture/implementation plans, NOT confirmation that paid access, hosted streaming, real payouts or global functionality work. See [Project Progress](docs/PROJECT_PROGRESS.md) for tested vs blocked state.

### First tracked engineering work (same repository)

- [#9 — W00: Audit current main, test CI/build and inventory routes](https://github.com/srdataml-droid/Student-creator-/issues/9)
- [#10 — W03–W05: Verified student and creator viewing/comment/DM restrictions](https://github.com/srdataml-droid/Student-creator-/issues/10)
- [#11 — W06–W07: Paid viewing access, sandbox transactions and ledger](https://github.com/srdataml-droid/Student-creator-/issues/11)
- [#12 — W10–W11: Creator-user alpha and controlled 80–100-student pilot](https://github.com/srdataml-droid/Student-creator-/issues/12)

These issues are **open plans**; do not interpret their existence as completed features. Founder-approved small changes on main only, with exact-commit test evidence.
