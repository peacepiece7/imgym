#!/bin/sh
# Redeploys /opt/imgym whenever origin/main moves ahead of it.
#
# Cron runs the copy at ~/.local/bin/imgym-auto-deploy, never this file: a
# rollback runs `git reset --hard`, and rewriting a script while /bin/sh is
# still reading it corrupts the run. The copy is refreshed from here at the end
# of a successful deploy, so edits land on the following run.
#
# No sudo anywhere: /opt/imgym belongs to the deploy user and that user is in
# the docker group.
set -u

REPO=/opt/imgym
HEALTH_URL=http://127.0.0.1:5820/imgym/api/health
HEALTH_ATTEMPTS=45
HEALTH_INTERVAL=2
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/imgym"
LOG="$LOG_DIR/deploy.log"
LOG_KEEP_LINES=2000
SELF_INSTALLED="$HOME/.local/bin/imgym-auto-deploy"

mkdir -p "$LOG_DIR" || exit 1

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"
}

# Keep the log from growing without bound; logrotate would need root here.
trim_log() {
  if [ "$(wc -l <"$LOG" 2>/dev/null || echo 0)" -gt "$LOG_KEEP_LINES" ]; then
    tail -n "$LOG_KEEP_LINES" "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

cd "$REPO" || { log "FATAL cannot cd to $REPO"; exit 1; }

if ! git fetch -q origin main 2>>"$LOG"; then
  log "ERROR git fetch failed"
  exit 1
fi

CURRENT="$(git rev-parse HEAD)"
TARGET="$(git rev-parse origin/main)"
[ "$CURRENT" = "$TARGET" ] && exit 0

trim_log
log "START $(git rev-parse --short HEAD) -> $(git rev-parse --short origin/main)"

# The image serving traffic right now is the only thing worth going back to.
HAVE_ROLLBACK=no
if docker image inspect imgym:local >/dev/null 2>&1; then
  docker image tag imgym:local imgym:rollback >/dev/null 2>&1 && HAVE_ROLLBACK=yes
fi

rollback() {
  log "ROLLBACK restoring $(git rev-parse --short "$CURRENT")"
  git reset --hard -q "$CURRENT" 2>>"$LOG"
  if [ "$HAVE_ROLLBACK" = yes ]; then
    docker image tag imgym:rollback imgym:local >/dev/null 2>&1
  fi
  if docker compose up -d >>"$LOG" 2>&1; then
    log "ROLLBACK done, serving $(git rev-parse --short HEAD)"
  else
    log "ROLLBACK FAILED - site may be down, needs a human"
  fi
  exit 1
}

if ! git pull --ff-only -q 2>>"$LOG"; then
  log "ERROR git pull failed, nothing changed"
  exit 1
fi

if ! docker compose up -d --build >>"$LOG" 2>&1; then
  log "ERROR build or start failed"
  rollback
fi

attempt=0
while [ "$attempt" -lt "$HEALTH_ATTEMPTS" ]; do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "OK now serving $(git rev-parse --short HEAD)"
    cp deploy/auto-deploy.sh "$SELF_INSTALLED" 2>/dev/null && chmod +x "$SELF_INSTALLED"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep "$HEALTH_INTERVAL"
done

log "ERROR unhealthy after $((HEALTH_ATTEMPTS * HEALTH_INTERVAL))s"
rollback
