#!/usr/bin/env bash
# CI only: runs the REAL host Nginx site file (deploy/nginx/zuvo.corremadvisory.com.conf) in an
# nginx:1.24 container (Ubuntu 24.04's version) in front of the running stack, with a self-signed
# certificate where certbot's would be, and checks TLS + HTTP/2, headers, cache rules, the proxy
# routes and the WebSocket upgrade. Needs the stack from prod-smoke.sh. sudo bash deploy/ci/nginx-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "::error title=Host Nginx::$*"; docker logs zuvo-host-nginx 2>&1 | tail -n 30 || true; exit 1; }
# shellcheck source=deploy/ci/host-nginx.sh
. deploy/ci/host-nginx.sh
start_host_nginx || fail "nginx -t failed"

header() { c -H 'Accept-Encoding: gzip' -o /dev/null -D - "https://$HOST$1" | tr -d '\r' | grep -i "^$2:" | sed -n 1p | cut -d' ' -f2-; }

[ "$(c -o /dev/null -w '%{http_version}' "https://$HOST/")" = 2 ] || fail "HTTP/2 is not served"
[ "$(c -o /dev/null -w '%{http_code}' "http://$HOST/chats")" = 301 ] || fail "http must redirect to https"
c "https://$HOST/chats" | grep >/dev/null '<div id="root">' || fail "the app shell did not load through Nginx"
header / content-security-policy | grep >/dev/null "script-src 'self'" || fail "no CSP on the app"
header / strict-transport-security | grep >/dev/null max-age || fail "no HSTS on the app"
[ "$(header / cache-control)" = no-cache ] || fail "the shell must be no-cache"
[ "$(header /sw.js cache-control)" = no-cache ] || fail "sw.js must be no-cache"
asset="$(c "https://$HOST/" | grep -oE '/assets/[^"]+\.js' | sed -n 1p)"
[ -n "$asset" ] || fail "no hashed asset in index.html"
header "$asset" cache-control | grep >/dev/null immutable || fail "hashed assets must be immutable"
header "$asset" content-encoding | grep >/dev/null gzip || [ "$(c -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: gzip' "https://$HOST$asset")" -lt 1024 ] \
  || fail "JavaScript is not gzipped"
[ "$(c -o /dev/null -w '%{http_code}' "https://$HOST/v1/ready")" = 200 ] || fail "/v1/ready through Nginx"
csp_count="$(c -o /dev/null -D - "https://$HOST/v1/ready" | grep -ci '^content-security-policy:')"
[ "$csp_count" = 1 ] || fail "the API must get exactly one CSP (its own), got $csp_count"
[ "$(c -o /dev/null -w '%{http_code}' "https://$HOST/v1/test/outbox/latest")" = 404 ] || fail "test routes reachable"
# WebSocket upgrade through Nginx (Engine.IO answers 101 before any sign-in check).
upgrade="$(c --http1.1 --max-time 3 -o /dev/null -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" -H "Origin: https://$HOST" \
  "https://$HOST/socket.io/?EIO=4&transport=websocket" || true)"
[ "$upgrade" = 101 ] || fail "the WebSocket upgrade did not pass Nginx (got $upgrade)"
stop_host_nginx
echo "host Nginx OK: HTTP/2, headers, cache rules, /v1, /socket.io"
