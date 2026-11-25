#!/usr/bin/env bash
set -euo pipefail
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
  [[ -s "$apk" ]]
  signer="$("$tools/apksigner" verify --min-sdk-version 26 --print-certs "$apk")"
  digest="$(printf '%s\n' "$signer" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
  [[ "$digest" =~ ^[a-fA-F0-9]{64}$ ]]
  [[ "$(printf '%s\n' "$signer" | grep -c 'certificate SHA-256 digest:')" == 1 ]]
  badging="$("$tools/aapt2" dump badging "$apk")"
  grep -Fq "package: name='$expected'" <<< "$badging"
  grep -Fxq "sdkVersion:'26'" <<< "$badging"
  grep -Fxq "targetSdkVersion:'36'" <<< "$badging"
  printf '%s\n' "$digest"
}
main_signer="$(verify "$main" org.worthkind.studentcreators.internal)"
test_signer="$(verify "$instrument" org.worthkind.studentcreators.internal.test)"
[[ "$main_signer" == "$test_signer" ]]
revision="$(git rev-parse HEAD)"
printf 'INTERNAL_ANDROID_BUILD revision=%s signer_sha256=%s\n' "$revision" "$main_signer"
sha256sum "$main" "$instrument"
echo "APK signatures, package IDs, API levels and matching test signer verified. Debug signing only; no release or upload."
