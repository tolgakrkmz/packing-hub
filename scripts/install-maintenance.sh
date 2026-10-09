#!/usr/bin/env bash
# Optional local adapter; it reuses the installed backup service and its private configuration.
abort() { echo 'Local maintenance installation failed. Check the installed backup service and host tools.'; exit 1; }
check_host() {
  local install_root=$1
  for command in python3 systemctl docker mountpoint findmnt install stat; do command -v "$command" >/dev/null; done
  [[ -x /usr/bin/python3 ]] || abort
  /usr/bin/python3 -c 'import sys; assert sys.version_info >= (3, 8)'
  [[ -f "$install_root/etc/package-hub-backup.conf" && ! -L "$install_root/etc/package-hub-backup.conf" && $(stat -c '%u:%a:%h' "$install_root/etc/package-hub-backup.conf") == 0:600:1 ]] || abort
  [[ -f "$install_root/usr/local/libexec/package-hub-backup.sh" && ! -L "$install_root/usr/local/libexec/package-hub-backup.sh" && $(stat -c '%u:%a:%h' "$install_root/usr/local/libexec/package-hub-backup.sh") == 0:755:1 ]] || abort
  [[ -f "$install_root/etc/systemd/system/package-hub-backup.service" && ! -L "$install_root/etc/systemd/system/package-hub-backup.service" && $(stat -c '%u:%a:%h' "$install_root/etc/systemd/system/package-hub-backup.service") == 0:644:1 ]] || abort
  [[ $(systemctl show package-hub-backup.service --property=LoadState --value) == loaded ]] || abort
  local active
  active=$(systemctl show package-hub-backup.service --property=ActiveState --value)
  [[ $active == inactive || $active == failed ]] || abort
}
install_service() {
  # Tests stage these exact copies in a temporary root; the CLI always uses /.
  local script_dir=$1 install_root=$2
  install -m 755 "$script_dir/maintenance-host.py" "$install_root/usr/local/libexec/package-hub-maintenance-host.py"
  install -m 644 "$script_dir/package-hub-maintenance.socket" "$install_root/etc/systemd/system/package-hub-maintenance.socket"
  install -m 644 "$script_dir/package-hub-maintenance.service" "$install_root/etc/systemd/system/package-hub-maintenance.service"
  install -m 600 "$script_dir/../compose.maintenance.yaml" "$install_root/etc/package-hub-maintenance.compose.yaml"
  systemctl daemon-reload
  systemctl enable --now package-hub-maintenance.socket
  # Existing socket-activated workers must load the newly reviewed source too.
  systemctl try-restart package-hub-maintenance.service
  echo 'Local maintenance endpoint installed. Apply the reviewed Compose override during a planned deployment.'
}
main() {
  set -Eeuo pipefail
  umask 077
  exec 2>/dev/null
  trap abort ERR
  [[ $(id -u) == 0 && $# == 0 ]] || abort
  check_host ''
  local script_dir
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  install_service "$script_dir" ''
}
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
