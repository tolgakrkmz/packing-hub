#!/usr/bin/env bash
# Run on the Linux host after deploying the reviewed backup-capable application image.
abort() { echo 'Backup installation failed. Check the local paths, disk mount and running application.'; exit 1; }
install_service() {
  # The root parameter lets tests stage the exact installation into a temporary
  # directory. The host entry point always installs into the real system root.
  local script_dir=$1 install_root=$2 temporary
  install -d -m 755 "$install_root/usr/local/libexec" "$install_root/etc/systemd/system"
  install -m 755 "$script_dir/backup.sh" "$install_root/usr/local/libexec/package-hub-backup.sh"
  install -m 644 "$script_dir/package-hub-backup.service" "$install_root/etc/systemd/system/package-hub-backup.service"
  install -m 644 "$script_dir/package-hub-backup.timer" "$install_root/etc/systemd/system/package-hub-backup.timer"
  temporary=$(mktemp "$install_root/etc/package-hub-backup.conf.XXXXXX")
  trap 'rm -f -- "${temporary:-}"; echo "Backup installation failed. Check local storage and the running application."' ERR
  {
    printf 'DEPLOY_DIR=%q\nCOMPOSE_PROJECT=%q\nPRIMARY_DIR=%q\nBACKUP_MODE=%q\n' "$deploy_dir" "$project" "$primary_dir" "${backup_mode:-dual}"
    if [[ ${backup_mode:-dual} == dual ]]; then
      printf 'SECONDARY_DIR=%q\nSECONDARY_MOUNT=%q\nSECONDARY_UUID=%q\n' "$secondary_dir" "$secondary_mount" "$secondary_uuid"
    fi
  } >"$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$install_root/etc/package-hub-backup.conf"
  install -d -m 755 "$install_root/etc/systemd/system/package-hub-backup.timer.d"
  printf '[Timer]\nOnCalendar=\nOnCalendar=*-*-* 00/%s:00:00 UTC\n' "$hours" >"$install_root/etc/systemd/system/package-hub-backup.timer.d/schedule.conf"
  systemctl daemon-reload
  # A first successful run is required before enabling the recurring schedule.
  systemctl start package-hub-backup.service
  systemctl enable --now package-hub-backup.timer
  echo 'Local backups are verified and the schedule is enabled. Check systemctl status package-hub-backup.timer.'
  if [[ ${backup_mode:-dual} == single ]]; then echo 'Single-disk mode: there is no independent second copy.'; fi
}
main() {
  set -Eeuo pipefail
  umask 077
  exec 2>/dev/null
  trap 'echo "Backup installation failed. Check the local paths, disk mount and running application."' ERR
  [[ $(id -u) == 0 ]] || abort
  backup_mode=dual
  if [[ ${1:-} == --single ]]; then backup_mode=single; shift; fi
  if [[ $backup_mode == single ]]; then
    [[ $# == 2 || $# == 3 ]] || abort
    hours=${3:-4}
  else
    [[ $# == 3 || $# == 4 ]] || { echo 'Usage: sudo bash scripts/install-backups.sh [--single] /absolute/compose/project /absolute/primary/directory [/absolute/secondary/directory] [hours: 1,2,3,4,6,8,12,24]'; exit 1; }
    hours=${4:-4}
  fi
  for command in docker systemctl flock realpath stat; do command -v "$command" >/dev/null; done
  directories=("$1" "$2")
  if [[ $backup_mode == dual ]]; then directories+=("$3"); fi
  for directory in "${directories[@]}"; do
    [[ $directory == /* && $directory != *','* && $directory != *$'\n'* && $directory != *$'\r'* ]] || abort
  done
  [[ -d $2 && ! -L $2 ]] || abort
  deploy_dir=$(realpath "$1")
  primary_dir=$(realpath -m "$2")
  [[ $hours =~ ^(1|2|3|4|6|8|12|24)$ ]] || abort
  [[ -f "$deploy_dir/compose.yaml" && -f "$deploy_dir/.env" ]] || abort
  [[ $primary_dir != "$deploy_dir" ]] || abort
  # Require pre-created application-specific directories; never chmod arbitrary host folders.
  [[ -d $primary_dir && ! -L $primary_dir && $(stat -c '%u:%a' "$primary_dir") == 1000:700 ]] || abort
  if [[ $backup_mode == dual ]]; then
    for command in findmnt mountpoint; do command -v "$command" >/dev/null; done
    [[ -d $3 && ! -L $3 ]] || abort
    secondary_dir=$(realpath -m "$3")
    [[ $secondary_dir != "$deploy_dir" && $primary_dir != "$secondary_dir" && -d $secondary_dir && ! -L $secondary_dir && $(stat -c '%u:%a' "$secondary_dir") == 1000:700 ]] || abort
    secondary_mount=$(findmnt -nro TARGET --target "$secondary_dir")
    secondary_uuid=$(findmnt -nro UUID --target "$secondary_dir")
    [[ -n $secondary_uuid && $secondary_mount != / ]] || abort
    mountpoint -q "$secondary_mount"
    [[ $(stat -c '%d' "$primary_dir") != "$(stat -c '%d' "$secondary_dir")" ]] || abort
  fi
  container=$(docker compose --project-directory "$deploy_dir" -f "$deploy_dir/compose.yaml" ps -q package-hub)
  [[ $container =~ ^[0-9a-f]{12,64}$ ]] || abort
  project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
  [[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || abort
  working_dir=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
  [[ $(realpath "$working_dir") == "$deploy_dir" ]] || abort
  docker exec "$container" node -e "require('./server/backups.cjs')" >/dev/null
  [[ $(docker exec "$container" id -u) == 1000 ]] || abort
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  install_service "$script_dir" ''
}
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
