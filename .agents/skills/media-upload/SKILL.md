---
name: media-upload
description: Implement safe creator-owned video intake, resumable uploads, media processing, protected playback and real mobile bandwidth measurements.
---

# media upload

## When to use
Use for related GitHub issues and features; this file is scoped guidance, not a granted external permission.

## Procedure
Read current local MP4 path, 25MiB development limit and tus/Mux/Video.js reference summaries. Compare managed video vendors before adoption; keep upload session short-lived, validate creator rights and file types, quarantine/encode unsafe input. Permit interrupted upload resume when supported; separate public preview from paid protected playback with signed short-lived grants. Test network interruption, invalid header, processing failure, creator/viewer block, resource exhaustion, device/mobile data savings and delivery-minute cost. Do not self-host a CDN at pilot scale or promise DRM prevents recording.

## Output checklist
- Linked issue, role, required decision and user behavior.
- Source URLs/paths inspected; separate verified behavior from proposal.
- Risks/negative tests; exact results and commit SHA.
- Acceptance/status and next step; do not invent success or approval.
