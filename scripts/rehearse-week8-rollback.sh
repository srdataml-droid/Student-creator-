#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Historical verified Week 8 web checkpoint; Actions run 45502735098.
baseline=7d122bc6c64ec4cc0214edfc87b35482163cbace
if [[ "${CI:-}" != true ]]; then
  echo "This rehearsal is limited to a disposable CI checkout." >&2; exit 1
fi
if ! git cat-file -e "$baseline^{commit}" 2>/dev/null; then git fetch --no-tags --depth=1 origin "$baseline"; fi
git cat-file -e "$baseline^{commit}"
# Never roll an older server onto an unreviewed migration.
git diff --exit-code "$baseline" HEAD -- db/migrations packages/local-core/src/commerce-schema.mjs
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git archive "$baseline" packages | tar -x -C "$tmp"
APP_DATA_MODE=local node scripts/rehearse-local-rollback.mjs "$tmp"
echo "Synthetic rollback compatible with $baseline; no hosted deployment or data changed."
