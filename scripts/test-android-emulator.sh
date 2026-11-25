#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Only use an isolated standard CI runner, never a real attached device.
# Missing host virtualization is a distinct result from a test failure.
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
emu="$sdk/emulator/emulator"
adb="$sdk/platform-tools/adb"
avdm="$sdk/cmdline-tools/latest/bin/avdmanager"
sdkmanager="$sdk/cmdline-tools/latest/bin/sdkmanager"
if [[ "${CI:-}" != true || -z "$sdk" || ! -x "$emu" || ! -x "$adb" ]]; then
  echo "ANDROID_EMULATOR_NOT_EXECUTED: Android emulator or SDK unavailable"
  exit 0
fi
if [[ ! -x "$avdm" ]]; then avdm="$(command -v avdmanager || true)"; fi
if [[ ! -x "$sdkmanager" ]]; then sdkmanager="$(command -v sdkmanager || true)"; fi
if [[ ! -x "$avdm" ]]; then
  echo "ANDROID_EMULATOR_NOT_EXECUTED: avdmanager unavailable"
  exit 0
fi
if [[ ! -c /dev/kvm ]]; then
  echo "ANDROID_EMULATOR_NOT_EXECUTED: host has no KVM device"
  exit 0
fi
# Standard GitHub-hosted Linux VMs support KVM. Limit any temporary device
# permission to the ephemeral runner user, never world-writable or self-hosted.
if [[ ! -r /dev/kvm || ! -w /dev/kvm ]]; then
  if [[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${WK8_STANDARD_PUBLIC_RUNNER:-}" == true ]] && command -v setfacl >/dev/null; then
    sudo -n setfacl -m "u:$(id -u):rw" /dev/kvm || true
  fi
fi
if [[ ! -r /dev/kvm || ! -w /dev/kvm ]] || ! "$emu" -accel-check; then
  echo "ANDROID_EMULATOR_NOT_EXECUTED: KVM cannot be used by this runner"
  exit 0
fi
image=""
for api in 36 35; do
  for flavor in default google_apis; do
    if [[ -f "$sdk/system-images/android-$api/$flavor/x86_64/system.img" ]]; then
      image="system-images;android-$api;$flavor;x86_64"; break 2
    fi
  done
done
if [[ -z "$image" && "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${WK8_STANDARD_PUBLIC_RUNNER:-}" == true && -x "$sdkmanager" ]]; then
  # Official SDK image only. Use existing SDK licenses; do not accept new
  # agreements, add paid runner services, or inject credentials.
  candidate="system-images;android-36;google_apis;x86_64"
  if timeout 240 "$sdkmanager" --install "$candidate" </dev/null &&
      [[ -f "$sdk/system-images/android-36/google_apis/x86_64/system.img" ]]; then
    image="$candidate"
  fi
fi
if [[ -z "$image" ]]; then
  echo "ANDROID_EMULATOR_NOT_EXECUTED: compatible system image unavailable"
  exit 0
fi
if "$adb" devices | awk 'NR>1 && NF>=2 {found=1} END {exit !found}'; then
  echo "ANDROID_EMULATOR_NOT_EXECUTED: another Android device is attached"
  exit 0
fi
tmp="$(mktemp -d)"
export ANDROID_AVD_HOME="$tmp/avd"
mkdir -p "$ANDROID_AVD_HOME"
serial=emulator-5568
pid=""
cleanup(){
  if [[ -n "$pid" ]]; then "$adb" -s "$serial" emu kill >/dev/null 2>&1 || true; kill "$pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
printf 'no\n' | "$avdm" create avd --name wk8_internal_ci --package "$image" --path "$ANDROID_AVD_HOME/wk8_internal_ci.avd"
"$emu" -avd wk8_internal_ci -port 5568 -accel on -no-window -no-audio -no-boot-anim -no-snapshot -wipe-data -gpu swiftshader_indirect >"$tmp/emulator.log" 2>&1 &
pid=$!
timeout 150 "$adb" -s "$serial" wait-for-device
booted=false
for i in $(seq 1 90); do
  if [[ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then booted=true; break; fi
  if ! kill -0 "$pid" 2>/dev/null; then echo "Android emulator terminated before boot"; exit 1; fi
  sleep 2
done
[[ "$booted" == true ]]
timeout 60 "$adb" -s "$serial" install apps/android/app/build/outputs/apk/debug/app-debug.apk
timeout 60 "$adb" -s "$serial" install apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
timeout 45 "$adb" -s "$serial" shell am instrument -w org.worthkind.studentcreators.internal.test/org.worthkind.studentcreators.CatalogSmokeInstrumentation | tee "$tmp/result.txt"
grep -Fq 'ANDROID_CATALOG_SMOKE_PASS' "$tmp/result.txt"
grep -Fq 'INSTRUMENTATION_CODE: -1' "$tmp/result.txt"
echo "Android emulator instrumentation passed (synthetic, unconfigured native app only)."
