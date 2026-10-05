#!/usr/bin/env bash
# Run in the existing server source checkout, never the production file-mode folder.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run this installer with sudo on the CasaOS host.'; exit 1; }
[[ $# == 1 || $# == 2 ]] || { echo 'Usage: sudo bash scripts/install-auto-update.sh /absolute/source/checkout [/absolute/existing/compose/project]'; exit 1; }
source_dir=$(realpath "$1")
deploy_dir=$(realpath "${2:-$1}")
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for command in docker git systemctl flock curl; do
  command -v "$command" >/dev/null || { echo 'A required host tool is missing.'; exit 1; }
done
git_source() { git -c "safe.directory=$source_dir" -C "$source_dir" "$@"; }
[[ $(git_source branch --show-current) == main && -z $(git_source status --porcelain --untracked-files=normal) ]] \
  || { echo 'Use a clean main source checkout.'; exit 1; }
case "$(git_source remote get-url origin)" in
  https://github.com/tolgakrkmz/packing-hub.git|git@github.com:tolgakrkmz/packing-hub.git) ;;
  *) echo 'The configured source repository is not approved.'; exit 1 ;;
esac
[[ -f "$deploy_dir/compose.yaml" && -f "$deploy_dir/.env" ]] || { echo 'The existing Compose file and local .env are required.'; exit 1; }
compose_help=$(docker compose up --help)
[[ $compose_help == *--wait-timeout* ]] || { echo 'Docker Compose with --wait-timeout is required.'; exit 1; }
container=$(docker compose --project-directory "$deploy_dir" -f "$deploy_dir/compose.yaml" ps -q package-hub)
[[ $container =~ ^[0-9a-f]{12,64}$ ]] || { echo 'The existing application container was not found.'; exit 1; }
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'The existing Compose project could not be verified.'; exit 1; }
working_dir=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
[[ $(realpath "$working_dir") == "$deploy_dir" ]] || { echo 'The deployment directory does not own the running container.'; exit 1; }
[[ $source_dir != *$'\n'* ]] || { echo 'Unsupported source directory.'; exit 1; }
escaped_source=${source_dir//\\/\\\\}
escaped_source=${escaped_source//\"/\\\"}
printf 'services:\n  package-hub:\n    build:\n      context: "%s"\n' "$escaped_source" >/etc/package-hub-auto-update.build.yaml
chmod 600 /etc/package-hub-auto-update.build.yaml
install -d -m 700 /var/lib/package-hub-deploy
install -d -m 755 /usr/local/libexec
install -m 755 "$script_dir/auto-update.sh" /usr/local/libexec/package-hub-auto-update.sh
install -m 644 "$script_dir/package-hub-auto-update.service" /etc/systemd/system/package-hub-auto-update.service
install -m 644 "$script_dir/package-hub-auto-update.timer" /etc/systemd/system/package-hub-auto-update.timer
{
  printf 'SOURCE_DIR=%q\n' "$source_dir"
  printf 'DEPLOY_DIR=%q\n' "$deploy_dir"
  printf 'BUILD_OVERRIDE=%q\n' /etc/package-hub-auto-update.build.yaml
  printf 'COMPOSE_PROJECT=%q\n' "$project"
  printf 'STATE_DIR=%q\n' /var/lib/package-hub-deploy
} >/etc/package-hub-auto-update.conf
chmod 600 /etc/package-hub-auto-update.conf
systemctl daemon-reload
systemctl enable --now package-hub-auto-update.timer
systemctl start package-hub-auto-update.service
echo 'Automatic main updates are enabled. Check systemctl status package-hub-auto-update.timer.'
