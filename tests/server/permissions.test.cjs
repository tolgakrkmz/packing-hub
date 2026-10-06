const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const http = require('node:http');
const {createHubServer} = require('../../server/server.cjs');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {defaults} = require('../../server/permissions.cjs');
const password = 'Fictional-permissions-123';
const entry = id => ({id, date: '2026-10-05', shift: 'А', tonnage: 1000, brak: 0});
async function setup(t) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  for (const role of ['admin', 'operator', 'observer']) await hub.auth.create('demo-' + role, password, role);
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  async function login(role = 'admin') {
    const response = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({username: 'demo-' + role, password})});
    assert.equal(response.status, 200); const result = await response.json();
    return {...result, cookie: response.headers.get('set-cookie').split(';')[0]};
  }
  function request(route, user, method = 'GET', data, headers = {}) {
    return fetch(base + route, {method, redirect: 'manual', headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', ...headers}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  }
  const change = (actor, user, permissions) => request('/api/accounts/' + user.user.id, actor, 'PATCH', {permissions});
  return {hub, base, login, request, change};
}
test('role defaults and explicit restrictions survive a reopen; migration preserves legacy accounts, data and sessions', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-permissions-demo-')); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'demo.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1); PRAGMA user_version=1"); legacy.close();
  let store = openStore(filename), auth = accounts(store);
  const user = await auth.create('demo-legacy', password, 'operator'); const session = await auth.login(user.username, password);
  store.put('production-log', {entries: [entry('demo-preserved')], goalTons: 3000}, 1, user); store.close();
  const downgrade = new DatabaseSync(filename); downgrade.exec('ALTER TABLE users DROP COLUMN permissions; PRAGMA user_version=1'); downgrade.close();
  store = openStore(filename); auth = accounts(store);
  assert.deepEqual(auth.session(session.token).user.permissions, defaults.operator);
  assert.equal(store.get('production-log').data.entries[0].id, 'demo-preserved');
  await auth.update(user.id, {permissions: {canExportReports: false}}, {role: 'admin'});
  assert.equal(auth.session(session.token), null); store.close();
  store = openStore(filename); t.after(() => store.close());
  assert.equal(accounts(store).list()[0].permissions.canExportReports, false);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
});
test('only administrators manage permissions; values are strictly boolean and role ceilings cannot be bypassed', async t => {
  const {hub, login, request, change} = await setup(t); const admin = await login(), operator = await login('operator');
  assert.equal((await change(operator, operator, {canImportData: true})).status, 403);
  for (const permissions of [null, [], {canExportReports: 'false'}, {canImportData: 1}, {unknown: true}, JSON.parse('{"__proto__":true}')]) {
    assert.equal((await change(admin, operator, permissions)).status, 400);
    assert.equal((await request('/api/session', operator)).status, 200);
  }
  assert.equal((await request('/api/accounts', admin, 'POST', {username: 'demo-restricted', password, role: 'operator', permissions: {canExportReports: false}})).status, 201);
  const all = {canImportData: true, canCreateReports: true, canEditReports: true, canExportReports: true};
  await hub.auth.update(operator.user.id, {permissions: all}, admin.user); const enabled = await login('operator');
  assert.equal(enabled.user.permissions.canImportData, false);
  assert.equal((await request('/api/import/batches', enabled, 'POST', {})).status, 403);
  const observer = await login('observer'); await hub.auth.update(observer.user.id, {permissions: all}, admin.user); const reader = await login('observer');
  assert.equal(reader.user.permissions.canCreateReports, false); assert.equal(reader.user.permissions.canEditReports, false);
  assert.equal((await request('/api/data/production-log', reader, 'PUT', {entries: [], goalTons: 3000}, {'If-Match': '"1"'})).status, 403);
});
test('export permission gates every supported download, retains viewing and records only audit metadata', async t => {
  const {hub, login, request, change} = await setup(t); const admin = await login(), observer = await login('observer');
  for (const kind of ['production-log', 'line-downtime', 'pair-targets']) {
    const response = await request('/api/export/' + kind, observer); assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="' + kind + '.json"');
    assert.deepEqual(await response.json(), hub.store.get(kind).data);
  }
  assert.equal((await request('/api/export/personnel', observer)).status, 404);
  assert.equal((await request('/api/export/production-log', observer, 'POST', {})).status, 405);
  assert.equal((await change(admin, observer, {canExportReports: false})).status, 200);
  assert.equal((await request('/api/export/production-log', observer)).status, 401);
  const limited = await login('observer');
  for (const kind of ['production-log', 'line-downtime', 'pair-targets']) assert.equal((await request('/api/export/' + kind, limited)).status, 403);
  assert.equal((await request('/api/data/production-log', limited)).status, 200);
  assert.equal(hub.store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='export'").get().n, 3);
});
test('report creation and correction rights are independent and cannot grant operator settings or personnel access', async t => {
  const {hub, login, request, change} = await setup(t); const admin = await login(), original = await login('operator');
  const put = (kind, user, data, revision) => request('/api/data/' + kind, user, 'PUT', data, {'If-Match': '"' + revision + '"'});
  const report = {entries: [entry('demo-record')], goalTons: 3000};
  assert.equal((await put('production-log', original, report, 1)).status, 200);
  assert.equal((await put('production-log', original, {...report, entries: []}, 2)).status, 403);
  await change(admin, original, {canCreateReports: false, canEditReports: true}); const editor = await login('operator');
  assert.equal((await put('production-log', editor, {...report, entries: [...report.entries, entry('demo-extra')]}, 2)).status, 403);
  assert.equal((await put('production-log', editor, {...report, goalTons: 5}, 2)).status, 403);
  assert.equal((await put('personnel', editor, hub.store.get('personnel').data, 1)).status, 403);
  assert.equal((await put('production-log', editor, {...report, entries: [{...report.entries[0], tonnage: 1200}]}, 2)).status, 200);
  assert.equal((await put('production-log', editor, {...report, entries: []}, 3)).status, 200);
  await change(admin, editor, {canCreateReports: false, canEditReports: false}); const reader = await login('operator');
  assert.equal((await put('production-log', reader, hub.store.get('production-log').data, 4)).status, 403);
  assert.equal(hub.store.get('production-log').revision, 4);
});
test('restricted administrators cannot import through pages, batch stages or legacy endpoints; permitted import is independent of report write rights', async t => {
  const {hub, login, request, change} = await setup(t); const admin = await login();
  await hub.auth.create('demo-second-admin', password, 'admin');
  const source = {documents: {'production-log': {entries: [entry('demo-import')]}}, files: [], includeSettings: false};
  const id = (await (await request('/api/import/batches', admin, 'POST', source)).json()).id;
  await change(admin, admin, {canImportData: false}); const restricted = await login();
  for (const route of ['/data-import.html', '/production-import.html']) assert.equal((await request(route, restricted)).status, 403);
  for (const [route, method, data] of [
    ['/api/import/batches', 'POST', source], ['/api/import/batches/' + id + '/preview', 'POST', {}],
    ['/api/import/batches/' + id + '/apply', 'POST', {token: 'fictional'}], ['/api/import/batches/' + id + '/files/0', 'PUT', {}],
    ['/api/import/batches/' + id, 'DELETE', {}], ['/api/import/production-log/preview', 'POST', source.documents['production-log']],
    ['/api/import/production-log/apply', 'POST', source.documents['production-log']]
  ]) assert.equal((await request(route, restricted, method, data)).status, 403);
  assert.equal(hub.store.get('production-log').revision, 1);
  assert.throws(() => hub.imports.preview(id, restricted.user), error => error.code === 'FORBIDDEN');
  const other = await hub.auth.login('demo-second-admin', password);
  const actor = {user: other.user, csrf: other.csrf, cookie: 'hub-local-session=' + other.token};
  await change(actor, restricted, {canImportData: true, canCreateReports: false, canEditReports: false}); const importer = await login();
  assert.equal((await request('/api/import/production-log/apply', importer, 'POST', source.documents['production-log'], {'If-Match': '"1"'})).status, 200);
});
test('permission updates close live sessions immediately and role downgrades remove inherited privileged access', async t => {
  const {login, request, change} = await setup(t); const admin = await login(), operator = await login('operator');
  const stream = await request('/api/events', operator); const reader = stream.body.getReader();
  try {
    await reader.read(); await change(admin, operator, {canExportReports: false});
    assert.match(Buffer.from((await reader.read()).value).toString(), /event: logout/);
    assert.equal((await request('/api/session', operator)).status, 401);
    await request('/api/accounts/' + operator.user.id, admin, 'PATCH', {role: 'observer', permissions: {canEditReports: true}});
    const downgraded = await login('operator'); assert.equal(downgraded.user.permissions.canEditReports, false);
    assert.equal((await request('/api/accounts/' + admin.user.id, admin, 'PATCH', {active: false})).status, 409);
  } finally { await reader.cancel(); }
});
test('revoking permissions during a slow request body prevents the in-flight write from using its old session', async t => {
  const {hub, base, login, change} = await setup(t); const admin = await login(), operator = await login('operator');
  const payload = JSON.stringify({entries: [entry('demo-slow-write')], goalTons: 3000});
  const received = new Promise(resolve => hub.server.once('request', resolve));
  let pending;
  const result = new Promise((resolve, reject) => {
    pending = http.request(base + '/api/data/production-log', {method: 'PUT', headers: {Origin: base, Cookie: operator.cookie, 'X-CSRF-Token': operator.csrf, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'If-Match': '"1"'}}, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    pending.on('error', reject); pending.write(payload.slice(0, 4));
  });
  t.after(() => pending.destroy());
  await received; await change(admin, operator, {canCreateReports: false}); pending.end(payload.slice(4));
  assert.equal(await result, 401); assert.equal(hub.store.get('production-log').revision, 1);
});
test('personnel is administrator-only and statistics is administrator/observer-only for direct URLs and APIs', async t => {
  const {login, request} = await setup(t);
  const admin = await login(), operator = await login('operator'), observer = await login('observer');
  for (const user of [operator, observer]) {
    for (const route of ['/personnel.html', '/personnel.html?role=admin', '/api/data/personnel', '/api/files?path=data%2Fpersonnel.json', '/api/files?path=personnel.json']) {
      assert.equal((await request(route, user)).status, 403);
    }
    assert.equal((await request('/personnel.html', user, 'HEAD')).status, 403);
    assert.equal((await request('/api/data/personnel', user, 'PUT', {employees: []}, {'If-Match': '"1"'})).status, 403);
  }
  for (const user of [admin, observer]) {
    assert.equal((await request('/statistics.html', user)).status, 200);
    assert.equal((await request('/api/statistics/workforce', user)).status, 200);
    assert.equal((await request('/api/statistics/workforce', user, 'POST', {})).status, 405);
  }
  for (const route of ['/statistics.html', '/statistics.html?role=observer', '/api/statistics/workforce']) assert.equal((await request(route, operator)).status, 403);
  assert.equal((await request('/statistics.html', operator, 'HEAD')).status, 403);
  assert.equal((await request('/personnel.html', admin)).status, 200);
  assert.equal((await request('/api/data/personnel', admin)).status, 200);
});
test('pair selection uses a minimal active-packer roster and workforce counts disclose no personnel records', async t => {
  const {hub, login, request} = await setup(t); const admin = await login(), operator = await login('operator'), observer = await login('observer');
  const person = (id, category, team, role = 'Опаковчик', active = true) => ({id, name: 'Demo View ' + id, category, team, role, active, note: 'Fictional private personnel note'});
  const roster = {schemaVersion: 3, employees: [person('demo-auto', 'auto', 'А'), person('demo-manual', 'manual', 'А'), person('demo-stickers', 'stickers', '1 смяна'), person('demo-inactive', 'auto', 'Б', 'Опаковчик', false), person('demo-supervisor', 'auto', 'В', 'Началник смяна')], settings: {stickersStage1: 3, stickersStage2: 5}, moveLog: []};
  hub.store.put('personnel', roster, 1, admin.user);
  for (const user of [operator, observer, admin]) {
    const response = await request('/api/pair-roster', user); assert.equal(response.status, 200); const view = await response.json();
    assert.equal(view.revision, 2); assert.deepEqual(Object.keys(view.data), ['employees']);
    assert.deepEqual(view.data.employees.map(person => person.id), ['demo-auto', 'demo-manual', 'demo-stickers']);
    assert.ok(view.data.employees.every(person => Object.keys(person).sort().join(',') === 'active,category,id,name,role,team'));
    assert.equal((await request('/api/pair-roster', user, 'PUT', {})).status, 405);
  }
  const summary = await (await request('/api/statistics/workforce', observer)).json();
  assert.deepEqual(Object.keys(summary.data), ['counts']);
  assert.equal(summary.data.counts.totalActive, 4); assert.equal(summary.data.counts.productionTotal, 3);
  assert.equal(summary.data.counts.stickers, 1); assert.equal(summary.data.counts.additional, 1);
  assert.equal(summary.data.counts.production['А'], 2); assert.equal(summary.data.counts.production['В'], 1);
  assert.ok(!JSON.stringify(summary).includes('Demo View')); assert.ok(!JSON.stringify(summary).includes('personnel note'));
  const updated = {...roster, employees: roster.employees.map(person => ({...person, active: false}))}; hub.store.put('personnel', updated, 2, admin.user);
  const current = await (await request('/api/statistics/workforce', observer)).json(); assert.equal(current.revision, 3); assert.equal(current.data.counts.totalActive, 0);
  assert.equal((await (await request('/api/pair-roster', operator)).json()).data.employees.length, 0);
});
