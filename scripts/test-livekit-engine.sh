#!/usr/bin/env bash
set -euo pipefail
umask 077
dir="$(mktemp -d)"
pid=""
cleanup(){ if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; rm -rf "$dir"; }
trap cleanup EXIT
# Exact upstream release archive digest from GitHub release metadata.
curl --fail --silent --show-error --location --max-time 90  https://github.com/livekit/livekit/releases/download/v1.13.11/livekit_1.13.11_linux_amd64.tar.gz -o "$dir/livekit.tar.gz"
printf '1e9ee90ca301e1842b2887fc77cb122759756a9c8aeb4334ee91de3325ec43fb  %s\n' "$dir/livekit.tar.gz" | sha256sum -c -
tar -xzf "$dir/livekit.tar.gz" -C "$dir" livekit-server
export WK_LIVEKIT_FIXTURE_KEY=wk_fixture_key
export WK_LIVEKIT_FIXTURE_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
cat > "$dir/server.yaml" <<EOF
port: 7880
bind_addresses: ["127.0.0.1"]
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50020
  use_external_ip: false
  node_ip: 127.0.0.1
room:
  auto_create: false
keys:
  $WK_LIVEKIT_FIXTURE_KEY: $WK_LIVEKIT_FIXTURE_SECRET
EOF
"$dir/livekit-server" --config "$dir/server.yaml" > "$dir/server.log" 2>&1 &
pid=$!
for i in $(seq 1 60); do
 if curl -fsS http://127.0.0.1:7880/ >/dev/null 2>&1; then break; fi
 if ! kill -0 "$pid" 2>/dev/null; then echo 'Disposable LiveKit server exited'; exit 1; fi
 sleep 0.25
done
curl -fsS http://127.0.0.1:7880/ >/dev/null
node apps/web/e2e/livekit-engine-acceptance.mjs
