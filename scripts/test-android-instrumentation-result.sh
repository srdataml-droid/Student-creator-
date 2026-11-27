#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
check(){
  local expected="$1" sample="$2"
  printf '%b' "$sample" > "$tmp/result"
  if bash scripts/verify-android-instrumentation-result.sh "$tmp/result" >/dev/null 2>&1; then actual=pass; else actual=fail; fi
  [[ "$actual" == "$expected" ]] || { echo "Unexpected instrumentation parser result"; exit 1; }
}
check pass 'INSTRUMENTATION_RESULT: stream=\nANDROID_CATALOG_SMOKE_PASS\nINSTRUMENTATION_CODE: -1\n'
check pass 'ANDROID_CATALOG_SMOKE_PASS\r\nINSTRUMENTATION_CODE: -1\r\n'
check fail 'ANDROID_CATALOG_SMOKE_PASS\n'
check fail 'INSTRUMENTATION_CODE: -1\n'
check fail 'ANDROID_CATALOG_SMOKE_PASS\nINSTRUMENTATION_CODE: 0\n'
check fail 'ANDROID_CATALOG_SMOKE_PASS\nANDROID_CATALOG_SMOKE_FAIL: AssertionError\nINSTRUMENTATION_CODE: -1\n'
check fail 'ANDROID_CATALOG_SMOKE_PASS\nINSTRUMENTATION_CODE: -1\nINSTRUMENTATION_CODE: 0\n'
check fail 'ANDROID_CATALOG_SMOKE_PASS\nANDROID_CATALOG_SMOKE_PASS\nINSTRUMENTATION_CODE: -1\n'
echo 'Instrumentation result parser: 8 checks passed'
