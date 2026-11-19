#!/usr/bin/env bash
# Checks that the host Nginx site in front of the API passes the critical routes through as they
# are: no redirect, no Nginx error page. The site file on the server is a copy that a deploy does
# not update, so it can drift from deploy/nginx/zuvo.corremadvisory.com.conf (Nov 2026: a stale
# `location /v1/uploads/` turned every POST /v1/uploads into a 301, and no file could be sent).
# Signed-out requests only: each must reach the API (its own status and x-request-id header).
#   bash deploy/ci/live-routes.sh https://zuvo.corremadvisory.com
#   CURL_EXTRA="--resolve host:443:127.0.0.1 -k" bash deploy/ci/live-routes.sh https://host   (CI)
set -euo pipefail
base="${1:?usage: live-routes.sh <https://origin>}"
read -r -a extra <<< "${CURL_EXTRA:-}"
failed=0

# check <method> <path> <expected status> [curl args...]
check() {
  local method="$1" path="$2" want="$3"
  shift 3
  local headers status request_id location
  headers="$(curl -sS -o /dev/null -D - --max-time 15 -X "$method" "${extra[@]}" "$@" "$base$path" | tr -d '\r')" || {
    echo "FAIL $method $path: no answer"
    failed=1
    return
  }
  status="$(sed -n '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p' <<< "$headers")"
  request_id="$(grep -i '^x-request-id:' <<< "$headers" | sed -n 1p || true)"
  location="$(grep -i '^location:' <<< "$headers" | sed -n 1p || true)"
  if [ "$status" != "$want" ] || [ -z "$request_id" ]; then
    echo "FAIL $method $path: got $status${location:+ ($location)}${request_id:+, from the API}${request_id:-, not from the API}, want $want from the API"
    failed=1
  else
    echo "ok   $method $path -> $status"
  fi
}

json=(-H 'content-type: application/json' --data '{}')
id=000000000000000000000000
check GET /v1/ready 200
check POST /v1/uploads 401 "${json[@]}"
check GET "/v1/uploads/$id" 401
check PATCH "/v1/uploads/$id" 401 -H 'content-type: application/offset+octet-stream' -H 'upload-offset: 0' --data x
check POST "/v1/uploads/$id/complete" 401
check GET "/v1/media/$id/link" 401
check GET /v1/chats 401
check GET /v1/auth/me 401
# Socket.IO answers outside Fastify (no request id): its handshake starts with 0{"sid".
handshake="$(curl -sS --max-time 15 "${extra[@]}" "$base/socket.io/?EIO=4&transport=polling" || true)"
if [[ "$handshake" == '0{"sid"'* ]]; then
  echo "ok   GET /socket.io/ -> Engine.IO handshake"
else
  echo "FAIL GET /socket.io/: no Engine.IO handshake (${handshake:0:80})"
  failed=1
fi

# "Share to Zuvo" with no service worker yet: the web container sends it to /share?retry=1 (a static
# server would answer 405). Served by the web container, so no API request id here.
share="$(curl -sS -o /dev/null -D - --max-time 15 -X POST -F text=hi "${extra[@]}" "$base/share-target" | tr -d '\r' || true)"
share_status="$(sed -n '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p' <<< "$share")"
if [ "$share_status" = 303 ] && grep -qi '^location: .*/share?retry=1$' <<< "$share"; then
  echo "ok   POST /share-target -> 303 /share?retry=1"
else
  echo "FAIL POST /share-target: got ${share_status:-no answer}, want 303 to /share?retry=1"
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "::error title=Nginx routes::The Nginx site in front of $base does not pass every API route through. Compare it with deploy/nginx/zuvo.corremadvisory.com.conf (docs/runbooks/nginx-site.md)."
  exit 1
fi
echo "Nginx routes OK on $base"
