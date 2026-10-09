const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {snapshot} = require('../../server/backups.cjs');
const {backupFixture} = require('./backup-fixture.cjs');
const backup = path.resolve(__dirname, '../../server/backup-cli.cjs'), restore = path.resolve(__dirname, '../../server/restore-cli.cjs');
const run = (script, args, env = {}) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script, ...args], {env: {...process.env, ...env}, encoding: 'utf8'});
function privateOutput(result, demo) {
  for (const value of [demo.directory, 'demo-backup-admin', 'fictional-session', 'Fictional document']) assert.ok(!(result.stdout + result.stderr).includes(value));
}
test('backup CLI reports failed two-disk protection with a nonzero exit and sanitized status', t => {
  const demo = backupFixture(t), env = {HUB_DATABASE: demo.database, HUB_BACKUP_PRIMARY: demo.primary, HUB_BACKUP_SECONDARY: demo.secondary};
  const failed = run(backup, ['run'], env); assert.equal(failed.status, 1); privateOutput(failed, demo);
  assert.ok(failed.stdout.includes('SECONDARY_NOT_SEPARATE'));
  const status = run(backup, ['status'], env); assert.equal(status.status, 0); privateOutput(status, demo);
  const value = JSON.parse(status.stdout); assert.equal(value.state, 'failed'); assert.equal(value.lastSuccess, null);
  assert.deepEqual(Object.keys(value).sort(), ['state', 'code', 'lastAttempt', 'lastSuccess', 'lastPrimary', 'lastSecondary'].sort());
});
test('status CLI handles a truncated summary without reporting success or revealing its content', t => {
  const demo = backupFixture(t); fs.writeFileSync(path.join(demo.primary, 'status.json'), '{"fictional-private-field":');
  const result = run(backup, ['status'], {HUB_BACKUP_PRIMARY: demo.primary});
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).state, 'unknown');
  assert.ok(!result.stdout.includes('fictional-private-field')); privateOutput(result, demo);
});
test('restore CLI produces an isolated private copy and repeatable successful drills', t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'snapshot.sqlite'); snapshot(demo.database, archive);
  const persistent = path.join(demo.directory, 'persistent');
  const result = run(restore, ['restore', archive, persistent]); assert.equal(result.status, 0, result.stderr); privateOutput(result, demo);
  assert.equal(fs.statSync(path.join(persistent, 'hub.sqlite')).mode & 0o777, 0o600);
  for (const name of ['first-drill', 'second-drill']) {
    const drill = run(restore, ['drill', archive, path.join(demo.directory, name)]); assert.equal(drill.status, 0, drill.stderr); privateOutput(drill, demo);
    const checked = JSON.parse(drill.stdout); assert.equal(checked.ok, true); assert.equal(checked.sessionsRevoked, true);
    assert.ok(checked.restoreMs >= 0); assert.ok(checked.startupMs >= 0);
  }
});
test('invalid maintenance commands and failed recovery exit nonzero with generic errors', t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'invalid.sqlite'); fs.writeFileSync(archive, 'Fictional damaged archive');
  for (const [script, args, env] of [[backup, ['invalid'], {}], [backup, ['run'], {HUB_DATABASE: demo.database, HUB_BACKUP_PRIMARY: path.join(demo.directory, 'absent')}],
    [restore, ['restore', archive, path.join(demo.directory, 'recovered')], {}], [restore, ['restore', archive, demo.directory, 'extra'], {}]]) {
    const result = run(script, args, env); assert.equal(result.status, 1); privateOutput(result, demo);
    assert.ok(result.stderr.includes('failed')); assert.ok(!result.stderr.includes('Error:'));
  }
});
