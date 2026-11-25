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
# Prefer the structured SDK manifest commands instead of version-dependent badging text.
analyzer="$sdk/cmdline-tools/latest/bin/apkanalyzer"
if [[ ! -x "$analyzer" ]]; then analyzer="$(command -v apkanalyzer || true)"; fi
badging_tool="$tools/aapt2"
if [[ -x "$sdk/build-tools/35.0.0/aapt2" ]]; then badging_tool="$sdk/build-tools/35.0.0/aapt2"; fi
main=apps/android/app/build/outputs/apk/debug/app-debug.apk
instrument=apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
verify() {
  local apk="$1" expected="$2" badging signer digest
  [[ -s "$apk" ]] || { echo "APK missing" >&2; return 1; }
  signer="$("$tools/apksigner" verify --min-sdk-version 26 --verbose --print-certs "$apk")" || { echo "APK signature rejected" >&2; return 1; }
  # Build Tools 37 labels each signature scheme instead of "Signer #1".
  # Verify all recognized signing certificates, excluding source stamps.
  local certs count
  certs="$(printf '%s\n' "$signer" | sed -nE 's/^[[:space:]]*(Signer #[0-9]+|V[0-9]+(\.[0-9]+)? Signer:)[[:space:]]+certificate SHA-256 digest:[[:space:]]*([[:xdigit:]:]+)[[:space:]]*$/\3/p' | tr -d ':' | tr 'A-F' 'a-f')"
  [[ -n "$certs" ]] || { echo "Missing APK signer fingerprint (build tools $(basename "$tools"))" >&2; return 1; }
  while IFS= read -r digest; do
    [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || { echo "Invalid APK signer fingerprint" >&2; return 1; }
  done <<< "$certs"
  count="$(printf '%s\n' "$certs" | sort -u | wc -l)"
  [[ "$count" == 1 ]] || { echo "Expected one unique APK signing certificate across schemes" >&2; return 1; }
  digest="$(printf '%s\n' "$certs" | sort -u)"
  local package min target
  if [[ -x "$analyzer" ]]; then
    package="$("$analyzer" manifest application-id "$apk")" || return 1
    min="$("$analyzer" manifest min-sdk "$apk")" || return 1
    target="$("$analyzer" manifest target-sdk "$apk")" || return 1
  else
    badging="$("$badging_tool" dump badging "$apk")" || { echo "APK manifest unavailable" >&2; return 1; }
    package="$(printf '%s\n' "$badging" | sed -nE "s/^[[:space:]]*package: name='([^']+)'.*$/\1/p")"
    min="$(printf '%s\n' "$badging" | sed -nE "s/^[[:space:]]*(minSdkVersion|sdkVersion):[[:space:]]*'?([0-9]+)'?[[:space:]]*$/\2/p")"
    target="$(printf '%s\n' "$badging" | sed -nE "s/^[[:space:]]*targetSdkVersion:[[:space:]]*'?([0-9]+)'?[[:space:]]*$/\1/p")"
  fi
  [[ "$package" == "$expected" ]] || { echo "Unexpected APK package for $expected" >&2; return 1; }
  [[ "$min" == 26 && "$target" == 36 ]] || {
    printf 'Unexpected SDK bounds for %s: min=%q target=%q\n' "$expected" "$min" "$target" >&2
    return 1
  }
  printf '%s\n' "$digest"
}
main_signer="$(verify "$main" org.worthkind.studentcreators.internal)"
test_signer="$(verify "$instrument" org.worthkind.studentcreators.internal.test)"
[[ "$main_signer" =~ ^[a-fA-F0-9]{64}$ && "$main_signer" == "$test_signer" ]] || { echo "APK signer mismatch" >&2; exit 1; }
revision="$(git rev-parse HEAD)"
printf 'INTERNAL_ANDROID_BUILD revision=%s signer_sha256=%s\n' "$revision" "$main_signer"
sha256sum "$main" "$instrument"
echo "APK signatures, package IDs, API levels and matching test signer verified. Debug signing only; no release or upload."
