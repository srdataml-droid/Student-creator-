#!/usr/bin/env bash
set -euo pipefail
umask 077
dir="$(mktemp -d)"
pid=""
cleanup(){ if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; rm -rf "$dir"; }
trap cleanup EXIT
mkdir "$dir/db"
# ClamAV NDB custom signature: all file types, any offset, harmless marker bytes.
printf 'Worthkind.Test.SyntheticMarker:0:*:%s\n' "$(printf 'WK_CLAMD_SYNTHETIC_SIGNATURE_20261125' | od -An -tx1 | tr -d ' \n')" > "$dir/db/synthetic.ndb"
cat > "$dir/clamd.conf" <<EOF
Foreground yes
LocalSocket $dir/clamd.sock
LocalSocketMode 600
DatabaseDirectory $dir/db
TemporaryDirectory $dir
OfficialDatabaseOnly no
StreamMaxLength 5M
MaxFileSize 5M
MaxScanSize 20M
AlertExceedsMax yes
MaxThreads 2
EOF
clamd --config-file="$dir/clamd.conf" > "$dir/clamd.log" 2>&1 &
pid=$!
for i in $(seq 1 60); do
 if [ -S "$dir/clamd.sock" ]; then break; fi
 if ! kill -0 "$pid" 2>/dev/null; then cat "$dir/clamd.log"; exit 1; fi
 sleep 0.25
done
CLAMD_SOCKET="$dir/clamd.sock" node scripts/test-clamd-engine.mjs || { cat "$dir/clamd.log"; exit 1; }
