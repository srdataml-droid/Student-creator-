# W11-pilot — Student Creators candidate-code workspace

**Week 06; branch `work/week-06`**

Work scope: Gradual evidence-gated enrollment; no outreach without approval.

These Week 1–8 groupings are **provisional groupings of the existing W00–W14 engineering workstreams**, not a previously approved detailed eight-week delivery schedule. Week 1 is the only active implementation target. Do not merge this branch into main or run external code merely because a repo is public.

## Candidate workflow
1. Find an existing implementation in GitHub or official SDK docs.
2. Record exact repository URL, upstream commit/tag and file path. Inspect its license; **public does not imply permission to copy**.
3. Review source and all dependencies/scripts for malicious behavior, telemetry/tracking, secret leakage, exfiltration and insecure defaults. Run isolated static checks; do not use private credentials.
4. Only then stage a narrowly scoped, attributed copy under this task's `references/` directory; never execute reference files directly from the app runtime.
5. Adapt in dedicated feature PR, test denied access and negative cases, and verify CI before any promotion into `main`.

## Status
- Candidate code: Not admitted until license/provenance/security review (unless a separate documented reference appears alongside this file)
- Implementation: Deferred; research only
- Main integration: Not authorized by this template

Primary tracker: https://github.com/worthkind/Student-creator-/issues/34
