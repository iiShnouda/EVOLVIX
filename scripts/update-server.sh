#!/usr/bin/env bash
# Evolvix company server — updates (owner, 2026-10-11: "I press Update in the app and it updates").
#
#   sudo bash scripts/update-server.sh check     # look for a new version (also run once a day)
#   sudo bash scripts/update-server.sh update    # update now: fetch, build, restart
#   sudo bash scripts/update-server.sh request   # do what the app asked for (run by systemd)
#
# The app can't run anything on the server. On the updates page the owner only leaves the word
# "check" or "update" in /var/lib/evolvix/updates/request; systemd (evolvix-update.path, set up by
# install-server.sh) then runs this script, which does only these two things whatever the file says.
# It writes how it went in status.json (state, step, error code) and what the newest code brings in
# latest-release-notes.json, the only things the app reads back. Its own log stays on the server:
# /var/log/evolvix-update.log. A backup is made by the app just before it asks for an update.
set -uo pipefail

REPO="${EVOLVIX_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
DIR=/var/lib/evolvix/updates
LOG=/var/log/evolvix-update.log
NOTES=apps/api/src/SKB.Api/release-notes.json

# git pull may replace this very file while it runs: run a copy of it instead.
if [ -z "${EVOLVIX_UPDATE_COPY:-}" ]; then
  copy=$(mktemp /tmp/evolvix-update.XXXXXX)
  cp "$0" "$copy"
  EVOLVIX_UPDATE_COPY="$copy" EVOLVIX_REPO="$REPO" exec bash "$copy" "$@"
fi
trap 'rm -f "$EVOLVIX_UPDATE_COPY"' EXIT

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo."; exit 1; fi
cd "$REPO" || exit 1
mkdir -p "$DIR"
exec 9>/run/evolvix-update.lock
flock -n 9 || { echo "Already running."; exit 0; }

# The code belongs to the person who installed it: git runs as them (their GitHub access, no
# "dubious ownership"); Docker runs as root.
OWNER=$(stat -c %U "$REPO")
git_() { runuser -u "$OWNER" -- env GIT_TERMINAL_PROMPT=0 git -C "$REPO" "$@"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "$(now) $*" >> "$LOG"; }

# status.json: written whole each time (a temporary file, then moved), so the app never reads half.
CHECKED_AT=""; STARTED_AT=""; FINISHED_AT=""; BEHIND=0
if [ -f "$DIR/status.json" ]; then
  CHECKED_AT=$(sed -n 's/.*"checkedAt": *"\([^"]*\)".*/\1/p' "$DIR/status.json")
  FINISHED_AT=$(sed -n 's/.*"finishedAt": *"\([^"]*\)".*/\1/p' "$DIR/status.json")
fi
status() { # state step error
  local q='"'
  {
    printf '{"state":"%s","step":%s,"error":%s,"behind":%s,' "$1" \
      "$([ -n "$2" ] && echo "$q$2$q" || echo null)" "$([ -n "$3" ] && echo "$q$3$q" || echo null)" "${BEHIND:-0}"
    printf '"checkedAt":%s,"startedAt":%s,"finishedAt":%s}\n' \
      "$([ -n "$CHECKED_AT" ] && echo "$q$CHECKED_AT$q" || echo null)" \
      "$([ -n "$STARTED_AT" ] && echo "$q$STARTED_AT$q" || echo null)" \
      "$([ -n "$FINISHED_AT" ] && echo "$q$FINISHED_AT$q" || echo null)"
  } > "$DIR/status.json.part" && mv "$DIR/status.json.part" "$DIR/status.json"
}
fail() { log "failed: $1"; FINISHED_AT=$(now); status failed "" "$1"; exit 1; }

# Fetch the newest code and note how far ahead it is and what it brings.
check() {
  status checking fetch ""
  local upstream
  upstream=$(git_ rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || upstream=origin/main
  if ! git_ fetch --quiet origin >> "$LOG" 2>&1; then CHECKED_AT=$(now); fail no_connection; fi
  BEHIND=$(git_ rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)
  if git_ show "$upstream:$NOTES" > "$DIR/latest-release-notes.json.part" 2>/dev/null; then
    mv "$DIR/latest-release-notes.json.part" "$DIR/latest-release-notes.json"
  else
    rm -f "$DIR/latest-release-notes.json.part"
  fi
  CHECKED_AT=$(now)
  log "checked: $BEHIND new change(s) on $upstream"
}

health() {
  local port
  port=$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2); port=${port:-8080}
  for _ in $(seq 1 90); do
    curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

update() {
  check
  STARTED_AT=$(now); FINISHED_AT=""
  log "updating"
  status updating download ""
  git_ pull --ff-only --quiet >> "$LOG" 2>&1 || fail local_changes
  # Build while the running version keeps serving, then swap (the app is away for a moment).
  status updating build ""
  local services=()
  grep -q '^ASSISTANT_ENABLED=false' .env 2>/dev/null && services=(db app)
  docker compose --profile full build "${services[@]}" >> "$LOG" 2>&1 || fail build_failed
  status updating restart ""
  docker compose --profile full up -d --remove-orphans "${services[@]}" >> "$LOG" 2>&1 || fail start_failed
  health || fail start_failed
  docker image prune -f >> "$LOG" 2>&1 || true   # the old version's images: keep the disk free
  BEHIND=0; FINISHED_AT=$(now)
  status idle done ""
  log "updated to $(git_ rev-parse --short HEAD)"
}

what="${1:-}"
if [ "$what" = request ]; then
  # Only the two known words count; the file is removed whatever it says.
  what=$(head -c 16 "$DIR/request" 2>/dev/null | tr -cd 'a-z')
  rm -f "$DIR/request"
fi
case "$what" in
  check) check; status idle "" "" ;;
  update) update ;;
  *) echo "Usage: sudo bash scripts/update-server.sh check|update"; exit 1 ;;
esac
