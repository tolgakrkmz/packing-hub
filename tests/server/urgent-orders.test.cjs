const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const password = 'Fictional-orders-password-123';
async function setup(t, clock = {at: Date.parse('2026-10-26T08:00:00Z')}) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => clock.at});
  const admin0 = await hub.auth.create('demo-admin', password, 'admin');
  // Pilot: shift leads get the module only by an explicit grant until release.
  await hub.auth.create('demo-lead', password, 'operator', admin0, {canViewUrgentOrders: true}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  await hub.auth.create('demo-lead-2', password, 'operator', admin0, {}, () => {}, {taskSupervisor: true, taskTeam: 'Б'});
  await hub.auth.create('demo-operator', password, 'operator');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => { const logged = await hub.auth.login(name, password); return {...logged, cookie: 'hub-local-session=' + logged.token}; };
  const request = (route, user, method = 'GET', data, headers = {}) => fetch(base + route, {method, headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', ...headers}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const [admin, lead, operator] = await Promise.all(['demo-admin', 'demo-lead', 'demo-operator'].map(login));
  const add = (text, user = admin) => request('/api/urgent-orders', user, 'POST', {text, truckDate: '2026-10-27', requestId: randomUUID()});
  const list = async (user = lead) => (await (await request('/api/urgent-orders', user)).json()).items;
  const change = (item, user, action) => request('/api/urgent-orders/' + item.id, user, 'PATCH', {action, requestId: randomUUID()}, {'If-Match': '"' + item.revision + '"'});
  return {hub, clock, admin, lead, operator, request, list, change, add};
}
test('the manager adds pasted lines as separate orders; shift leads mark them packed or not found and undo', async t => {
  const s = await setup(t);
  const input = {text: 'Fictional 4521 · 5 pallets\n\n  Fictional 4530  \n', truckDate: '2026-10-27', requestId: randomUUID()};
  assert.equal((await s.request('/api/urgent-orders', s.lead, 'POST', input)).status, 403);
  const first = await s.request('/api/urgent-orders', s.admin, 'POST', input);
  assert.equal(first.status, 201);
  assert.equal((await s.request('/api/urgent-orders', s.admin, 'POST', input)).status, 201); // retry with the same id adds nothing
  const items = await s.list();
  assert.deepEqual(items.map(item => item.text).sort(), ['Fictional 4521 · 5 pallets', 'Fictional 4530']);
  const [item, other] = items;
  const find = id => s.list().then(list => list.find(value => value.id === id));
  assert.equal((await s.change(item, s.lead, 'pack')).status, 200);
  assert.equal((await s.change(item, s.lead, 'missing')).status, 409); // stale revision
  const packed = await find(item.id);
  assert.equal(packed.status, 'packed'); assert.equal(packed.markedBy.username, 'demo-lead');
  assert.equal((await s.change(packed, s.lead, 'missing')).status, 409);
  assert.equal((await s.change(other, s.lead, 'missing')).status, 200);
  assert.equal((await find(other.id)).status, 'missing');
  assert.equal((await s.change(packed, s.lead, 'reopen')).status, 200);
  const restored = await find(item.id);
  assert.equal(restored.status, 'open'); assert.equal(restored.markedAt, null);
  assert.equal((await s.change(restored, s.lead, 'reopen')).status, 409);
  assert.equal((await s.change(restored, s.lead, 'remove')).status, 403);
  assert.equal((await s.change(restored, s.admin, 'remove')).status, 200);
  assert.equal((await s.list()).length, 1);
});
test('during the pilot only admins and granted accounts have access; input is checked at the server', async t => {
  const s = await setup(t);
  const otherLead = await s.hub.auth.login('demo-lead-2', password);
  assert.equal((await s.request('/api/urgent-orders', {...otherLead, cookie: 'hub-local-session=' + otherLead.token})).status, 403);
  assert.equal((await s.request('/api/urgent-orders', s.operator)).status, 403);
  assert.equal((await s.add('Fictional', s.operator)).status, 403);
  assert.equal((await s.request('/urgent-orders', s.operator)).status, 403);
  for (const extra of [{text: ' \n '}, {text: 'x'.repeat(301)}, {truckDate: '2026-02-30'}, {truckDate: '2026-13-45'}, {truckDate: '9999-12-31'}, {truckDate: '2026-10-18'}, {truckDate: 'tomorrow'}, {requestId: 'nope'}, {text: Array(301).fill('Fictional').join('\n')}]) {
    assert.equal((await s.request('/api/urgent-orders', s.admin, 'POST', {text: 'Fictional', truckDate: '2026-10-27', requestId: randomUUID(), ...extra})).status, 400, JSON.stringify(extra).slice(0, 40));
  }
  await s.add('Fictional'); const [item] = await s.list();
  assert.equal((await s.change(item, s.lead, 'explode')).status, 400);
  assert.equal((await s.request('/api/urgent-orders', s.lead, 'PUT', {})).status, 405);
});
test('marked orders are removed after 30 days, open ones stay', async t => {
  const s = await setup(t);
  await s.add('Fictional A\nFictional B\nFictional C');
  const [packed, missing] = await s.list();
  await s.change(packed, s.lead, 'pack'); await s.change(missing, s.lead, 'missing');
  s.clock.at += 31 * 86400000; s.hub.urgentOrders.prune();
  assert.deepEqual((await s.list()).map(value => value.status), ['open']);
});
test('pasted report rows keep their columns and a second paste adds only new orders', async t => {
  const s = await setup(t);
  const row = n => 'DP000000' + n + '_10000\tFictional Client Ltd\t500-000' + n + '\tA000001\t10' + n + '\t0\t10' + n;
  const post = text => s.request('/api/urgent-orders', s.admin, 'POST', {text, truckDate: '2026-10-27', requestId: randomUUID()}).then(response => response.json());
  assert.deepEqual(await post(['Поръчка\tКлиент', row(1), row(2)].join('\n')).then(({ids, ...rest}) => [ids.length, rest]), [2, {skipped: 1, duplicates: 0}]);
  assert.deepEqual(await post([row(2), row(3)].join('\n')).then(({ids, ...rest}) => [ids.length, rest]), [1, {skipped: 0, duplicates: 1}]);
  const saved = (await s.list()).find(item => item.order === 'DP0000001_10000');
  assert.deepEqual([saved.client, saved.profile, saved.variant, saved.quantity, saved.note, saved.text], ['Fictional Client Ltd', '500-0001', 'A000001', '101', '', 'DP0000001_10000 · 500-0001 · A000001']);
});
test('the manager assigns possible shifts and the magic button places every waiting order; shift leads only read', async t => {
  const s = await setup(t); // the clock is 2026-10-26 10:00 Sofia: the first shift runs
  await s.add('Fictional A\nFictional B\nFictional C\nFictional D');
  const [item] = await s.list();
  const assign = (user, shift) => s.request('/api/urgent-orders/' + item.id, user, 'PATCH', {action: 'assign', shift, requestId: randomUUID()}, {'If-Match': '"' + item.revision + '"'});
  assert.equal((await assign(s.lead, {date: '2026-10-26', code: 2})).status, 403);
  assert.equal((await assign(s.admin, {date: '2026-10-27', code: 1})).status, 400); // the truck day itself is too late
  assert.equal((await assign(s.admin, {date: '2026-10-26', code: 2})).status, 200);
  assert.deepEqual((await s.list()).find(value => value.id === item.id).shift.code, 2);
  const spread = user => s.request('/api/urgent-orders/distribute', user, 'POST', {requestId: randomUUID()});
  assert.equal((await spread(s.lead)).status, 403);
  const result = await spread(s.admin);
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), {assigned: 3, unplaced: 0});
  const shifts = (await s.list()).map(value => value.shift?.date + '/' + value.shift?.code);
  assert.ok(shifts.every(key => ['2026-10-26/1', '2026-10-26/2', '2026-10-26/3'].includes(key)), shifts.join());
  assert.equal(new Set(shifts).size, 3); // four equal orders over three equal shifts use all three
});
