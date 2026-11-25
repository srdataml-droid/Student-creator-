#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$sdk" || ! -f "$sdk/platforms/android-36/android.jar" ]]; then
  echo "Android SDK platform 36 is required; no Android build was executed." >&2
  exit 1
fi
# Pin and verify Gradle against the publisher's independent checksum reference.
# https://gradle.org/release-checksums/
version=8.11.1
sha=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if command -v gradle >/dev/null && gradle --version | grep -Fxq "Gradle $version"; then
  runner="$(command -v gradle)"
else
  curl --fail --silent --show-error --location --max-time 180 --proto '=https' --proto-redir '=https' \
    "https://services.gradle.org/distributions/gradle-$version-bin.zip" -o "$tmp/gradle.zip"
  printf '%s  %s\n' "$sha" "$tmp/gradle.zip" | sha256sum --check --strict
  unzip -q "$tmp/gradle.zip" -d "$tmp"
  runner="$tmp/gradle-$version/bin/gradle"
fi
# No production credentials, catalog origin, signing keys or publication.
"$runner" --no-daemon --console=plain -p apps/android :app:assembleDebug :app:lintDebug
test -s apps/android/app/build/outputs/apk/debug/app-debug.apk
echo "Internal Android debug APK compiled and lint completed. No release signing or install."
