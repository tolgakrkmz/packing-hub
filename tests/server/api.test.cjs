const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHubServer} = require('../../server/server.cjs');
const {openStore} = require('../../server/store.cjs');
const fixturePassword = 'Fictional-password-123';
async function setup(t, filename = ':memory:') {
  const hub = createHubServer({filename, publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  await hub.auth.create('demo-admin', fixturePassword, 'admin');
  await hub.auth.create('demo-operator', fixturePassword, 'operator');
  await hub.auth.create('demo-observer', fixturePassword, 'observer');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  t.after(() => hub.close());
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  async function login(username = 'demo-admin') {
    const response = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({username, password: fixturePassword})});
    assert.equal(response.status, 200);
    const result = await response.json();
    return {cookie: response.headers.get('set-cookie').split(';')[0], csrf: result.csrf, user: result.user};
  }
  async function request(route, user, options = {}) {
    const headers = {Origin: base, ...(user ? {Cookie: user.cookie, 'X-CSRF-Token': user.csrf} : {}), ...options.headers};
    if (options.data !== undefined) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.data); }
    return fetch(base + route, {...options, headers, redirect: 'manual'});
  }
  return {hub, base, login, request};
}
test('authentication gates pages, data, attachments and administration; sessions are HttpOnly and logout revokes access', async t => {
  const {request, login} = await setup(t);
  assert.equal((await request('/production-log.html')).status, 302);
  for (const route of ['/api/data/personnel', '/api/accounts', '/api/files?path=data/package-instructions.json', '/server-session.js']) assert.equal((await request(route)).status, 401);
  for (const route of ['/data/personnel.json', '/server/server.cjs', '/.git/config', '/server-state/hub.sqlite']) assert.equal((await request(route)).status, 404);
  const user = await login();
  assert.equal((await request('/production-log.html', user)).status, 200);
  const response = await request('/api/login', null, {method: 'POST', data: {username: 'demo-admin', password: fixturePassword}});
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await request('/api/logout', user, {method: 'POST', data: {}})).status, 200);
  assert.equal((await request('/api/data/personnel', user)).status, 401);
});
test('cross-origin and missing CSRF writes are denied; deployment requires HTTPS outside explicit localhost development', async t => {
  const {request, login} = await setup(t); const user = await login();
  assert.equal((await request('/api/logout', user, {method: 'POST', data: {}, headers: {Origin: 'https://example.invalid'}})).status, 403);
  assert.equal((await request('/api/logout', user, {method: 'POST', data: {}, headers: {'X-CSRF-Token': ''}})).status, 403);
  assert.throws(() => createHubServer({filename: ':memory:', publicOrigin: 'http://example.invalid'}), /HTTPS/);
  assert.throws(() => createHubServer({filename: ':memory:', publicOrigin: 'http://example.invalid', allowHttp: true}), /HTTPS/);
});
test('HTTPS proxy configuration uses Secure host cookies and restrictive page headers', async t => {
  const origin = 'https://demo-hub.example.invalid';
  const hub = createHubServer({filename: ':memory:', publicOrigin: origin}); t.after(() => hub.close());
  await hub.auth.create('demo-admin', fixturePassword, 'admin');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const response = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({username: 'demo-admin', password: fixturePassword})});
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-hub-session=/); assert.match(cookie, /; Path=/); assert.match(cookie, /; Secure/); assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const page = await fetch(base + '/index.html', {headers: {Cookie: cookie.split(';')[0]}});
  assert.match(page.headers.get('content-security-policy'), /object-src 'none'/); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff'); assert.match(page.headers.get('strict-transport-security'), /max-age/);
  assert.match(await page.text(), /src="\/server-session.js"/);
});
test('operator can append reports but cannot change goals, delete reports, manage personnel or accounts; observer cannot write', async t => {
  const {request, login} = await setup(t); const operator = await login('demo-operator'), observer = await login('demo-observer');
  const original = await (await request('/api/data/production-log', operator)).json();
  const entry = {id: 'demo-online-1', date: '2026-10-05', shift: 'А', tonnage: 3000, brak: 30, breakdown: null};
  const data = {...original.data, entries: [entry]};
  const put = (kind, user, value, revision = 1) => request('/api/data/' + kind, user, {method: 'PUT', headers: {'If-Match': '"' + revision + '"'}, data: value});
  assert.equal((await put('production-log', observer, data)).status, 403);
  assert.equal((await put('production-log', operator, data)).status, 200);
  assert.equal((await put('production-log', operator, {...data, goalTons: 1}, 2)).status, 403);
  assert.equal((await put('production-log', operator, {...data, entries: []}, 2)).status, 403);
  const personnel = await (await request('/api/data/personnel', operator)).json();
  assert.equal((await put('personnel', operator, personnel.data)).status, 403);
  assert.equal((await request('/api/accounts', operator)).status, 403);
  assert.equal((await request('/accounts.html', observer)).status, 403);
  assert.equal((await request('/api/data/personnel', observer)).status, 200);
});
test('revisions prevent stale replacement and duplicate retries; invalid schemas and missing revisions never modify accepted data', async t => {
  const {request, login} = await setup(t); const user = await login();
  const initial = await (await request('/api/data/production-log', user)).json();
  const put = (data, revision) => request('/api/data/production-log', user, {method: 'PUT', data, headers: revision ? {'If-Match': '"' + revision + '"'} : {}});
  assert.equal((await put({...initial.data, goalTons: 12}, 1)).status, 200);
  assert.equal((await put(initial.data, 1)).status, 409);
  assert.equal((await put({employees: []}, 2)).status, 400);
  assert.equal((await put(initial.data)).status, 428);
  const current = await (await request('/api/data/production-log', user)).json();
  assert.equal(current.revision, 2); assert.equal(current.data.goalTons, 12);
});
test('account administration hashes passwords, rejects duplicates, disables sessions and retains an active administrator', async t => {
  const {hub, request, login} = await setup(t); const user = await login(), observer = await login('demo-observer');
  assert.equal((await request('/api/accounts', user, {method: 'POST', data: {username: 'demo-new', password: fixturePassword, role: 'observer'}})).status, 201);
  assert.equal((await request('/api/accounts', user, {method: 'POST', data: {username: 'demo-new', password: fixturePassword, role: 'observer'}})).status, 409);
  const rows = hub.store.db.prepare('SELECT hash FROM users').all();
  assert.ok(rows.every(row => !row.hash.includes(fixturePassword) && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(row.hash)));
  const list = await (await request('/api/accounts', user)).json(); assert.ok(list.users.every(row => !Object.hasOwn(row, 'hash')));
  assert.equal((await request('/api/accounts/' + observer.user.id, user, {method: 'PATCH', data: {active: false}})).status, 200);
  assert.equal((await request('/api/session', observer)).status, 401);
  assert.equal((await request('/api/accounts/' + user.user.id, user, {method: 'PATCH', data: {role: 'observer'}})).status, 409);
});
test('attachments and indexes are in SQLite, restricted to admin writes and protected against traversal and stale saves', async t => {
  const {request, login} = await setup(t); const user = await login(), observer = await login('demo-observer');
  const create = (name, role = user) => request('/api/folders', role, {method: 'POST', data: {path: name, kind: 'file'}});
  assert.equal((await create('data/profiles/demo-note.txt', observer)).status, 403);
  assert.equal((await create('../private-note.txt')).status, 400);
  assert.equal((await create('data/profiles/demo-note.txt')).status, 201);
  const route = '/api/files?path=data%2Fprofiles%2Fdemo-note.txt';
  assert.equal((await request(route, user, {method: 'PUT', headers: {'If-Match': '"1"', 'Content-Type': 'text/plain'}, body: 'Fictional attachment'})).status, 200);
  assert.equal((await request(route, user, {method: 'PUT', headers: {'If-Match': '"1"'}, body: 'Stale fictional replacement'})).status, 409);
  const file = await request(route, observer); assert.equal(await file.text(), 'Fictional attachment'); assert.equal(file.headers.get('content-disposition'), 'attachment');
});
test('committed records survive a database reopen and backups are complete SQLite snapshots', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-server-demo-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const filename = path.join(dir, 'demo.sqlite');
  let store = openStore(filename);
  store.put('production-log', {entries: [], goalTons: 12}, 1, {role: 'admin'});
  store.db.prepare('VACUUM INTO ?').run(path.join(dir, 'backup.sqlite')); store.close();
  store = openStore(filename); assert.equal(store.get('production-log').data.goalTons, 12); store.close();
  store = openStore(path.join(dir, 'backup.sqlite')); assert.equal(store.get('production-log').revision, 2); store.close();
});
test('login failures are generic and repeated attempts are throttled', async t => {
  const {request} = await setup(t);
  for (let i = 0; i < 10; i++) {
    const response = await request('/api/login', null, {method: 'POST', data: {username: 'demo-unknown', password: fixturePassword}});
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), {error: 'INVALID_LOGIN'});
  }
  assert.equal((await request('/api/login', null, {method: 'POST', data: {username: 'demo-unknown', password: fixturePassword}})).status, 429);
});
test('pair writes enforce the active packer roster and preserve reported plans while retaining historical members', async t => {
  const {request, login} = await setup(t); const admin = await login(), operator = await login('demo-operator');
  const put = (kind, data, revision, user = admin) => request('/api/data/' + kind, user, {method: 'PUT', data, headers: {'If-Match': '"' + revision + '"'}});
  const roster = await (await request('/api/data/personnel', admin)).json();
  roster.data.employees = [1, 2, 3].map(number => ({id: 'demo-person-' + number, name: 'Demo API Person ' + number, category: 'stickers', team: '1 смяна', role: number === 3 ? 'Отговорник' : 'Опаковчик', active: true, note: ''}));
  assert.equal((await put('personnel', roster.data, 1)).status, 200);
  const member = person => ({id: person.id, name: person.name, category: person.category, role: person.role});
  const time = '2026-10-05T05:30:00.000Z';
  const entry = {id: 'demo-pair-one', date: '2026-10-05', shiftCode: 1, team: 'СТИКЕРИ', members: roster.data.employees.slice(0, 2).map(member), areas: ['manual'], targetKg: 1000, targetCrates: 40, result: null, createdAt: time, updatedAt: time};
  const data = {module: 'pair-targets', schemaVersion: 1, entries: [entry]};
  assert.equal((await put('pair-targets', {...data, entries: [{...entry, members: [member(roster.data.employees[0]), member(roster.data.employees[2])]}]}, 1, operator)).status, 400);
  assert.equal((await put('pair-targets', data, 1, operator)).status, 200);
  roster.data.employees[0].active = false;
  assert.equal((await put('personnel', roster.data, 2)).status, 200);
  entry.result = {kg: 1100, crates: 44, reasonKey: '', reasonText: '', reportedAt: time};
  assert.equal((await put('pair-targets', data, 2, operator)).status, 200);
  assert.equal((await put('pair-targets', {...data, entries: []}, 3, operator)).status, 400);
  assert.equal((await put('pair-targets', {...data, entries: [{...entry, targetKg: 50}]}, 3)).status, 400);
  assert.equal((await put('pair-targets', {...data, entries: [{...entry, result: {...entry.result, reasonKey: 'other', reasonText: 'Unneeded fictional reason'}}]}, 3, operator)).status, 400);
  assert.equal((await (await request('/api/data/pair-targets', operator)).json()).data.entries[0].result.kg, 1100);
});
test('simultaneous saves accept one revision and a refreshed retry preserves both reports', async t => {
  const {request, login} = await setup(t); const operator = await login('demo-operator');
  const initial = await (await request('/api/data/production-log', operator)).json();
  const entries = [1, 2].map(id => ({id: 'demo-race-' + id, date: '2026-10-05', shift: 'А', tonnage: 1000, brak: 0, breakdown: null}));
  const put = (data, revision) => request('/api/data/production-log', operator, {method: 'PUT', data, headers: {'If-Match': '"' + revision + '"'}});
  const responses = await Promise.all(entries.map(entry => put({...initial.data, entries: [entry]}, 1)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const current = await (await request('/api/data/production-log', operator)).json();
  const missing = entries.find(entry => !current.data.entries.some(prior => prior.id === entry.id));
  assert.equal((await put({...current.data, entries: [...current.data.entries, missing]}, current.revision)).status, 200);
  assert.equal((await (await request('/api/data/production-log', operator)).json()).data.entries.length, 2);
});
test('live events announce committed revisions and immediately revoke disabled readers on the next notification', async t => {
  const {request, login} = await setup(t); const admin = await login(), observer = await login('demo-observer');
  const stream = await request('/api/events', observer, {signal: AbortSignal.timeout(5000)});
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const reader = stream.body.getReader();
  try {
    assert.match(Buffer.from((await reader.read()).value).toString(), /event: version/);
    const put = revision => request('/api/data/production-log', admin, {method: 'PUT', data: {entries: [], goalTons: 12}, headers: {'If-Match': '"' + revision + '"'}});
    assert.equal((await put(1)).status, 200);
    const event = Buffer.from((await reader.read()).value).toString();
    assert.match(event, /event: change/); assert.match(event, /"module":"production-log","revision":2/); assert.ok(!event.includes('goalTons'));
    assert.equal((await request('/api/accounts/' + observer.user.id, admin, {method: 'PATCH', data: {active: false}})).status, 200);
    assert.equal((await put(2)).status, 200);
    assert.match(Buffer.from((await reader.read()).value).toString(), /event: logout/);
  } finally { await reader.cancel(); }
});
