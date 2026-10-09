const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {summarize, capacity, createMaintenance, hostRequest} = require('../../server/maintenance.cjs');
const {createHubServer} = require('../../server/server.cjs');
const {openStore} = require('../../server/store.cjs');
const now = Date.parse('2026-10-08T12:00:00.000Z'), at = new Date(now).toISOString();
const healthy = () => ({backups: {state: 'ok', lastAttempt: at, lastSuccess: at, lastPrimary: at, lastSecondary: at, code: null, intervalHours: 4, secondaryAvailable: true},
  updates: {state: 'ok', lastSuccess: at, lastAttempt: at}, manual: {available: true, state: 'idle'}});
const checked = host => summarize(host, {database: {state: 'ok'}, disk: {state: 'ok', freeBytes: 20 * 1024 ** 3, totalBytes: 100 * 1024 ** 3}, now});
test('only complete current checks produce healthy status with fixed fields and no private values', () => {
  const input = healthy(); input.privatePath = '/fictional/private'; input.backups.account = 'fictional-person'; input.updates.logs = 'fictional-sensitive-tool-error';
  const result = checked(input); assert.equal(result.state, 'ok'); assert.deepEqual(result.warnings, []);
  assert.equal(result.secondary.lastCopy, at); assert.equal(result.manual.available, true);
  for (const value of ['/fictional/private', 'fictional-person', 'fictional-sensitive-tool-error']) assert.ok(!JSON.stringify(result).includes(value));
});
test('no host status and no confirmed backup remain unknown rather than healthy', () => {
  const result = checked(null); assert.equal(result.state, 'unknown'); assert.equal(result.backups.lastSuccess, null); assert.equal(result.manual.available, false);
  assert.ok(result.warnings.includes('BACKUP_STATUS_UNKNOWN')); assert.ok(result.warnings.includes('UPDATE_STATUS_UNKNOWN'));
  const input = healthy(); input.backups = {secondaryAvailable: true}; assert.equal(checked(input).secondary.state, 'unknown');
});
test('an overdue backup warns after the configured interval and fifteen-minute grace', () => {
  const input = healthy();
  for (const key of ['lastSuccess', 'lastAttempt', 'lastPrimary', 'lastSecondary']) input.backups[key] = new Date(now - 4 * 3600000 - 900000).toISOString();
  assert.equal(checked(input).backups.state, 'ok');
  for (const key of ['lastSuccess', 'lastAttempt', 'lastPrimary', 'lastSecondary']) input.backups[key] = new Date(now - 4 * 3600000 - 900001).toISOString();
  assert.equal(checked(input).backups.state, 'warning'); assert.ok(checked(input).warnings.includes('BACKUP_OVERDUE'));
});
for (const scenario of ['missing-disk', 'failed-backup', 'failed-update', 'failed-manual']) {
  test(scenario + ' overrides older successful timestamps', () => {
    const input = healthy();
    if (scenario === 'missing-disk') input.backups.secondaryAvailable = false;
    if (scenario === 'failed-backup') { input.backups.state = 'failed'; input.backups.code = 'SECONDARY_COPY_FAILED'; }
    if (scenario === 'failed-update') input.updates.state = 'failed';
    if (scenario === 'failed-manual') input.manual.state = 'failed';
    const result = checked(input); assert.equal(result.state, 'failed'); assert.ok(result.warnings.length);
    assert.equal(result.backups.lastSuccess, at); assert.equal(result.updates.lastSuccess, at);
  });
}
for (const scenario of ['missing-time', 'mismatched-copy', 'future-time', 'invalid-interval', 'unknown-code']) {
  test(scenario + ' cannot claim successful protection', () => {
    const input = healthy();
    if (scenario === 'missing-time') delete input.backups.lastSuccess;
    if (scenario === 'mismatched-copy') input.backups.lastSecondary = '2026-10-08T08:00:00.000Z';
    if (scenario === 'future-time') for (const key of ['lastSuccess', 'lastAttempt', 'lastPrimary', 'lastSecondary']) input.backups[key] = '2099-01-01T00:00:00.000Z';
    if (scenario === 'invalid-interval') input.backups.intervalHours = 5;
    if (scenario === 'unknown-code') input.backups.code = '/fictional/private-tool-error';
    const result = checked(input); assert.equal(result.backups.state, 'unknown'); assert.equal(result.backups.code, 'STATUS_UNREADABLE');
    assert.ok(!JSON.stringify(result).includes('/fictional/private-tool-error'));
  });
}
test('disk capacity uses space available to the application and warns on full or small disks', t => {
  let available = 20n;
  t.mock.method(fs, 'statfsSync', () => ({bavail: available, bfree: 50n, bsize: 1024n ** 3n, blocks: 100n}));
  assert.equal(capacity('/fictional/hub.sqlite').state, 'ok');
  assert.equal(capacity('/fictional/hub.sqlite').freeBytes, 20 * 1024 ** 3);
  available = 9n; assert.equal(capacity('/fictional/hub.sqlite').state, 'warning');
  available = 0n; assert.equal(capacity('/fictional/hub.sqlite').state, 'warning');
  const result = summarize(healthy(), {database: {state: 'ok'}, disk: capacity('/fictional/hub.sqlite'), now});
  assert.ok(result.warnings.includes('DISK_SPACE_LOW'));
  available = 101n; assert.equal(capacity('/fictional/hub.sqlite').state, 'unknown');
  assert.equal(capacity(':memory:').state, 'unknown');
});
test('a failed database check is reported without returning SQLite error text', async () => {
  const maintenance = createMaintenance({filename: ':memory:', store: {db: {prepare() { throw new Error('Fictional private SQLite details'); }}}});
  const result = await maintenance.status(); assert.equal(result.database.state, 'failed'); assert.equal(result.state, 'failed');
  assert.ok(!JSON.stringify(result).includes('Fictional private'));
});
test('simultaneous host reads are shared and a later failure clears previous green status', async () => {
  let calls = 0, release;
  const maintenance = createMaintenance({filename: ':memory:', socketPath: 'fictional', now: () => now,
    store: {db: {prepare: () => ({get: () => ({readable: 1})})}}, request: () => { calls++; return calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.reject(new Error('Fictional host failure')); }});
  const first = maintenance.status(), second = maintenance.status(); assert.equal(calls, 1); release(healthy());
  assert.equal((await first).backups.state, 'ok'); assert.equal((await second).backups.state, 'ok');
  assert.equal((await maintenance.status()).backups.state, 'unknown'); assert.equal(calls, 2);
});
async function setup(t) {
  const directory = fs.mkdtempSync('/tmp/hub-status-demo-'), socketPath = path.join(directory, 'control.sock');
  let payload = healthy(), reply = 202, requests = 0, hook;
  const bridge = http.createServer(async (req, res) => {
    requests++; if (hook) await hook();
    res.writeHead(req.url === '/backup' ? reply : 200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(req.url === '/backup' ? {state: 'running', privateField: 'Fictional private host metadata'} : payload));
  });
  await new Promise(resolve => bridge.listen(socketPath, resolve));
  const hub = createHubServer({filename: path.join(directory, 'demo.sqlite'), publicOrigin: 'http://127.0.0.1:0', allowHttp: true, maintenanceSocket: socketPath});
  for (const role of ['admin', 'operator', 'observer']) await hub.auth.create('demo-status-' + role, 'Fictional-password-123', role);
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await hub.close(); await new Promise(resolve => bridge.close(resolve)); fs.rmSync(directory, {recursive: true, force: true}); });
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = role => hub.auth.login('demo-status-' + role, 'Fictional-password-123');
  const request = (route, actor, options = {}) => fetch(base + route, {redirect: 'manual', ...options,
    headers: {Origin: base, ...(actor ? {Cookie: 'hub-local-session=' + actor.token, 'X-CSRF-Token': actor.csrf} : {}), ...options.headers}});
  return {hub, login, request, base, socketPath, count: () => requests, payload: value => { payload = value; }, reply: value => { reply = value; }, hook: value => { hook = value; }};
}
test('administration page, direct status API and manual backup reject anonymous, operator and observer access', async t => {
  const demo = await setup(t);
  for (const role of [null, 'operator', 'observer']) {
    const actor = role ? await demo.login(role) : null;
    assert.equal((await demo.request('/system-status.html', actor)).status, actor ? 403 : 302);
    assert.equal((await demo.request('/api/admin/status', actor)).status, actor ? 403 : 401);
    assert.equal((await demo.request('/api/admin/backup', actor, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, actor ? 403 : 401);
  }
  assert.equal(demo.count(), 0);
  assert.deepEqual(await (await demo.request('/healthz')).json(), {ok: true});
  for (const route of ['/scripts/maintenance-host.py', '/run/package-hub-maintenance/control.sock', '/backups/status.json']) assert.equal((await demo.request(route)).status, 404);
});
test('administrator receives sanitized status and starts only a fixed asynchronous backup action', async t => {
  const demo = await setup(t), admin = await demo.login('admin');
  const value = await (await demo.request('/api/admin/status', admin)).json();
  assert.equal(value.database.state, 'ok'); assert.equal(value.manual.available, true);
  assert.ok(!JSON.stringify(value).includes(demo.socketPath));
  const result = await demo.request('/api/admin/backup', admin, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
  assert.equal(result.status, 202); assert.deepEqual(await result.json(), {state: 'running'});
  assert.equal((await demo.request('/system-status.html', admin)).status, 200);
});
test('manual backup requires matching origin and CSRF, an empty bounded body and the allowed method', async t => {
  const demo = await setup(t), admin = await demo.login('admin');
  const send = (headers = {}, body = '{}', method = 'POST') => demo.request('/api/admin/backup', admin, {method, headers: {'Content-Type': 'application/json', ...headers}, ...(method === 'GET' ? {} : {body})});
  assert.equal((await send({Origin: 'https://example.invalid'})).status, 403);
  assert.equal((await send({'X-CSRF-Token': ''})).status, 403);
  assert.equal((await send({}, '{"path":"/fictional/private"}')).status, 400);
  assert.equal((await send({}, '{"padding":"' + 'x'.repeat(1100) + '"}')).status, 413);
  assert.equal((await send({}, '{}', 'GET')).status, 405);
  assert.equal(demo.count(), 0);
  demo.reply(409); assert.equal((await send()).status, 409);
  demo.reply(500); assert.equal((await send()).status, 503);
});
test('a revoked administrator cannot receive a status response that was awaiting the host', async t => {
  const demo = await setup(t), admin = await demo.login('admin');
  let release, entered;
  const arrived = new Promise(resolve => { entered = resolve; });
  demo.hook(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const response = demo.request('/api/admin/status', admin); await arrived;
  demo.hub.auth.logout(admin.token); release(); assert.equal((await response).status, 401);
});
test('the Unix-socket client refuses oversized or malformed host responses without exposing them', async t => {
  const directory = fs.mkdtempSync('/tmp/hub-status-client-'), socket = path.join(directory, 'socket');
  let body = 'Fictional invalid JSON';
  const server = http.createServer((req, res) => { res.writeHead(200); res.end(body); });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true, force: true}); });
  await assert.rejects(() => hostRequest(socket, '/status'), /MAINTENANCE_UNAVAILABLE/);
  body = 'x'.repeat(9000); await assert.rejects(() => hostRequest(socket, '/status'));
});

