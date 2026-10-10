const test = require('node:test');
const assert = require('node:assert/strict');
const {createHubServer} = require('../../server/server.cjs');
const {keys, groups, permissionsFor} = require('../../server/permissions.cjs');
const {fixture} = require('./import-fixture.cjs');
const password = 'Fictional-permissions-123';
const none = Object.fromEntries(keys.map(key => [key, false]));
const all = Object.fromEntries(keys.map(key => [key, true]));
async function setup(t) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  const admin = await hub.auth.create('demo-manager', password, 'admin');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => {
    const session = await hub.auth.login(name, password);
    return {...session, cookie: 'hub-local-session=' + session.token};
  };
  const request = (route, session, method = 'GET', data, revision) => fetch(base + route, {method, redirect: 'manual', headers: {Origin: base, Cookie: session.cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json', ...(revision ? {'If-Match': '"' + revision + '"'} : {})}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  return {hub, admin, login, request};
}
test('every flag is available to every valid role, explicit viewing denials win, and invalid roles grant nothing', () => {
  for (const role of ['admin', 'operator', 'observer']) {
    assert.deepEqual(permissionsFor({role, permissionOverrides: all}), all);
    assert.deepEqual(permissionsFor({role, permissionOverrides: none}), none);
    for (const group of groups.filter(group => group.view)) {
      const rights = permissionsFor({role, permissionOverrides: {...all, [group.view]: false}});
      for (const key of Object.keys(group.flags)) assert.equal(rights[key], false, role + '/' + key);
    }
  }
  for (const role of ['unknown', '__proto__', 'constructor', 'toString']) assert.deepEqual(permissionsFor({role, taskSupervisor: true, permissionOverrides: all}), none);
  assert.equal(permissionsFor({role: 'observer', permissionOverrides: {canManageAccounts: true}}).canViewAccounts, true);
  assert.equal(permissionsFor({role: 'operator', permissionOverrides: {canAssignTasks: true}}).canManageAccounts, false);
});
test('delegated operator and observer accounts can manage each module without changing role', async t => {
  const {hub, admin, login, request} = await setup(t);
  for (const role of ['operator', 'observer']) {
    const user = await hub.auth.create('demo-full-' + role, password, role, admin, all);
    const session = await login(user.username); assert.equal(session.user.role, role);
    for (const group of groups.filter(group => group.module)) {
      for (const method of ['GET', 'HEAD']) assert.equal((await request('/' + group.module + '.html', session, method)).status, 200, role + '/' + group.module);
    }
    for (const route of ['/api/accounts', '/api/admin/activity', '/api/admin/status', '/api/pair-roster', '/api/statistics/workforce', '/api/statistics/data/production-log']) assert.equal((await request(route, session)).status, 200, route);
    const put = async (kind, data) => {
      const revision = hub.store.get(kind).revision;
      assert.equal((await request('/api/data/' + kind, session, 'PUT', data, revision)).status, 200, role + '/' + kind);
    };
    await put('production-log', {entries: [], goalTons: 2000});
    await put('line-downtime', {entries: [], reasons: ['Fictional delegated reason', 'Друго']});
    await put('pair-targets', hub.store.get('pair-targets').data);
    await put('personnel', {employees: []}); await put('package-instructions', {});
    assert.equal((await request('/api/folders', session, 'POST', {path: 'demo-' + role, kind: 'directory'})).status, 201);
    assert.equal((await request('/api/admin/backup', session, 'POST', {})).status, 503);
    const created = await request('/api/accounts', session, 'POST', {username: 'demo-created-' + role, password, role: 'observer', permissions: {canAssignTasks: true}});
    assert.equal(created.status, 201); const account = (await created.json()).user;
    assert.equal((await request('/api/accounts/' + account.id, session, 'DELETE', {})).status, 200);
  }
});
test('viewing denials gate direct pages, APIs, exports, roster, statistics and instruction attachment aliases', async t => {
  const {hub, admin, login, request} = await setup(t);
  for (const group of groups.filter(group => group.view)) {
    const user = await hub.auth.create('demo-deny-' + group.module, password, 'admin', admin, {...all, [group.view]: false});
    const session = await login(user.username);
    for (const method of ['GET', 'HEAD']) assert.equal((await request('/' + group.module + '.html', session, method)).status, 403);
    const routes = {
      'production-log': ['/api/data/production-log', '/api/export/production-log'],
      'line-downtime': ['/api/data/line-downtime', '/api/export/line-downtime'],
      'pair-targets': ['/api/data/pair-targets', '/api/pair-roster', '/api/export/pair-targets'],
      personnel: ['/api/data/personnel', '/api/files?path=personnel.json', '/api/files?path=data%2Fpersonnel.json'],
      'package-instructions': ['/api/data/package-instructions', '/api/folders', '/api/files?path=data%2Fpackage-instructions.json'],
      statistics: ['/api/statistics/workforce', '/api/statistics/data/production-log'],
      tasks: ['/api/tasks', '/api/tasks/summary', '/api/tasks/preview'],
      accounts: ['/api/accounts'], 'activity-log': ['/api/admin/activity'], 'system-status': ['/api/admin/status']
    };
    for (const route of routes[group.module]) assert.equal((await request(route, session)).status, 403, route);
    if (['production-log', 'line-downtime', 'pair-targets', 'personnel', 'package-instructions'].includes(group.module)) {
      assert.equal((await request('/api/data/' + group.module, session, 'PUT', hub.store.get(group.module).data, hub.store.get(group.module).revision)).status, 403);
    }
  }
});
test('module report flags override legacy common grants and settings can be delegated independently', async t => {
  const {hub, admin, login, request} = await setup(t);
  const user = await hub.auth.create('demo-selective', password, 'observer', admin, {canCreateReports: false, canCreateProduction: true, canEditReports: true, canEditProduction: false, canManageProductionSettings: true});
  const session = await login(user.username);
  const entry = {id: 'demo-selective-entry', date: '2026-10-05', shift: 'А', tonnage: 1000, brak: 0};
  const put = data => request('/api/data/production-log', session, 'PUT', data, hub.store.get('production-log').revision);
  assert.equal((await put({entries: [entry], goalTons: 3000})).status, 200);
  assert.equal((await put({entries: [{...entry, tonnage: 1100}], goalTons: 3000})).status, 403);
  assert.equal((await put({entries: [entry], goalTons: 2100})).status, 200);
  assert.equal(session.user.permissions.canCreateDowntime, false);
  assert.equal(session.user.permissions.canEditDowntime, true);
  assert.equal(session.user.permissions.canManageDowntimeSettings, false);
});
test('observer import grants are independent of editing and respect explicit module denials at every stage', async t => {
  const {hub, admin, login, request} = await setup(t);
  const user = await hub.auth.create('demo-importer', password, 'observer', admin, {canImportData: true});
  let session = await login(user.username);
  const data = fixture().payload.documents['production-log'];
  assert.equal((await request('/api/import/production-log/preview', session, 'POST', data)).status, 200);
  assert.equal((await request('/api/import/production-log/apply', session, 'POST', data, 1)).status, 200);
  assert.equal((await request('/api/data/personnel', session, 'PUT', {employees: []}, 1)).status, 403);
  const batch = hub.imports.create({documents: {personnel: {employees: []}}, files: [], includeSettings: false}, session.user);
  const preview = hub.imports.preview(batch.id, session.user);
  await hub.auth.update(user.id, {permissions: {canImportData: true, canViewPersonnel: false}}, admin);
  assert.equal((await request('/api/session', session)).status, 401); session = await login(user.username);
  for (const action of ['preview', 'apply']) assert.throws(() => action === 'preview' ? hub.imports.preview(batch.id, session.user) : hub.imports.apply(batch.id, preview.token, session.user), error => error.code === 'FORBIDDEN');
  assert.equal((await request('/api/import/batches', session, 'POST', {documents: {personnel: {employees: []}}, files: [], includeSettings: false})).status, 403);
});
test('read-only account and system access does not grant mutations; the last actual account manager cannot be disabled', async t => {
  const {hub, admin, login, request} = await setup(t);
  const viewer = await hub.auth.create('demo-admin-reader', password, 'operator', admin, {canViewAccounts: true, canViewSystemStatus: true});
  const session = await login(viewer.username);
  assert.equal((await request('/api/accounts', session)).status, 200);
  assert.equal((await request('/api/accounts/' + viewer.id, session, 'PATCH', {permissions: all})).status, 403);
  assert.equal((await request('/api/admin/backup', session, 'POST', {})).status, 403);
  await assert.rejects(hub.auth.update(admin.id, {permissions: {canManageAccounts: false}}, admin), error => error.code === 'LAST_ACCOUNT_MANAGER');
  await hub.auth.update(viewer.id, {permissions: {canManageAccounts: true}}, admin);
  await hub.auth.update(admin.id, {permissions: {canManageAccounts: false}}, admin);
  await assert.rejects(hub.auth.update(viewer.id, {permissions: {canViewAccounts: false}}, viewer), error => error.code === 'LAST_ACCOUNT_MANAGER');
});
