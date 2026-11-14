const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const {photo} = require('./task-photo-fixture.cjs');
const password = 'Fictional-labels-password-123';
async function setup(t, clock = {at: Date.parse('2026-10-26T08:00:00Z')}) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => clock.at});
  await hub.auth.create('demo-admin', password, 'admin');
  await hub.auth.create('demo-lead', password, 'operator', undefined, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  await hub.auth.create('demo-operator', password, 'operator');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => { const logged = await hub.auth.login(name, password); return {...logged, cookie: 'hub-local-session=' + logged.token}; };
  const request = (route, user, method = 'GET', data, headers = {}) => fetch(base + route, {method, headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', ...headers}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const [admin, lead, operator] = await Promise.all(['demo-admin', 'demo-lead', 'demo-operator'].map(login));
  const list = async (user = lead) => (await (await request('/api/deleted-labels', user)).json()).items;
  const change = (item, user, action) => request('/api/deleted-labels/' + item.id, user, 'PATCH', {action, requestId: randomUUID()}, {'If-Match': '"' + item.revision + '"'});
  return {hub, clock, admin, lead, operator, request, list, change};
}
test('a shift lead adds a label only with a photo; a manager marks it deleted, undoes and removes it', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', {text: 'Fictional label', requestId: randomUUID()})).status, 400, 'photo is required');
  const input = {text: 'Fictional label 4521', photo, requestId: randomUUID()};
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', input)).status, 201);
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', input)).status, 201); // retry with the same id adds nothing
  let [item] = await s.list();
  assert.equal((await s.list()).length, 1);
  assert.deepEqual([item.text, item.status, item.createdBy.username, item.photo.available], ['Fictional label 4521', 'pending', 'demo-lead', true]);
  const image = await s.request('/api/deleted-labels/' + item.id + '/photos/' + item.photo.id, s.lead);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal((await s.change(item, s.lead, 'delete')).status, 403, 'only a manager marks labels');
  assert.equal((await s.change(item, s.admin, 'delete')).status, 200);
  [item] = await s.list();
  assert.deepEqual([item.status, item.deletedBy.username], ['deleted', 'demo-admin']);
  assert.equal((await s.change(item, s.admin, 'delete')).status, 409);
  assert.equal((await s.change(item, s.admin, 'reopen')).status, 200);
  [item] = await s.list();
  assert.equal(item.status, 'pending');
  assert.equal((await s.change(item, s.admin, 'remove')).status, 200);
  assert.deepEqual(await s.list(), []);
  assert.equal(s.hub.store.db.prepare('SELECT count(*) AS n FROM label_photos').get().n, 0, 'photo removed with its label');
});
test('other accounts cannot open the module; bad input is rejected', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/api/deleted-labels', s.operator)).status, 403);
  assert.equal((await s.request('/deleted-labels', s.operator)).status, 403);
  for (const extra of [{photo: 'not-a-photo'}, {photo, text: 'x'.repeat(301)}, {photo, text: 5}, {photo, other: 1}, {photos: [photo]}]) {
    assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', {requestId: randomUUID(), ...extra})).status >= 400, true, JSON.stringify(extra).slice(0, 40));
  }
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'PUT', {})).status, 405);
});
test('labels marked deleted are pruned with their photo after 30 days; pending ones stay', async t => {
  const s = await setup(t);
  for (const text of ['Fictional A', 'Fictional B']) await s.request('/api/deleted-labels', s.lead, 'POST', {text, photo, requestId: randomUUID()});
  const done = (await s.list()).find(item => item.text === 'Fictional A');
  await s.change(done, s.admin, 'delete');
  s.clock.at += 31 * 86400000; s.hub.deletedLabels.prune();
  assert.deepEqual((await s.list()).map(item => item.text), ['Fictional B']);
  assert.equal(s.hub.store.db.prepare('SELECT count(*) AS n FROM label_photos').get().n, 1);
});