test('Unix responses require the exact status code, JSON content type and an object body', async t => {
  const directory = fs.mkdtempSync('/tmp/hub-status-protocol-'), socket = path.join(directory, 'socket');
  let status = 200, type = 'application/json', body = '{}';
  const server = http.createServer((req, res) => { res.writeHead(status, {'Content-Type': type}); res.end(body); });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true, force: true}); });
  const rejected = () => assert.rejects(() => hostRequest(socket, '/status'), error => error.status === 503 && error.code === 'MAINTENANCE_UNAVAILABLE');
  for (const code of [202, 204, 301, 403, 409, 500]) { status = code; await rejected(); }
  status = 200; type = 'text/html'; await rejected(); type = 'application/json';
  for (const value of ['null', '[]', 'true', '42', '"Fictional private response"', '{']) { body = value; await rejected(); }
  body = '{}'; type = 'application/json; charset=utf-8'; assert.deepEqual(await hostRequest(socket, '/status'), {});
  body = '{"state":"running"}';
  await assert.rejects(() => hostRequest(socket, '/backup', 'POST'), {code: 'MAINTENANCE_UNAVAILABLE'});
  status = 202; assert.deepEqual(await hostRequest(socket, '/backup', 'POST'), {state: 'running'});
  status = 409; await assert.rejects(() => hostRequest(socket, '/backup', 'POST'), {status: 409, code: 'BACKUP_BUSY'});
});

