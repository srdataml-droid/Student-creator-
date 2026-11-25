# Week 8 — release evidence and stop gates

Founder-authorized isolated Week 8 implementation on `work/week-08`, draft PR #48. The existing creator-first Next.js design is preserved; no public release, production promotion, real enrollment, live financial operations or destructive rollback.

## Verified implementation checkpoints

| Exact branch revision | GitHub Actions | Evidence |
|---|---|---|
| `7d122bc6c64ec4cc0214edfc87b35482163cbace` | [45502735098](https://github.com/worthkind/Student-creator-/actions/runs/45502735098) | Five jobs green; 12 primary and nine authenticated route checks, seven Chromium tests; offline/retry, keyboard, navigation, reflow, chat polling and feed races |
| `5e906990ed7af1647358398424a504b5ec1ce95a` | [45519585749](https://github.com/worthkind/Student-creator-/actions/runs/45519585749) | Five jobs green; 285 Node tests, 38 native transport checks, SDK 36 internal debug build and lint; safe liveness/diagnostic tests |
| `f59c76de14a585d20e9e4253ebbeed99dd7ad53b` | [45519819701](https://github.com/worthkind/Student-creator-/actions/runs/45519819701) | Five jobs green; 28 native session checks; debug and instrumentation APKs built, lint passed; emulator explicitly not executed (CI emulator/KVM unavailable) |
| `d1a4dab903a24cd0290e9997f1c2571633818738` | [45519989413](https://github.com/worthkind/Student-creator-/actions/runs/45519989413) | Five jobs green; eight browser tests, labelled visible form controls, liveness response, throttled feed 168740 B, DCL 632ms, LCP 640ms, CLS 0 (synthetic Chromium only) |
| `c5f1047f749f9336e73c706507dc69cb679a3b34` | [45520158782](https://github.com/worthkind/Student-creator-/actions/runs/45520158782) | Five jobs green; disposable rollback to previous source read current synthetic data, preserved authorization, media, journal replay and refund balance |
| `dc45dc210bc7b0f8f88d054122efefb853789c77` | [45520397274](https://github.com/worthkind/Student-creator-/actions/runs/45520397274) | Added generated playable H.264 fixture, actual browser decode and position preservation; exact-head CI pending at documentation checkpoint |

Evidence belongs to the stated revision, not automatically a newer head. See issue #34 for subsequent exact-head retest results.

## Gate status

| Gate | Status |
|---|---|
| Responsive and keyboard | Local Chromium verified across five widths and authenticated route sweep; manual TalkBack/physical device and final founder design remain |
| Loading/errors/offline | Verified browser cases and API transport unit tests; no service worker, private cache or write replay |
| Media and bandwidth | Protected local synthetic byte ranges, captions, revocation and no eager downloads verified; real codec test added; hosted Mux adaptive stream and real mobile data measurement pending |
| Browser | Prior five-job CI runs green as recorded; latest exact head must be checked |
| Android | Internal native Java public catalog client, SDK 36, strict HTTPS/read-only transport, bounded parsing, loading/error/retry UI; debug/instrumentation APKs and lint verified. No native private login, purchase or media. CI emulator not executed due to unavailable KVM. |
| Mobile sessions | Memory-only native boundary verified with injected synthetic verifier; no persistent token, stale result, URL token or local role inference. Not wired to hosted Auth; no native sign-in/refresh/revocation integration or real-device proof. |
| Play release | Internal listing draft, target API 36, provisional application ID. Release variant disabled. Final package, signing/upload-key custody, billing, privacy/deletion, rating, screenshots and testing track require approval/verification. |
| Vercel staging | Minimal no-cache /api/health and exact SHA preview probe implemented/tested; observed protected preview still at older b15ea561...; no current exact-head staging acceptance or provider approval. |
| Monitoring | Opt-in server diagnostic sink implemented/tested, no raw request or exception data copied; no Sentry/Firebase config or external delivery/alerts verified. |
| Performance and dependencies | Local simulated network measurements and CI production npm audit; not real Android/production metrics. |
| Rollback | Prior source loaded current isolated synthetic data and validated auth, protected media, balanced ledger, replay/refund; existing independent backup/restore tests preserved. Actual Vercel/staging and hosted DB rollback unexecuted. |

## Android build and distribution boundaries

Native code is original Java using Android platform APIs, not a complete native application. AGP 8.10.1, Gradle 8.11.1 pinned; API 36 target from current official Android requirements. JDK 17 selected to correct CI Java 25 incompatibility. Gradle download checksum pinned against publisher reference. No new runtime SDK dependency. See apps/android/README.md and scripts/build-android-internal.sh. The canonical repo is public, so no CI APK artifact was uploaded or public binary distributed without approval. A founder-controlled private transfer or local build is needed for physical testing. No signing key, live credentials, paid checkout or preview bypass secret belongs in an APK.

References: https://developer.android.com/build/releases/agp-8-10-0-release-notes ; https://developer.android.com/google/play/requirements/target-sdk ; https://gradle.org/release-checksums/ ; https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation . Google Play policies must be rechecked at submission: https://support.google.com/googleplay/android-developer/answer/9858738 ; https://support.google.com/googleplay/android-developer/answer/13327111 ; https://support.google.com/googleplay/android-developer/answer/18265346 . Do not embed unrestricted external digital-goods checkout in a Play-distributed app absent verified applicable policy compliance.

## Hosted rollback boundary

Do not change production or erase payment history. With owner approval, identify an exact verified compatible preview and independently restored staging database, keep enrollment and live payments disabled, run liveness and provider authorization/access/entitlement checks, and obtain independent review. The synthetic rehearsal is not evidence of Vercel or production rollback.

One-student pilot remains separately gated; 100 and 1000 require later acceptance.
