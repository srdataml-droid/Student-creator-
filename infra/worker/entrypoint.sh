#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /app
if [[ "${STUDENT_CREATORS_IDENTITY_SCANNER_ENABLED:-false}" != true && "${STUDENT_CREATORS_MEDIA_SOURCE_WORKER_ENABLED:-false}" != true ]]; then
 exec node scripts/run-hosted-workers.mjs
fi
if [[ "${CLAMD_SOCKET:-}" != /run/clamav/clamd.sock ]]; then
 echo 'Invalid scanner socket' >&2
 exit 1
fi
pids=()
worker_pid=''
cleanup(){
 trap - TERM INT EXIT
 if [[ -n "$worker_pid" ]]; then
  kill -TERM "$worker_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
 fi
 for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
 for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
# No worker is started until the official signatures are available.
timeout 600 freshclam --config-file=/app/infra/worker/freshclam.conf
clamd --config-file=/app/infra/worker/clamd.conf &
pids+=("$!")
scanner_pid="$!"
for ((i=0;i<120;i++)); do
 kill -0 "$scanner_pid" 2>/dev/null || exit 1
 [[ -S "$CLAMD_SOCKET" ]] && break
 sleep 5
done
[[ -S "$CLAMD_SOCKET" ]] || exit 1
# Clamd periodically reloads updated official signatures via SelfCheck.
freshclam --daemon --config-file=/app/infra/worker/freshclam.conf &
pids+=("$!")
node scripts/run-hosted-workers.mjs &
worker_pid="$!"
set +e
wait -n "$worker_pid" "${pids[@]}"
set -e
# Any unexpectedly exited child makes the service unhealthy; never leave a
# supposedly operational worker running without its scanner/updater.
exit 1
