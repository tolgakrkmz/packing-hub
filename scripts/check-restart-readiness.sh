#!/usr/bin/env bash
# Read-only audit on the existing Linux host. Never print private host values.
set -uo pipefail
exec 2>/dev/null
failed=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failed=1; }
run() { timeout 15s "$@"; }
check_unit() {
  local unit=$1 label=$2 enabled
  if enabled=$(run systemctl is-enabled "$unit") && [[ $enabled == enabled ]] && run systemctl is-active --quiet "$unit" >/dev/null; then
    pass "$label"
  else fail "$label"; fi
}
check_job() {
  local unit=$1 label=$2 result status state
  if ! result=$(run systemctl show --property=Result --value "$unit") ||
     ! status=$(run systemctl show --property=ExecMainStatus --value "$unit") ||
     ! state=$(run systemctl show --property=ActiveState --value "$unit"); then fail "$label"; return; fi
  # A completed oneshot is normally inactive. This is not proof of a past run.
  if [[ $result == success && $status == 0 && ( $state == inactive || $state == active ) ]]; then
    pass "$label"
  else fail "$label"; fi
}
[[ $# == 1 && $1 == /* && -d $1 && -f $1/compose.yaml && -f $1/.env ]] || {
  echo 'Usage: sudo bash scripts/check-restart-readiness.sh /absolute/existing/compose/project'
  exit 1
}
for tool in uname realpath timeout systemctl docker curl; do
  command -v "$tool" >/dev/null || { echo 'FAIL REQUIRED_HOST_TOOLS'; exit 1; }
done
[[ $(uname -s) == Linux ]] || { echo 'FAIL LINUX_HOST_REQUIRED'; exit 1; }
deploy_dir=$(realpath -- "$1") || { echo 'FAIL DEPLOYMENT_DIRECTORY'; exit 1; }
check_unit docker.service DOCKER_BOOT
check_unit containerd.service CONTAINERD_BOOT
check_unit tailscaled.service NETWORK_BOOT
check_unit package-hub-auto-update.timer UPDATE_TIMER_BOOT
check_job package-hub-auto-update.service UPDATE_JOB_STATE
check_unit package-hub-backup.timer BACKUP_TIMER_BOOT
check_job package-hub-backup.service BACKUP_JOB_STATE
compose=(docker compose --project-directory "$deploy_dir" -f "$deploy_dir/compose.yaml")
if [[ -f $deploy_dir/.env.push ]]; then compose+=(--env-file "$deploy_dir/.env" --env-file "$deploy_dir/.env.push"); fi
container=$(run "${compose[@]}" ps --all -q package-hub) || { echo 'FAIL EXISTING_APPLICATION'; exit 1; }
[[ $container =~ ^[0-9a-f]{12,64}$ ]] || { echo 'FAIL EXISTING_APPLICATION'; exit 1; }
inspect() { run docker inspect --format "$1" "$container"; }
check_inspect() {
  local actual
  if actual=$(inspect "$1") && [[ $actual == "$2" ]]; then pass "$3"; else fail "$3"; fi
}
working_dir=$(inspect '{{index .Config.Labels "com.docker.compose.project.working_dir"}}') || { echo 'FAIL PROJECT_IDENTITY'; exit 1; }
if [[ -n $working_dir ]] && actual_dir=$(realpath -- "$working_dir") && [[ $actual_dir == "$deploy_dir" ]]; then pass PROJECT_IDENTITY;
else echo 'FAIL PROJECT_IDENTITY'; exit 1; fi
check_inspect '{{.HostConfig.RestartPolicy.Name}}' unless-stopped RESTART_POLICY
check_inspect '{{.State.Running}}' true APPLICATION_RUNNING
check_inspect '{{if .State.Health}}{{.State.Health.Status}}{{end}}' healthy APPLICATION_HEALTH
if mount=$(inspect '{{range .Mounts}}{{if eq .Destination "/var/lib/package-hub"}}{{.Type}}:{{.RW}}:{{.Name}}{{end}}{{end}}') &&
   [[ $mount =~ ^volume:true:[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then pass PERSISTENT_VOLUME;
else fail PERSISTENT_VOLUME; fi
if port=$(inspect '{{range (index .NetworkSettings.Ports "3000/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}') && [[ $port == 127.0.0.1:3000 ]]; then
  pass LOCAL_PORT
  if run curl --silent --fail --noproxy '*' --connect-timeout 3 --max-time 5 --output /dev/null http://127.0.0.1:3000/healthz >/dev/null; then pass LOCAL_HTTP;
  else fail LOCAL_HTTP; fi
else fail LOCAL_PORT; fi
# The adapter is optional, but a configured adapter must also survive reboot.
if ! environment=$(inspect '{{range .Config.Env}}{{println .}}{{end}}'); then fail APPLICATION_CONFIGURATION;
else
  adapter=false
  database=false
  while IFS= read -r item; do
    case "$item" in
      HUB_MAINTENANCE_SOCKET=?*) adapter=true ;;
      HUB_DATABASE=/var/lib/package-hub/hub.sqlite) database=true ;;
    esac
  done <<<"$environment"
  if [[ $database == true ]]; then pass DATABASE_VOLUME_PATH; else fail DATABASE_VOLUME_PATH; fi
  if [[ $adapter == true ]]; then check_unit package-hub-maintenance.socket MAINTENANCE_SOCKET_BOOT; fi
fi
if [[ $failed == 0 ]]; then
  echo 'PASS HOST_CONFIGURATION_CHECK'
else echo 'FAIL HOST_CONFIGURATION_CHECK'; fi
echo 'MANUAL reboot, external HTTPS, confirmed record, UPS and BIOS acceptance remain required.'
exit "$failed"