test('the Unix client bounds a continuously trickling response and sanitizes disconnects and missing sockets', async t => {
  const directory = fs.mkdtempSync('/tmp/hub-status-timeout-'), socket = path.join(directory, 'socket');
  let disconnect = false, chunks = 0;
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'}); res.write('{');
    if (disconnect) return setImmediate(() => res.destroy());
    const interval = setInterval(() => { chunks++; res.write(' '); }, 10);
    res.once('close', () => clearInterval(interval));
  });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true, force: true}); });
  const failure = error => error.status === 503 && error.message === 'MAINTENANCE_UNAVAILABLE' && !error.message.includes(directory);
  const started = Date.now(); await assert.rejects(() => hostRequest(socket, '/status', 'GET', 75), failure);
  assert.ok(chunks > 0); assert.ok(Date.now() - started < 2000);
  disconnect = true; await assert.rejects(() => hostRequest(socket, '/status', 'GET', 500), failure);
  await assert.rejects(() => hostRequest(path.join(directory, 'missing.sock'), '/status'), failure);
});

test('many simultaneous requests share host, database and capacity work and do not retain the result afterward', async t => {
  let reads = 0, databaseReads = 0, diskReads = 0, release;
  t.mock.method(fs, 'statfsSync', () => { diskReads++; return {bsize: 1n, blocks: 20n * 1024n ** 3n, bavail: 10n * 1024n ** 3n}; });
  t.mock.method(fs, 'lstatSync', () => ({dev: 1n, ino: 1n, size: 4096n, nlink: 1n, isFile: () => true}));
  t.mock.method(fs, 'accessSync', () => {});
  const maintenance = createMaintenance({filename: '/fictional/hub.sqlite', socketPath: 'fictional', now: () => now,
    store: {db: {prepare: () => ({get: () => { databaseReads++; return {readable: 1}; }})}},
    request: () => { reads++; return new Promise(resolve => { release = resolve; }); }});
  const requests = Array.from({length: 40}, () => maintenance.status());
  assert.equal(reads, 1); release(healthy());
  for (const result of await Promise.all(requests)) assert.equal(result.state, 'ok');
  assert.equal(databaseReads, 1); assert.equal(diskReads, 1);
  const fresh = maintenance.status(); assert.equal(reads, 2); release(null);
  assert.equal((await fresh).backups.state, 'unknown'); assert.equal(databaseReads, 2); assert.equal(diskReads, 2);
});

