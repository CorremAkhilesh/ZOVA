#!/usr/bin/env bash
# CI only: runs one smoke script and, when it fails, repeats the last 40 lines of its output as ONE
# error annotation (annotations are readable on the run page and through the public API, logs are
# not). Usage: sudo -E env "PATH=$PATH" bash deploy/ci/run.sh deploy/ci/prod-smoke.sh
set -uo pipefail
log="$(mktemp)"
bash "$1" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -vE '^ *(Container|Network|#[0-9]+) ' | tail -n 40 | cut -c1-250 \
    | awk 'BEGIN { ORS = "%0A" } { gsub(/%/, "%25"); gsub(/\r/, ""); print }' \
    | { read -r -d '' body || true; echo "::error title=$(basename "$1") failed (exit $status), last lines::${body}"; }
fi
rm -f "$log"
exit "$status"
