const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {restoreArchive, rehearse} = require('../../server/restore.cjs');
const {snapshot, copyVerified, verifyDatabase} = require('../../server/backups.cjs');
const {backupFixture} = require('./backup-fixture.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createTasks} = require('../../server/tasks.cjs');
const {createHubServer} = require('../../server/server.cjs');
const password = 'Fictional-recovery-password-123';
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('isolated restore preserves every module, task, schedule, account permission and document, revoking only copied sessions', t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'snapshot.sqlite');
  snapshot(demo.database, archive); const original = hash(archive);
  const source = new DatabaseSync(archive, {readOnly: true});
  const target = path.join(demo.directory, 'recovered');
  const result = restoreArchive(archive, target);
  assert.ok(result.restoreMs >= 0); assert.equal(result.sessionsRevoked, true);
  const restored = new DatabaseSync(path.join(target, 'hub.sqlite'), {readOnly: true});
  try {
    for (const table of ['documents', 'users', 'files', 'task_items', 'task_schedules', 'task_requests']) {
      assert.deepEqual(restored.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(), source.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
    }
    assert.equal(restored.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    assert.equal(source.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
    assert.equal(demo.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
    assert.equal(restored.prepare("SELECT count(*) AS n FROM audit WHERE action='restore'").get().n, 1);
  } finally { restored.close(); source.close(); }
  assert.equal(hash(archive), original);
  verifyDatabase(path.join(target, 'hub.sqlite'));
  assert.equal(fs.statSync(target).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(target, 'hub.sqlite')).mode & 0o777, 0o600);
  assert.ok(fs.existsSync(path.join(target, 'recovery-ready.json')));
  assert.throws(() => restoreArchive(archive, target), /TARGET_NOT_EMPTY/);
});
test('existing live destinations, sidecars and unsafe directories are refused without altering the live database', t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'snapshot.sqlite'); snapshot(demo.database, archive);
  const before = demo.store.get('production-log');
  assert.throws(() => restoreArchive(archive, demo.directory), /TARGET_NOT_EMPTY/);
  assert.deepEqual(demo.store.get('production-log'), before);
  assert.throws(() => restoreArchive(demo.database, path.join(demo.directory, 'live-source-copy')), /STANDALONE_ARCHIVE/);
  const unsafe = path.join(demo.directory, 'unsafe'); fs.mkdirSync(unsafe, {mode: 0o755});
  assert.throws(() => restoreArchive(archive, unsafe), {code: 'UNSAFE_DIRECTORY'});
  fs.chmodSync(unsafe, 0o700); fs.writeFileSync(path.join(unsafe, 'hub.sqlite-wal'), 'Fictional orphan sidecar');
  assert.throws(() => restoreArchive(archive, unsafe), /TARGET_NOT_EMPTY/);
});
test('corruption, copy interruption and unsupported schema never produce a ready recovery copy', t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'snapshot.sqlite'); snapshot(demo.database, archive);
  const invalid = path.join(demo.primary, 'invalid.sqlite'); fs.writeFileSync(invalid, 'Fictional damaged backup');
  const badTarget = path.join(demo.directory, 'invalid-target');
  assert.throws(() => restoreArchive(invalid, badTarget)); assert.equal(fs.existsSync(badTarget), false);
  const schema = path.join(demo.primary, 'schema.sqlite'); fs.copyFileSync(archive, schema);
  const db = new DatabaseSync(schema); db.exec('PRAGMA user_version=99'); db.close();
  assert.throws(() => restoreArchive(schema, badTarget), {code: 'UNSUPPORTED_SCHEMA'});
  t.mock.method(fs, 'copyFileSync', () => { throw new Error('Fictional copy interruption'); });
  const interrupted = path.join(demo.directory, 'interrupted');
  assert.throws(() => restoreArchive(archive, interrupted));
  assert.ok(fs.existsSync(path.join(interrupted, '.restore-in-progress')));
  assert.equal(fs.existsSync(path.join(interrupted, 'recovery-ready.json')), false);
  assert.throws(() => restoreArchive(archive, interrupted), /TARGET_NOT_EMPTY/);
});
test('restore requires an available administrator and a valid ready marker before rehearsal', async t => {
  const demo = backupFixture(t);
  demo.store.db.prepare("UPDATE users SET active=0 WHERE role='admin'").run();
  const archive = path.join(demo.primary, 'snapshot.sqlite'); snapshot(demo.database, archive);
  const target = path.join(demo.directory, 'no-admin');
  assert.throws(() => restoreArchive(archive, target), /RECOVERY_ADMIN_UNAVAILABLE/);
  assert.ok(fs.existsSync(path.join(target, '.restore-in-progress')));
  assert.equal(fs.existsSync(path.join(target, 'recovery-ready.json')), false);
  await assert.rejects(() => rehearse(target));
  assert.equal(demo.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
});
test('restored application starts, authenticates, enforces permissions, materializes schedules and serves documents and the last confirmed record', async t => {
  let hub;
  t.after(async () => { if (hub) await hub.close(); });
  const demo = backupFixture(t), auth = accounts(demo.store);
  demo.store.db.exec('DELETE FROM task_items; DELETE FROM task_schedules; DELETE FROM task_requests');
  const admin = await auth.create('demo-restore-admin', password, 'admin');
  const chief = await auth.create('demo-restore-chief', password, 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  await auth.create('demo-restore-observer', password, 'observer');
  const oldSession = await auth.login('demo-restore-admin', password);
  const at = Date.parse('2026-12-01T07:00:00+02:00');
  const tasks = createTasks(demo.store, {now: () => at});
  const plan = tasks.create({requestId: randomUUID(), title: 'Fictional recurring recovery task', description: '', priority: 'normal', assigneeId: chief.id, participantIds: [], kind: 'shift', repeat: 'every-shift', from: '2026-12-01', until: '2026-12-03'}, admin);
  const archive = path.join(demo.primary, 'snapshot.sqlite'); snapshot(demo.database, archive);
  const expected = demo.store.get('production-log');
  demo.store.db.prepare("UPDATE documents SET data=? WHERE kind='production-log'").run(JSON.stringify({...expected.data, entries: [...expected.data.entries, {...expected.data.entries[0], id: 'demo-after-snapshot'}]}));
  const target = path.join(demo.directory, 'recovered'); const restored = restoreArchive(archive, target);
  const drill = await rehearse(target); assert.equal(drill.ok, true); assert.ok(drill.startupMs >= 0);
  t.diagnostic('Fictional recovery timing: restore=' + restored.restoreMs + 'ms, startup=' + drill.startupMs + 'ms.');
  hub = createHubServer({filename: path.join(target, 'hub.sqlite'), publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => Date.parse('2026-12-03T23:00:00+02:00')});
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  assert.equal(hub.auth.session(oldSession.token), null); assert.ok(auth.session(oldSession.token));
  const restoredAdmin = await hub.auth.login('demo-restore-admin', password);
  const observer = await hub.auth.login('demo-restore-observer', password);
  const chiefSession = await hub.auth.login('demo-restore-chief', password);
  const request = (route, actor, method = 'GET', body) => fetch(base + route, {method, headers: {Origin: base, Cookie: 'hub-local-session=' + actor.token, 'X-CSRF-Token': actor.csrf, 'Content-Type': 'application/json', 'If-Match': '"9"'}, ...(body ? {body: JSON.stringify(body)} : {})});
  const recovered = await (await request('/api/data/production-log', restoredAdmin)).json();
  assert.deepEqual(recovered, expected); assert.ok(!recovered.data.entries.some(entry => entry.id === 'demo-after-snapshot'));
  const list = await (await request('/api/tasks', restoredAdmin)).json();
  assert.ok(list.schedules.some(item => item.id === plan.id));
  assert.ok(list.items.some(item => item.scheduleId === plan.id));
  assert.equal((await request('/api/accounts', observer)).status, 403);
  assert.equal((await request('/api/data/production-log', observer, 'PUT', expected.data)).status, 403);
  assert.equal((await request('/api/tasks', chiefSession)).status, 200);
  const attachment = await request('/api/files?path=data/demo-document.txt', restoredAdmin);
  assert.equal(attachment.status, 200); assert.equal(await attachment.text(), 'Fictional document for backup verification.');
  assert.equal(demo.store.get('production-log').data.entries.length, 2);
});
for (const stage of ['ready-write', 'ready-flush', 'lock-removal']) {
  test('restore ' + stage + ' failure leaves the copy blocked from rehearsal and preserves the archive', async t => {
    const demo = backupFixture(t), archive = path.join(demo.primary, 'snapshot.sqlite'), target = path.join(demo.directory, 'interrupted');
    snapshot(demo.database, archive); const before = hash(archive), lock = path.join(target, '.restore-in-progress'), ready = path.join(target, 'recovery-ready.json');
    if (stage === 'ready-write') {
      const write = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (filename, ...args) => { if (filename === ready) throw new Error('Fictional marker write failure'); return write(filename, ...args); });
    } else if (stage === 'ready-flush') {
      const sync = fs.fsyncSync;
      t.mock.method(fs, 'fsyncSync', fd => {
        if (fs.existsSync(ready) && fs.fstatSync(fd).ino === fs.statSync(ready).ino) throw new Error('Fictional marker flush failure');
        return sync(fd);
      });
    } else {
      const unlink = fs.unlinkSync;
      t.mock.method(fs, 'unlinkSync', (filename, ...args) => { if (filename === lock) throw new Error('Fictional lock removal failure'); return unlink(filename, ...args); });
    }
    assert.throws(() => restoreArchive(archive, target)); assert.ok(fs.existsSync(lock));
    await assert.rejects(() => rehearse(target));
    assert.throws(() => restoreArchive(archive, target), /TARGET_NOT_EMPTY/);
    assert.equal(hash(archive), before); assert.equal(demo.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  });
}
test('a broken sidecar symlink is still refused before any recovery destination is created', t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'snapshot.sqlite'), target = path.join(demo.directory, 'recovered');
  snapshot(demo.database, archive); fs.symlinkSync(path.join(demo.directory, 'absent'), archive + '-wal');
  assert.throws(() => restoreArchive(archive, target), /NOT_STANDALONE_ARCHIVE/);
  assert.equal(fs.existsSync(target), false);
});
test('a damaged newer archive can be replaced by an older verified recovery point in another empty destination', t => {
  const demo = backupFixture(t), old = path.join(demo.primary, 'older.sqlite'), newer = path.join(demo.primary, 'newer.sqlite');
  snapshot(demo.database, old); const oldHash = hash(old), expected = demo.store.get('production-log');
  demo.store.db.prepare("UPDATE documents SET data=? WHERE kind='production-log'").run(JSON.stringify({...expected.data, entries: []}));
  snapshot(demo.database, newer); fs.writeFileSync(newer, 'Fictional damaged recent archive');
  const failed = path.join(demo.directory, 'failed'), recovered = path.join(demo.directory, 'recovered');
  assert.throws(() => restoreArchive(newer, failed)); assert.equal(fs.existsSync(failed), false);
  restoreArchive(old, recovered);
  const db = new DatabaseSync(path.join(recovered, 'hub.sqlite'), {readOnly: true});
  try { assert.deepEqual(JSON.parse(db.prepare("SELECT data FROM documents WHERE kind='production-log'").get().data), expected.data); }
  finally { db.close(); }
  assert.equal(hash(old), oldHash); assert.equal(demo.store.get('production-log').data.entries.length, 0);
});
test('rehearsal refuses revived sessions and invalid readiness metadata', async t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'snapshot.sqlite'), target = path.join(demo.directory, 'recovered');
  snapshot(demo.database, archive); restoreArchive(archive, target);
  const db = new DatabaseSync(path.join(target, 'hub.sqlite'));
  const user = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('fictional-revived-session', user, 'fictional-csrf', 1); db.close();
  await assert.rejects(() => rehearse(target), /RECOVERY_SESSIONS_PRESENT/);
  const ready = path.join(target, 'recovery-ready.json');
  fs.writeFileSync(ready, JSON.stringify({version: 99, sessionsRevoked: true}));
  await assert.rejects(() => rehearse(target), /RECOVERY_NOT_READY/);
  fs.writeFileSync(ready, '{'); await assert.rejects(() => rehearse(target));
});
test('failed application health checks cannot pass a rehearsal and allow a later clean retry', async t => {
  const demo = backupFixture(t), archive = path.join(demo.primary, 'snapshot.sqlite'), target = path.join(demo.directory, 'recovered');
  snapshot(demo.database, archive); restoreArchive(archive, target);
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', {status: 503}));
  await assert.rejects(() => rehearse(target), /RECOVERY_STARTUP_FAILED/);
  mock.mock.restore(); assert.equal((await rehearse(target)).ok, true);
});
test('recovery can use the secondary archive after the primary archive is lost', t => {
  const demo = backupFixture(t), primary = path.join(demo.primary, 'snapshot.sqlite'), secondary = path.join(demo.secondary, 'snapshot.sqlite');
  snapshot(demo.database, primary); copyVerified(primary, secondary);
  fs.unlinkSync(primary);
  const target = path.join(demo.directory, 'from-secondary'); restoreArchive(secondary, target);
  verifyDatabase(path.join(target, 'hub.sqlite')); verifyDatabase(secondary);
  const db = new DatabaseSync(path.join(target, 'hub.sqlite'), {readOnly: true});
  try {
    assert.deepEqual(db.prepare('SELECT * FROM documents ORDER BY kind').all(), demo.store.db.prepare('SELECT * FROM documents ORDER BY kind').all());
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  } finally { db.close(); }
});
