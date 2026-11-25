# Internal Android catalog client

Native Android Java Activity, API 26 minimum, compile/target API 36. Existing hosted public metadata contracts: GET /api/courses and GET /api/lessons?courseId=UUID&limit=20. No fabricated local courses; unconfigured or unavailable server gives a genuine error. No WebView, native authentication, billing, protected media, telemetry, push or private data. This is a first native vertical slice, NOT the full application or store candidate.

AGP 8.10.1 / Gradle 8.11.1 / JDK 17+ and SDK 36 required. See https://developer.android.com/build/releases/agp-8-10-0-release-notes and https://developer.android.com/google/play/requirements/target-sdk . No new third-party runtime libraries. Package ID is provisional and internal only.

From apps/android with a reviewed installed Gradle 8.11.1 and SDK:
- gradle :app:assembleDebug (unconfigured build fails closed)
- gradle :app:assembleDebug -PcatalogOrigin=https://OWNER-APPROVED-STAGING-HOST (substitute the actual approved HTTPS origin; not a secret)
- gradle :app:lintDebug
- install on an authorized Android emulator or physical test phone; verify configuration error, course/preview display, retry, rotation, large text, network failure. Never use a protected-preview bypass secret in the APK.

Transport tests run on plain JDK via scripts/test-android-catalog.sh from the repo root. They do not establish an Android APK build or device acceptance. No release signing keys, upload key or store submission. Authentication and private capabilities await the shared hosted session contract; do not bypass it. Play package, branding, billing and final UI require owner approval.

## Verified internal build and test commands

From repository root: `bash scripts/test-android-catalog.sh` runs plain-JDK catalog and memory-only session boundary checks. `bash scripts/build-android-internal.sh` requires installed SDK 36 and JDK 17 or 21; it verifies pinned Gradle when needed, builds debug and instrumentation APKs and runs lint. Release variants are disabled. The CI-only emulator script uses only an already installed system image and available KVM; it reports NOT EXECUTED if unavailable. It does not download an image or use a paid emulator. For a private authorized test device, install the two debug APKs from app/build/outputs/apk and run the platform instrumentation component `org.worthkind.studentcreators.internal.test/org.worthkind.studentcreators.CatalogSmokeInstrumentation`. Do not upload public artifacts or pass a preview bypass secret. The unconfigured debug build tests genuine unavailable state and synthetic parser behavior; a configured private staging build needs a real approved HTTPS public catalog endpoint. No native private login is enabled; MobileSessionBoundary is a separately tested adapter boundary, not a functioning hosted integration.
