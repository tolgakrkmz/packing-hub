/* Local authorization regressions. Every identity and record is fictional. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {randomUUID, createHash} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const password = 'Fictional-authz-matrix-password-123';

async function setup(t) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true,
    taskNow: () => Date.parse('2026-12-01T07:00:00+02:00')});
  t.after(() => hub.close());
  const admin = await hub.auth.create('demo-matrix-admin', password, 'admin');
  await new Promise((resolve, reject) => { hub.server.once('error', reject); hub.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => {
    const session = await hub.auth.login(name || admin.username, password);
    return {...session, cookie: 'hub-local-session=' + session.token};
  };
  const request = (route, session, method = 'GET', input, extra = {}) => {
    const headers = {Origin: base, 'Content-Type': 'application/json', ...(session ? {Cookie: session.cookie, 'X-CSRF-Token': session.csrf} : {}), ...extra};
    for (const key of Object.keys(headers)) if (headers[key] === undefined) delete headers[key];
    return fetch(base + route, {method, redirect: 'manual', headers, ...(input === undefined ? {} : {body: JSON.stringify(input)})});
  };
  const account = (name, role = 'observer', permissions = {}, profile = {}) => hub.auth.create('demo-matrix-' + name, password, role, admin, permissions, () => {}, profile);
  return {hub, base, admin, login, request, account};
}

function accountState(hub) {
  return {
    users: hub.store.db.prepare('SELECT * FROM users ORDER BY id').all(),
    sessions: hub.store.db.prepare('SELECT * FROM sessions ORDER BY hash').all(),
    audit: hub.store.db.prepare('SELECT * FROM audit ORDER BY id').all()
  };
}

test('unprivileged role and target-ID combinations cannot change accounts, sessions or audit', async t => {
  const s = await setup(t);
  const target = await s.account('target');
  for (const role of ['operator', 'observer']) {
    const actor = await s.account('denied-' + role, role), session = await s.login(actor.username);
    const before = accountState(s.hub);
    for (const id of [actor.id, s.admin.id, target.id, 999999]) {
      for (const method of ['PATCH', 'DELETE']) {
        const response = await s.request('/api/accounts/' + id + '?role=admin&userId=' + s.admin.id, session, method,
          {id: s.admin.id, userId: s.admin.id, role: 'admin', active: false, permissions: {canManageAccounts: true}});
        assert.equal(response.status, 403, role + '/' + method + '/' + id);
        assert.deepEqual(await response.json(), {error: 'FORBIDDEN'});
        assert.deepEqual(accountState(s.hub), before);
      }
    }
  }
});

test('delegated account managers of every role modify only the URL target and cannot mutate with viewing rights alone', async t => {
  const s = await setup(t);
  for (const role of ['admin', 'operator', 'observer']) {
    const actor = await s.account('manager-' + role, role, {canManageAccounts: true});
    const target = await s.account('managed-' + role), session = await s.login(actor.username);
    const beforeAdmin = s.hub.auth.list().find(user => user.id === s.admin.id);
    let response = await s.request('/api/accounts/' + target.id, session, 'PATCH',
      {id: s.admin.id, userId: s.admin.id, username: s.admin.username, permissions: {canExportReports: false}});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, target.id);
    assert.deepEqual(s.hub.auth.list().find(user => user.id === s.admin.id), beforeAdmin);
    assert.equal(s.hub.auth.list().find(user => user.id === target.id).permissions.canExportReports, false);
    await s.hub.auth.update(actor.id, {permissions: {canManageAccounts: false, canViewAccounts: true}}, s.admin);
    const reader = await s.login(actor.username), before = accountState(s.hub);
    assert.equal((await s.request('/api/accounts', reader)).status, 200);
    response = await s.request('/api/accounts/' + target.id, reader, 'PATCH', {role: 'admin'});
    assert.equal(response.status, 403);
    assert.deepEqual(accountState(s.hub), before);
  }
});

for (const change of ['disable', 'delete', 'password']) test('account ' + change + ' blocks stale session, bootstrap and event-stream access', async t => {
  const s = await setup(t), user = await s.account('stale-' + change);
  const first = await s.login(user.username), second = await s.login(user.username);
  if (change === 'delete') s.hub.auth.remove(user.id, s.admin);
  else await s.hub.auth.update(user.id, change === 'disable' ? {active: false} : {password: 'Fictional-matrix-new-password-456'}, s.admin);
  for (const session of [first, second]) for (const route of ['/api/session', '/server-session.js', '/api/events']) {
    const response = await s.request(route, session);
    assert.equal(response.status, 401, change + '/' + route);
    assert.deepEqual(await response.json(), {error: 'LOGIN_REQUIRED'});
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await s.request('/production-log', first)).status, 302);
  assert.equal(s.hub.store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(user.id).n, 0);
  if (change === 'disable') {
    await s.hub.auth.update(user.id, {active: true}, s.admin);
    assert.equal((await s.request('/server-session.js', first)).status, 401);
    assert.equal((await s.request('/server-session.js', await s.login(user.username))).status, 200);
  }
});

test('bootstrap and events require a real server session and never trust supplied role or user IDs', async t => {
  const s = await setup(t), user = await s.account('bootstrap', 'operator', {canViewProduction: false});
  const session = await s.login(user.username);
  for (const route of ['/api/events', '/server-session.js']) {
    const response = await s.request(route + '?role=admin&userId=' + s.admin.id, null, 'GET', undefined,
      {Cookie: 'hub-local-session=fictional-forged-token', 'X-User-Id': String(s.admin.id), 'X-Role': 'admin'});
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {error: 'LOGIN_REQUIRED'});
  }
  const response = await s.request('/server-session.js?role=admin&userId=' + s.admin.id, session);
  assert.equal(response.status, 200);
  const source = await response.text();
  const boot = JSON.parse(source.slice('window.HUB_SERVER_BOOT='.length, -1));
  assert.equal(boot.user.id, user.id); assert.equal(boot.user.role, 'operator');
  assert.equal(boot.user.permissions.canViewProduction, false); assert.equal(boot.csrf, session.csrf);
  assert.equal(source.includes(session.token), false);
  const stored = s.hub.store.db.prepare('SELECT hash FROM sessions WHERE user_id=?').get(user.id).hash;
  assert.equal(stored, createHash('sha256').update(session.token).digest('hex'));
  assert.equal(source.includes(stored), false);
});

for (const mutation of ['create', 'update']) test('account ' + mutation + ' rechecks the manager after password hashing', async t => {
  const s = await setup(t), manager = await s.account('hash-manager-' + mutation, 'operator', {canManageAccounts: true});
  const target = await s.account('hash-target-' + mutation), session = await s.login(manager.username);
  let began;
  const hashing = new Promise(resolve => { began = resolve; });
  const method = mutation === 'create' ? 'create' : 'update', original = s.hub.auth[method], updateAccount = s.hub.auth.update;
  // Observe the real operation after its asynchronous scrypt starts. No password
  // function is replaced, and permission revocation finishes in this microtask.
  t.mock.method(s.hub.auth, method, function (...args) {
    const result = original.apply(this, args); began(); return result;
  });
  const pending = s.request(mutation === 'create' ? '/api/accounts' : '/api/accounts/' + target.id, session,
    mutation === 'create' ? 'POST' : 'PATCH', mutation === 'create'
      ? {username: 'demo-matrix-hash-new', password, role: 'observer'}
      : {password: 'Fictional-matrix-hash-replacement-456'});
  await hashing;
  await updateAccount(manager.id, {permissions: {canManageAccounts: false}}, s.admin);
  const afterRevocation = accountState(s.hub), response = await pending;
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {error: 'LOGIN_REQUIRED'});
  assert.deepEqual(accountState(s.hub), afterRevocation);
  assert.ok(await s.hub.auth.login(target.username, password));
});

for (const mutation of ['create', 'update']) test('account ' + mutation + ' rechecks the manager after a partial HTTP body', async t => {
  const s = await setup(t), manager = await s.account('body-manager-' + mutation, 'observer', {canManageAccounts: true});
  const target = await s.account('body-target-' + mutation), session = await s.login(manager.username);
  const input = mutation === 'create' ? {username: 'demo-matrix-body-new', password, role: 'observer'} : {active: false};
  const payload = JSON.stringify(input), received = new Promise(resolve => s.hub.server.once('request', resolve));
  let pending;
  const result = new Promise((resolve, reject) => {
    pending = http.request(s.base + (mutation === 'create' ? '/api/accounts' : '/api/accounts/' + target.id), {
      method: mutation === 'create' ? 'POST' : 'PATCH', headers: {Origin: s.base, Cookie: session.cookie,
        'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    pending.on('error', reject); pending.write(payload.slice(0, 4));
  });
  t.after(() => pending.destroy());
  await received;
  await s.hub.auth.update(manager.id, {permissions: {canManageAccounts: false}}, s.admin);
  const afterRevocation = accountState(s.hub);
  pending.end(payload.slice(4));
  assert.equal(await result, 401);
  assert.deepEqual(accountState(s.hub), afterRevocation);
});

test('forged task identity fields cannot let an unrelated supervisor report or manage another owner task', async t => {
  const s = await setup(t), profile = {taskSupervisor: true, taskTeam: 'А'};
  const owner = await s.account('task-owner', 'operator', {}, profile);
  const other = await s.account('task-other', 'operator', {}, profile), session = await s.login(other.username);
  const {id} = s.hub.tasks.create({requestId: randomUUID(), title: 'Fictional owner boundary', description: '', priority: 'normal',
    requiresPhotos: false, assigneeId: owner.id, participantIds: [], kind: 'global', repeat: 'once', dueDate: '2026-12-02', dueTime: '17:00'}, s.admin);
  const before = {tasks: s.hub.tasks.list(s.admin).items, audit: accountState(s.hub).audit};
  for (const action of ['report', 'progress', 'cancel', 'approve']) {
    const response = await s.request('/api/tasks/items/' + id + '?userId=' + owner.id, session, 'PATCH',
      {requestId: randomUUID(), action, status: 'review', note: 'Fictional forged ownership', userId: owner.id,
        actor: {id: s.admin.id, role: 'admin'}, owner: {id: other.id}, assigneeId: other.id, participantIds: [other.id]}, {'If-Match': '"1"'});
    assert.equal(response.status, 403, action);
    assert.deepEqual(await response.json(), {error: 'FORBIDDEN'});
    assert.deepEqual({tasks: s.hub.tasks.list(s.admin).items, audit: accountState(s.hub).audit}, before);
  }
  assert.equal((await (await s.request('/api/tasks', session)).json()).items.length, 0);
});

test('forged notification user IDs cannot read another inbox or change its preferences', async t => {
  const s = await setup(t), user = await s.account('inbox-other'), session = await s.login(user.username);
  s.hub.store.put('production-log', {entries: [{id: 'demo-matrix-notice', date: '2026-10-05', shift: 'А', tonnage: 1000, brak: 0}], goalTons: 3000}, 1, s.admin);
  s.hub.notifications.sync();
  const foreign = s.hub.notifications.list(s.admin).items[0];
  assert.ok(foreign);
  const before = s.hub.store.db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id').all(s.admin.id);
  const response = await s.request('/api/notifications/read?userId=' + s.admin.id, session, 'POST', {id: foreign.id, userId: s.admin.id, actor: s.admin});
  assert.equal(response.status, 200);
  assert.deepEqual(s.hub.store.db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id').all(s.admin.id), before);
  const list = await (await s.request('/api/notifications?userId=' + s.admin.id, session)).json();
  assert.equal(list.items.some(item => item.id === foreign.id), false);
  const preferences = s.hub.notifications.preferences(s.admin);
  const rejected = await s.request('/api/notifications/preferences', session, 'PATCH', {productionAdded: false, userId: s.admin.id});
  assert.equal(rejected.status, 400);
  assert.deepEqual(s.hub.notifications.preferences(s.admin), preferences);
});
