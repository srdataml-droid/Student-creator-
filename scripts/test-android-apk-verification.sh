#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Test the actual verifier's fail-closed behavior with isolated SDK-output
# fixtures. This is not a cryptographic signature test; real APKs are
# independently checked with the installed SDK in the build step.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/scripts" "$tmp/sdk/build-tools/37.0.0" "$tmp/sdk/cmdline-tools/latest/bin" \
  "$tmp/apps/android/app/build/outputs/apk/debug" "$tmp/apps/android/app/build/outputs/apk/androidTest/debug"
cp scripts/verify-android-internal-apk.sh "$tmp/scripts/"
git -C "$tmp" init -q
git -C "$tmp" -c user.name='CI fixture' -c user.email='ci@example.invalid' commit --allow-empty -qm 'Synthetic verifier fixture'
printf 'synthetic APK fixture' >"$tmp/apps/android/app/build/outputs/apk/debug/app-debug.apk"
printf 'synthetic test APK fixture' >"$tmp/apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
cat >"$tmp/sdk/build-tools/37.0.0/apksigner" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
apk="${@: -1}"
mode="${APK_VERIFY_FIXTURE:-valid}"
digest="$(printf '%064d' 0)"
case "$mode" in
  exit) exit 2 ;;
  missing) echo 'No certificate output'; exit 0 ;;
  invalid) digest=invalid ;;
  mismatch) if [[ "$apk" == *androidTest* ]]; then digest="$(printf '%064d' 1)"; fi ;;
esac
if [[ "$mode" == scheme ]]; then
  echo "V2 Signer: certificate SHA-256 digest: $digest"
  echo "V3 Signer: certificate SHA-256 digest: $digest"
else
  echo "Signer #1 certificate SHA-256 digest: $digest"
fi
if [[ "$mode" == multiple ]]; then echo "Signer #2 certificate SHA-256 digest: $(printf '%064d' 2)"; fi
FIXTURE
cat >"$tmp/sdk/cmdline-tools/latest/bin/apkanalyzer" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
mode="${APK_VERIFY_FIXTURE:-valid}"
case "$2" in
  application-id)
    if [[ "$mode" == package ]]; then echo org.invalid; exit 0; fi
    if [[ "$3" == *androidTest* ]]; then echo org.worthkind.studentcreators.internal.test; else echo org.worthkind.studentcreators.internal; fi ;;
  min-sdk) if [[ "$mode" == min ]]; then echo 25; else echo 26; fi ;;
  target-sdk) if [[ "$mode" == target ]]; then echo 35; else echo 36; fi ;;
  *) exit 2 ;;
esac
FIXTURE
printf '#!/usr/bin/env bash\nexit 2\n' >"$tmp/sdk/build-tools/37.0.0/aapt2"
chmod +x "$tmp/sdk/build-tools/37.0.0/"* "$tmp/sdk/cmdline-tools/latest/bin/apkanalyzer"
check(){
  local expected="$1" mode="$2" actual
  if ANDROID_HOME="$tmp/sdk" APK_VERIFY_FIXTURE="$mode" bash "$tmp/scripts/verify-android-internal-apk.sh" >"$tmp/log" 2>&1; then actual=pass; else actual=fail; fi
  if [[ "$actual" != "$expected" ]]; then cat "$tmp/log"; echo "Unexpected verifier result for $mode" >&2; exit 1; fi
}
check pass valid
check pass scheme
for mode in exit missing invalid mismatch multiple package min target; do check fail "$mode"; done
echo 'APK verifier control flow: 10 checks passed'
