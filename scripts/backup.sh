#!/usr/bin/env bash
# Local host service; uses the running image and its existing data volume read-only.
set -Eeuo pipefail
umask 077
exec 2>/dev/null
code=CONFIGURATION_FAILED
locked=false
worker=
cleanup() {
  if [[ $worker =~ ^[0-9a-f]{12,64}$ ]]; then
    docker stop --time 30 "$worker" >/dev/null || true
    docker rm -f "$worker" >/dev/null || return 1
  fi
  return 0
}
failed() {
  if [[ $locked == true ]]; then
    local temporary
    temporary=$(mktemp "$PRIMARY_DIR/.host-failure.XXXXXX") || true
    if [[ -n ${temporary:-} ]]; then
      printf '%s\n%s\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$code" >"$temporary"
      chown 1000:1000 "$temporary" || true
      mv -f -- "$temporary" "$PRIMARY_DIR/host-failure"
    fi
  fi
  echo "Scheduled backup failed ($code). Check the private host configuration."
}
abort() { failed; exit 1; }
finish() {
  local result=$?
  trap - EXIT ERR TERM INT
  if ! cleanup; then code=BACKUP_WORKER_FAILED; failed; result=1; fi
  if [[ $result == 0 && $locked == true ]]; then
    if [[ $BACKUP_MODE == single ]]; then echo 'Scheduled backup completed; local copy verified. No independent second copy.';
    else echo 'Scheduled backup completed; both local copies verified.'; fi
  fi
  exit "$result"
}
trap failed ERR
trap finish EXIT
trap 'code=BACKUP_INTERRUPTED; failed; exit 1' TERM INT
config=${HUB_BACKUP_CONFIG:-/etc/package-hub-backup.conf}
[[ -f $config && ! -L $config && $(stat -c '%u:%a:%h' "$config") == 0:600:1 ]] || abort
# shellcheck source=/dev/null
source "$config"
: "${DEPLOY_DIR:?}" "${COMPOSE_PROJECT:?}" "${PRIMARY_DIR:?}"
BACKUP_MODE=${BACKUP_MODE:-dual}
[[ $BACKUP_MODE == single || $BACKUP_MODE == dual ]] || abort
directories=("$DEPLOY_DIR" "$PRIMARY_DIR")
if [[ $BACKUP_MODE == dual ]]; then
  : "${SECONDARY_DIR:?}" "${SECONDARY_MOUNT:?}" "${SECONDARY_UUID:?}"
  directories+=("$SECONDARY_DIR" "$SECONDARY_MOUNT")
else
  [[ -z ${SECONDARY_DIR:-}${SECONDARY_MOUNT:-}${SECONDARY_UUID:-} ]] || abort
fi
for directory in "${directories[@]}"; do
  [[ $directory == /* && $directory != *','* && $directory != *$'\n'* && $directory != *$'\r'* ]] || abort
done
[[ -d $PRIMARY_DIR && ! -L $PRIMARY_DIR && $(stat -c '%u:%a' "$PRIMARY_DIR") == 1000:700 ]] || abort
[[ $# == 0 || $# == 1 && $1 == status ]] || abort
if [[ ${1:-} == status ]]; then
  code=STATUS_UNAVAILABLE
  # The socket adapter hides home directories. Read only Docker's existing
  # container labels so a deployment under /home needs no filesystem access.
  container=$(docker ps --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter 'label=com.docker.compose.service=package-hub' --filter status=running)
  [[ $container =~ ^[0-9a-f]{12,64}$ ]] || abort
  [[ $(docker inspect --format '{{.State.Running}}' "$container") == true ]] || abort
  [[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container") == "$COMPOSE_PROJECT" ]] || abort
  [[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$container") == package-hub ]] || abort
  image=$(docker inspect --format '{{.Image}}' "$container")
  [[ $image =~ ^sha256:[0-9a-f]{64}$ ]] || abort
  docker run --rm --pull never --network none --read-only --tmpfs /tmp \
    --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
    --mount "type=bind,src=$PRIMARY_DIR,dst=/backup-primary,readonly" \
    -e HUB_BACKUP_PRIMARY=/backup-primary --entrypoint node "$image" \
    --disable-warning=ExperimentalWarning server/backup-cli.cjs status
  exit 0
fi
exec 9>"$PRIMARY_DIR/backup.lock"
flock -n 9 || { echo 'A backup is already running.'; exit 0; }
locked=true
if [[ $BACKUP_MODE == dual ]]; then
  code=SECONDARY_UNAVAILABLE
  mountpoint -q "$SECONDARY_MOUNT"
  [[ $(findmnt -nro TARGET --target "$SECONDARY_DIR") == "$SECONDARY_MOUNT" ]] || abort
  [[ $(findmnt -nro UUID --target "$SECONDARY_DIR") == "$SECONDARY_UUID" ]] || abort
  [[ -d $SECONDARY_DIR && ! -L $SECONDARY_DIR && $(stat -c '%u:%a' "$SECONDARY_DIR") == 1000:700 ]] || abort
  [[ $(stat -c '%d' "$PRIMARY_DIR") != "$(stat -c '%d' "$SECONDARY_DIR")" ]] || abort
fi
code=APPLICATION_UNAVAILABLE
container=$(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml" -p "$COMPOSE_PROJECT" ps -q package-hub)
[[ $container =~ ^[0-9a-f]{12,64}$ ]] || abort
[[ $(docker inspect --format '{{.State.Running}}' "$container") == true ]] || abort
[[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container") == "$COMPOSE_PROJECT" ]] || abort
image=$(docker inspect --format '{{.Image}}' "$container")
[[ $image =~ ^sha256:[0-9a-f]{64}$ ]] || abort
volume=$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/var/lib/package-hub") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}' "$container")
[[ $volume =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || abort
code=DATABASE_CONFIGURATION_UNSUPPORTED
database=$(docker inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "HUB_DATABASE"}}{{index (split . "=") 1}}{{end}}{{end}}' "$container")
[[ $database == /var/lib/package-hub/hub.sqlite ]] || abort
code=BACKUP_WORKER_FAILED
backup_mounts=(--mount "type=bind,src=$PRIMARY_DIR,dst=/backup-primary")
backup_environment=(-e HUB_BACKUP_PRIMARY=/backup-primary -e "HUB_BACKUP_MODE=$BACKUP_MODE")
if [[ $BACKUP_MODE == dual ]]; then
  backup_mounts+=(--mount "type=bind,src=$SECONDARY_DIR,dst=/backup-secondary")
  backup_environment+=(-e HUB_BACKUP_SECONDARY=/backup-secondary)
fi
# A fixed name also blocks an orphaned worker after a host/client interruption.
worker=$(docker create --pull never --name "package-hub-backup-$COMPOSE_PROJECT" --network none --read-only --tmpfs /tmp \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=volume,src=$volume,dst=/var/lib/package-hub,readonly" \
  "${backup_mounts[@]}" \
  -e HUB_DATABASE=/var/lib/package-hub/hub.sqlite \
  "${backup_environment[@]}" \
  --entrypoint node "$image" --disable-warning=ExperimentalWarning server/backup-cli.cjs run)
[[ $worker =~ ^[0-9a-f]{12,64}$ ]] || abort
docker start -a "$worker"
# docker start --attach propagates the process exit status; verify it explicitly too.
[[ $(docker inspect --format '{{.State.ExitCode}}' "$worker") == 0 ]] || abort
rm -f -- "$PRIMARY_DIR/host-failure"
