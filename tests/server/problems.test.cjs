const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const {photo} = require('./task-photo-fixture.cjs');
const password = 'Fictional-problems-password-123';
async function setup(t) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  for (const role of ['admin', 'operator', 'observer']) await hub.auth.create('demo-' + role, password, role);
  await hub.auth.create('demo-operator-2', password, 'operator');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => { const logged = await hub.auth.login(name, password); return {...logged, cookie: 'hub-local-session=' + logged.token}; };
  const request = (route, user, method = 'GET', data, headers = {}) => fetch(base + route, {method, headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', ...headers}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const [admin, operator, other, observer] = await Promise.all(['demo-admin', 'demo-operator', 'demo-operator-2', 'demo-observer'].map(login));
  const payload = (extra = {}) => ({requestId: randomUUID(), title: 'Fictional pallet supply gap', description: 'Fictional description', impactLevel: 'high', impact: 'Fictional 120 min per month', dependsOn: 'Fictional logistics', ...extra});
  async function create(user = admin, data = payload()) { const response = await request('/api/problems', user, 'POST', data); assert.equal(response.status, 201); return (await response.json()).id; }
  const find = async (id, user = admin) => (await (await request('/api/problems', user)).json()).items.find(item => item.id === id);
  const change = (id, user, data, revision) => request('/api/problems/' + id, user, 'PATCH', data, {'If-Match': '"' + revision + '"'});
  return {hub, admin, operator, other, observer, login, request, payload, create, find, change};
}
test('the column follows proposals and resolution', async t => {
  const s = await setup(t), id = await s.create(s.operator);
  assert.equal((await s.find(id, s.observer)).stage, 'open');
  assert.equal((await s.change(id, s.other, {action: 'propose', text: 'Fictional buffer stock'}, 1)).status, 200);
  assert.equal((await s.find(id)).stage, 'proposed');
  assert.equal((await s.change(id, s.operator, {action: 'resolve'}, 2)).status, 200);
  const resolved = await s.find(id);
  assert.equal(resolved.stage, 'resolved'); assert.ok(resolved.resolvedAt);
  assert.equal((await s.change(id, s.operator, {action: 'propose', text: 'Fictional late idea'}, 3)).status, 409);
  assert.equal((await s.change(id, s.operator, {action: 'resolve'}, 3)).status, 409);
  assert.equal((await s.change(id, s.admin, {action: 'reopen'}, 3)).status, 200);
  const reopened = await s.find(id);
  assert.equal(reopened.stage, 'proposed'); assert.deepEqual(reopened.events.map(entry => entry.action), ['created', 'propose', 'resolve', 'reopen']);
});
test('authors and managers edit and resolve; others only propose; observers only read', async t => {
  const s = await setup(t), id = await s.create(s.operator);
  assert.equal((await s.request('/api/problems', s.observer, 'POST', s.payload())).status, 403);
  assert.equal((await s.change(id, s.observer, {action: 'propose', text: 'Fictional'}, 1)).status, 403);
  assert.equal((await s.change(id, s.other, {...s.payload(), action: 'edit'}, 1)).status, 403);
  assert.equal((await s.change(id, s.other, {action: 'resolve'}, 1)).status, 403);
  assert.equal((await s.change(id, s.operator, {...s.payload({title: 'Fictional edited by author'}), action: 'edit'}, 1)).status, 200);
  assert.equal((await s.change(id, s.admin, {...s.payload({title: 'Fictional edited by admin'}), action: 'edit'}, 2)).status, 200);
  assert.equal((await s.find(id)).title, 'Fictional edited by admin');
});
test('revisions, retries and input are checked at the server boundary', async t => {
  const s = await setup(t), id = await s.create();
  const input = {action: 'propose', text: 'Fictional retry', requestId: randomUUID()};
  assert.equal((await s.change(id, s.admin, input, 9)).status, 409);
  const first = await s.change(id, s.admin, input, 1); assert.equal(first.status, 200);
  const retry = await s.change(id, s.admin, input, 1); assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), await first.json());
  assert.equal((await s.find(id)).proposals.length, 1);
  for (const extra of [{title: ' '}, {impactLevel: 'huge'}, {title: 'x'.repeat(181)}, {dependsOn: 'x'.repeat(161)}, {requestId: 'not-a-uuid'}]) {
    assert.equal((await s.request('/api/problems', s.admin, 'POST', s.payload(extra))).status, 400, JSON.stringify(Object.keys(extra)));
  }
  assert.equal((await s.change(id, s.admin, {action: 'propose', text: ' '}, 2)).status, 400);
  assert.equal((await s.change(id, s.admin, {action: 'unknown'}, 2)).status, 400);
  assert.equal((await s.request('/api/problems', s.admin, 'PUT', {})).status, 405);
  assert.equal((await s.change(randomUUID(), s.admin, {action: 'resolve'}, 1)).status, 404);
});
test('problem and proposal photos are stored apart from tasks, readable by viewers and pruned when removed', async t => {
  const s = await setup(t), id = await s.create(s.operator, s.payload({photos: [photo]}));
  const other = await s.create(s.operator);
  let item = await s.find(id, s.observer);
  assert.equal(item.photos.length, 1); assert.equal(item.photos[0].available, true);
  const url = '/api/problems/' + id + '/photos/' + item.photos[0].id;
  const image = await s.request(url, s.observer);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal((await s.request('/api/problems/' + other + '/photos/' + item.photos[0].id, s.observer)).status, 404, 'photos are tied to their problem');
  s.hub.tasks.maintain();
  assert.equal((await s.request(url, s.observer)).status, 200, 'task photo cleanup leaves problem photos alone');
  assert.equal((await s.change(id, s.other, {action: 'propose', text: 'Fictional fix with photos', photos: [photo, photo]}, 1)).status, 200);
  item = await s.find(id);
  assert.equal(item.proposals[0].photos.length, 2);
  assert.equal((await s.request('/api/problems/' + id + '/photos/' + item.proposals[0].photos[1].id, s.observer)).status, 200);
  assert.equal((await s.change(id, s.operator, {...s.payload({photos: [{id: item.photos[0].id}]}), action: 'edit'}, 2)).status, 200, 'existing photos are kept by id');
  assert.equal((await s.request(url, s.admin)).status, 200);
  assert.equal((await s.change(id, s.operator, {...s.payload({photos: []}), action: 'edit'}, 3)).status, 200);
  assert.equal((await s.request(url, s.admin)).status, 404, 'removed photos are deleted');
  assert.equal(s.hub.store.db.prepare('SELECT count(*) AS count FROM problem_photos').get().count, 2);
  assert.equal((await s.request('/api/problems', s.admin, 'POST', s.payload({photos: ['not-a-photo']}))).status, 400);
  assert.equal((await s.request('/api/problems', s.admin, 'POST', s.payload({photos: Array(11).fill(photo)}))).status, 400);
});
test('optional English versions are stored with the problem and proposals; only authors and managers translate proposals', async t => {
  const s = await setup(t);
  const id = await s.create(s.operator, s.payload({titleEn: 'Fictional pallet gap EN', descriptionEn: 'Fictional EN description', impactEn: 'Fictional 120 min', dependsOnEn: 'Fictional logistics EN'}));
  let item = await s.find(id, s.observer);
  assert.deepEqual([item.titleEn, item.descriptionEn, item.impactEn, item.dependsOnEn], ['Fictional pallet gap EN', 'Fictional EN description', 'Fictional 120 min', 'Fictional logistics EN']);
  assert.equal((await s.change(id, s.other, {action: 'propose', text: 'Fictional BG idea', textEn: 'Fictional EN idea'}, 1)).status, 200);
  assert.equal((await s.change(id, s.other, {action: 'propose', text: 'Fictional second idea'}, 2)).status, 200);
  item = await s.find(id);
  assert.deepEqual(item.proposals.map(entry => entry.textEn), ['Fictional EN idea', '']);
  const second = item.proposals[1].id;
  assert.equal((await s.change(id, s.operator, {action: 'translate', proposalId: second, textEn: 'Fictional'}, 3)).status, 403, 'problem author is not the proposal author');
  assert.equal((await s.change(id, s.other, {action: 'translate', proposalId: second, textEn: 'Fictional second EN'}, 3)).status, 200);
  assert.equal((await s.change(id, s.admin, {action: 'resolve'}, 4)).status, 200);
  assert.equal((await s.change(id, s.admin, {action: 'translate', proposalId: second, textEn: 'Fictional admin EN'}, 5)).status, 200, 'resolved problems can still be prepared for meetings');
  assert.equal((await s.change(id, s.admin, {action: 'translate', proposalId: 'missing', textEn: 'Fictional'}, 6)).status, 400);
  assert.equal((await s.request('/api/problems', s.admin, 'POST', s.payload({titleEn: 'x'.repeat(181)}))).status, 400);
  assert.equal((await s.find(id)).proposals[1].textEn, 'Fictional admin EN');
  const author = s.hub.auth.list().find(user => user.username === 'demo-operator-2');
  await s.hub.auth.update(author.id, {permissions: {canCreateProblems: false}}, s.hub.auth.list().find(user => user.username === 'demo-admin'));
  const revoked = await s.login('demo-operator-2');
  assert.equal((await s.change(id, revoked, {action: 'translate', proposalId: second, textEn: 'Fictional after revoke'}, 6)).status, 403, 'authors need the create right to translate');
});
