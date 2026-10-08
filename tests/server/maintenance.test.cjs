const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {summarize, capacity, createMaintenance, hostRequest} = require('../../server/maintenance.cjs');
const {createHubServer} = require('../../server/server.cjs');
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
    store: {db: {prepare: () => ({all: () => [{quick_check: 'ok'}]})}}, request: () => { calls++; return calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.reject(new Error('Fictional host failure')); }});
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
