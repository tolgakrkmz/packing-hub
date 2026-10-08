#!/usr/bin/env python3
"""Local Unix-socket adapter. Only status and the installed backup service are exposed."""
import datetime
import json
import os
import re
import socket
import socketserver
import stat
import subprocess
import threading
from http.server import BaseHTTPRequestHandler


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def command(args, timeout=15):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=timeout, check=False)


class MaintenanceHost:
    def __init__(self, backup_config="/etc/package-hub-backup.conf", update_config="/etc/package-hub-auto-update.conf",
                 schedule="/etc/systemd/system/package-hub-backup.timer.d/schedule.conf", owner_uid=0, run=command):
        self.backup_config, self.update_config, self.schedule = backup_config, update_config, schedule
        self.owner_uid, self.run = owner_uid, run
        self.lock = threading.Lock()
        self.job = {"state": "idle", "startedAt": None, "finishedAt": None}

    def config(self, filename, fields):
        info = os.lstat(filename)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
            raise ValueError("CONFIGURATION_FAILED")
        # The same root-owned configuration is sourced by the existing installers.
        # Fields and shell code are fixed; request data never supplies commands.
        code = 'source "$1"; printf "%s\\0" ' + " ".join('"${' + field + ':-}"' for field in fields)
        result = self.run(["/bin/bash", "-c", code, "maintenance", filename])
        values = result.stdout.split("\0")[:-1]
        if result.returncode or len(values) != len(fields) or any(not value.startswith("/") or any(char in value for char in "\n\r,") for value in values):
            raise ValueError("CONFIGURATION_FAILED")
        return dict(zip(fields, values))

    def backup_config_values(self):
        return self.config(self.backup_config, ["PRIMARY_DIR", "SECONDARY_DIR", "SECONDARY_MOUNT"])

    def service_loaded(self):
        result = self.run(["systemctl", "show", "package-hub-backup.service", "--property=LoadState", "--value"], timeout=5)
        return result.returncode == 0 and result.stdout.strip() == "loaded"

    def second_disk(self, config):
        # Obtain UUID separately: it is a filesystem identifier, not a path.
        result = self.run(["/bin/bash", "-c", 'source "$1"; printf "%s" "${SECONDARY_UUID:-}"', "maintenance", self.backup_config])
        uuid = result.stdout.strip()
        if result.returncode or not uuid:
            return False
        primary, secondary = os.lstat(config["PRIMARY_DIR"]), os.lstat(config["SECONDARY_DIR"])
        if any(not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != 1000 for info in [primary, secondary]) or primary.st_dev == secondary.st_dev:
            return False
        mount = self.run(["mountpoint", "-q", config["SECONDARY_MOUNT"]])
        target = self.run(["findmnt", "-nro", "TARGET", "--target", config["SECONDARY_DIR"]])
        mounted_uuid = self.run(["findmnt", "-nro", "UUID", "--target", config["SECONDARY_DIR"]])
        return mount.returncode == target.returncode == mounted_uuid.returncode == 0 and target.stdout.strip() == config["SECONDARY_MOUNT"] and mounted_uuid.stdout.strip() == uuid

    def interval(self):
        with open(self.schedule, encoding="utf-8") as source:
            text = source.read(2048)
        found = re.search(r"^OnCalendar=\*-\*-\* 00/(1|2|3|4|6|8|12|24):00:00 UTC$", text, re.MULTILINE)
        return int(found.group(1)) if found else None

    def update_status(self):
        value = {"state": "unknown", "lastSuccess": None, "lastAttempt": None}
        try:
            directory = self.config(self.update_config, ["STATE_DIR"])["STATE_DIR"]
            directory_info = os.lstat(directory)
            if not stat.S_ISDIR(directory_info.st_mode) or directory_info.st_uid != self.owner_uid or stat.S_IMODE(directory_info.st_mode) != 0o700:
                raise ValueError("UNSAFE_DIRECTORY")
            good, failed = os.path.join(directory, "last-good"), os.path.join(directory, "last-failed")
            def modified(filename):
                info = os.lstat(filename)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != self.owner_uid or stat.S_IMODE(info.st_mode) & 0o077:
                    raise ValueError("UNSAFE_FILE")
                return datetime.datetime.fromtimestamp(info.st_mtime, datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            try:
                at = modified(good)
                with open(good, encoding="utf-8") as source:
                    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", source.read(128).strip()):
                        raise ValueError("INVALID_REVISION")
                value["lastSuccess"] = at
                value["state"] = "ok"
            except FileNotFoundError:
                pass
            try:
                at = modified(failed)
                if not value["lastSuccess"] or at > value["lastSuccess"]:
                    value.update(state="failed", lastAttempt=at)
            except FileNotFoundError:
                pass
            marker = os.path.join(directory, "last-attempt")
            try:
                modified(marker)
                with open(marker, encoding="utf-8") as source:
                    lines = source.read(128).splitlines()
                if len(lines) == 2 and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z", lines[0]) and lines[1] in ["ok", "failed"]:
                    datetime.datetime.strptime(lines[0], "%Y-%m-%dT%H:%M:%S.000Z")
                    value["lastAttempt"] = lines[0]
                    if lines[1] == "failed":
                        value["state"] = "failed"
                else:
                    value["state"] = "unknown"
            except FileNotFoundError:
                pass
        except Exception:
            value["state"] = "unknown"
        return value

    def status(self):
        backups = {"state": "unknown", "secondaryAvailable": None, "intervalHours": None}
        available = False
        try:
            config = self.backup_config_values()
            available = self.service_loaded()
            try:
                backups["secondaryAvailable"] = self.second_disk(config)
            except Exception:
                backups["secondaryAvailable"] = False
            try:
                backups["intervalHours"] = self.interval()
            except Exception:
                pass
            result = self.run(["/bin/bash", "/usr/local/libexec/package-hub-backup.sh", "status"], timeout=12)
            if result.returncode == 0 and len(result.stdout) <= 4096:
                value = json.loads(result.stdout)
                if isinstance(value, dict):
                    for field in ["state", "lastAttempt", "lastSuccess", "lastPrimary", "lastSecondary", "code"]:
                        backups[field] = value.get(field)
        except Exception:
            pass
        with self.lock:
            manual = dict(self.job, available=available)
        return {"backups": backups, "updates": self.update_status(), "manual": manual}

    def backup(self):
        try:
            self.backup_config_values()
            if not self.service_loaded():
                return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
        except Exception:
            return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
        with self.lock:
            if self.job["state"] == "running":
                return 409, {"error": "BACKUP_BUSY"}
            try:
                active = self.run(["systemctl", "show", "package-hub-backup.service", "--property=ActiveState", "--value"], timeout=5)
                if active.returncode:
                    return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
                if active.stdout.strip() not in ["inactive", "failed"]:
                    busy = active.stdout.strip() in ["active", "activating", "deactivating"]
                    return (409 if busy else 503), {"error": "BACKUP_BUSY" if busy else "MAINTENANCE_UNAVAILABLE"}
            except Exception:
                return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
            self.job = {"state": "running", "startedAt": utc_now(), "finishedAt": None}
            threading.Thread(target=self.perform_backup, daemon=True).start()
        return 202, {"state": "running"}

    def perform_backup(self):
        state = "failed"
        try:
            result = self.run(["systemctl", "start", "package-hub-backup.service"], timeout=7210)
            if result.returncode == 0:
                # Confirm a new successful pair, including when another scheduler
                # acquired the service immediately before this request.
                result = self.run(["/bin/bash", "/usr/local/libexec/package-hub-backup.sh", "status"], timeout=12)
                value = json.loads(result.stdout) if result.returncode == 0 and len(result.stdout) <= 4096 else {}
                with self.lock:
                    started = self.job["startedAt"]
                success = value.get("lastSuccess")
                if value.get("state") == "ok" and isinstance(success, str) and started <= success <= utc_now() and all(value.get(field) == success for field in ["lastAttempt", "lastPrimary", "lastSecondary"]):
                    state = "ok"
        except Exception:
            pass
        with self.lock:
            self.job.update(state=state, finishedAt=utc_now())


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    def handle_error(self, request, client_address):
        pass  # Never expose private command exceptions in service logs.


def handler(host):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *args):
            pass

        def reply(self, code, value):
            body = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/status":
                return self.reply(200, host.status())
            self.reply(404, {"error": "NOT_FOUND"})

        def do_POST(self):
            if self.path != "/backup":
                return self.reply(404, {"error": "NOT_FOUND"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if self.headers.get("Transfer-Encoding") or not 0 < length <= 64 or self.headers.get("Content-Type") != "application/json" or json.loads(self.rfile.read(length)) != {}:
                    raise ValueError()
            except Exception:
                return self.reply(400, {"error": "INVALID_DATA"})
            code, value = host.backup()
            self.reply(code, value)

    return Handler


def main():
    if os.getuid() != 0 or os.environ.get("LISTEN_PID") != str(os.getpid()) or os.environ.get("LISTEN_FDS") != "1":
        raise ValueError("INVALID_ACTIVATION")
    listener = socket.socket(fileno=3)
    if listener.family != socket.AF_UNIX or listener.type != socket.SOCK_STREAM or listener.getsockname() != "/run/package-hub-maintenance/control.sock":
        raise ValueError("INVALID_ACTIVATION")
    server = Server("", handler(MaintenanceHost()), bind_and_activate=False)
    server.socket.close()
    server.socket = listener
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Local maintenance service failed. Check the protected host configuration.")
        raise SystemExit(1)