test('a manual action invalidates an older status snapshot without cancelling a newer shared read', async () => {
  let reads = 0, releaseOld, releaseNew;
  const maintenance = createMaintenance({filename: ':memory:', socketPath: 'fictional', now: () => now,
    store: {db: {prepare: () => ({get: () => ({readable: 1})})}},
    request: (socket, route) => route === '/backup' ? Promise.resolve({state: 'running'}) : new Promise(resolve => {
      reads++; if (reads === 1) releaseOld = resolve; else releaseNew = resolve;
    })});
  const before = maintenance.status();
  await maintenance.backup();
  const fresh = maintenance.status(); assert.equal(reads, 2);
  releaseOld(healthy()); assert.equal((await before).backups.state, 'unknown');
  assert.equal(maintenance.status(), fresh); assert.equal(reads, 2);
  const running = healthy(); running.manual = {available: true, state: 'running', startedAt: at, finishedAt: null};
  releaseNew(running); assert.equal((await fresh).manual.state, 'running');
});

test('a live cached SQLite connection cannot hide a missing, replaced, empty or linked database file', async t => {
  const directory = fs.mkdtempSync('/tmp/hub-status-database-'), filename = path.join(directory, 'demo.sqlite');
  const store = openStore(filename), maintenance = createMaintenance({store, filename});
  t.after(() => { try { store.close(); } finally { fs.rmSync(directory, {recursive: true, force: true}); } });
  assert.equal((await maintenance.status()).database.state, 'ok');
  const saved = path.join(directory, 'saved.sqlite'); fs.renameSync(filename, saved);
  assert.equal((await maintenance.status()).database.state, 'failed');
  fs.copyFileSync(saved, filename); assert.equal((await maintenance.status()).database.state, 'failed');
  fs.unlinkSync(filename); fs.symlinkSync(saved, filename); assert.equal((await maintenance.status()).database.state, 'failed');
  fs.unlinkSync(filename); fs.renameSync(saved, filename);
  fs.linkSync(filename, path.join(directory, 'linked.sqlite')); assert.equal((await maintenance.status()).database.state, 'failed');
  fs.unlinkSync(path.join(directory, 'linked.sqlite'));
  t.mock.method(fs, 'accessSync', () => { throw new Error('Fictional private filesystem detail'); });
  const inaccessible = await maintenance.status(); assert.equal(inaccessible.database.state, 'failed');
  assert.ok(!JSON.stringify(inaccessible).includes('Fictional private'));
  t.mock.restoreAll(); fs.truncateSync(filename, 0); assert.equal((await maintenance.status()).database.state, 'failed');
});

