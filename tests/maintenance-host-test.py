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

    def test_command_timeout_stops_its_child_processes_and_releases_output_pipes(self):
        import sys
        import time
        heartbeat = self.root / "fictional-heartbeat"
        child_code = "import pathlib,sys,time; p=pathlib.Path(sys.argv[1]);\nwhile True:\n p.write_text(str(time.monotonic_ns())); time.sleep(.01)"
        parent_code = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); time.sleep(30)"
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired) as failure:
            module.command([sys.executable, "-c", parent_code, child_code, str(heartbeat)], timeout=1)
        self.assertEqual(failure.exception.cmd, "local-maintenance-command")
        self.assertLess(time.monotonic() - started, 3)
        self.assertTrue(heartbeat.exists())
        after = heartbeat.read_text()
        time.sleep(.1)
        self.assertEqual(heartbeat.read_text(), after)

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
        self.host.second_disk = lambda config, run=None: True
        result = self.host.status()
        self.assertEqual(result["backups"]["state"], "ok")
        self.assertEqual(result["backups"]["intervalHours"], 4)
        self.assertTrue(result["backups"]["secondaryAvailable"])
        self.assertNotIn("/fictional", json.dumps(result))
        self.assertEqual(self.commands[-1], ["/bin/bash", "-c", 'source "$1"; printf "%s\\0" "${STATE_DIR:-}"', "maintenance", str(self.update_config)])
        self.assertTrue(any(args == ["/bin/bash", "/usr/local/libexec/package-hub-backup.sh", "status"] for args in self.commands))

    def test_corrupt_status_never_reports_a_success(self):
        self.mode = "invalid-status"
        self.host.second_disk = lambda config, run=None: True
        self.assertEqual(self.host.status()["backups"]["state"], "unknown")

    def test_supported_intervals_and_invalid_schedule(self):
        for hours in [1, 2, 3, 4, 6, 8, 12, 24]:
            self.schedule.write_text("[Timer]\nOnCalendar=\nOnCalendar=*-*-* 00/%s:00:00 UTC\n" % hours)
            self.assertEqual(self.host.interval(), hours)
        self.schedule.write_text("Fictional unsupported calendar")
        self.assertIsNone(self.host.interval())

    def test_ambiguous_reset_trailing_or_unsafe_schedules_cannot_claim_a_known_cadence(self):
        valid = "[Timer]\nOnCalendar=\nOnCalendar=*-*-* 00/4:00:00 UTC\n"
        for value in [valid + "OnCalendar=\n", valid + "OnCalendar=*-*-* 00/8:00:00 UTC\n", valid + "fictional", valid * 50]:
            self.schedule.write_text(value)
            if len(value) > 2048:
                with self.assertRaises(ValueError):
                    self.host.interval()
            else:
                self.assertIsNone(self.host.interval())
        self.schedule.write_text(valid)
        self.schedule.chmod(0o666)
        with self.assertRaises(ValueError):
            self.host.interval()
        self.schedule.unlink()
        self.schedule.symlink_to(self.backup_config)
        with self.assertRaises(ValueError):
            self.host.interval()

    def test_update_metadata_rejects_symlinks_hardlinks_public_files_invalid_dates_and_oversized_content(self):
        good = self.state / "last-good"
        marker = self.state / "last-attempt"
        for mode in ["public", "hardlink", "symlink", "oversized", "invalid-revision", "invalid-date"]:
            with self.subTest(mode=mode):
                if good.exists() or good.is_symlink():
                    good.unlink()
                marker.unlink(missing_ok=True)
                good.write_text("a" * 40)
                good.chmod(0o600)
                if mode == "public":
                    good.chmod(0o644)
                if mode == "hardlink":
                    os.link(good, self.state / "fictional-linked")
                if mode == "symlink":
                    good.unlink()
                    good.symlink_to(self.update_config)
                if mode == "oversized":
                    good.write_text("a" * 40 + " " * 500)
                if mode == "invalid-revision":
                    good.write_text("fictional-invalid-revision")
                if mode == "invalid-date":
                    marker.write_text("2026-02-30T12:00:00.000Z\nok\n")
                    marker.chmod(0o600)
                result = self.host.update_status()
                self.assertEqual(result["state"], "unknown")
                self.assertNotIn(str(self.root), json.dumps(result))

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
        self.host.second_disk = lambda config, run=None: True
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

    def test_slow_commands_share_one_deadline_and_cannot_report_a_missing_disk_or_start_a_job(self):
        for action in [self.host.status, self.host.backup]:
            with self.subTest(action=action.__name__):
                elapsed, timeouts = [0], []
                self.host.clock = lambda: elapsed[0]
                def slow(args, timeout=15):
                    timeouts.append(timeout)
                    elapsed[0] += min(4, timeout)
                    if timeout < 4:
                        raise subprocess.TimeoutExpired("fictional", timeout)
                    return self.run_command(args, timeout)
                self.host.run = slow
                result = action()
                self.assertEqual(elapsed[0], 10)
                self.assertEqual(timeouts, [5, 5, 2])
                self.assertFalse(self.started.is_set())
                if action.__name__ == "status":
                    self.assertEqual(result["backups"]["state"], "unknown")
                    self.assertIsNone(result["backups"]["secondaryAvailable"])
                    self.assertEqual(result["updates"]["state"], "unknown")
                else:
                    self.assertEqual(result, (503, {"error": "MAINTENANCE_UNAVAILABLE"}))

    def test_simultaneous_manual_requests_start_exactly_one_backup(self):
        from concurrent.futures import ThreadPoolExecutor
        self.release.clear()
        with ThreadPoolExecutor(max_workers=8) as workers:
            codes = list(workers.map(lambda _: self.host.backup()[0], range(8)))
        self.assertEqual(codes.count(202), 1)
        self.assertEqual(codes.count(409), 7)
        self.assertTrue(self.started.wait(2))
        self.release.set()
        self.wait_finished()
        self.assertEqual(self.host.job["state"], "ok")
        self.assertEqual(self.commands.count(["systemctl", "start", "package-hub-backup.service"]), 1)

    def test_worker_start_failure_does_not_leave_a_permanently_running_job(self):
        with patch.object(module.threading, "Thread", side_effect=RuntimeError("Fictional private thread detail")):
            self.assertEqual(self.host.backup(), (503, {"error": "MAINTENANCE_UNAVAILABLE"}))
        self.assertEqual(self.host.job["state"], "failed")
        self.assertIsNotNone(self.host.job["finishedAt"])
        self.assertFalse(self.started.is_set())
        self.assertEqual(self.host.backup()[0], 202)
        self.wait_finished()
        self.assertEqual(self.host.job["state"], "ok")

    def test_manual_confirmation_requires_a_canonical_fresh_complete_success_without_an_error_code(self):
        at = "2026-10-08T12:00:00.500Z"
        good = dict(state="ok", lastSuccess=at, lastAttempt=at, lastPrimary=at, lastSecondary=at, code=None)
        cases = [dict(good), dict(good, code="SNAPSHOT_FAILED"), dict(good, lastSecondary=None), dict(good, state="unknown")]
        for invalid in ["2026-10-08T12:00:00.500X", "2026-10-08T12:00:00.5Z", "2099-01-01T00:00:00.000Z"]:
            cases.append(dict(good, **{key: invalid for key in ["lastSuccess", "lastAttempt", "lastPrimary", "lastSecondary"]}))
        for index, value in enumerate(cases):
            with self.subTest(case=index):
                self.host.job = dict(state="running", startedAt="2026-10-08T12:00:00.000Z", finishedAt=None)
                self.host.run = lambda args, timeout=15: subprocess.CompletedProcess(args, 0, json.dumps(value), "")
                with patch.object(module, "utc_now", return_value="2026-10-08T12:00:01.000Z"):
                    self.host.perform_backup()
                self.assertEqual(self.host.job["state"], "ok" if index == 0 else "failed")

    def test_status_timeout_does_not_block_the_manual_backup_state_lock(self):
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        def blocked(args, timeout=15):
            entered.set()
            release.wait(2)
            raise subprocess.TimeoutExpired("fictional", timeout)
        self.host.run = blocked
        worker = threading.Thread(target=self.host.status)
        worker.start()
        self.assertTrue(entered.wait(2))
        def update():
            with self.host.lock:
                self.host.job["state"] = "failed"
            finished.set()
        updater = threading.Thread(target=update)
        updater.start()
        try:
            self.assertTrue(finished.wait(1))
        finally:
            release.set()
            worker.join(3)
            updater.join(3)
        self.assertFalse(worker.is_alive())

    def test_socket_server_bounds_slow_connections_and_recovers_capacity(self):
        import socket
        import socketserver
        entered, release = threading.Event(), threading.Event()
        count, lock = [0], threading.Lock()
        class Slow(socketserver.BaseRequestHandler):
            def handle(self):
                with lock:
                    count[0] += 1
                    if count[0] == 2:
                        entered.set()
                release.wait(3)
                self.request.sendall(b"ok")
        filename = str(self.root / "bounded.sock")
        server = module.Server(filename, Slow, max_requests=2)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        clients = []
        try:
            for _ in range(2):
                client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                client.settimeout(2)
                client.connect(filename)
                clients.append(client)
            self.assertTrue(entered.wait(2))
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as extra:
                extra.settimeout(2)
                extra.connect(filename)
                self.assertEqual(extra.recv(10), b"")
            release.set()
            for client in clients:
                self.assertEqual(client.recv(10), b"ok")
                self.assertEqual(client.recv(10), b"")
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as next_client:
                next_client.settimeout(2)
                next_client.connect(filename)
                self.assertEqual(next_client.recv(10), b"ok")
        finally:
            release.set()
            for client in clients:
                client.close()
            server.shutdown()
            server.server_close()

    def test_socket_activation_refuses_wrong_pid_without_binding_a_public_port(self):
        with patch.dict(os.environ, {"LISTEN_PID": "fictional", "LISTEN_FDS": "1"}):
            with self.assertRaises(ValueError):
                module.main()

    def test_activation_requires_root_one_stream_descriptor_and_the_fixed_local_socket(self):
        import socket
        valid = {"LISTEN_PID": str(os.getpid()), "LISTEN_FDS": "1"}
        for uid, fields in [(1000, valid), (0, dict(valid, LISTEN_FDS="2")), (0, dict(valid, LISTEN_FDS="0"))]:
            with patch.object(module.os, "getuid", return_value=uid), patch.dict(os.environ, fields), patch.object(module.socket, "socket") as create:
                with self.assertRaises(ValueError):
                    module.main()
                create.assert_not_called()
        for family, kind, name in [(socket.AF_INET, socket.SOCK_STREAM, "/run/package-hub-maintenance/control.sock"),
                                   (socket.AF_UNIX, socket.SOCK_DGRAM, "/run/package-hub-maintenance/control.sock"),
                                   (socket.AF_UNIX, socket.SOCK_STREAM, "/fictional/other.sock")]:
            listener = type("Listener", (), {"family": family, "type": kind, "getsockname": lambda self: name})()
            with patch.object(module.os, "getuid", return_value=0), patch.dict(os.environ, valid), patch.object(module.socket, "socket", return_value=listener), patch.object(module, "Server") as server:
                with self.assertRaises(ValueError):
                    module.main()
                server.assert_not_called()

    def test_actual_unix_http_endpoint_accepts_only_fixed_routes_and_empty_backup_body(self):
        import http.client
        import socket
        self.host.second_disk = lambda config, run=None: True
        filename = str(self.root / "control.sock")
        server = module.Server(filename, module.handler(self.host))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(method, route, body=None, declared_length=None, extra_headers="", content_type="application/json"):
            payload = (body or "").encode()
            length = len(payload) if declared_length is None else declared_length
            headers = ("%s %s HTTP/1.1\r\nHost: localhost\r\nContent-Type: %s\r\nContent-Length: %s\r\n%s\r\n" % (method, route, content_type, length, extra_headers)).encode()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(3)
                connection.connect(filename)
                # Send one small wire request: invalid length can be rejected as
                # soon as headers arrive, before a separate body write finishes.
                connection.sendall(headers + payload)
                if declared_length is not None:
                    connection.shutdown(socket.SHUT_WR)
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
        self.assertEqual(request("POST", "/backup", "{}", declared_length=20)[0], 400)
        for body in ["null", "[]", "1", "{", '"{}"']:
            self.assertEqual(request("POST", "/backup", body)[0], 400)
        for headers in ["Transfer-Encoding: chunked\r\n", "Content-Length: 2\r\n", "Content-Type: application/json\r\n"]:
            self.assertEqual(request("POST", "/backup", "{}", extra_headers=headers)[0], 400)
        self.assertEqual(request("POST", "/backup", "{}", content_type="text/plain")[0], 400)
        code, value = request("DELETE", "/status")
        self.assertEqual((code, value), (501, {"error": "METHOD_REJECTED"}))
        self.assertFalse(self.started.is_set())
        self.assertEqual(request("POST", "/backup", "{}")[0], 202)
        self.wait_finished()
        self.assertEqual(self.host.job["state"], "ok")


if __name__ == "__main__":
    unittest.main()
