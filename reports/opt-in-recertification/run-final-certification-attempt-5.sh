#!/usr/bin/env bash
set -uo pipefail
cd /home/runner/workspace

out="reports/opt-in-recertification/final-cert-run"
log="$out/attempt-5-final-certification.log"
pidfile="$out/attempt-5.pid"
monitor="$out/attempt-5-monitor.log"
statusfile="$out/attempt-5-exit-status.txt"
: > "$log"
: > "$monitor"
rm -f "$pidfile" "$statusfile" "$out/capture-progress.json"

env \
  CERT_TARGET_REVISION=b3975aea8761ce5cdb43ec3206fe995ee012883a \
  CERT_LOCAL_SNAPSHOT=3d40d822dae9eeb103ba65923b4e445a7c8531a2 \
  CERT_WEB_ROOT=/home/runner/workspace/.local/opt-in-recertification/public \
  CERT_BUILD_INDEX_SHA256=704b9236468e84d7fd5c85f7c5305ee8659cc4ca2c2c87c5db7786d45ad5d6ca \
  CERT_API_DIST_SHA256=fbb87d2f59917f20c4bf42f8dfd1da8149611add98d6269d189566cb09bfc79c \
  node reports/opt-in-recertification/final-certification.mjs >> "$log" 2>&1 &
child=$!
printf '%s\n' "$child" > "$pidfile"
printf '%s START pid=%s\n' "$(date -u +%FT%TZ)" "$child" >> "$monitor"

while kill -0 "$child" 2>/dev/null; do
  if [[ -f "$out/capture-progress.json" ]]; then
    progress=$(node -e 'const x=require("./reports/opt-in-recertification/final-cert-run/capture-progress.json"); process.stdout.write(`${x.completed}/${x.required}`)')
  else
    progress="0/72"
  fi
  printf '%s alive pid=%s route-progress=%s\n' "$(date -u +%FT%TZ)" "$child" "$progress" >> "$monitor"
  sleep 10
done

wait "$child"
code=$?
printf '%s\n' "$code" > "$statusfile"
printf '%s EXIT pid=%s code=%s\n' "$(date -u +%FT%TZ)" "$child" "$code" >> "$monitor"
cat "$monitor"
tail -100 "$log"
exit "$code"
