#!/usr/bin/env bash
# Rehearse locally with a new volume and no network or published port. Never mount live data.
set -Eeuo pipefail
umask 077
exec 2>/dev/null
worker=
volume=
created=false
cleanup() {
  local result=0
  if [[ $worker =~ ^[0-9a-f]{12,64}$ ]]; then
    docker stop --time 30 "$worker" >/dev/null || true
    docker rm -f "$worker" >/dev/null || result=1
  fi
  if [[ $created == true ]]; then
    local owner
    owner=$(docker volume inspect --format '{{index .Labels "package-hub.restore-rehearsal"}}' "$volume") || return 1
    if [[ $owner == "$token" ]]; then docker volume rm "$volume" >/dev/null || result=1; else result=1; fi
  fi
  return "$result"
}
finish() {
  local result=$?
  trap - EXIT ERR TERM INT
  if ! cleanup; then
    echo 'Restore rehearsal cleanup failed. Inspect the isolated test resources locally.'
    result=1
  fi
  if [[ $result == 0 ]]; then echo 'Isolated restore rehearsal passed. Test container and volume removed.'; fi
  exit "$result"
}
abort() { echo 'Restore rehearsal failed. The original archive and live application are unchanged.'; exit 1; }
trap abort ERR
trap finish EXIT
trap abort TERM INT
[[ $# == 2 ]] || { echo 'Usage: bash scripts/restore-rehearsal.sh /absolute/local/archive.sqlite sha256:local-image-id'; exit 1; }
archive=$1
image=$2
[[ $archive == /* && -f $archive && ! -L $archive && $archive != *','* && $archive != *$'\n'* && $archive != *$'\r'* ]] || abort
for suffix in -wal -shm -journal; do
  [[ ! -e "$archive$suffix" && ! -L "$archive$suffix" ]] || abort
done
[[ $image =~ ^sha256:[0-9a-f]{64}$ ]] || abort
token=$(docker run --rm --pull never --network none --read-only --entrypoint node "$image" -e "process.stdout.write(require('node:crypto').randomUUID())")
[[ $token =~ ^[a-f0-9-]{36}$ ]] || abort
volume="package-hub-restore-$token"
# Docker volume create is idempotent: explicitly reject pre-existing names first.
if docker volume inspect "$volume" >/dev/null; then abort; fi
docker volume create --label "package-hub.restore-rehearsal=$token" "$volume" >/dev/null
created=true
owner=$(docker volume inspect --format '{{index .Labels "package-hub.restore-rehearsal"}}' "$volume")
[[ $owner == "$token" ]] || abort
worker=$(docker create --pull never --name "package-hub-restore-$token" \
  --network none --read-only --tmpfs /tmp --user 1000:1000 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=volume,src=$volume,dst=/var/lib/package-hub" \
  --mount "type=bind,src=$archive,dst=/recovery-source.sqlite,readonly" \
  --entrypoint node "$image" --disable-warning=ExperimentalWarning \
  server/restore-cli.cjs drill /recovery-source.sqlite /var/lib/package-hub)
[[ $worker =~ ^[0-9a-f]{12,64}$ ]] || abort
docker start -a "$worker"
[[ $(docker inspect --format '{{.State.ExitCode}}' "$worker") == 0 ]] || abort
