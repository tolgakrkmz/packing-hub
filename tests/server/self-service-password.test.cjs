/* All identities and credentials in this suite are fictional. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHubServer} = require('../../server/server.cjs');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const password = 'Fictional-self-service-123';
const replacement = 'Fictional-replacement-456';
async function setup(t) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  await hub.auth.create('demo-admin', password, 'admin');
  await hub.auth.create('demo-reader', password, 'observer');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  t.after(() => hub.close());
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  const session = response => response.headers.get('set-cookie').split(';')[0];
  async function login(username, secret = password) {
    const response = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({username, password: secret})});
    assert.equal(response.status, 200);
    const result = await response.json();
    return {cookie: session(response), csrf: result.csrf, user: result.user};
  }
  async function request(route, user, options = {}) {
    const headers = {Origin: base, ...(user ? {Cookie: user.cookie, 'X-CSRF-Token': user.csrf} : {}), ...options.headers};
    if (options.data !== undefined) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.data); }
    return fetch(base + route, {...options, headers, redirect: 'manual'});
  }
  const change = (user, data, headers) => request('/api/account/password', user, {method: 'POST', data, headers});
  return {hub, base, login, request, change, session};
}
test('an account created by a manager starts with a temporary password that blocks modules and APIs', async t => {
  const {hub, login, request, change, session} = await setup(t);
  const admin = await login('demo-admin');
  assert.equal(admin.user.mustChangePassword, false);
  const created = await request('/api/accounts', admin, {method: 'POST', data: {username: 'demo-temporary', password, role: 'operator'}});
  assert.equal(created.status, 201);
  assert.equal((await created.json()).user.mustChangePassword, true);
  const user = await login('demo-temporary');
  assert.equal(user.user.mustChangePassword, true);
  for (const route of ['/api/data/personnel', '/api/tasks', '/api/notifications/summary', '/server-session.js', '/api/events']) {
    const response = await request(route, user);
    assert.equal(response.status, 403, route);
    assert.equal((await response.json()).error, 'PASSWORD_CHANGE_REQUIRED');
  }
  for (const page of ['/', '/production-log', '/tasks']) {
    const response = await request(page, user);
    assert.equal(response.status, 302, page);
    assert.equal(response.headers.get('location'), '/account-password');
  }
  assert.equal((await request('/account-password', user)).status, 200);
  assert.equal((await request('/api/session', user)).status, 200);
  const changed = await change(user, {currentPassword: password, password: replacement});
  assert.equal(changed.status, 200);
  const result = await changed.json();
  assert.equal(result.user.mustChangePassword, false);
  const fresh = {cookie: session(changed), csrf: result.csrf};
  assert.notEqual(fresh.cookie, user.cookie);
  assert.equal((await request('/api/session', user)).status, 401, 'the temporary session is rotated');
  assert.equal((await request('/api/data/production-log', fresh)).status, 200);
  assert.equal((await request('/', fresh)).status, 200);
  assert.equal(hub.store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='password-change'").get().n, 1);
});
test('self-service change verifies the current password, rejects reuse and keeps only this device signed in', async t => {
  const {hub, login, request, change, session} = await setup(t);
  const here = await login('demo-reader'), elsewhere = await login('demo-reader');
  const before = hub.store.db.prepare("SELECT hash FROM users WHERE username='demo-reader'").get().hash;
  for (const [data, code] of [
    [{currentPassword: 'Fictional-wrong-pass-1', password: replacement}, 'CURRENT_PASSWORD_INVALID'],
    [{currentPassword: password, password}, 'PASSWORD_REUSED'],
    [{currentPassword: password, password: 'short'}, 'PASSWORD_LENGTH'],
    [{currentPassword: password}, 'INVALID_DATA']
  ]) {
    const response = await change(here, data);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, code);
  }
  assert.equal((await change(here, {currentPassword: password, password: replacement}, {'X-CSRF-Token': 'fictional'})).status, 403);
  assert.equal((await change(here, {currentPassword: password, password: replacement}, {Origin: 'https://example.invalid'})).status, 403);
  assert.equal((await change(undefined, {currentPassword: password, password: replacement})).status, 401);
  assert.equal(hub.store.db.prepare("SELECT hash FROM users WHERE username='demo-reader'").get().hash, before);
  const changed = await change(here, {currentPassword: password, password: replacement});
  assert.equal(changed.status, 200);
  const fresh = {cookie: session(changed), csrf: (await changed.json()).csrf};
  assert.equal((await request('/api/session', elsewhere)).status, 401);
  assert.equal((await request('/api/session', here)).status, 401);
  assert.equal((await request('/api/session', fresh)).status, 200);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.username=?').get('demo-reader').n, 1);
  await login('demo-reader', replacement);
  const old = await request('/api/login', undefined, {method: 'POST', data: {username: 'demo-reader', password}});
  assert.equal(old.status, 401);
  const audit = hub.store.db.prepare('SELECT action, detail FROM audit').all();
  assert.ok(audit.every(row => !row.detail.includes(password) && !row.detail.includes(replacement)), 'passwords never reach the audit journal');
});
test('wrong current passwords are rate limited per account', async t => {
  const {login, change} = await setup(t);
  const user = await login('demo-reader');
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await change(user, {currentPassword: 'Fictional-wrong-pass-' + attempt, password: replacement})).status, 400);
  const limited = await change(user, {currentPassword: password, password: replacement});
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'RATE_LIMITED');
});
test('parallel wrong current passwords cannot exceed the limit', async t => {
  const {login, change} = await setup(t);
  const user = await login('demo-reader');
  const statuses = (await Promise.all(Array.from({length: 14}, (_, attempt) => change(user, {currentPassword: 'Fictional-wrong-pass-' + attempt, password: replacement})))).map(response => response.status);
  assert.equal(statuses.filter(status => status === 400).length, 10);
  assert.equal(statuses.filter(status => status === 429).length, 4);
});
test('sign-out from all devices ends every session and push subscription of the account only', async t => {
  const {hub, login, request} = await setup(t);
  const first = await login('demo-reader'), second = await login('demo-reader'), admin = await login('demo-admin');
  const reader = hub.store.db.prepare("SELECT id FROM users WHERE username='demo-reader'").get().id;
  hub.store.db.prepare('INSERT INTO push_subscriptions(id,user_id,session_hash,endpoint,public_key,at) VALUES(?,?,?,?,?,?)').run('fictional-sub', reader, 'fictional-hash', 'https://push.example.test/fictional', 'fictional-key', Date.now());
  assert.equal((await request('/api/logout-all', first, {method: 'POST', data: {}, headers: {'X-CSRF-Token': 'fictional'}})).status, 403);
  const response = await request('/api/logout-all', first, {method: 'POST', data: {}});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {sessions: 2});
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  for (const user of [first, second]) assert.equal((await request('/api/session', user)).status, 401);
  assert.equal((await request('/api/session', admin)).status, 200);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?').get(reader).n, 0);
  assert.equal(hub.store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='logout-all'").get().n, 1);
});
test('a manager reset makes another account temporary, but not the manager’s own password', async t => {
  const {hub, login, request} = await setup(t);
  const admin = await login('demo-admin');
  const reader = hub.store.db.prepare("SELECT id FROM users WHERE username='demo-reader'").get().id;
  const reset = await request('/api/accounts/' + reader, admin, {method: 'PATCH', data: {password: replacement}});
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).user.mustChangePassword, true);
  const permissions = await request('/api/accounts/' + reader, (await login('demo-admin')), {method: 'PATCH', data: {permissions: {canViewProduction: false}}});
  assert.equal((await permissions.json()).user.mustChangePassword, true, 'other edits keep the temporary state');
  const own = await request('/api/accounts/' + admin.user.id, await login('demo-admin'), {method: 'PATCH', data: {password: replacement}});
  assert.equal((await own.json()).user.mustChangePassword, false);
});
test('existing databases gain the flag without forcing current accounts to change passwords', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-password-migration-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const filename = path.join(dir, 'demo.sqlite');
  let store = openStore(filename);
  await accounts(store).create('demo-legacy', password, 'operator');
  store.db.exec('ALTER TABLE users DROP COLUMN must_change_password');
  store.close();
  const legacy = new DatabaseSync(filename);
  assert.ok(!legacy.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'must_change_password'));
  legacy.close();
  store = openStore(filename);
  t.after(() => store.close());
  const session = await accounts(store).login('demo-legacy', password);
  assert.equal(session.user.mustChangePassword, false);
});
