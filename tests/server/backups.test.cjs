const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {snapshot, copyVerified, verifyDatabase, runBackup, readStatus, retainedArchives} = require('../../server/backups.cjs');
const {backupFixture} = require('./backup-fixture.cjs');
const now = new Date('2026-10-08T12:00:00.000Z');
function separateDevice(t, secondary) {
  const original = fs.statSync;
  t.mock.method(fs, 'statSync', (filename, ...args) => {
    const stat = original(filename, ...args);
    if (filename === secondary) stat.dev += 12345;
    return stat;
  });
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (filename, ...args) => {
    const stat = lstat(filename, ...args);
    if (filename === secondary) stat.dev += 12345;
    return stat;
  });
}
const archives = directory => fs.readdirSync(directory).filter(name => name.endsWith('.sqlite'));
test('snapshot includes committed WAL data, accounts, sessions, tasks, schedules and attachment BLOBs', t => {
  const demo = backupFixture(t), destination = path.join(demo.primary, 'manual.sqlite');
  snapshot(demo.database, destination); verifyDatabase(destination);
  const restored = new DatabaseSync(destination, {readOnly: true});
  try {
    for (const table of ['documents', 'users', 'sessions', 'files', 'audit', 'task_items', 'task_schedules', 'task_requests']) {
      assert.deepEqual(restored.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(), demo.store.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
    }
  } finally { restored.close(); }
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  assert.deepEqual(archives(demo.primary), ['manual.sqlite']);
  assert.throws(() => snapshot(demo.database, destination));
  verifyDatabase(destination);
});
test('two verified copies record success and never expose paths, hashes or database contents', t => {
  const demo = backupFixture(t); separateDevice(t, demo.secondary);
  const status = runBackup({...demo, now});
  assert.equal(status.state, 'ok'); assert.equal(status.lastSuccess, now.toISOString());
  const name = archives(demo.primary)[0];
  assert.deepEqual(archives(demo.secondary), [name]);
  assert.deepEqual(fs.readFileSync(path.join(demo.primary, name)), fs.readFileSync(path.join(demo.secondary, name)));
  assert.equal(fs.statSync(path.join(demo.secondary, name)).mode & 0o777, 0o600);
  assert.deepEqual(readStatus(demo.primary), status);
  const summary = fs.readFileSync(path.join(demo.primary, 'status.json'), 'utf8');
  for (const forbidden of [demo.database, demo.secondary, 'demo-backup-admin', 'Fictional document', 'fictional-session']) assert.ok(!summary.includes(forbidden));
});
test('same filesystem and missing secondary retain the local snapshot but never report protection', t => {
  const demo = backupFixture(t);
  const same = runBackup({...demo, now});
  assert.equal(same.code, 'SECONDARY_NOT_SEPARATE'); assert.equal(same.state, 'failed'); assert.equal(same.lastSuccess, null);
  assert.equal(archives(demo.primary).length, 1); assert.equal(archives(demo.secondary).length, 0);
  fs.rmdirSync(demo.secondary);
  const missing = runBackup({...demo, now});
  assert.equal(missing.code, 'SECONDARY_UNAVAILABLE'); assert.equal(archives(demo.primary).length, 2);
});
test('full secondary disk preserves prior good copies and last successful timestamp without pruning', t => {
  const demo = backupFixture(t); separateDevice(t, demo.secondary);
  const good = runBackup({...demo, now}); assert.equal(good.state, 'ok');
  const before = archives(demo.secondary);
  t.mock.method(fs, 'copyFileSync', () => { throw Object.assign(new Error('Fictional disk full'), {code: 'ENOSPC'}); });
  const result = runBackup({...demo, now: new Date(now.getTime() + 14400000)});
  assert.equal(result.state, 'failed'); assert.equal(result.code, 'SECONDARY_COPY_FAILED');
  assert.equal(result.lastSuccess, good.lastSuccess); assert.equal(result.lastSecondary, good.lastSecondary);
  assert.deepEqual(archives(demo.secondary), before); assert.equal(archives(demo.primary).length, 2);
  assert.ok(!fs.readdirSync(demo.secondary).some(name => name.startsWith('.incomplete')));
});
test('damaged source, missing source and corrupt copy cannot become completed archives', t => {
  const demo = backupFixture(t), destination = path.join(demo.primary, 'manual.sqlite');
  assert.throws(() => snapshot(path.join(demo.directory, 'missing.sqlite'), destination));
  assert.equal(fs.existsSync(path.join(demo.directory, 'missing.sqlite')), false);
  const corrupt = path.join(demo.directory, 'corrupt.sqlite'); fs.writeFileSync(corrupt, 'Fictional invalid archive');
  assert.throws(() => snapshot(corrupt, destination)); assert.equal(fs.existsSync(destination), false);
  snapshot(demo.database, destination);
  const original = fs.copyFileSync;
  t.mock.method(fs, 'copyFileSync', (source, target) => { original(source, target); fs.writeFileSync(target, 'Fictional interrupted copy'); });
  assert.throws(() => copyVerified(destination, path.join(demo.secondary, 'copy.sqlite')));
  assert.deepEqual(fs.readdirSync(demo.secondary), []); verifyDatabase(destination);
});
test('changed but structurally valid copy fails byte comparison', t => {
  const demo = backupFixture(t), source = path.join(demo.primary, 'manual.sqlite'); snapshot(demo.database, source);
  const original = fs.copyFileSync;
  t.mock.method(fs, 'copyFileSync', (from, to) => {
    original(from, to); const db = new DatabaseSync(to);
    try { db.prepare("UPDATE users SET active=0 WHERE username='demo-backup-admin'").run(); } finally { db.close(); }
  });
  assert.throws(() => copyVerified(source, path.join(demo.secondary, 'copy.sqlite')), {code: 'COPY_MISMATCH'});
  assert.deepEqual(fs.readdirSync(demo.secondary), []);
});
test('permissions and symlinks are rejected before backup data is written', t => {
  const demo = backupFixture(t); fs.chmodSync(demo.primary, 0o755);
  assert.throws(() => runBackup({...demo, now}), {code: 'UNSAFE_DIRECTORY'});
  fs.chmodSync(demo.primary, 0o700);
  const link = path.join(demo.directory, 'link.sqlite'); fs.symlinkSync(demo.database, link);
  assert.throws(() => snapshot(link, path.join(demo.primary, 'manual.sqlite')), {code: 'UNSAFE_FILE'});
  assert.deepEqual(fs.readdirSync(demo.primary), []);
});
test('daily, ISO weekly and monthly rotation retains recovery points including year boundaries', () => {
  const name = at => 'hub-' + at.replace(/:/g, '-').replace('.', '-') + '-00000000-0000-4000-8000-000000000000.sqlite';
  const names = [];
  for (let day = 0; day < 120; day++) for (const hour of [0, 4, 8, 12, 16, 20]) names.push(name(new Date(Date.UTC(2027, 0, 8 - day, hour)).toISOString()));
  const keep = retainedArchives([...names, 'unmanaged.sqlite', '.incomplete-demo', 'hub-invalid.sqlite']);
  assert.ok(keep.has(name('2027-01-08T20:00:00.000Z')));
  for (const at of ['2027-01-02T20:00:00.000Z', '2026-12-31T20:00:00.000Z', '2026-11-30T20:00:00.000Z']) assert.ok(keep.has(name(at)));
  assert.ok(keep.size <= 14); assert.ok(!keep.has(name('2026-10-31T20:00:00.000Z')));
});
test('rotation deletes only verified managed archives, retaining unmanaged files and incomplete work', t => {
  const demo = backupFixture(t); separateDevice(t, demo.secondary);
  const seed = path.join(demo.directory, 'seed.sqlite'); snapshot(demo.database, seed);
  const names = [];
  for (let day = 1; day <= 35; day++) {
    const at = new Date(now.getTime() - day * 86400000).toISOString();
    const name = 'hub-' + at.replace(/:/g, '-').replace('.', '-') + '-00000000-0000-4000-8000-000000000000.sqlite';
    names.push(name);
    for (const directory of [demo.primary, demo.secondary]) fs.copyFileSync(seed, path.join(directory, name));
  }
  for (const directory of [demo.primary, demo.secondary]) {
    fs.writeFileSync(path.join(directory, 'manual.sqlite'), 'Fictional unmanaged file');
    fs.writeFileSync(path.join(directory, '.incomplete-demo'), 'Fictional interrupted work');
  }
  assert.equal(runBackup({...demo, now}).state, 'ok');
  const newest = archives(demo.primary).find(name => !names.includes(name) && name !== 'manual.sqlite');
  const expected = [...retainedArchives([...names, newest]), 'manual.sqlite'].sort();
  for (const directory of [demo.primary, demo.secondary]) {
    assert.deepEqual(archives(directory).sort(), expected);
    assert.equal(fs.readFileSync(path.join(directory, '.incomplete-demo'), 'utf8'), 'Fictional interrupted work');
  }
});
test('invalid historical archive stops pruning and a host failure overrides previous success', t => {
  const demo = backupFixture(t); separateDevice(t, demo.secondary);
  assert.equal(runBackup({...demo, now}).state, 'ok');
  const corrupt = 'hub-2026-09-01T00-00-00-000Z-00000000-0000-4000-8000-000000000000.sqlite';
  fs.writeFileSync(path.join(demo.primary, corrupt), 'Fictional damaged historical archive');
  const status = runBackup({...demo, now: new Date(now.getTime() + 14400000)});
  assert.equal(status.code, 'RETENTION_FAILED'); assert.equal(archives(demo.primary).length, 3);
  assert.equal(status.lastSuccess, now.toISOString());
  fs.writeFileSync(path.join(demo.primary, 'host-failure'), '2026-10-09T00:00:00.000Z\nSECONDARY_UNAVAILABLE\n');
  assert.equal(readStatus(demo.primary).state, 'failed'); assert.equal(readStatus(demo.primary).code, 'SECONDARY_UNAVAILABLE');
  assert.equal(readStatus(demo.primary).lastAttempt, '2026-10-09T00:00:00.000Z');
});