test('capacity thresholds include their exact boundaries and fail closed for impossible or unreadable filesystems', t => {
  let result = {bsize: 1n, blocks: 10n * 1024n ** 3n, bavail: 1024n ** 3n};
  t.mock.method(fs, 'statfsSync', () => { if (result instanceof Error) throw result; return result; });
  assert.equal(capacity('/fictional/hub.sqlite').state, 'ok');
  result.bavail--; assert.equal(capacity('/fictional/hub.sqlite').state, 'warning');
  for (const invalid of [
    {bsize: 1n, blocks: 0n, bavail: 0n}, {bsize: 1n, blocks: 100n, bavail: -1n},
    {bsize: 1n, blocks: 100n, bavail: 101n}, {bsize: 2n ** 54n, blocks: 1n, bavail: 1n},
    new Error('Fictional private filesystem details')
  ]) {
    result = invalid; const value = capacity('/fictional/hub.sqlite');
    assert.deepEqual(value, {state: 'unknown', freeBytes: null, totalBytes: null});
  }
});

test('all permitted cadences and malformed timestamps are handled without inventing successful protection', () => {
  for (const intervalHours of [1, 2, 3, 4, 6, 8, 12, 24]) {
    const input = healthy(); input.backups.intervalHours = intervalHours;
    for (const key of ['lastAttempt', 'lastSuccess', 'lastPrimary', 'lastSecondary']) input.backups[key] = new Date(now - intervalHours * 3600000 - 900001).toISOString();
    assert.equal(checked(input).backups.state, 'warning');
    assert.equal(checked(input).secondary.state, 'warning');
  }
  for (const value of [null, 0, true, {}, [], '', 'invalid', '2026-02-30T00:00:00.000Z', '2026-10-08T12:00:00Z', '2099-01-01T00:00:00.000Z']) {
    for (const key of ['lastAttempt', 'lastSuccess', 'lastPrimary', 'lastSecondary']) {
      const input = healthy(); input.backups[key] = value;
      assert.notEqual(checked(input).backups.state, 'ok');
    }
    const input = healthy(); input.updates.lastSuccess = value;
    assert.equal(checked(input).updates.state, 'unknown');
  }
});

test('an unavailable manual service or an unconfirmed manual result cannot produce an entirely green summary', () => {
  const unavailable = healthy(); unavailable.manual.available = false;
  assert.equal(checked(unavailable).state, 'unknown'); assert.ok(checked(unavailable).warnings.includes('MANUAL_BACKUP_UNAVAILABLE'));
  for (const manual of [
    {available: true, state: 'ok'}, {available: true, state: 'running'}, {available: true, state: 'fictional'},
    {available: true, state: 'ok', startedAt: at, finishedAt: '2026-10-08T11:00:00.000Z'},
    {available: true, state: 'ok', startedAt: at, finishedAt: '2099-01-01T00:00:00.000Z'},
    {available: true, state: 'running', startedAt: at, finishedAt: at}
  ]) {
    const value = healthy(); value.manual = manual; const result = checked(value);
    assert.equal(result.manual.state, 'unknown'); assert.equal(result.state, 'unknown');
    assert.ok(result.warnings.includes('MANUAL_BACKUP_STATUS_UNKNOWN'));
  }
  const value = healthy(); value.manual = {available: true, state: 'ok', startedAt: at, finishedAt: at};
  assert.equal(checked(value).state, 'ok');
});

