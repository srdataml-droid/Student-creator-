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
node_ip="$(ip -4 route get 192.0.2.1 | awk '{for(i=1;i<=NF;i++)if($i=="src"){print $(i+1);exit}}')"
# Pion excludes loopback ICE candidates by default. Signal on localhost, but
# advertise the isolated runner's non-loopback host candidate for media.
[[ "$node_ip" =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)[0-9.]+$ ]] || { echo 'Expected isolated private runner IP'; exit 1; }
cat > "$dir/server.yaml" <<EOF
port: 7880
bind_addresses: ["127.0.0.1"]
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50020
  use_external_ip: false
  node_ip: $node_ip
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
if ! node apps/web/e2e/livekit-engine-acceptance.mjs; then
 # All server logs are from a disposable synthetic instance. Still remove
 # any JWT-like values and the fixture signing secret before diagnostics.
 node --input-type=module -e 'import {readFileSync} from "node:fs";let s=readFileSync(process.argv[1],"utf8");s=s.replaceAll(process.env.WK_LIVEKIT_FIXTURE_SECRET,"[redacted]").replace(/[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{20,}/g,"[redacted-token]");console.error(s.slice(-12000));' "$dir/server.log"
 exit 1
fi
