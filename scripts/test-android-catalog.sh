#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
javac --release 17 -d "$out" apps/android/app/src/main/java/org/worthkind/studentcreators/CatalogTransport.java apps/android/tests/CatalogTransportTest.java
java -cp "$out" org.worthkind.studentcreators.CatalogTransportTest
