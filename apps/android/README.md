# Internal Android catalog client

Native Android Java Activity, API 26 minimum, compile/target API 36. Existing hosted public metadata contracts: GET /api/courses and GET /api/lessons?courseId=UUID&limit=20. No fabricated local courses; unconfigured or unavailable server gives a genuine error. No WebView, native authentication, billing, protected media, telemetry, push or private data. This is a first native vertical slice, NOT the full application or store candidate.

AGP 8.10.1 / Gradle 8.11.1 / JDK 17+ and SDK 36 required. See https://developer.android.com/build/releases/agp-8-10-0-release-notes and https://developer.android.com/google/play/requirements/target-sdk . No new third-party runtime libraries. Package ID is provisional and internal only.

From apps/android with a reviewed installed Gradle 8.11.1 and SDK:
- gradle :app:assembleDebug (unconfigured build fails closed)
- gradle :app:assembleDebug -PcatalogOrigin=https://OWNER-APPROVED-STAGING-HOST (substitute the actual approved HTTPS origin; not a secret)
- gradle :app:lintDebug
- install on an authorized Android emulator or physical test phone; verify configuration error, course/preview display, retry, rotation, large text, network failure. Never use a protected-preview bypass secret in the APK.

Transport tests run on plain JDK via scripts/test-android-catalog.sh from the repo root. They do not establish an Android APK build or device acceptance. No release signing keys, upload key or store submission. Authentication and private capabilities await the shared hosted session contract; do not bypass it. Play package, branding, billing and final UI require owner approval.
