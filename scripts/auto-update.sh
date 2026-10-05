#!/usr/bin/env bash
# Installed once by the administrator; configuration and backups stay on the host.
set -Eeuo pipefail
umask 077
config=${HUB_UPDATE_CONFIG:-/etc/package-hub-auto-update.conf}
[[ -f "$config" ]] || { echo 'Deployment configuration is missing.'; exit 1; }
# shellcheck source=/dev/null
source "$config"
: "${SOURCE_DIR:?}" "${DEPLOY_DIR:?}" "${BUILD_OVERRIDE:?}" "${COMPOSE_PROJECT:?}" "${STATE_DIR:?}"
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/update.lock"
flock -n 9 || exit 0
log="$STATE_DIR/last-run.log"
: >"$log"
fail() { echo "$1"; exit 1; }
run() { "$@" >>"$log" 2>&1; }
git_source() { git -c "safe.directory=$SOURCE_DIR" -C "$SOURCE_DIR" "$@"; }
compose() { docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml" -f "$BUILD_OVERRIDE" -p "$COMPOSE_PROJECT" "$@"; }
[[ $(git_source branch --show-current) == main ]] || fail 'Deployment requires the main branch.'
[[ -z $(git_source status --porcelain --untracked-files=normal) ]] || fail 'Local source changes require administrator review.'
case "$(git_source remote get-url origin)" in
  https://github.com/tolgakrkmz/packing-hub.git|git@github.com:tolgakrkmz/packing-hub.git) ;;
  *) fail 'The configured source repository is not approved.' ;;
esac
run git_source fetch --no-tags origin refs/heads/main:refs/remotes/origin/main || fail 'Source fetch failed. The running site is unchanged.'
candidate=$(git_source rev-parse origin/main)
current=$(git_source rev-parse HEAD)
[[ $candidate =~ ^[0-9a-f]{40,64}$ ]] || fail 'Invalid source revision.'
if [[ -f "$STATE_DIR/last-good" && $(cat "$STATE_DIR/last-good") == "$candidate" ]]; then exit 0; fi
if [[ -f "$STATE_DIR/last-failed" && $(cat "$STATE_DIR/last-failed") == "$candidate" ]]; then
  fail 'This revision previously failed. Administrator review or a newer main revision is required.'
fi
git_source merge-base --is-ancestor HEAD origin/main || fail 'Diverged source history requires administrator review.'
baseline=$current
[[ ! -f "$STATE_DIR/last-good" ]] || baseline=$(cat "$STATE_DIR/last-good")
git_source diff --quiet "$baseline" "$candidate" -- compose.yaml || fail 'Compose configuration changes require a manual deployment.'
container=$(compose ps -q package-hub)
[[ $container =~ ^[0-9a-f]{12,64}$ ]] || fail 'Exactly one existing application container is required.'
[[ $(docker inspect --format '{{.State.Running}}' "$container") == true ]] || fail 'The application is not running.'
volume_format='{{range .Mounts}}{{if and (eq .Destination "/var/lib/package-hub") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}'
old_volume=$(docker inspect --format "$volume_format" "$container")
[[ -n $old_volume ]] || fail 'The existing named data volume could not be verified.'
old_image=$(docker inspect --format '{{.Image}}' "$container")
old_ref=$(docker inspect --format '{{.Config.Image}}' "$container")
expected_ref=$(compose config --images)
[[ ${old_ref%:latest} == "${expected_ref%:latest}" ]] || fail 'The current image does not match this Compose project.'
run git_source merge --ff-only origin/main || fail 'Source update failed. The running site is unchanged.'

failed() {
  printf '%s\n' "$candidate" >"$STATE_DIR/last-failed"
  cp "$log" "$STATE_DIR/last-failure.log"
}
run compose build package-hub || { failed; fail 'Image build failed. The running site is unchanged.'; }
# Resolve the rebuilt tag: compose images can still return the old running image ID.
new_image=$(docker image inspect --format '{{.Id}}' "$expected_ref")
run docker run --rm --network none --read-only --tmpfs /tmp --entrypoint node "$new_image" -e \
  "const hub=require('./server/server.cjs').createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:3000',allowHttp:true});hub.close().catch(()=>process.exit(1));" \
  || { run docker image tag "$old_image" "$expected_ref"; failed; fail 'The built image failed its startup check. The running site is unchanged.'; }

backup_dir=/var/lib/package-hub/auto-backups
backup="$backup_dir/$(date -u +%Y%m%dT%H%M%SZ)-$candidate.sqlite"
run docker exec "$container" node -e "process.umask(0o077);require('node:fs').mkdirSync('$backup_dir',{recursive:true,mode:0o700});" \
  || { failed; fail 'Backup directory creation failed. The running site is unchanged.'; }
run docker exec "$container" node server/manage.cjs backup "$backup" \
  || { failed; fail 'The local database backup failed. Deployment was cancelled.'; }

rollback() {
  failed
  # Restore the prior image tag; preserve the existing database, attachments and sessions.
  if run docker image tag "$old_image" "$expected_ref" && run compose up -d --no-build --pull never --no-deps --wait --wait-timeout 120 package-hub; then
    echo 'Deployment failed. The previous image was restored; administrator review is required.'
  else
    echo 'Deployment and image rollback failed. Administrator intervention is required.'
  fi
  cp "$log" "$STATE_DIR/last-failure.log"
  exit 1
}
run compose up -d --no-build --pull never --no-deps --wait --wait-timeout 120 package-hub || rollback
updated=$(compose ps -q package-hub)
[[ -n $updated && $(docker inspect --format "$volume_format" "$updated") == "$old_volume" ]] || rollback
[[ $(docker inspect --format '{{.Image}}' "$updated") == "$new_image" ]] || rollback
run curl --fail --silent --max-time 10 http://127.0.0.1:3000/healthz || rollback
printf '%s\n' "$candidate" >"$STATE_DIR/last-good"
rm -f "$STATE_DIR/last-failed"
echo 'The latest main revision is deployed and healthy. Data remains on the existing volume.'
