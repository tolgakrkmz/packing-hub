const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const {photo} = require('./task-photo-fixture.cjs');
const password = 'Fictional-labels-password-123';
const fields = {palletNo: 'PA00000001', productionOrder: 'DP0000001_00001', customer: 'Fictional Customer Ltd', grossWt: '120', netWt: '110', length: '3000', pieces: '50'};
async function setup(t, clock = {at: Date.parse('2026-10-26T08:00:00Z')}) {
  const reads = [];
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => clock.at, labelReader: async jpeg => { reads.push(jpeg.length); return {...fields, palletNo: 'PA00000001'}; }});
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
  return {hub, clock, admin, lead, operator, request, list, change, reads};
}
test('a shift lead adds a label only with a photo; a manager marks it deleted, undoes and removes it', async t => {
  const s = await setup(t);
  const read = await s.request('/api/deleted-labels/read', s.lead, 'POST', {photo});
  assert.equal(read.status, 200); assert.deepEqual((await read.json()).fields, fields);
  assert.equal(s.reads.length, 1); assert.deepEqual(await s.list(), [], 'reading saves nothing');
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', {fields, requestId: randomUUID()})).status, 400, 'photo is required');
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', {photo, fields: {...fields, palletNo: ' '}, requestId: randomUUID()})).status, 400, 'pallet is required');
  const input = {text: 'Fictional label 4521', photo, fields: {...fields, palletNo: 'PA00000002'}, requestId: randomUUID()};
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', input)).status, 201);
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', input)).status, 201); // retry with the same id adds nothing
  let [item] = await s.list();
  assert.equal((await s.list()).length, 1);
  assert.deepEqual([item.text, item.status, item.createdBy.username, item.photo.available], ['Fictional label 4521', 'pending', 'demo-lead', true]);
  assert.deepEqual(item.fields, {...fields, palletNo: 'PA00000002'}, 'the checked pallet replaces the read one');
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
  assert.equal((await s.request('/api/deleted-labels/read', s.operator, 'POST', {photo})).status, 403);
  assert.equal((await s.request('/api/deleted-labels/read', s.lead, 'POST', {photo: 'not-a-photo'})).status, 400);
  assert.equal((await s.request('/api/deleted-labels/read', s.lead, 'POST', {photo: 'A'.repeat(2100000)})).status, 413, 'reading copy is bounded');
  assert.equal((await s.request('/deleted-labels', s.operator)).status, 403);
  for (const extra of [{photo: 'not-a-photo', fields}, {photo, fields, text: 'x'.repeat(301)}, {photo, fields, text: 5}, {photo, fields, other: 1}, {photos: [photo], fields}, {photo, fields: {...fields, extra: '1'}}, {photo, fields: {...fields, customer: 'x'.repeat(121)}}, {photo, fields: {...fields, pieces: 5}}]) {
    assert.equal((await s.request('/api/deleted-labels', s.lead, 'POST', {requestId: randomUUID(), ...extra})).status >= 400, true, JSON.stringify(extra).slice(0, 40));
  }
  assert.equal((await s.request('/api/deleted-labels', s.lead, 'PUT', {})).status, 405);
});
test('a deleted label loses its photo after 7 days and its record after a year; pending ones stay', async t => {
  const s = await setup(t);
  for (const palletNo of ['PA00000011', 'PA00000012']) await s.request('/api/deleted-labels', s.lead, 'POST', {photo, fields: {...fields, palletNo}, requestId: randomUUID()});
  const done = (await s.list()).find(item => item.fields.palletNo === 'PA00000011');
  await s.change(done, s.admin, 'delete');
  s.clock.at += 8 * 86400000; s.hub.deletedLabels.prune();
  const kept = (await s.list()).find(item => item.fields.palletNo === 'PA00000011');
  assert.deepEqual([kept.status, kept.photo.available], ['deleted', false], 'record stays searchable without the photo');
  assert.equal(s.hub.store.db.prepare('SELECT count(*) AS n FROM label_photos').get().n, 1);
  s.clock.at += 360 * 86400000; s.hub.deletedLabels.prune();
  assert.deepEqual((await s.list()).map(item => item.fields.palletNo), ['PA00000012']);
});
test('a pallet waits only once, typed spacing and case do not matter, and photos are cacheable', async t => {
  const s = await setup(t);
  const add = palletNo => s.request('/api/deleted-labels', s.lead, 'POST', {photo, fields: {...fields, palletNo}, requestId: randomUUID()});
  assert.equal((await add(' pa 00000021 ')).status, 201);
  const [item] = await s.list();
  assert.equal(item.fields.palletNo, 'PA00000021', 'pallet is stored without spaces in capitals');
  const duplicate = await add('PA00000021');
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).error, 'LABEL_DUPLICATE');
  await s.change(item, s.admin, 'delete');
  assert.equal((await add('PA00000021')).status, 201, 'a new wrong label is allowed once the old one is deleted');
  const image = await s.request('/api/deleted-labels/' + item.id + '/photos/' + item.photo.id, s.lead);
  assert.match(image.headers.get('cache-control'), /private.*immutable/);
});
