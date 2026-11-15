#!/usr/bin/env bash
# CI only: runs the REAL host Nginx site file (deploy/nginx/zuvo.corremadvisory.com.conf) in an
# nginx:1.24 container (Ubuntu 24.04's version) in front of the running stack, with a self-signed
# certificate where certbot's would be, and checks TLS + HTTP/2, headers, cache rules, the proxy
# routes and the WebSocket upgrade. Needs the stack from prod-smoke.sh. sudo bash deploy/ci/nginx-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "::error title=Host Nginx::$*"; docker logs zuvo-host-nginx 2>&1 | tail -n 30 || true; exit 1; }
HOST=zuvo.corremadvisory.com
le="$(mktemp -d)"
live="$le/live/$HOST"
mkdir -p "$live"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$HOST" -addext "subjectAltName=DNS:$HOST" \
  -keyout "$live/privkey.pem" -out "$live/fullchain.pem" 2> /dev/null
openssl dhparam -dsaparam -out "$le/ssl-dhparams.pem" 2048 2> /dev/null
# Stand-in for certbot's file (the real one sets protocols, ciphers and the session cache).
printf 'ssl_protocols TLSv1.2 TLSv1.3;\nssl_session_cache shared:le_nginx_SSL:10m;\n' > "$le/options-ssl-nginx.conf"
chmod -R a+rX "$le"

docker rm -f zuvo-host-nginx > /dev/null 2>&1 || true
docker run -d --name zuvo-host-nginx --network host \
  -v "$PWD/deploy/nginx/$HOST.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$PWD/infra/nginx/security-headers.conf:/etc/nginx/snippets/zuvo-security-headers.conf:ro" \
  -v "$le:/etc/letsencrypt:ro" nginx:1.24-alpine > /dev/null
docker exec zuvo-host-nginx nginx -t || fail "nginx -t failed"
sleep 1

c() { curl -sS --resolve "$HOST:443:127.0.0.1" --resolve "$HOST:80:127.0.0.1" -k "$@"; }
header() { c -o /dev/null -D - "https://$HOST$1" | tr -d '\r' | grep -i "^$2:" | sed -n 1p | cut -d' ' -f2-; }

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
docker rm -f zuvo-host-nginx > /dev/null
echo "host Nginx OK: HTTP/2, headers, cache rules, /v1, /socket.io"
