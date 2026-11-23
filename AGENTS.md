# Student Creators Platform — AI Coding Agent Instructions
This repository is **srdataml-droid/Student-creator-**. The older school-learning-platform repo is NOT the active application. Read README.md, docs/PRODUCT_SCOPE.md, docs/PROJECT_PROGRESS.md, docs/architecture/{01_SYSTEM_CONTEXT_AND_CONTAINERS,02_DOMAIN_DATA_AND_SECURITY_CONTRACTS,03_ROLES_WORKSTREAMS_AND_RELEASE_PLAN}.md and docs/researches-and-tasks/00_INDEX_AND_LEARNED_FLOWS.md before broad implementation work.

## Product contract
Verified tertiary students are creators and viewers in a social-video marketplace. The default experience is a creator-first feed, not an LMS. Author retains copyright over work they own; buyer purchases a defined ACCESS entitlement, not the work, source media or copyright. Only verified consented activity, auditable earnings, safe platform/creator restrictions and compliant payouts. Pilot target 5–10 alpha and up to 80–100 students after safety and finance gates.

## Engineering obligations
- Use **this repository**. Current user requested research work on branch researches-and-tasks; do not create extra repos. Do not merge research code or bypass protected main checks without founder authorization.
- Inspect existing files and tests first; preserve social feed, profiles, local SQLite, moderation and payment-core. No rewrite for its own sake.
- For every feature: requirement -> owner/role -> acceptance and negative tests -> implementation -> independent tests -> source SHA + status -> operation/recovery notes.
- Frontend is untrusted. Never expose keys, raw ID documents, private messages or banking info. Apply authorization at backend, data and media layers.
- Paid content demands a server-issued short-lived playback grant after restrictions AND verified entitlement. Current development MP4 URL is not protected paid playback.
- Never grant content from a payment redirect; PSP signature alone is insufficient. Verify amount/currency/reference/environment/status against trusted order, then idempotently allocate entitlement and balanced journal.
- Never claim an actual bank transfer, payout, successful hosted deployment, browser test, comprehensive code audit or verified CI without that evidence.
- Local Node 22+ and Next.js/React. Root npm test, Next build in apps/web, disposable Postgres contract and browser E2E as applicable. Keep staged SQL separated from production.
- No real student data or synthetic cash metrics in public GitHub files. Do not invent interviews, team consent or signoff.

## Working with role-specific skills
Use targeted .agents/skills subdirectories when the task matches:
product-discovery, architecture-lead, ux-creator-flows, secure-content-access, payments-ledger, media-upload, qa-release, team-leadership.
Each skill produces a small source-grounded deliverable and reports gaps. Loaded skills do not grant external credentials or special deployment privileges.

## Delivery note template
Task and linked issue; current branch SHA; source paths inspected; changes; exact test commands and results; risk/privacy check; CI/build/browser evidence; blockers; owner decision; next task. A planning document is not proof that a feature works.
