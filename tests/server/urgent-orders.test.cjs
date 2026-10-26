const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const password = 'Fictional-orders-password-123';
async function setup(t, clock = {at: Date.parse('2026-10-26T08:00:00Z')}) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => clock.at});
  const admin0 = await hub.auth.create('demo-admin', password, 'admin');
  await hub.auth.create('demo-lead', password, 'operator', admin0, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  await hub.auth.create('demo-operator', password, 'operator');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => { const logged = await hub.auth.login(name, password); return {...logged, cookie: 'hub-local-session=' + logged.token}; };
  const request = (route, user, method = 'GET', data, headers = {}) => fetch(base + route, {method, headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', ...headers}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const [admin, lead, operator] = await Promise.all(['demo-admin', 'demo-lead', 'demo-operator'].map(login));
  const list = async (user = lead) => (await (await request('/api/urgent-orders', user)).json()).items;
  const change = (item, user, action) => request('/api/urgent-orders/' + item.id, user, 'PATCH', {action, requestId: randomUUID()}, {'If-Match': '"' + item.revision + '"'});
  return {hub, clock, admin, lead, operator, request, list, change};
}
test('shift leads add pasted lines as separate orders, mark them packed and undo', async t => {
  const s = await setup(t);
  const input = {text: 'Fictional 4521 · 5 pallets\n\n  Fictional 4530  \n', truckDate: '2026-10-27', requestId: randomUUID()};
  const first = await s.request('/api/urgent-orders', s.lead, 'POST', input);
  assert.equal(first.status, 201);
  assert.equal((await s.request('/api/urgent-orders', s.lead, 'POST', input)).status, 201); // retry with the same id adds nothing
  const items = await s.list();
  assert.deepEqual(items.map(item => item.text).sort(), ['Fictional 4521 · 5 pallets', 'Fictional 4530']);
  const [item] = items;
  assert.equal((await s.change(item, s.admin, 'pack')).status, 200);
  assert.equal((await s.change(item, s.lead, 'pack')).status, 409); // stale revision
  const packed = (await s.list()).find(value => value.id === item.id);
  assert.equal(packed.packedBy.username, 'demo-admin');
  assert.equal((await s.change(packed, s.lead, 'pack')).status, 409);
  assert.equal((await s.change(packed, s.lead, 'unpack')).status, 200);
  const restored = (await s.list()).find(value => value.id === item.id);
  assert.equal(restored.packedAt, null);
  assert.equal((await s.change(restored, s.lead, 'remove')).status, 200);
  assert.equal((await s.list()).length, 1);
});
test('only shift leads and admins have access; input is checked at the server', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/api/urgent-orders', s.operator)).status, 403);
  assert.equal((await s.request('/api/urgent-orders', s.operator, 'POST', {text: 'Fictional', truckDate: '2026-10-27', requestId: randomUUID()})).status, 403);
  assert.equal((await s.request('/urgent-orders', s.operator)).status, 403);
  for (const extra of [{text: ' \n '}, {text: 'x'.repeat(201)}, {truckDate: '2026-02-30'}, {truckDate: '2026-13-45'}, {truckDate: 'tomorrow'}, {requestId: 'nope'}, {text: Array(51).fill('Fictional').join('\n')}]) {
    assert.equal((await s.request('/api/urgent-orders', s.lead, 'POST', {text: 'Fictional', truckDate: '2026-10-27', requestId: randomUUID(), ...extra})).status, 400, JSON.stringify(extra).slice(0, 40));
  }
  const [item] = await (async () => { await s.request('/api/urgent-orders', s.lead, 'POST', {text: 'Fictional', truckDate: '2026-10-27', requestId: randomUUID()}); return s.list(); })();
  assert.equal((await s.change(item, s.lead, 'explode')).status, 400);
  assert.equal((await s.request('/api/urgent-orders', s.lead, 'PUT', {})).status, 405);
});
test('packed orders are removed after 30 days, open ones stay', async t => {
  const s = await setup(t);
  await s.request('/api/urgent-orders', s.lead, 'POST', {text: 'Fictional A\nFictional B', truckDate: '2026-10-27', requestId: randomUUID()});
  const [item] = await s.list();
  await s.change(item, s.lead, 'pack');
  s.clock.at += 31 * 86400000; s.hub.urgentOrders.prune();
  assert.deepEqual((await s.list()).map(value => value.packedAt), [null]);
});
