#!/usr/bin/env python3
"""Local Unix-socket adapter. Only status and the installed backup service are exposed."""
import datetime
import json
import os
import re
import signal
import socket
import socketserver
import stat
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def valid_timestamp(value):
    if not isinstance(value, str):
        return False
    try:
        at = datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
        return at.isoformat(timespec="milliseconds") + "Z" == value
    except ValueError:
        return False


def command(args, timeout=15):
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True) as process:
        try:
            stdout, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            # A shell/CLI may have children holding stdout open. Terminate its
            # whole local group; systemd's independent backup unit continues.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
            raise subprocess.TimeoutExpired("local-maintenance-command", timeout)
        return subprocess.CompletedProcess(args, process.returncode, stdout, "")


class MaintenanceHost:
    def __init__(self, backup_config="/etc/package-hub-backup.conf", update_config="/etc/package-hub-auto-update.conf",
                 schedule="/etc/systemd/system/package-hub-backup.timer.d/schedule.conf", owner_uid=0, run=command, clock=time.monotonic):
        self.backup_config, self.update_config, self.schedule = backup_config, update_config, schedule
        self.owner_uid, self.run, self.clock = owner_uid, run, clock
        self.lock = threading.Lock()
        self.job = {"state": "idle", "startedAt": None, "finishedAt": None}

    def limited_commands(self):
        # Finish before the application's 15-second deadline. Several slow host
        # tools share one budget rather than each consuming a full timeout.
        deadline = self.clock() + 10
        def run(args, timeout=15):
            remaining = deadline - self.clock()
            if remaining <= 0:
                raise TimeoutError("MAINTENANCE_UNAVAILABLE")
            return self.run(args, timeout=min(timeout, remaining, 5))
        return run

    def config(self, filename, fields, run=None):
        run = run or self.run
        info = os.lstat(filename)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
            raise ValueError("CONFIGURATION_FAILED")
        # The same root-owned configuration is sourced by the existing installers.
        # Fields and shell code are fixed; request data never supplies commands.
        code = 'source "$1"; printf "%s\\0" ' + " ".join('"${' + field + ':-}"' for field in fields)
        result = run(["/bin/bash", "-c", code, "maintenance", filename])
        values = result.stdout.split("\0")[:-1]
        if result.returncode or len(values) != len(fields) or any(not value.startswith("/") or any(char in value for char in "\n\r,") for value in values):
            raise ValueError("CONFIGURATION_FAILED")
        return dict(zip(fields, values))

    def backup_config_values(self, run=None):
        return self.config(self.backup_config, ["PRIMARY_DIR", "SECONDARY_DIR", "SECONDARY_MOUNT"], run)

    def service_loaded(self, run=None):
        result = (run or self.run)(["systemctl", "show", "package-hub-backup.service", "--property=LoadState", "--value"], timeout=5)
        return result.returncode == 0 and result.stdout.strip() == "loaded"

    def second_disk(self, config, run=None):
        run = run or self.run
        # Obtain UUID separately: it is a filesystem identifier, not a path.
        result = run(["/bin/bash", "-c", 'source "$1"; printf "%s" "${SECONDARY_UUID:-}"', "maintenance", self.backup_config])
        uuid = result.stdout.strip()
        if result.returncode or not uuid:
            return False
        primary, secondary = os.lstat(config["PRIMARY_DIR"]), os.lstat(config["SECONDARY_DIR"])
        if any(not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != 1000 for info in [primary, secondary]) or primary.st_dev == secondary.st_dev:
            return False
        mount = run(["mountpoint", "-q", config["SECONDARY_MOUNT"]])
        target = run(["findmnt", "-nro", "TARGET", "--target", config["SECONDARY_DIR"]])
        mounted_uuid = run(["findmnt", "-nro", "UUID", "--target", config["SECONDARY_DIR"]])
        return mount.returncode == target.returncode == mounted_uuid.returncode == 0 and target.stdout.strip() == config["SECONDARY_MOUNT"] and mounted_uuid.stdout.strip() == uuid

    def interval(self):
        info = os.lstat(self.schedule)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid or info.st_mode & 0o022 or info.st_nlink != 1 or info.st_size > 2048:
            raise ValueError("CONFIGURATION_FAILED")
        with open(self.schedule, encoding="utf-8") as source:
            text = source.read(2048)
        found = re.fullmatch(r"\[Timer\]\nOnCalendar=\nOnCalendar=\*-\*-\* 00/(1|2|3|4|6|8|12|24):00:00 UTC\n?", text)
        return int(found.group(1)) if found else None

    def update_status(self, run=None):
        value = {"state": "unknown", "lastSuccess": None, "lastAttempt": None}
        try:
            directory = self.config(self.update_config, ["STATE_DIR"], run)["STATE_DIR"]
            directory_info = os.lstat(directory)
            if not stat.S_ISDIR(directory_info.st_mode) or directory_info.st_uid != self.owner_uid or stat.S_IMODE(directory_info.st_mode) != 0o700:
                raise ValueError("UNSAFE_DIRECTORY")
            good, failed = os.path.join(directory, "last-good"), os.path.join(directory, "last-failed")
            def modified(filename):
                info = os.lstat(filename)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != self.owner_uid or stat.S_IMODE(info.st_mode) & 0o077 or info.st_size > 128:
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
        run = self.limited_commands()
        try:
            config = self.backup_config_values(run)
            available = self.service_loaded(run)
            try:
                backups["secondaryAvailable"] = self.second_disk(config, run)
            except Exception:
                pass  # A timed-out check is unknown, not proof of a missing disk.
            try:
                backups["intervalHours"] = self.interval()
            except Exception:
                pass
            result = run(["/bin/bash", "/usr/local/libexec/package-hub-backup.sh", "status"], timeout=5)
            if result.returncode == 0 and len(result.stdout) <= 4096:
                value = json.loads(result.stdout)
                if isinstance(value, dict):
                    for field in ["state", "lastAttempt", "lastSuccess", "lastPrimary", "lastSecondary", "code"]:
                        backups[field] = value.get(field)
        except Exception:
            pass
        with self.lock:
            manual = dict(self.job, available=available)
        return {"backups": backups, "updates": self.update_status(run), "manual": manual}

    def backup(self):
        run = self.limited_commands()
        try:
            self.backup_config_values(run)
            if not self.service_loaded(run):
                return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
        except Exception:
            return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
        with self.lock:
            if self.job["state"] == "running":
                return 409, {"error": "BACKUP_BUSY"}
            try:
                active = run(["systemctl", "show", "package-hub-backup.service", "--property=ActiveState", "--value"], timeout=5)
                if active.returncode:
                    return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
                if active.stdout.strip() not in ["inactive", "failed"]:
                    busy = active.stdout.strip() in ["active", "activating", "deactivating"]
                    return (409 if busy else 503), {"error": "BACKUP_BUSY" if busy else "MAINTENANCE_UNAVAILABLE"}
            except Exception:
                return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
            self.job = {"state": "running", "startedAt": utc_now(), "finishedAt": None}
            try:
                threading.Thread(target=self.perform_backup, daemon=True).start()
            except Exception:
                self.job.update(state="failed", finishedAt=utc_now())
                return 503, {"error": "MAINTENANCE_UNAVAILABLE"}
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
                if value.get("state") == "ok" and "code" in value and value["code"] is None and valid_timestamp(success) and started <= success <= utc_now() and all(value.get(field) == success for field in ["lastAttempt", "lastPrimary", "lastSecondary"]):
                    state = "ok"
        except Exception:
            pass
        with self.lock:
            self.job.update(state=state, finishedAt=utc_now())


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    def __init__(self, *args, max_requests=8, **kwargs):
        self.slots = threading.BoundedSemaphore(max_requests)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            return self.shutdown_request(request)
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

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
            if self.command != "HEAD":
                self.wfile.write(body)

        def send_error(self, code, message=None, explain=None):
            # BaseHTTPRequestHandler otherwise reflects unsupported methods and
            # parser details in an HTML error page.
            self.reply(code, {"error": "METHOD_REJECTED" if code == 501 else "INVALID_DATA"})

        def do_GET(self):
            if self.path == "/status":
                return self.reply(200, host.status())
            self.reply(404, {"error": "NOT_FOUND"})

        def do_POST(self):
            if self.path != "/backup":
                return self.reply(404, {"error": "NOT_FOUND"})
            try:
                lengths = self.headers.get_all("Content-Length", [])
                types = self.headers.get_all("Content-Type", [])
                if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,2}", lengths[0]) or types != ["application/json"]:
                    raise ValueError()
                length = int(lengths[0])
                if not 0 < length <= 64:
                    raise ValueError()
                body = self.rfile.read(length)
                if len(body) != length or json.loads(body.decode("utf-8")) != {}:
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
