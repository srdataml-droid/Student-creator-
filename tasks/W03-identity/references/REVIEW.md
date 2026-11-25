# Isolated upstream reference — Resend Node utility

Source: https://github.com/resend/resend-node/blob/f469296e8affa8be59d9c1f73119909ec1554bc7/src/common/utils/has-dot-segment.ts
Source version: `f469296e8affa8be59d9c1f73119909ec1554bc7` (repository commit)
License: MIT, copyright (c) 2023 Plus Five Five, Inc. A complete copy accompanies the file.
Purpose: examine canonical URL dot-segment rejection logic for potential safe handling of provider paths; **not yet adapted or executed**.

**Static review at intake:** A single self-contained TypeScript function checks dot-path segments and URL parser normalization; no network calls, analytics, cookies, tokens, environment variables, subprocesses, dynamic code or external dependencies in this file. This is only a *file-level inspection*, not a full provenance/dependency audit or guarantee the upstream package is free of tracking/malware. Maintain an isolation boundary: do not import this under `apps/web/` or `packages/` until separately reviewed and covered by regression tests.

**Admission verdict:** safe enough to store as nonexecuting reference for later review; **NOT cleared for application use**. Note that source code from non-licensed/public-only repos must never be staged.
