---
name: qa-release
description: Verify app changes with exact-commit Node/Next/Postgres/Playwright test evidence, security failure cases, rollback and staged release gates.
---

# qa release

## When to use
Use for related GitHub issues and features; this file is scoped guidance, not a granted external permission.

## Procedure
Read .github/workflows/ci.yml and the exact current source files. Define behavior-based positive and negative tests before risky changes. Use npm test, the app's locked Next.js build and Postgres contract jobs; add Playwright for real browser creator/viewer/moderator flows and real-device checks where possible. Record commands, exact commit SHA, failures and environment. Check recovery, admin permissions and privacy/financial issues. Do not call docs, mocked tests, old CI runs or a merge a production verification. Refuse unsafe release until gaps are documented and owner authorizes.

## Output checklist
- Linked issue, role, required decision and user behavior.
- Source URLs/paths inspected; separate verified behavior from proposal.
- Risks/negative tests; exact results and commit SHA.
- Acceptance/status and next step; do not invent success or approval.
