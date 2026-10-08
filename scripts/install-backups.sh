#!/usr/bin/env bash
# Run on the Linux host after deploying the reviewed backup-capable application image.
set -Eeuo pipefail
umask 077
exec 2>/dev/null
abort() { echo 'Backup installation failed. Check the local paths, disk mount and running application.'; exit 1; }
trap 'echo "Backup installation failed. Check the local paths, disk mount and running application."' ERR
[[ $(id -u) == 0 ]] || abort
[[ $# == 3 || $# == 4 ]] || { echo 'Usage: sudo bash scripts/install-backups.sh /absolute/compose/project /absolute/primary/directory /absolute/secondary/directory [hours: 1,2,3,4,6,8,12,24]'; exit 1; }
for command in docker systemctl findmnt mountpoint flock realpath stat; do command -v "$command" >/dev/null; done
for directory in "$1" "$2" "$3"; do
  [[ $directory == /* && $directory != *','* && $directory != *$'\n'* && $directory != *$'\r'* ]] || abort
done
deploy_dir=$(realpath "$1")
primary_dir=$(realpath -m "$2")
secondary_dir=$(realpath -m "$3")
hours=${4:-4}
[[ $hours =~ ^(1|2|3|4|6|8|12|24)$ ]] || abort
[[ -f "$deploy_dir/compose.yaml" && -f "$deploy_dir/.env" ]] || abort
[[ $primary_dir != "$deploy_dir" && $secondary_dir != "$deploy_dir" && $primary_dir != "$secondary_dir" ]] || abort
# Require pre-created application-specific directories; never chmod arbitrary host folders.
[[ -d $primary_dir && -d $secondary_dir ]] || abort
[[ $(stat -c '%u:%a' "$primary_dir") == 1000:700 && $(stat -c '%u:%a' "$secondary_dir") == 1000:700 ]] || abort
secondary_mount=$(findmnt -nro TARGET --target "$secondary_dir")
secondary_uuid=$(findmnt -nro UUID --target "$secondary_dir")
[[ -n $secondary_uuid && $secondary_mount != / ]] || abort
mountpoint -q "$secondary_mount"
[[ $(stat -c '%d' "$primary_dir") != "$(stat -c '%d' "$secondary_dir")" ]] || abort
container=$(docker compose --project-directory "$deploy_dir" -f "$deploy_dir/compose.yaml" ps -q package-hub)
[[ $container =~ ^[0-9a-f]{12,64}$ ]] || abort
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || abort
working_dir=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
[[ $(realpath "$working_dir") == "$deploy_dir" ]] || abort
docker exec "$container" node -e "require('./server/backups.cjs')" >/dev/null
[[ $(docker exec "$container" id -u) == 1000 ]] || abort
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 755 /usr/local/libexec
install -m 755 "$script_dir/backup.sh" /usr/local/libexec/package-hub-backup.sh
install -m 644 "$script_dir/package-hub-backup.service" /etc/systemd/system/package-hub-backup.service
install -m 644 "$script_dir/package-hub-backup.timer" /etc/systemd/system/package-hub-backup.timer
temporary=$(mktemp /etc/package-hub-backup.conf.XXXXXX)
trap 'rm -f -- "${temporary:-}"; echo "Backup installation failed. Check local storage and the running application."' ERR
{
  printf 'DEPLOY_DIR=%q\nCOMPOSE_PROJECT=%q\nPRIMARY_DIR=%q\nSECONDARY_DIR=%q\nSECONDARY_MOUNT=%q\nSECONDARY_UUID=%q\n' \
    "$deploy_dir" "$project" "$primary_dir" "$secondary_dir" "$secondary_mount" "$secondary_uuid"
} >"$temporary"
chmod 600 "$temporary"
mv -f -- "$temporary" /etc/package-hub-backup.conf
install -d -m 755 /etc/systemd/system/package-hub-backup.timer.d
printf '[Timer]\nOnCalendar=\nOnCalendar=*-*-* 00/%s:00:00 UTC\n' "$hours" >/etc/systemd/system/package-hub-backup.timer.d/schedule.conf
systemctl daemon-reload
# A first successful run is required before enabling the recurring schedule.
systemctl start package-hub-backup.service
systemctl enable --now package-hub-backup.timer
echo 'Local backups are verified and the schedule is enabled. Check systemctl status package-hub-backup.timer.'
