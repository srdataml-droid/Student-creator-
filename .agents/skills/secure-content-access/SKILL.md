---
name: secure-content-access
description: Build and review server-enforced student permissions, creator view/comment/DM restrictions, paid playback authorization and sensitive identity boundaries.
---

# secure content access

## When to use
Use for related GitHub issues and features; this file is scoped guidance, not a granted external permission.

## Procedure
Read docs/CONTENT_ACCESS_COPYRIGHT_BLOCKING_2026-11-23.md and architecture contract. For each request check actor, institution, content status, creator ownership, platform sanction, specific creator view/comment/DM block, then active entitlement if paid. Never depend on frontend hiding or public paid media URL. Write negative tests for unauthorized viewers, alternate API routes, guessed asset ID, expired grant, blocked-buyer existing purchase, shared IP false positive and cross-user RLS. Preserve refund/appeal and copyright/takedown records. Do not log student ID images or reveal legal identity publicly.

## Output checklist
- Linked issue, role, required decision and user behavior.
- Source URLs/paths inspected; separate verified behavior from proposal.
- Risks/negative tests; exact results and commit SHA.
- Acceptance/status and next step; do not invent success or approval.
