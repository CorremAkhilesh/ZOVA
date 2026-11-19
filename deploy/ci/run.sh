#!/usr/bin/env bash
# CI only: runs one smoke script and, when it fails, repeats the important lines of its output as ONE
# error annotation (annotations are readable on the run page and through the public API, logs are
# not): the "=== WHY" section the script prints on failure, else the last 40 lines without Docker
# progress noise. Usage (in the job): $AS_ROOT bash deploy/ci/run.sh deploy/ci/prod-smoke.sh
set -uo pipefail
log="$(mktemp)"
bash "$1" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  noise='Container |Network |Extracting|Downloading|Pulling|Pull complete|Download complete|Verifying|Waiting|^#[0-9]+ '
  {
    if grep -q '^=== WHY' "$log"; then
      grep -E '::error' "$log" | tail -n 3
      sed -n '/^=== WHY/,$p' "$log"
    else
      grep -vE "$noise" "$log"
    fi
  } | sed 's/\x1b\[[0-9;]*m//g' | tail -n 40 | cut -c1-250 \
    | awk 'BEGIN { ORS = "%0A" } { gsub(/%/, "%25"); gsub(/\r/, ""); print }' \
    | { read -r -d '' body || true; echo "::error title=$(basename "$1") failed (exit $status)::${body}"; }
fi
rm -f "$log"
exit "$status"
