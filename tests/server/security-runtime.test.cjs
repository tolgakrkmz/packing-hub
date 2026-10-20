/* Security boundaries use generated temporary data and never a production path. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');
const {createHubServer} = require('../../server/server.cjs');
const {createNotifications} = require('../../server/notifications.cjs');
const {snapshot, copyVerified, verifyDatabase, readStatus} = require('../../server/backups.cjs');
const {restoreArchive} = require('../../server/restore.cjs');
const {backupFixture} = require('./backup-fixture.cjs');
const root = path.resolve(__dirname, '../..');
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-security-runtime-demo-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}
function child(args, env = {}) {
  return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], {
    cwd: root, env: {PATH: path.dirname(process.execPath), TZ: 'UTC', ...env},
    encoding: 'utf8', timeout: 15000, maxBuffer: 65536
  });
}
test('noncanonical and nonlocal HTTP origins are rejected before creating a database', async t => {
  const directory = temporary(t), filename = path.join(directory, 'never-created', 'demo.sqlite');
  for (const publicOrigin of ['', 'https://demo.example.invalid/', 'https://demo.example.invalid/path',
    'https://demo.example.invalid?demo=1', 'https://demo.example.invalid#demo',
    'https://demo:fictional-password@demo.example.invalid', 'https://DEMO.example.invalid',
    'https://demo.example.invalid:443', 'http://127.0.0.1.example.invalid',
    'http://localhost.example.invalid', 'http://0.0.0.0:3000', 'file:///demo', 'null']) {
    assert.throws(() => createHubServer({filename, publicOrigin, allowHttp: true}));
    assert.equal(fs.existsSync(path.dirname(filename)), false, 'invalid origin must have no database side effect');
  }
  assert.throws(() => createHubServer({filename, publicOrigin: 'http://127.0.0.1:0'}));
  assert.equal(fs.existsSync(path.dirname(filename)), false);
  for (const publicOrigin of ['https://demo.example.invalid', 'http://127.0.0.1:0', 'http://localhost:0']) {
    const hub = createHubServer({filename: ':memory:', publicOrigin, allowHttp: true});
    await hub.close();
  }
});
test('startup failures reveal neither configured paths nor credentials nor SQLite errors', t => {
  const directory = temporary(t), filename = path.join(directory, 'fictional-private.sqlite');
  fs.writeFileSync(filename, 'Fictional invalid database');
  for (const env of [
    {HUB_PUBLIC_ORIGIN: 'https://demo:fictional-origin-password@demo.example.invalid', HUB_DATABASE: filename},
    {HUB_PUBLIC_ORIGIN: 'https://demo.example.invalid', HUB_DATABASE: filename}
  ]) {
    const result = child(['server/server.cjs'], env);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'Server startup failed. Check Node.js 24+, database permissions and HUB_PUBLIC_ORIGIN.');
    for (const value of [filename, directory, 'fictional-origin-password', 'Fictional invalid database', 'SQLITE_NOTADB']) {
      assert.equal(result.stderr.includes(value), false);
    }
  }
});
test('new database and SQLite sidecars remain private even with a permissive caller umask', t => {
  const directory = temporary(t), filename = path.join(directory, 'nested', 'demo.sqlite');
  const result = child(['-e', `process.umask(0);const fs=require('node:fs');const {openStore}=require('./server/store.cjs');const file=process.env.DEMO_DATABASE;const store=openStore(file);const modes=[file,file+'-wal',file+'-shm'].map(name=>fs.statSync(name).mode&0o777);const parent=fs.statSync(require('node:path').dirname(file)).mode&0o777;store.close();process.stdout.write(JSON.stringify({modes,parent}));`], {DEMO_DATABASE: filename});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {modes: [0o600, 0o600, 0o600], parent: 0o700});
});
test('anonymous health is fixed metadata and protected source paths never disclose runtime files', async t => {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'https://demo.example.invalid'});
  t.after(() => hub.close());
  await new Promise((resolve, reject) => { hub.server.once('error', reject); hub.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const health = await fetch(base + '/healthz', {headers: {Host: 'untrusted.example.invalid'}, signal: AbortSignal.timeout(5000)});
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {ok: true});
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  for (const route of ['/server/store.cjs', '/server/server.cjs', '/.git/config', '/.env', '/Dockerfile', '/compose.yaml', '/SECURITY-REVIEW.md', '/data/personnel.json', '/hub.sqlite', '/hub.sqlite-wal']) {
    const response = await fetch(base + route, {redirect: 'manual', signal: AbortSignal.timeout(5000)});
    assert.ok([401, 404].includes(response.status), route);
    const body = await response.text();
    assert.equal(body.includes('const '), false, 'source must not be served');
    assert.equal(body.includes('employees'), false, 'data must not be served');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
});
test('recovery revokes copied push devices and queued delivery while preserving inbox and preferences', t => {
  const demo = backupFixture(t);
  createNotifications(demo.store);
  const id = demo.store.db.prepare("SELECT id FROM users WHERE username='demo-backup-admin'").get().id;
  demo.store.db.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?)').run('demo-subscription', id, 'fictional-session-hash', 'https://push.example.invalid/demo', 'fictional-public-key', 1);
  demo.store.db.prepare('INSERT INTO push_queue(subscription_id,next_at) VALUES(?,?)').run('demo-subscription', 1);
  demo.store.db.prepare('INSERT INTO notification_preferences VALUES(?,?)').run(id, '{"productionAdded":false}');
  demo.store.db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)').run('demo-notification', id, 'productionAdded', null, 1, null, 'demo-event');
  const archive = path.join(demo.primary, 'snapshot.sqlite'), target = path.join(demo.directory, 'recovered');
  snapshot(demo.database, archive);
  restoreArchive(archive, target);
  for (const filename of [archive, path.join(target, 'hub.sqlite')]) {
    const db = new DatabaseSync(filename, {readOnly: true});
    try {
      const restored = filename !== archive;
      for (const table of ['sessions', 'push_subscriptions', 'push_queue']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, restored ? 0 : 1, table);
      for (const table of ['notifications', 'notification_preferences']) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), demo.store.db.prepare(`SELECT * FROM ${table}`).all());
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    } finally { db.close(); }
  }
  assert.equal(demo.store.db.prepare('SELECT count(*) AS n FROM push_queue').get().n, 1);
});
test('structurally intact archives with invalid module data are rejected before recovery files are created', t => {
  const demo = backupFixture(t), original = path.join(demo.primary, 'original.sqlite');
  snapshot(demo.database, original);
  const cases = [
    ["UPDATE documents SET data='not-json' WHERE kind='personnel'", []],
    ["UPDATE documents SET data=? WHERE kind='production-log'", [JSON.stringify({entries: [{id: 'demo-invalid', date: 'invalid', shift: 'А', tonnage: -1}], goalTons: 3000})]],
    ["UPDATE documents SET data=? WHERE kind='package-instructions'", ['{"__proto__":{}}']],
    ["DELETE FROM documents WHERE kind='line-downtime'", []]
  ];
  for (const [index, [statement, args]] of cases.entries()) {
    const archive = path.join(demo.primary, 'invalid-' + index + '.sqlite'), target = path.join(demo.directory, 'rejected-' + index);
    fs.copyFileSync(original, archive);
    const db = new DatabaseSync(archive); db.prepare(statement).run(...args); db.close();
    assert.throws(() => verifyDatabase(archive));
    assert.throws(() => restoreArchive(archive, target));
    assert.equal(fs.existsSync(target), false);
  }
  verifyDatabase(original);
});
test('copy publication never overwrites existing regular, symlink or hardlink destinations', t => {
  const demo = backupFixture(t), source = path.join(demo.primary, 'snapshot.sqlite');
  snapshot(demo.database, source);
  for (const kind of ['regular', 'symlink', 'hardlink']) {
    const protectedFile = path.join(demo.directory, kind + '-protected.txt'), destination = path.join(demo.secondary, kind + '.sqlite');
    fs.writeFileSync(protectedFile, 'Fictional existing destination');
    if (kind === 'regular') fs.copyFileSync(protectedFile, destination);
    else if (kind === 'symlink') fs.symlinkSync(protectedFile, destination);
    else fs.linkSync(protectedFile, destination);
    assert.throws(() => copyVerified(source, destination));
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'Fictional existing destination');
    assert.equal(fs.readFileSync(destination, 'utf8'), 'Fictional existing destination');
    assert.equal(fs.readdirSync(demo.secondary).some(name => name.startsWith('.incomplete-')), false);
  }
  verifyDatabase(source);
});
test('unknown fields and noncanonical timestamps cannot turn malformed status into backup success', t => {
  const demo = backupFixture(t), at = '2026-10-08T12:00:00.000Z';
  const valid = {mode: 'dual', state: 'ok', lastAttempt: at, lastSuccess: at, lastPrimary: at, lastSecondary: at, code: null};
  for (const patch of [{lastSuccess: '2026-10-08T12:00:00Z'}, {lastPrimary: null}, {lastSecondary: at + '\n'}, {code: 'fictional-private-error'}, {mode: 'fictional-unknown-mode'}]) {
    fs.writeFileSync(path.join(demo.primary, 'status.json'), JSON.stringify({...valid, ...patch, account: 'Fictional account', database: 'Fictional private path', credentials: 'Fictional secret'}));
    const status = readStatus(demo.primary);
    assert.equal(status.state, 'unknown');
    assert.equal(status.code, 'STATUS_UNREADABLE');
    for (const key of ['account', 'database', 'credentials']) assert.equal(Object.hasOwn(status, key), false);
    assert.equal(JSON.stringify(status).includes('Fictional'), false);
  }
});
test('server errors and failed background jobs log only the route or job and error kind', async t => {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  await hub.auth.create('demo-log-admin', 'Fictional-log-password-123', 'admin');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port, session = await hub.auth.login('demo-log-admin', 'Fictional-log-password-123');
  const get = route => fetch(base + route, {headers: {Origin: base, Cookie: 'hub-local-session=' + session.token}});
  const logged = [], original = console.error; console.error = (...values) => logged.push(values.join(' ')); t.after(() => { console.error = original; });
  const secret = 'Fictional private value 42';
  hub.notifications.sync = () => { throw Object.assign(new Error(secret), {code: 'ERR_SQLITE_ERROR'}); };
  assert.equal((await get('/api/notifications/summary')).status, 200);
  hub.tasks.summary = () => { throw new TypeError(secret); };
  const response = await get('/api/tasks/summary'); assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {error: 'SERVER_ERROR'});
  assert.deepEqual(logged, ['Package Hub failure: job notifications-sync (ERR_SQLITE_ERROR)', 'Package Hub failure: route api/tasks (TypeError)']);
});
