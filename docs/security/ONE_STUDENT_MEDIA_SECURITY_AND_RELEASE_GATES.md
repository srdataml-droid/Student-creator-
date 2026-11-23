# Student Creators — One-Student Media Security and Release Gates

**Scope:** one consenting tertiary student, one original lesson/video; future 100 and 1,000 cohorts NOT authorized by this checkpoint. GitHub #9, #10, #12 and #23. No production media/provider access is implied.

## Source-grounded boundary (local development)

- `packages/local-core/src/http.mjs` routes an MP4 upload/read through `/api/local/lessons/{lessonId}/video`. The server obtains the real cookie/session actor; `packages/local-core/src/store.mjs` checks publication and creator permissions. Feed controls are only a user-experience hint; server checks matter.
- Local `*.sqlite.media` files are stored in a private local directory, not a public asset path. HTTPS, private hosted storage, scanned/transcoded uploads, hardware DRM and media CDN remain **unverified/not complete**. Do not deploy this SQLite adapter on a stateless host.
- **Proven limitation:** a fully authorized viewer can GET the entire plaintext MP4 (or reassemble it from byte ranges); `packages/local-core/test/single-student-journey.test.mjs` explicitly verifies this. A developer tool, browser network viewer or yt-dlp-style HTTP client with valid browser credentials can therefore save a copy. Hidden controls, blocked right-click, changing file extensions or ordinary HLS fragments do not solve this.
- A scoped playback cookie or short-lived signed URL narrows who can request which stream for how long. It does **not** encrypt the actual bytes or stop a currently authorized user capturing them. Use different language for **access control**, **download deterrence**, and **DRM**.
- Browser JavaScript cannot reliably prohibit OS screenshots, operating-system recording, or an external camera. On supported future native Android surfaces `FLAG_SECURE` and platform DRM may interfere with direct capture, but rooted devices/external recording still evade this; web-only playback does not have that control.

## Threats and mandatory negative tests

| Threat | First-student check | Expected behavior |
| --- | --- | --- |
| Guess/share published video URL while signed out | GET, HEAD, suffix/invalid/multiple ranges | All unauthorized full-video requests denied; no response-body leak |
| Draft/private video enumeration | Guess another or unapproved lesson ID | No unapproved content available |
| Suspended/unverified student | Replay existing or new session | Server denies full content and streaming |
| Creator view block | GET, HEAD, Range and lesson pages | Fail closed, not just hidden in UI |
| Reused/expired playback grant | Token replay, changed account, logout/revocation | Deny authorization; no token in logs, query strings or public page JSON |
| Valid viewer saving video | Full GET and sequential byte ranges | **Current known gap**: ordinary MP4 can be saved; DRM/provider decision needed for paid premium video |
| Wrong/original storage URL | Direct public-bucket/CDN access | Must be inaccessible without authorized provider protection |
| Unapproved MP4 / malware / upload interruption | Invalid boxes, codec, scanning status, incomplete upload | No publication; durable safe errors |
| Stolen session/rapid requests | Security event/rate/session tests, expiration | Deny revoked access, detect and limit abuse; recognize rate caps do not eliminate downloads |
| Screenshots / screen recording | Android and supported browser empirical tests | Record supported protection and bypasses; NEVER promise perfect capture prevention |
| Privacy unsafe watermark | Real student ID, legal name, email in video overlay/logs | Reject; use only a random pseudonymous session reference |

## Hosted design gate (NOT implemented by this document)

1. Dedicated Student Creators staging environment (not shared with landlord/hotel/business apps), hosted Auth and scoped session policy. Do not trust `raw_user_meta_data` for verification or RLS. Student verification review/appeals stored separately from public aliases.
2. Private source/media/quarantine buckets with least-privilege policies, no public original; quarantine, malware/format inspection and provider-side transcoding prior to publication.
3. On each request validate: signed-in + verified + non-suspended + allowed campus/content + creator view permissions + published status; for any paid lesson require trusted, non-reversed entitlement too. Grants must bind session/user/lesson, expire quickly, be revocable and not disclose provider keys.
4. Confirm provider-side URL/origin protection and whether production paid videos warrant Widevine/FairPlay/PlayReady DRM with license-server authentication. Signed URLs or HLS alone **do not equal DRM**. Test low-cost Android/slow-network compatibility and operating costs before decision.
5. Provide privacy-reviewed deterrent watermarks if justified. Avoid permanent personal details; do not degrade caption readability, screen-reader access or support for legitimate note-taking.
6. Exercise 1-student local/hosted backup restoration, secret-safe logs, media failure recovery, server-side monitoring and alert tests before any real invitation.

## Current evidence and owner decisions

- [Local exact-main CI history](https://github.com/srdataml-droid/Student-creator-/actions) — use a specific succeeding workflow + SHA, not historical green runs to assert a new commit passed.
- Local synthetic creator/viewer/moderator browser checks: `apps/web/e2e/local-alpha.spec.mjs`.
- One-student full synthetic path: `packages/local-core/test/single-student-journey.test.mjs`.
- Independent offline CLI restore rehearsal: `packages/local-core/test/backup-cli-recovery.test.mjs`, using `scripts/local-backup.mjs`. A green synthetic restore is **not a hosted disaster recovery rehearsal**.
- **Approval gates**: dedicated hosted project/media/credentials, private lawful identity policy, one real consenting tester, independent Android/device and usability result, DRM/provider selection and cost. Founder controls invitations and any deployment or real money.
