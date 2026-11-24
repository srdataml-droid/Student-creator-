# Student Creators — engineering agent instructions (Week 1 active)

You are working on **Worthkind Student Creators**, the university-student-only, creator-first video/social learning marketplace. This is **not** Worthkind Flow, Hotel OS, an LMS, or a prototype-only rebuild.

## Binding objective
**Finish and verify Week 1 before implementing Weeks 2–8.** Reuse the existing Next.js/Node app and security tests. The only active engineering scope is safe hosted backend foundations and verification, not launching, onboarding real students, or widening the pilot.

**Canonical repository:** `worthkind/Student-creator-`. **Tracking:** GitHub Issue #34, plus linked Issue #10 (identity), #11 (commerce), #12 (pilot), #23 (hosting), #24 (privacy), PR #32 (institutional appeals) and PR #35 (Mux signed playback foundation). Avoid the outdated former owner and do not overwrite existing main changes.

## Self-directed work loop
1. Inspect current `main`, open PRs, CI evidence at the **exact head SHA**, and #34 comments. Never treat previous green runs as evidence for new commits.
2. Pick one highest-priority, safe, unblocked **Week 1** defect. Inspect source and relevant tests first. Prefer small, isolated, reversible commits to a dedicated branch/PR.
   **Before implementation** search GitHub for an existing solution. Use isolated `work/week-01` through `work/week-08` branches with a `tasks/Wxx-name/` folder per workstream. Inspect upstream `LICENSE`, exact revision, source, dependency tree, telemetry/tracking, network calls and execution scripts. A public repo without an appropriate license is not copyable. Stage permitted upstream snippets with attribution and their full license under `references/` **for review only**, never automatically import/run them. The eight branch groups are provisional until the founder confirms a detailed Week 1–8 breakdown. Weeks 2–8 are research-only until Week 1 is verified.
3. Implement the real behavior with explicit authorization, error handling, and negative tests. A standalone helper or proposed schema is **not** a wired production integration.
4. Run local targeted tests, then verify GitHub's complete job results (unit tests, build, paid-media browser, browser acceptance, PostgreSQL contract). Fix failures; preserve security invariants.
5. Record commit SHA, exact commands, CI run links, verified outcomes and any blockers in #34. Continue only from the next unresolved Week 1 requirement.

## Week 1 exit gates
- **Identity/data:** dedicated founder-owned Supabase staging project, actual Auth/session checks, staged schema with least-privilege RLS, private media/identity buckets, verified cross-account denials, and isolated backup restore.
- **Video:** Mux signed-only assets, ownership-controlled uploads, webhook signature and idempotency, server-authorized short-lived playback, processing and deletion states, and player acceptance.
- **Communication/classes:** verified Resend sending/recovery and notifications; role-scoped LiveKit room/token lifecycle. Don't present calendar scheduling as live streaming.
- **Payments:** Paystack **test mode only**, verified server amounts/reference/NGN currency/signature, atomic idempotent entitlements, replay/refund/chargeback tests and non-withdrawable synthetic accounting.
- **Deployment/quality:** Vercel staging configuration with correct server-side variable names, all five exact-head CI jobs green, security and device acceptance, and real end-to-end tests. Sentry/Firebase when configured.
- **Governance:** admin-only moderation, student verification and appeals (never automatic approval), private student-ID handling, creator rights, strict role isolation.

## Existing verified constraints
The founder reports service credentials set in Vercel apart from Sentry/Firebase. Vercel environment names currently include lowercase aliases such as `supabase_url` instead of `SUPABASE_URL`; **never log, echo, commit, or paste values**. A compatible server-only config validator is being introduced. Supabase project `jnkqmlbkkvccnxrgkpno` was observed healthy but had no tables in the `public` schema at inspection. Configured credentials do not establish functioning service integrations.

## Hard boundaries
No public deployment, live payments, purchases, spending, real student enrollment, student ID submission, synthetic-to-real balance conversion, force-push, or destructive production migration without explicit founder authorization. Do not introduce fake app activity. A Friday pitch does not waive these gates. If a service cannot be reached, report the precise blocker and implement independently testable code rather than inventing success.

## Reporting
Separate **implemented**, **locally tested**, **CI verified**, **hosted tested**, and **not yet integrated**. The existing hourly engineering follow-up may advance authorized work, but do not claim unattended execution or future completion unless a run actually performed it. Preserve creator-first UX and the Stitch design handoff independently from backend changes.
