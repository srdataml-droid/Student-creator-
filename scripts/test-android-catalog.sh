#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
javac --release 17 -d "$out" apps/android/app/src/main/java/org/worthkind/studentcreators/CatalogTransport.java apps/android/tests/CatalogTransportTest.java apps/android/app/src/main/java/org/worthkind/studentcreators/CatalogPaging.java apps/android/app/src/main/java/org/worthkind/studentcreators/MobileSessionBoundary.java apps/android/tests/MobileSessionBoundaryTest.java
java -cp "$out" org.worthkind.studentcreators.CatalogTransportTest
java -cp "$out" org.worthkind.studentcreators.MobileSessionBoundaryTest
