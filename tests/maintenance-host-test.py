"""Only fictional temporary state and command boundaries; no production configuration."""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("maintenance_host", pathlib.Path(__file__).resolve().parents[1] / "scripts/maintenance-host.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="hub-status-fictional-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.backup_config, self.update_config, self.schedule = [self.root / name for name in ["backup.conf", "update.conf", "schedule.conf"]]
        self.backup_config.write_text("Fictional command boundary")
        self.update_config.write_text("Fictional command boundary")
        self.backup_config.chmod(0o600)
        self.update_config.chmod(0o600)
        self.schedule.write_text("[Timer]\nOnCalendar=\nOnCalendar=*-*-* 00/4:00:00 UTC\n")
        self.state = self.root / "state"
        self.state.mkdir()
        self.state.chmod(0o700)
        self.commands, self.mode = [], "success"
        self.started, self.release = threading.Event(), threading.Event()
        self.release.set()
        self.host = module.MaintenanceHost(str(self.backup_config), str(self.update_config), str(self.schedule), os.getuid(), self.run_command)

    def run_command(self, args, timeout=15):
        self.commands.append(args)
        out, code = "", 0
        if args[0] == "/bin/bash" and args[1] == "-c":
            if "SECONDARY_UUID" in args[2]:
                out = "fictional-uuid"
            elif args[-1] == str(self.update_config):
                out = str(self.state) + "\0"
            else:
                out = "/fictional/primary\0/fictional/secondary\0/fictional/mount\0"
        elif args[0] == "mountpoint":
            code = 1 if self.mode == "missing-disk" else 0
        elif args[0] == "findmnt":
            out = ("fictional-other-uuid" if self.mode == "replaced-disk" else "fictional-uuid") if args[2] == "UUID" else "/fictional/mount"
        elif args[0] == "systemctl":
            if args[1] == "show":
                if "--property=LoadState" in args:
                    out = "not-found" if self.mode == "service-missing" else "loaded"
                else:
                    out = "activating" if self.mode == "active" else "inactive"
            else:
                self.started.set()
                self.release.wait(3)
                code = 1 if self.mode == "backup-fails" else 0
        elif args[0] == "/bin/bash":
            at = "2020-01-01T00:00:00.000Z" if self.mode == "stale-result" else module.utc_now()
            out = "Fictional invalid status" if self.mode == "invalid-status" else json.dumps(dict(state="ok", lastSuccess=at, lastAttempt=at, lastPrimary=at, lastSecondary=at, code=None))
        return subprocess.CompletedProcess(args, code, out, "")

    def info(self, device):
        return type("Info", (), {"st_mode": 0o40700, "st_dev": device, "st_uid": 1000})()

    def test_configuration_requires_private_regular_owned_file(self):
        self.backup_config.chmod(0o644)
        self.assertEqual(self.host.backup()[0], 503)
        self.assertFalse(self.commands)
        self.backup_config.unlink()
        self.backup_config.symlink_to(self.update_config)
        self.assertEqual(self.host.backup()[0], 503)
        self.assertFalse(self.commands)

    def test_real_bash_config_handles_quoted_paths_without_executing_values(self):
        target = str(self.root / "demo 'quoted' $(fictional)")
        self.backup_config.write_text("PRIMARY_DIR=" + "'" + target.replace("'", "'\\''") + "'\n")
        self.host.run = module.command
        self.assertEqual(self.host.config(str(self.backup_config), ["PRIMARY_DIR"]), {"PRIMARY_DIR": target})

    def test_no_configuration_is_unknown_and_manual_action_is_unavailable(self):
        self.backup_config.unlink()
        result = self.host.status()
        self.assertEqual(result["backups"]["state"], "unknown")
        self.assertFalse(result["manual"]["available"])
        self.assertEqual(self.host.backup()[0], 503)

    def test_disks_require_separate_devices_mount_and_uuid(self):
        config = self.host.backup_config_values()
        for mode in ["success", "missing-disk", "replaced-disk"]:
            self.mode = mode
            with patch.object(module.os, "lstat", side_effect=[self.info(1), self.info(2)]):
                self.assertEqual(self.host.second_disk(config), mode == "success")
        with patch.object(module.os, "lstat", side_effect=[self.info(1), self.info(1)]):
            self.assertFalse(self.host.second_disk(config))

    def test_status_reads_existing_backup_command_without_exposing_paths_or_logs(self):
        self.host.second_disk = lambda config: True
        result = self.host.status()
        self.assertEqual(result["backups"]["state"], "ok")
        self.assertEqual(result["backups"]["intervalHours"], 4)
        self.assertTrue(result["backups"]["secondaryAvailable"])
        self.assertNotIn("/fictional", json.dumps(result))
        self.assertEqual(self.commands[-1], ["/bin/bash", "-c", 'source "$1"; printf "%s\\0" "${STATE_DIR:-}"', "maintenance", str(self.update_config)])
        self.assertTrue(any(args == ["/bin/bash", "/usr/local/libexec/package-hub-backup.sh", "status"] for args in self.commands))

    def test_corrupt_status_never_reports_a_success(self):
        self.mode = "invalid-status"
        self.host.second_disk = lambda config: True
        self.assertEqual(self.host.status()["backups"]["state"], "unknown")

    def test_supported_intervals_and_invalid_schedule(self):
        for hours in [1, 2, 3, 4, 6, 8, 12, 24]:
            self.schedule.write_text("[Timer]\nOnCalendar=\nOnCalendar=*-*-* 00/%s:00:00 UTC\n" % hours)
            self.assertEqual(self.host.interval(), hours)
        self.schedule.write_text("Fictional unsupported calendar")
        self.assertIsNone(self.host.interval())

    def test_update_checks_distinguish_success_failure_missing_and_corrupt_metadata(self):
        good = self.state / "last-good"
        good.write_text("a" * 40)
        good.chmod(0o600)
        os.utime(good, (1000000000, 1000000000))
        self.assertEqual(self.host.update_status()["state"], "ok")
        marker = self.state / "last-attempt"
        marker.write_text("2026-10-08T12:00:00.000Z\nfailed\n")
        marker.chmod(0o600)
        result = self.host.update_status()
        self.assertEqual(result["state"], "failed")
        self.assertIsNotNone(result["lastSuccess"])
        marker.write_text("Fictional corrupt status")
        self.assertEqual(self.host.update_status()["state"], "unknown")
        marker.unlink()
        good.unlink()
        self.assertEqual(self.host.update_status()["state"], "unknown")

    def test_manual_backup_runs_only_fixed_service_and_rejects_overlap(self):
        self.release.clear()
        code, value = self.host.backup()
        self.assertEqual(code, 202)
        self.assertEqual(value, {"state": "running"})
        self.assertTrue(self.started.wait(2))
        self.assertEqual(self.host.backup()[0], 409)
        self.release.set()
        self.wait_finished()
        self.assertEqual(self.host.job["state"], "ok")
        self.assertTrue(any(args == ["systemctl", "start", "package-hub-backup.service"] for args in self.commands))
        self.assertFalse(any("restart" in args or "push" in args for args in self.commands))

    def wait_finished(self):
        import time
        deadline = time.monotonic() + 3
        while self.host.job["state"] == "running" and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertNotEqual(self.host.job["state"], "running")

    def test_service_failure_and_old_result_are_not_a_successful_manual_backup(self):
        for mode in ["backup-fails", "stale-result"]:
            self.mode = mode
            self.assertEqual(self.host.backup()[0], 202)
            self.wait_finished()
            self.assertEqual(self.host.job["state"], "failed")

    def test_running_scheduled_service_blocks_manual_request(self):
        self.mode = "active"
        self.assertEqual(self.host.backup()[0], 409)
        self.assertFalse(self.started.is_set())

    def test_missing_backup_service_disables_action_and_refuses_request(self):
        self.mode = "service-missing"
        self.host.second_disk = lambda config: True
        self.assertFalse(self.host.status()["manual"]["available"])
        self.assertEqual(self.host.backup()[0], 503)
        self.assertFalse(self.started.is_set())

    def test_host_command_exception_is_sanitized(self):
        def failed(*args, **kwargs):
            raise RuntimeError("Fictional private infrastructure detail")
        self.host.run = failed
        result = self.host.status()
        self.assertEqual(result["backups"]["state"], "unknown")
        self.assertNotIn("Fictional private", json.dumps(result))
        self.assertEqual(self.host.backup()[0], 503)

    def test_socket_activation_refuses_wrong_pid_without_binding_a_public_port(self):
        with patch.dict(os.environ, {"LISTEN_PID": "fictional", "LISTEN_FDS": "1"}):
            with self.assertRaises(ValueError):
                module.main()

    def test_actual_unix_http_endpoint_accepts_only_fixed_routes_and_empty_backup_body(self):
        import http.client
        import socket
        self.host.second_disk = lambda config: True
        filename = str(self.root / "control.sock")
        server = module.Server(filename, module.handler(self.host))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(method, route, body=None):
            payload = (body or "").encode()
            headers = ("%s %s HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: %s\r\n\r\n" % (method, route, len(payload))).encode()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(3)
                connection.connect(filename)
                # Send one small wire request: invalid length can be rejected as
                # soon as headers arrive, before a separate body write finishes.
                connection.sendall(headers + payload)
                response = http.client.HTTPResponse(connection)
                response.begin()
                try:
                    return response.status, json.loads(response.read())
                finally:
                    response.close()
        self.assertEqual(request("GET", "/status")[0], 200)
        self.assertEqual(request("GET", "/fictional/private")[0], 404)
        self.assertEqual(request("POST", "/backup", '{"command":"fictional"}')[0], 400)
        self.assertEqual(request("POST", "/backup", "x" * 100)[0], 400)
        self.assertFalse(self.started.is_set())
        self.assertEqual(request("POST", "/backup", "{}")[0], 202)
        self.wait_finished()
        self.assertEqual(self.host.job["state"], "ok")


if __name__ == "__main__":
    unittest.main()
