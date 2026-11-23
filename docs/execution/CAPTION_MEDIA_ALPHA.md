# Local caption accessibility and access controls

Status: implemented in the existing Student Creators local SQLite + MP4 development mode. **Not deployed to Supabase or approved for production.**

## Student outcome

A verified student creator may attach a small, original **English WebVTT** file to a saved MP4, while their lesson is draft or rejected. The creator owns the captions as part of their original work. A moderator can preview the video and the timed captions before approving the lesson. Once approved, the viewer sees a CC track on the feed, full-lesson page and dark watch page, with no separate public transcript download.

Example text-only .vtt file (UTF-8):

```vtt
WEBVTT

00:00:00.000 --> 00:00:01.000
Welcome to my original explanation.

00:00:01.000 --> 00:00:02.000
Here is the first step.
```

The local validator in `packages/local-core/src/captions.mjs` accepts simple non-overlapping timing cues and a limited optional numeric cue ID. It rejects cue HTML, CSS, timing options, malformed UTF-8, dangerous control characters, overlap, empty cues and files above 128 KiB. This intentionally does **not** support advanced WebVTT formatting or a localization pipeline. Captions are creator-supplied and **not** AI-generated, verified for accuracy, speech-transcribed, scanned externally or guaranteed to cover every spoken word.

## Authorization

- `POST /api/local/lessons/{id}/video/captions` accepts `text/vtt` only after session, verification, original-lesson ownership and draft-state checks. It is capped at eight new caption edits per hour per creator.
- Captions live in SQLite `lesson_captions`, not in publicly served files or the Git repository. Replacing MP4 bytes with different bytes automatically removes old captions so outdated words/timings cannot be silently attached.
- `GET/HEAD /api/local/lessons/{id}/video/captions` first calls the **same** server-side `getVideoFile` authorization used for MP4: current verified student, active published lesson, creator view permission, paid entitlement where applicable, valid current session and five-minute playback grant. This route is deliberately nested under `/video` so that the existing path-scoped HttpOnly cookie applies without exposing the bearer to client JavaScript. Draft owner/admin preview retains existing moderation-only access.
- Responses are `private, no-store`, `nosniff`, same-origin resource policy and no-referrer. The server never puts caption bodies in feed previews; only `hasCaptions` is whitelisted for client display.
- Copyright is **not** transferred by purchase. Captions can still be copied by a legitimate authorized viewer; this is not DRM or screenshot protection. The existing moving watermark is only a deterrent.

## Verification and constraints

`packages/local-core/test/captions.test.mjs` proves malformed cue rejection, draft-only uploads, owner-only writes, anonymous/unpaid/other-account denial, missing grant, paid access after synthetic confirmation, creator block and unblock grant invalidation, synthetic refund revocation, and persistence of denial across a SQLite reopen. `apps/web/e2e/local-alpha.spec.mjs` uploads free/paid caption tracks through Creator Studio and asserts paid subtitle denial and the working authorized track in Chromium. The viewport test checks a narrow mobile layout, but a physical Android phone and accessibility review remain outstanding.

**Next integration:** dedicated authorized Student Creators Supabase staging project, private media and caption objects, hosted Auth+RLS, streaming/CDN, restore/retention review, separate security signoff and one consenting student. Never treat disposable CI or localhost replay as proof of live deployment.

## Related work

- [Issue #10](https://github.com/srdataml-droid/Student-creator-/issues/10): private media and object authorization
- [Issue #12](https://github.com/srdataml-droid/Student-creator-/issues/12): one-student alpha and mobile accessibility
