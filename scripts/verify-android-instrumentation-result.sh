#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 && -s "$1" ]] || { echo "Missing instrumentation result" >&2; exit 1; }
# adb versions may emit CRLF. Require exactly one marker and terminal success.
awk '
  {sub(/\r$/, "")}
  /^ANDROID_CATALOG_SMOKE_PASS$/ {pass++}
  /^ANDROID_CATALOG_SMOKE_FAIL/ {bad++}
  /^INSTRUMENTATION_FAILED:|^INSTRUMENTATION_ABORTED:|^INSTRUMENTATION_RESULT: shortMsg=/ {bad++}
  /^INSTRUMENTATION_CODE:/ {codes++; if ($0 == "INSTRUMENTATION_CODE: -1") ok++}
  END {exit !(pass == 1 && bad == 0 && codes == 1 && ok == 1)}
' "$1" || { echo "Instrumentation assertions or terminal result not verified" >&2; exit 1; }
