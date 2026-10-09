const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
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
test('a snapshot excludes uncommitted WAL changes and leaves the live transaction intact', t => {
  const demo = backupFixture(t), destination = path.join(demo.primary, 'committed.sqlite');
  const expected = demo.store.get('production-log');
  demo.store.db.exec('BEGIN IMMEDIATE');
  try {
    demo.store.db.prepare("UPDATE documents SET data=? WHERE kind='production-log'").run(JSON.stringify({entries: [], goalTons: 1}));
    snapshot(demo.database, destination);
    const db = new DatabaseSync(destination, {readOnly: true});
    try { assert.deepEqual(JSON.parse(db.prepare("SELECT data FROM documents WHERE kind='production-log'").get().data), expected.data); }
    finally { db.close(); }
    assert.equal(demo.store.get('production-log').data.entries.length, 0);
  } finally { demo.store.db.exec('ROLLBACK'); }
  assert.deepEqual(demo.store.get('production-log'), expected);
});
test('a full primary disk keeps both previous copies and can recover on the next run', t => {
  const demo = backupFixture(t); separateDevice(t, demo.secondary);
  const good = runBackup({...demo, now}), primaryBefore = archives(demo.primary), secondaryBefore = archives(demo.secondary);
  const open = fs.openSync;
  const mock = t.mock.method(fs, 'openSync', (filename, ...args) => {
    if (path.dirname(filename) === demo.primary && path.basename(filename).startsWith('.incomplete-')) throw Object.assign(new Error('Fictional full disk'), {code: 'ENOSPC'});
    return open(filename, ...args);
  });
  const failed = runBackup({...demo, now: new Date(now.getTime() + 14400000)});
  assert.equal(failed.code, 'SNAPSHOT_FAILED'); assert.equal(failed.state, 'failed');
  assert.equal(failed.lastSuccess, good.lastSuccess); assert.equal(failed.lastPrimary, good.lastPrimary);
  assert.deepEqual(archives(demo.primary), primaryBefore); assert.deepEqual(archives(demo.secondary), secondaryBefore);
  mock.mock.restore();
  const retried = runBackup({...demo, now: new Date(now.getTime() + 86400000)});
  assert.equal(retried.state, 'ok'); assert.equal(retried.lastSuccess, retried.lastAttempt);
  assert.equal(archives(demo.primary).length, 2); assert.equal(archives(demo.secondary).length, 2);
});
for (const stage of ['flush', 'publish']) {
  test('snapshot ' + stage + ' failure never publishes an incomplete archive or removes previous copies', t => {
    const demo = backupFixture(t), previous = path.join(demo.primary, 'previous.sqlite'), destination = path.join(demo.primary, 'new.sqlite');
    snapshot(demo.database, previous); const before = fs.readFileSync(previous);
    t.mock.method(fs, stage === 'flush' ? 'fsyncSync' : 'linkSync', () => { throw new Error('Fictional storage failure'); });
    assert.throws(() => snapshot(demo.database, destination));
    assert.equal(fs.existsSync(destination), false); assert.deepEqual(fs.readFileSync(previous), before);
    assert.deepEqual(fs.readdirSync(demo.primary), ['previous.sqlite']);
  });
}
test('failure to persist the directory after publishing cannot report a successful pair', t => {
  const demo = backupFixture(t); separateDevice(t, demo.secondary);
  const sync = fs.fsyncSync;
  let injected = false;
  t.mock.method(fs, 'fsyncSync', fd => {
    if (!injected && fs.fstatSync(fd).isDirectory()) { injected = true; throw new Error('Fictional directory flush failure'); }
    return sync(fd);
  });
  const status = runBackup({...demo, now});
  assert.equal(status.state, 'failed'); assert.equal(status.code, 'SNAPSHOT_FAILED'); assert.equal(status.lastSuccess, null);
  assert.equal(archives(demo.secondary).length, 0);
  assert.equal(archives(demo.primary).length, 1); verifyDatabase(path.join(demo.primary, archives(demo.primary)[0]));
});
test('failure to replace status keeps the previous summary and both verified archives', t => {
  const demo = backupFixture(t); separateDevice(t, demo.secondary);
  const good = runBackup({...demo, now}), before = fs.readFileSync(path.join(demo.primary, 'status.json'));
  t.mock.method(fs, 'renameSync', () => { throw new Error('Fictional status write failure'); });
  assert.throws(() => runBackup({...demo, now: new Date(now.getTime() + 86400000)}));
  assert.deepEqual(fs.readFileSync(path.join(demo.primary, 'status.json')), before);
  assert.deepEqual(readStatus(demo.primary), good);
  for (const directory of [demo.primary, demo.secondary]) {
    assert.equal(archives(directory).length, 2);
    for (const name of archives(directory)) verifyDatabase(path.join(directory, name));
  }
  assert.ok(!fs.readdirSync(demo.primary).some(name => name.startsWith('.status-')));
});
for (const text of ['{', 'null', '[]', '{"state":"ok"}', '{"state":"ok","lastAttempt":"2026-02-30T00:00:00.000Z"}']) {
  test('invalid status summary ' + text + ' is unknown and never prevents a fresh verified backup', t => {
    const demo = backupFixture(t); separateDevice(t, demo.secondary);
    fs.writeFileSync(path.join(demo.primary, 'status.json'), text);
    assert.equal(readStatus(demo.primary).state, 'unknown'); assert.equal(readStatus(demo.primary).code, 'STATUS_UNREADABLE');
    const status = runBackup({...demo, now});
    assert.equal(status.state, 'ok'); assert.equal(readStatus(demo.primary).lastSuccess, now.toISOString());
  });
}
test('status cannot claim success from mismatched copy timestamps or echo unknown error values', t => {
  const demo = backupFixture(t); separateDevice(t, demo.secondary);
  const good = runBackup({...demo, now});
  fs.writeFileSync(path.join(demo.primary, 'status.json'), JSON.stringify({...good, lastSecondary: '2026-10-08T08:00:00.000Z'}));
  assert.equal(readStatus(demo.primary).state, 'unknown');
  fs.writeFileSync(path.join(demo.primary, 'host-failure'), 'Fictional invalid date\nFictional private tool error\n');
  const status = readStatus(demo.primary);
  assert.equal(status.state, 'failed'); assert.equal(status.code, 'HOST_BACKUP_FAILED');
  assert.ok(!JSON.stringify(status).includes('Fictional'));
});
test('linked database or status files and a linked secondary directory are never followed', t => {
  const demo = backupFixture(t);
  const hardlink = path.join(demo.directory, 'hardlink.sqlite'); fs.linkSync(demo.database, hardlink);
  assert.throws(() => snapshot(hardlink, path.join(demo.primary, 'manual.sqlite')), {code: 'UNSAFE_FILE'});
  fs.unlinkSync(hardlink);
  const target = path.join(demo.directory, 'external-status'); fs.writeFileSync(target, 'Fictional external data');
  fs.symlinkSync(target, path.join(demo.primary, 'status.json'));
  assert.throws(() => runBackup({...demo, now}), {code: 'UNSAFE_FILE'});
  assert.equal(fs.readFileSync(target, 'utf8'), 'Fictional external data');
  fs.unlinkSync(path.join(demo.primary, 'status.json')); fs.rmdirSync(demo.secondary); fs.symlinkSync(demo.primary, demo.secondary);
  assert.equal(runBackup({...demo, now}).code, 'SECONDARY_UNAVAILABLE');
});
for (const mutation of ["DROP TABLE task_items", "DELETE FROM documents WHERE kind='personnel'", "UPDATE task_schedules SET data='{'", "UPDATE documents SET data='{}' WHERE kind='production-log'"]) {
  test('an incomplete or invalid logical database cannot become a verified archive: ' + mutation, t => {
    const demo = backupFixture(t), archive = path.join(demo.primary, 'invalid.sqlite');
    demo.store.db.exec(mutation);
    assert.throws(() => snapshot(demo.database, archive));
    assert.equal(fs.existsSync(archive), false); assert.deepEqual(fs.readdirSync(demo.primary), []);
  });
}
test('foreign-key corruption is rejected even if the SQLite file itself is intact', t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'invalid.sqlite');
  demo.store.db.exec('PRAGMA foreign_keys=OFF');
  demo.store.db.prepare('UPDATE sessions SET user_id=?').run(999999);
  assert.throws(() => snapshot(demo.database, archive), {code: 'INVALID_ARCHIVE'});
  assert.equal(fs.existsSync(archive), false);
});
test('a killed copy process leaves no completed archive and a retry preserves its incomplete work', async t => {
  const demo = backupFixture(t), source = path.join(demo.primary, 'source.sqlite'), destination = path.join(demo.secondary, 'copy.sqlite');
  snapshot(demo.database, source); const before = fs.readFileSync(source);
  const childCode = `const fs=require('node:fs');
const {copyVerified}=require(process.argv[1]);
fs.copyFileSync=(from,to)=>{fs.writeFileSync(to,'Fictional interrupted copy');process.stdout.write('STAGED\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
copyVerified(process.argv[2],process.argv[3]);`;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', childCode, path.resolve(__dirname, '../../server/backups.cjs'), source, destination], {stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({code, signal})); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fictional copy fixture did not reach the interruption point')), 5000);
    let output = '';
    child.stdout.on('data', data => { output += data; if (output.includes('STAGED\n')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Fictional copy fixture exited before staging')); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  child.kill('SIGKILL'); assert.equal((await exited).signal, 'SIGKILL');
  assert.equal(fs.existsSync(destination), false); assert.deepEqual(fs.readFileSync(source), before);
  const incomplete = fs.readdirSync(demo.secondary); assert.equal(incomplete.length, 1); assert.ok(incomplete[0].startsWith('.incomplete-'));
  copyVerified(source, destination); verifyDatabase(destination);
  assert.deepEqual(fs.readFileSync(destination), before); assert.ok(fs.existsSync(path.join(demo.secondary, incomplete[0])));
});

test('explicit single-disk mode verifies a complete local archive without claiming a second copy', t => {
  const demo = backupFixture(t);
  const status = runBackup({...demo, secondary: undefined, mode: 'single', now});
  assert.equal(status.state, 'ok'); assert.equal(status.mode, 'single');
  assert.equal(status.lastSuccess, now.toISOString()); assert.equal(status.lastPrimary, status.lastSuccess);
  assert.equal(status.lastSecondary, null); assert.equal(status.code, null);
  assert.deepEqual(readStatus(demo.primary), status); assert.equal(archives(demo.secondary).length, 0);
  const db = new DatabaseSync(path.join(demo.primary, archives(demo.primary)[0]), {readOnly: true});
  try {
    for (const table of ['documents', 'users', 'sessions', 'files', 'audit', 'task_items', 'task_schedules', 'task_requests']) {
      assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(), demo.store.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
    }
  } finally { db.close(); }
});
test('single-disk history retains the same daily, weekly and monthly recovery points', t => {
  const demo = backupFixture(t), names = [];
  for (let days = 24; days >= 0; days--) {
    const at = new Date(now.getTime() - days * 86400000);
    const status = runBackup({...demo, secondary: undefined, mode: 'single', now: at});
    assert.equal(status.state, 'ok');
    names.push(archives(demo.primary).find(name => !names.includes(name)));
  }
  assert.deepEqual(archives(demo.primary).sort(), [...retainedArchives(names)].sort());
  assert.ok(archives(demo.primary).length <= 14);
});
test('single-disk snapshot failure keeps the previous verified recovery point', t => {
  const demo = backupFixture(t);
  assert.equal(runBackup({...demo, secondary: undefined, mode: 'single', now}).state, 'ok');
  const before = archives(demo.primary);
  t.mock.method(fs, 'linkSync', () => { throw Object.assign(new Error('Fictional full disk'), {code: 'ENOSPC'}); });
  const status = runBackup({...demo, secondary: undefined, mode: 'single', now: new Date(now.getTime() + 14400000)});
  assert.equal(status.state, 'failed'); assert.equal(status.code, 'SNAPSHOT_FAILED');
  assert.equal(status.lastSuccess, now.toISOString()); assert.deepEqual(archives(demo.primary), before);
  assert.ok(!fs.readdirSync(demo.primary).some(name => name.startsWith('.incomplete')));
});
test('a damaged single-disk historical archive stops rotation without deleting recovery points', t => {
  const demo = backupFixture(t);
  assert.equal(runBackup({...demo, secondary: undefined, mode: 'single', now}).state, 'ok');
  const corrupt = 'hub-2026-09-01T00-00-00-000Z-00000000-0000-4000-8000-000000000000.sqlite';
  fs.writeFileSync(path.join(demo.primary, corrupt), 'Fictional damaged archive');
  const status = runBackup({...demo, secondary: undefined, mode: 'single', now: new Date(now.getTime() + 14400000)});
  assert.equal(status.state, 'failed'); assert.equal(status.code, 'RETENTION_FAILED');
  assert.equal(status.lastSuccess, now.toISOString()); assert.equal(archives(demo.primary).length, 3);
});
test('single-disk mode is explicit and never silently substitutes for failed two-disk protection', t => {
  const demo = backupFixture(t);
  for (const mode of ['unknown', null, true]) assert.throws(() => runBackup({...demo, mode}), {code: 'CONFIGURATION_FAILED'});
  assert.throws(() => runBackup({...demo, mode: 'single'}), {code: 'CONFIGURATION_FAILED'});
  assert.deepEqual(fs.readdirSync(demo.primary), []);
  const status = runBackup({...demo, secondary: undefined, now});
  assert.equal(status.mode, 'dual'); assert.equal(status.state, 'failed');
});
test('single-disk success metadata cannot fabricate a second copy or accept an unknown mode', t => {
  const demo = backupFixture(t);
  const good = runBackup({...demo, secondary: undefined, mode: 'single', now});
  for (const change of [{lastSecondary: now.toISOString()}, {lastPrimary: null}, {mode: 'unknown'}, {mode: null}]) {
    fs.writeFileSync(path.join(demo.primary, 'status.json'), JSON.stringify({...good, ...change}));
    assert.equal(readStatus(demo.primary).state, 'unknown');
  }
});
