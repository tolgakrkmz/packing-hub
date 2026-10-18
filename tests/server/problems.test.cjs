const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const password = 'Fictional-problems-password-123';
async function setup(t) {
  let time = Date.parse('2026-12-01T09:00:00+02:00');
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => time});
  for (const role of ['admin', 'operator', 'observer']) await hub.auth.create('demo-' + role, password, role);
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => { const logged = await hub.auth.login(name, password); return {...logged, cookie: 'hub-local-session=' + logged.token}; };
  const request = (route, user, method = 'GET', data, headers = {}) => fetch(base + route, {method, headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', ...headers}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const admin = await login('demo-admin'), operator = await login('demo-operator'), observer = await login('demo-observer');
  const payload = (extra = {}) => ({requestId: randomUUID(), title: 'Fictional pallet supply gap', area: 'Demo line 1', category: 'materials', description: 'Fictional description', impactLevel: 'high', impact: 'Fictional 120 min per month', rootCause: '', dependsOn: '', contact: '', request: '', ...extra});
  async function create(user = admin, data = payload()) { const response = await request('/api/problems', user, 'POST', data); assert.equal(response.status, 201); return (await response.json()).id; }
  const list = async (user = admin) => (await request('/api/problems', user)).json();
  const find = async (id, user = admin) => (await list(user)).items.find(item => item.id === id);
  const change = (id, user, data, revision) => request('/api/problems/' + id, user, 'PATCH', data, {'If-Match': '"' + revision + '"'});
  return {hub, admin, operator, observer, request, payload, create, list, find, change, time: value => { time = Date.parse(value); }};
}
test('everyone may view problems; operators describe and propose; observers stay read-only', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/api/problems', s.observer, 'POST', s.payload())).status, 403);
  const id = await s.create(s.operator);
  const observed = await s.list(s.observer);
  assert.equal(observed.items.length, 1); assert.deepEqual(observed.owners, []);
  assert.equal((await s.change(id, s.observer, {action: 'propose', text: 'Fictional idea', effort: 'S'}, 1)).status, 403);
  assert.equal((await s.change(id, s.operator, {action: 'propose', text: 'Fictional buffer stock', effort: 'M'}, 1)).status, 200);
  assert.equal((await s.change(id, s.operator, {action: 'status', status: 'presented'}, 2)).status, 403);
  assert.equal((await s.change(id, s.operator, {...s.payload(), action: 'edit', title: 'Fictional edited by author'}, 2)).status, 200);
  assert.equal((await s.change(id, s.admin, {action: 'status', status: 'described'}, 3)).status, 200);
  assert.equal((await s.change(id, s.operator, {...s.payload(), action: 'edit'}, 4)).status, 403, 'authors edit only while new');
  const item = await s.find(id);
  assert.equal(item.title, 'Fictional edited by author'); assert.equal(item.proposals[0].effort, 'M');
  assert.deepEqual(item.events.map(entry => entry.action), ['created', 'propose', 'edit', 'status']);
});
test('escalation requires party, request, owner and next contact; follow-up signals are derived', async t => {
  const s = await setup(t), id = await s.create();
  const {owners} = await s.list(); const owner = owners.find(person => person.username === 'demo-operator');
  assert.ok(owner); assert.equal((await s.change(id, s.admin, {action: 'status', status: 'escalated', ownerId: owner.id, nextContact: '2026-12-05'}, 1)).status, 400);
  assert.equal((await s.change(id, s.admin, {...s.payload(), action: 'edit', dependsOn: 'Fictional logistics', request: 'Fictional daily pallet delivery'}, 1)).status, 200);
  assert.equal((await s.change(id, s.admin, {action: 'status', status: 'escalated', ownerId: 999999, nextContact: '2026-12-05'}, 2)).status, 400);
  assert.equal((await s.change(id, s.admin, {action: 'status', status: 'escalated', ownerId: owner.id, nextContact: '2026-12-05'}, 2)).status, 200);
  let item = await s.find(id);
  assert.equal(item.escalatedOn, '2026-12-01'); assert.equal(item.quietDays, 0); assert.equal(item.contactOverdue, false);
  s.time('2026-12-10T09:00:00+02:00');
  item = await s.find(id);
  assert.equal(item.quietDays, 9); assert.equal(item.contactOverdue, true);
  assert.equal((await s.change(id, s.operator, {action: 'contact', date: '2026-12-11', note: 'Fictional'}, 3)).status, 400, 'contacts cannot be in the future');
  assert.equal((await s.change(id, s.operator, {action: 'contact', date: '2026-12-09', with: 'Fictional planner', note: 'Fictional promise', promisedDate: '2026-12-08', nextContact: '2026-12-15'}, 3)).status, 200);
  item = await s.find(id);
  assert.equal(item.quietDays, 1); assert.equal(item.contactOverdue, false); assert.equal(item.promiseOverdue, true);
  assert.equal((await s.change(id, s.observer, {action: 'contact', date: '2026-12-09', note: 'Fictional'}, 4)).status, 403);
});
test('closed problems accept only a manager status change; reasons, revisions and retries are enforced', async t => {
  const s = await setup(t), id = await s.create();
  assert.equal((await s.change(id, s.admin, {action: 'status', status: 'rejected'}, 1)).status, 400);
  const input = {action: 'status', status: 'rejected', note: 'Fictional owner declined', requestId: randomUUID()};
  assert.equal((await s.change(id, s.admin, input, 9)).status, 409);
  const first = await s.change(id, s.admin, input, 1); assert.equal(first.status, 200);
  const retry = await s.change(id, s.admin, input, 1); assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), await first.json());
  assert.equal((await s.change(id, s.admin, {action: 'propose', text: 'Fictional', effort: 'S'}, 2)).status, 409);
  assert.equal((await s.change(id, s.admin, {action: 'status', status: 'described'}, 2)).status, 200);
  const item = await s.find(id);
  assert.equal(item.closedAt, null); assert.equal(item.revision, 3);
});
test('a manager accepts exactly one proposal', async t => {
  const s = await setup(t), id = await s.create();
  for (const [index, text] of ['Fictional A', 'Fictional B'].entries()) assert.equal((await s.change(id, s.operator, {action: 'propose', text, effort: 'S'}, index + 1)).status, 200);
  const [a, b] = (await s.find(id)).proposals;
  assert.equal((await s.change(id, s.operator, {action: 'accept', proposalId: a.id}, 3)).status, 403);
  assert.equal((await s.change(id, s.admin, {action: 'accept', proposalId: a.id}, 3)).status, 200);
  assert.equal((await s.change(id, s.admin, {action: 'accept', proposalId: b.id}, 4)).status, 200);
  assert.deepEqual((await s.find(id)).proposals.map(entry => entry.accepted), [false, true]);
});
test('problem input is validated at the server boundary', async t => {
  const s = await setup(t);
  for (const extra of [{title: ' '}, {category: 'unknown'}, {impactLevel: 'huge'}, {title: 'x'.repeat(181)}, {requestId: 'not-a-uuid'}]) {
    assert.equal((await s.request('/api/problems', s.admin, 'POST', s.payload(extra))).status, 400, JSON.stringify(Object.keys(extra)));
  }
  assert.equal((await s.request('/api/problems', s.admin, 'PUT', {})).status, 405);
  assert.equal((await s.request('/api/problems/' + randomUUID(), s.admin, 'PATCH', {action: 'status', status: 'new'}, {'If-Match': '"1"'})).status, 404);
});
