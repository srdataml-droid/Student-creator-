#!/usr/bin/env bash
set -euo pipefail
shopt -s inherit_errexit
export LC_ALL=C
cd "$(dirname "$0")/.."
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "$sdk" && -d "$sdk/build-tools" ]] || { echo "Android SDK build-tools required" >&2; exit 1; }
tools=""
for candidate in "$sdk"/build-tools/*; do
  if [[ -x "$candidate/apksigner" && -x "$candidate/aapt2" ]]; then tools="$candidate"; fi
done
[[ -n "$tools" ]] || { echo "apksigner and aapt2 unavailable" >&2; exit 1; }
main=apps/android/app/build/outputs/apk/debug/app-debug.apk
instrument=apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
verify() {
  local apk="$1" expected="$2" badging signer digest
  [[ -s "$apk" ]] || { echo "APK missing" >&2; return 1; }
  signer="$("$tools/apksigner" verify --min-sdk-version 26 --verbose --print-certs "$apk")" || { echo "APK signature rejected" >&2; return 1; }
  digest="$(printf '%s\n' "$signer" | sed -nE 's/^[[:space:]]*Signer #1 certificate SHA-256 digest:[[:space:]]*([[:xdigit:]]{64})[[:space:]]*$/\1/p')"
  [[ "$digest" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "Missing or invalid APK signer fingerprint" >&2; return 1; }
  [[ "$(printf '%s\n' "$signer" | grep -c 'certificate SHA-256 digest:' || true)" == 1 ]] || { echo "Expected one APK signer" >&2; return 1; }
  badging="$("$tools/aapt2" dump badging "$apk")" || { echo "APK manifest unavailable" >&2; return 1; }
  grep -Fq "package: name='$expected'" <<< "$badging" || { echo "Unexpected APK package" >&2; return 1; }
  grep -Fxq "sdkVersion:'26'" <<< "$badging" || { echo "Unexpected APK minimum API" >&2; return 1; }
  grep -Fxq "targetSdkVersion:'36'" <<< "$badging" || { echo "Unexpected APK target API" >&2; return 1; }
  printf '%s\n' "$digest"
}
main_signer="$(verify "$main" org.worthkind.studentcreators.internal)"
test_signer="$(verify "$instrument" org.worthkind.studentcreators.internal.test)"
[[ "$main_signer" =~ ^[a-fA-F0-9]{64}$ && "$main_signer" == "$test_signer" ]] || { echo "APK signer mismatch" >&2; exit 1; }
revision="$(git rev-parse HEAD)"
printf 'INTERNAL_ANDROID_BUILD revision=%s signer_sha256=%s\n' "$revision" "$main_signer"
sha256sum "$main" "$instrument"
echo "APK signatures, package IDs, API levels and matching test signer verified. Debug signing only; no release or upload."
