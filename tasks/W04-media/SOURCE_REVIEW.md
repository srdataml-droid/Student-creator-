# Upstream code candidate — Mux signed media

Source repository: https://github.com/muxinc/mux-ts
Upstream commit: `ff214916fd71161fe2a688e04c564b8a3febb3aa`
Upstream SDK license: Apache-2.0 (checked license file and package metadata on 2026-11-24).
Relevant public example: https://github.com/muxinc/mux-ts/blob/ff214916fd71161fe2a688e04c564b8a3febb3aa/examples/create-asset.ts

**Security finding:** The example explicitly creates an asset with `playback_policies: ['public']`, lists assets and prints asset information. This is **not acceptable unchanged** for paid/student-gated content. Copying it into an executable folder would risk provisioning publicly accessible media, disclosure in logs and unintended provider/API calls. The example was intentionally **not copied or executed**.

Candidate usage: consult the official Mux SDK/API interface, but implement signed playback, verified ownership, verified idempotent webhooks, bounded tokens and no unsafe logs. Existing isolated Week 1 helper is in draft PR #35 and must be connected/tested before production use. No security clearance for the full Mux SDK or its transitive dependencies has occurred.