test('all malformed backup bodies and unsupported administration methods are refused without contacting the host', async t => {
  const demo = await setup(t), admin = await demo.login('admin');
  for (const body of ['', 'null', '[]', 'true', '42', '"{}"', '{', '{"command":"fictional"}']) {
    const response = await demo.request('/api/admin/backup', admin, {method: 'POST', headers: {'Content-Type': 'application/json'}, body});
    assert.equal(response.status, 400);
  }
  for (const type of ['', 'text/plain', 'application/octet-stream', 'application/json-private']) {
    assert.equal((await demo.request('/api/admin/backup', admin, {method: 'POST', headers: {'Content-Type': type}, body: '{}'})).status, 415);
  }
  for (const [route, methods] of [['/api/admin/status', ['HEAD', 'POST', 'PUT', 'DELETE']], ['/api/admin/backup', ['HEAD', 'GET', 'PUT', 'DELETE']]]) {
    for (const method of methods) assert.equal((await demo.request(route, admin, {method})).status, 405);
  }
  assert.equal(demo.count(), 0);
  const page = await demo.request('/system-status.html', admin, {method: 'HEAD'}); assert.equal(page.status, 200); assert.equal(await page.text(), '');
  assert.equal((await demo.request('/system-status.html', await demo.login('observer'), {method: 'HEAD'})).status, 403);
});

test('revoking the session while the backup body arrives prevents starting the host action', async t => {
  const demo = await setup(t), admin = await demo.login('admin');
  const request = http.request(demo.base + '/api/admin/backup', {method: 'POST', headers: {Origin: demo.base, Cookie: 'hub-local-session=' + admin.token,
    'X-CSRF-Token': admin.csrf, 'Content-Type': 'application/json', 'Content-Length': 2}});
  const response = new Promise((resolve, reject) => { request.on('response', reply => { reply.resume(); resolve(reply.statusCode); }); request.on('error', reject); });
  request.flushHeaders(); request.write('{');
  await new Promise(resolve => setTimeout(resolve, 20));
  demo.hub.auth.logout(admin.token); request.end('}');
  assert.equal(await response, 401); assert.equal(demo.count(), 0);
});

test('single-disk success remains a warning with no independent copy and an available manual action', () => {
  const host = healthy(); Object.assign(host.backups, {mode: 'single', lastSecondary: null, secondaryAvailable: false});
  const value = checked(host);
  assert.equal(value.state, 'warning'); assert.equal(value.backups.state, 'ok'); assert.equal(value.backups.mode, 'single');
  assert.equal(value.secondary.state, 'warning'); assert.equal(value.secondary.lastCopy, null);
  assert.equal(value.manual.available, true); assert.deepEqual(value.warnings, ['SINGLE_DISK_BACKUP']);
});
test('single-disk overdue, failed and malformed results do not become successful two-copy protection', () => {
  const host = healthy(); Object.assign(host.backups, {mode: 'single', lastSecondary: null, secondaryAvailable: false});
  for (const key of ['lastSuccess', 'lastAttempt', 'lastPrimary']) host.backups[key] = new Date(now - 6 * 3600000).toISOString();
  assert.ok(checked(host).warnings.includes('BACKUP_OVERDUE'));
  host.backups.state = 'failed'; host.backups.code = 'SNAPSHOT_FAILED';
  assert.equal(checked(host).state, 'failed'); assert.ok(checked(host).warnings.includes('BACKUP_FAILED'));
  for (const change of [{mode: 'unknown'}, {mode: null}, {lastPrimary: null}, {lastSecondary: at}]) {
    const input = healthy(); Object.assign(input.backups, {mode: 'single', lastSecondary: null, secondaryAvailable: false}, change);
    const value = checked(input); assert.notEqual(value.backups.state, 'ok'); assert.notEqual(value.state, 'ok');
  }
});
test('configured two-disk backups never fall back to a successful single-disk summary', () => {
  const host = healthy(); host.backups.secondaryAvailable = false;
  const value = checked(host); assert.equal(value.backups.mode, 'dual'); assert.equal(value.state, 'failed');
  assert.ok(!value.warnings.includes('SINGLE_DISK_BACKUP'));
});

test('an unconfigured or unreachable adapter cannot claim that either backup mode is configured', () => {
  for (const host of [null, {backups: {}}, {backups: {state: 'unknown', mode: null}}]) {
    const value = checked(host); assert.equal(value.backups.mode, null); assert.equal(value.backups.state, 'unknown');
  }
});
