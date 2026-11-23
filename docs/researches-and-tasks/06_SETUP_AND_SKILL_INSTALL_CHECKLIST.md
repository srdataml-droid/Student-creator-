# Installation and Setup Checklist — Actual State
Date: 2026-11-23 · Branch researches-and-tasks.

## Installed in THIS repository (version-controlled, not yet merged to main)
- Root AGENTS.md, .github/copilot-instructions.md.
- Eight Agent Skills under .agents/skills/[skill]/SKILL.md: discovery, architecture, UX, secure-access, payments, media, QA and leadership.
- GitHub issue templates engineering-task.yml and learning-task.yml.
- Research, system maps, time estimates, leadership roadmap and work catalog under docs/researches-and-tasks/.

**Agent skills** are repository files recognized by compatible tools when the repo and version are accessible; they are not executable software packages and have not been independently invoked/tested by an external coding agent in this session. They must be used on a checkout of this branch or after the reviewed merge. Official GitHub Copilot paths: https://docs.github.com/en/copilot/reference/customization-cheat-sheet ; Codex skills: https://developers.openai.com/blog/skills-agents-sdk.

## Existing repo tooling (not installed by these commits)
Node.js >=22.16, npm, Next.js/React, built-in node:test, SQLite local mode, CI with disposable PostgreSQL 17 contract. Use existing lockfile. Known commands from README:
- npm ci --prefix apps/web
- npm test
- APP_DATA_MODE=local npm run dev --prefix apps/web
- npm run build --prefix apps/web
Do not commit .env keys or real seed users.

## Developer workstation setup (USER ACTION; not remotely completed)
1. Clone or pull srdataml-droid/Student-creator- and checkout researches-and-tasks for this planning packet.
2. Review AGENTS.md and relevant .agents/skills task descriptions; select one primary coding agent (Codex OR Copilot) to start, not six subscriptions.
3. Install Node 22+ and repo dependencies on local machine only; run test and Next build. Capture actual logs.
4. Optional: VS Code/VSCodium + GitHub CLI (gh), Figma/Penpot, Playwright browsers when the test task is ready.
5. Connect only the approved staging Supabase/Paystack/video environments; separate secrets from repo; MFA on each provider.
6. Invite volunteer testers through explicit roles and permission scopes, not by sharing owner passwords.
7. If testing the GitHub issue forms, open New issue and select Engineering / Product Delivery Task or Learn and Apply.

## GitHub Projects board / goal fields (NOT created by connector)
The available GitHub connector can create issues/branches/docs but does not currently offer setup for GitHub Projects board, iteration/date custom fields or milestones. Founder can create one GitHub Project UI tied to this repo and use:
- Board columns: Proposed, Ready, Doing, In Review, Verified, Released, Measured, Blocked.
- Fields: Workstream, Role, Priority P0–P3, Estimate Hours, Actual Hours, Start Date, Target Date, Iteration, Blocker and Evidence URL.
- Timeline: 1-week iterations and dates from 04_GOALS_ROADMAP_AND_LEADERSHIP.md; update after W00 verification.
- Views: Board for active work, Table for backlog, Roadmap for milestones, filtered Learning view for exercises.
Docs: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/quickstart-for-projects.

## ChatGPT plugins and external integrations
Notion is available as a connected plugin, but we choose **GitHub Issues as single source of truth** to avoid duplicates. Superpowers (third-party development methodology) can be connected by user action if desired; it is not required for these repo-local skills. No external plugin can be assumed installed just because we suggested it. Never claim account creation, subscriptions, licenses or tools installed on the user's device without explicit verification.

## Time/cost reminder
Avoid paid tools until needed by a real work item. First priority: actual main CI/test/route audit, not shopping for a new engineering suite.
