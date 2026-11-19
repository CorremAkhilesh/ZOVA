#!/usr/bin/env bash
# CI only, sourced by nginx-smoke.sh and upload-smoke.sh: runs the REAL host Nginx site file
# (deploy/nginx/zuvo.corremadvisory.com.conf) in an nginx:1.24 container (Ubuntu 24.04's version) on
# the host network, in front of the running stack, with a self-signed certificate where certbot's
# would be. `c` is curl pointed at it.
HOST=zuvo.corremadvisory.com

start_host_nginx() {
  local le live
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
  docker exec zuvo-host-nginx nginx -t || return 1
  sleep 1
}

stop_host_nginx() { docker rm -f zuvo-host-nginx > /dev/null 2>&1 || true; }

c() { curl -sS --resolve "$HOST:443:127.0.0.1" --resolve "$HOST:80:127.0.0.1" -k "$@"; }
