---
name: architecture-lead
description: Map current Next.js, Node, SQLite, future Postgres and vendor boundaries with C4 and lightweight architecture decisions before significant engineering changes.
---

# architecture lead

## When to use
Use for related GitHub issues and features; this file is scoped guidance, not a granted external permission.

## Procedure
Read docs/architecture/01_SYSTEM_CONTEXT_AND_CONTAINERS.md, 02_DOMAIN_DATA_AND_SECURITY_CONTRACTS.md and source files rather than trusting summaries. Make context/container/component Mermaid diagrams, label current vs proposed. Recommend a modular monolith at pilot scale, preserve existing code, map data ownership/auth trust, vendor failures and rollback. Document an ADR with alternatives, risks, costs, changes and acceptance evidence. Never mark target services deployed merely because they appear in a diagram.

## Output checklist
- Linked issue, role, required decision and user behavior.
- Source URLs/paths inspected; separate verified behavior from proposal.
- Risks/negative tests; exact results and commit SHA.
- Acceptance/status and next step; do not invent success or approval.
