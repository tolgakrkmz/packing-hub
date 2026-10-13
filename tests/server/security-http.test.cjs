/* Loopback-only security regressions with fictional generated accounts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHubServer} = require('../../server/server.cjs');
const password = 'Fictional-security-password-123';
async function setup(t) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  t.after(() => hub.close());
  await hub.auth.create('demo-security-admin', password, 'admin');
  await new Promise((resolve, reject) => { hub.server.once('error', reject); hub.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const session = await hub.auth.login('demo-security-admin', password);
  const headers = {Origin: base, Cookie: 'hub-local-session=' + session.token, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json'};
  const request = (route, options = {}) => {
    const selected = {...headers, ...options.headers};
    for (const name of Object.keys(selected)) if (selected[name] === undefined) delete selected[name];
    return fetch(base + route, {...options, headers: selected, redirect: 'manual'});
  };
  return {hub, base, session, headers, request};
}
test('oversized JSON bodies return a sanitized 413 response and leave sessions and documents unchanged', async t => {
  const {hub, request} = await setup(t);
  const before = hub.store.get('production-log');
  const response = await request('/api/reports/production-log/operations', {
    method: 'POST', body: JSON.stringify({padding: 'x'.repeat(2 * 1024 * 1024)})
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {error: 'TOO_LARGE'});
  assert.deepEqual(hub.store.get('production-log'), before);
  assert.equal((await request('/api/session')).status, 200);
});
test('malformed or non-object login JSON and unsupported content types never create a session', async t => {
  const {hub, request} = await setup(t);
  for (const body of ['{', 'null', '[]', '42', '"fictional"']) {
    const response = await request('/api/login', {method: 'POST', body});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {error: 'INVALID_DATA'});
  }
  const response = await request('/api/login', {method: 'POST', body: '{}', headers: {'Content-Type': 'text/plain'}});
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), {error: 'JSON_REQUIRED'});
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});
test('SQL-like login input cannot bypass authentication or expose account or database details', async t => {
  const {hub, request} = await setup(t);
  for (const username of ["' OR 1=1 --", 'demo-security-admin', 'demo-missing']) {
    const response = await request('/api/login', {method: 'POST', body: JSON.stringify({username, password: 'Fictional-wrong-password'})});
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {error: 'INVALID_LOGIN'});
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});
test('missing, null, hostile and prefix-matching Origins and mismatched CSRF tokens cannot mutate folders', async t => {
  const {hub, base, session, request} = await setup(t);
  const next = await hub.auth.login('demo-security-admin', password);
  const input = {path: 'data/profiles/demo-security-folder', kind: 'directory'};
  for (const headers of [
    {Origin: undefined}, {Origin: ''}, {Origin: 'null'}, {Origin: 'https://example.invalid'}, {Origin: base + '.example.invalid'},
    {Origin: base + '/'}, {'X-CSRF-Token': undefined}, {'X-CSRF-Token': ''}, {'X-CSRF-Token': next.csrf}
  ]) {
    const response = await request('/api/folders', {method: 'POST', body: JSON.stringify(input), headers});
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /^(ORIGIN|CSRF)_REJECTED$/);
    assert.throws(() => hub.store.node(input.path), {code: 'NOT_FOUND'});
    assert.ok(hub.auth.session(session.token));
  }
  assert.equal((await request('/api/folders', {method: 'POST', body: JSON.stringify(input)})).status, 201);
  assert.equal(hub.store.node(input.path).kind, 'directory');
});
test('decoded traversal, NUL and backslash attachment paths return generic errors without disclosing content', async t => {
  const {request} = await setup(t);
  for (const value of ['../demo.txt', 'data/../demo.txt', '/demo.txt', 'data\\demo.txt', 'data/\0demo.txt', 'data//demo.txt']) {
    const response = await request('/api/files?path=' + encodeURIComponent(value));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {error: 'INVALID_PATH'});
  }
  for (const value of ['data/%2e%2e/demo.txt', "data/demo' OR 1=1 --"]) {
    const response = await request('/api/files?path=' + encodeURIComponent(value));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {error: 'NOT_FOUND'});
  }
});
test('notification JSON accepts its exact byte boundary and refuses one byte more without changing preferences', async t => {
  const {hub, request, session} = await setup(t);
  const body = '{}' + ' '.repeat(4094);
  assert.equal((await request('/api/notifications/preferences', {method: 'PATCH', body})).status, 200);
  const before = hub.notifications.preferences(session.user);
  const response = await request('/api/notifications/preferences', {method: 'PATCH', body: body + ' '});
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {error: 'TOO_LARGE'});
  assert.deepEqual(hub.notifications.preferences(session.user), before);
});
test('unexpected internal failures use a sanitized error and keep secure response headers', async t => {
  const {hub, request} = await setup(t);
  t.mock.method(hub.store, 'get', () => { throw new Error('Fictional-local-only-diagnostic'); });
  const response = await request('/api/data/production-log');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {error: 'SERVER_ERROR'});
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self';/);
});
test('account login throttling combines case aliases and releases the limit at the window boundary', async t => {
  const {hub, request} = await setup(t);
  t.mock.timers.enable({apis: ['Date'], now: Date.now()});
  for (let attempt = 0; attempt < 10; attempt++) {
    const username = attempt % 2 ? 'DEMO-MISSING' : 'demo-missing';
    assert.equal((await request('/api/login', {method: 'POST', body: JSON.stringify({username, password})})).status, 401);
  }
  let response = await request('/api/login', {method: 'POST', body: JSON.stringify({username: 'demo-missing', password})});
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {error: 'RATE_LIMITED'});
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  t.mock.timers.tick(15 * 60000 + 1);
  response = await request('/api/login', {method: 'POST', body: JSON.stringify({username: 'demo-missing', password})});
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {error: 'INVALID_LOGIN'});
});
test('forged forwarding headers cannot evade the connection IP login attempt limit', async t => {
  const {request} = await setup(t);
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await request('/api/login', {method: 'POST', headers: {'X-Forwarded-For': '192.0.2.' + attempt}, body: JSON.stringify({username: 'demo-unknown-' + attempt, password})});
    assert.equal(response.status, 401);
  }
  const response = await request('/api/login', {method: 'POST', headers: {'X-Forwarded-For': '192.0.2.99'}, body: JSON.stringify({username: 'demo-security-admin', password})});
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {error: 'RATE_LIMITED'});
});
