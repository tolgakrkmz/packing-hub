const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const {photo} = require('./task-photo-fixture.cjs');
const password = 'Fictional-wall-password-123';
async function setup(t) {
  let time = Date.parse('2026-10-20T10:00:00Z');
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => time});
  // The admin running the wall has an explicit grant; other admins get nothing by default.
  await hub.auth.create('demo-admin', password, 'admin', null, {canViewWall: true, canPostWall: true, canReceiveWallPosts: true});
  await hub.auth.create('demo-admin-2', password, 'admin');
  await hub.auth.create('demo-lead', password, 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  await hub.auth.create('demo-lead-2', password, 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'Б'});
  await hub.auth.create('demo-operator', password, 'operator');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => { const logged = await hub.auth.login(name, password); return {...logged, cookie: 'hub-local-session=' + logged.token}; };
  const request = (route, user, method = 'GET', data) => fetch(base + route, {method, headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json'}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const [admin, lead, other, operator, plainAdmin] = await Promise.all(['demo-admin', 'demo-lead', 'demo-lead-2', 'demo-operator', 'demo-admin-2'].map(login));
  async function post(user, extra = {}) { const response = await request('/api/wall', user, 'POST', {requestId: randomUUID(), text: 'Fictional after-shift note', ...extra}); assert.equal(response.status, 201); return (await response.json()).id; }
  const feed = async (user, before) => (await request('/api/wall' + (before ? '?before=' + before : ''), user)).json();
  return {hub, admin, lead, other, operator, plainAdmin, request, post, feed, advance: ms => { time += ms; }};
}
test('shift leads and explicitly granted accounts use the wall; other operators and admins are refused', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/api/wall', s.operator)).status, 403);
  assert.equal((await s.request('/api/wall', s.plainAdmin)).status, 403);
  assert.equal((await s.request('/wall', s.plainAdmin)).status, 403);
  assert.equal((await s.request('/api/wall', s.operator, 'POST', {requestId: randomUUID(), text: 'x'})).status, 403);
  const id = await s.post(s.lead);
  const [item] = (await s.feed(s.admin)).items;
  assert.equal(item.id, id); assert.equal(item.author.username, 'demo-lead'); assert.equal(item.text, 'Fictional after-shift note');
  assert.equal((await s.request('/api/wall/' + id + '/reactions', s.operator, 'POST', {requestId: randomUUID(), kind: 'beer'})).status, 403);
});
test('a viewer without the post right can react but not post or comment', async t => {
  const s = await setup(t), id = await s.post(s.lead);
  const viewer = await s.hub.auth.create('demo-viewer', password, 'operator', null, {canViewWall: true});
  const user = {...await s.hub.auth.login(viewer.username, password)}; user.cookie = 'hub-local-session=' + user.token;
  assert.equal((await s.request('/api/wall/' + id + '/reactions', user, 'POST', {requestId: randomUUID(), kind: 'fire'})).status, 200);
  assert.equal((await s.request('/api/wall', user, 'POST', {requestId: randomUUID(), text: 'x'})).status, 403);
  assert.equal((await s.request('/api/wall/' + id + '/comments', user, 'POST', {requestId: randomUUID(), text: 'x'})).status, 403);
});
test('reactions toggle once per person and kind, and retries do not toggle back', async t => {
  const s = await setup(t), id = await s.post(s.lead), requestId = randomUUID();
  const react = (user, kind, key = randomUUID()) => s.request('/api/wall/' + id + '/reactions', user, 'POST', {requestId: key, kind});
  assert.deepEqual(await (await react(s.other, 'beer', requestId)).json(), {active: true});
  assert.deepEqual(await (await react(s.other, 'beer', requestId)).json(), {active: true}, 'replayed request');
  await react(s.admin, 'beer'); await react(s.other, 'laugh');
  let [item] = (await s.feed(s.other)).items;
  assert.deepEqual(item.reactions, {beer: 2, laugh: 1, fire: 0, like: 0}); assert.deepEqual(item.mine.sort(), ['beer', 'laugh']);
  assert.deepEqual(await (await react(s.other, 'beer')).json(), {active: false});
  [item] = (await s.feed(s.other)).items;
  assert.equal(item.reactions.beer, 1); assert.deepEqual(item.mine, ['laugh']);
  assert.equal((await react(s.other, 'heart')).status, 400);
});
test('authors delete their own posts and comments; only admins delete others', async t => {
  const s = await setup(t), id = await s.post(s.lead, {photo});
  const comment = await (await s.request('/api/wall/' + id + '/comments', s.other, 'POST', {requestId: randomUUID(), text: 'Fictional cheers'})).json();
  assert.equal((await s.request('/api/wall/' + id + '/comments/' + comment.id, s.lead, 'DELETE')).status, 403, 'post author cannot delete a comment by someone else');
  assert.equal((await s.request('/api/wall/' + id, s.other, 'DELETE')).status, 403);
  assert.equal((await s.request('/api/wall/' + id + '/comments/' + comment.id, s.other, 'DELETE')).status, 200);
  assert.equal((await s.feed(s.lead)).items[0].comments.length, 0);
  assert.equal((await s.request('/api/wall/' + id, s.lead, 'DELETE')).status, 200);
  assert.equal((await s.feed(s.lead)).items.length, 0);
  assert.equal(s.hub.store.db.prepare('SELECT count(*) AS n FROM wall_photos').get().n, 0, 'photo removed with its post');
  const second = await s.post(s.lead);
  await s.request('/api/wall/' + second + '/comments', s.lead, 'POST', {requestId: randomUUID(), text: 'Fictional own comment'});
  assert.equal((await s.request('/api/wall/' + second, s.admin, 'DELETE')).status, 200);
  assert.equal(s.hub.store.db.prepare('SELECT count(*) AS n FROM wall_comments').get().n, 0);
});
test('photos are validated, bounded and served only with their post', async t => {
  const s = await setup(t);
  for (const bad of [{photo: 'not-a-photo'}, {photo: 'A'.repeat(500000)}, {photos: [photo]}, {text: 'x'.repeat(501)}, {text: '   '}]) {
    assert.ok([400, 413].includes((await s.request('/api/wall', s.lead, 'POST', {requestId: randomUUID(), text: 'x', ...bad})).status), JSON.stringify(Object.keys(bad)));
  }
  const id = await s.post(s.lead, {text: '', photo});
  const [item] = (await s.feed(s.other)).items;
  assert.equal(item.photo.available, true);
  const response = await s.request('/api/wall/' + id + '/photos/' + item.photo.id, s.other);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal((await s.request('/api/wall/' + id + '/photos/' + item.photo.id, s.operator)).status, 403);
  const other = await s.post(s.lead);
  assert.equal((await s.request('/api/wall/' + other + '/photos/' + item.photo.id, s.other)).status, 404);
});
test('posts, comments, reactions and photos are removed after 90 days', async t => {
  const s = await setup(t), old = await s.post(s.lead, {photo});
  await s.request('/api/wall/' + old + '/comments', s.other, 'POST', {requestId: randomUUID(), text: 'Fictional'});
  await s.request('/api/wall/' + old + '/reactions', s.other, 'POST', {requestId: randomUUID(), kind: 'like'});
  s.advance(89 * 86400000); const recent = await s.post(s.other);
  assert.equal((await s.feed(s.lead)).items.length, 2);
  s.advance(2 * 86400000);
  assert.deepEqual((await s.feed(s.lead)).items.map(item => item.id), [recent]);
  for (const table of ['wall_comments', 'wall_reactions', 'wall_photos']) assert.equal(s.hub.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
});
test('the feed is newest first and paged; the new badge clears when the wall is opened', async t => {
  const s = await setup(t);
  for (let i = 0; i < 12; i++) { await s.post(s.lead, {text: 'Fictional ' + i}); s.advance(1000); }
  assert.deepEqual(await (await s.request('/api/wall/summary', s.other)).json(), {unread: 12});
  assert.deepEqual(await (await s.request('/api/wall/summary', s.lead)).json(), {unread: 0}, 'own posts are not new');
  const first = await s.feed(s.other);
  assert.equal(first.items.length, 10); assert.equal(first.items[0].text, 'Fictional 11'); assert.ok(first.nextBefore);
  const second = await s.feed(s.other, first.nextBefore);
  assert.deepEqual(second.items.map(item => item.text), ['Fictional 1', 'Fictional 0']); assert.equal(second.nextBefore, null);
  assert.deepEqual(await (await s.request('/api/wall/summary', s.other)).json(), {unread: 0});
  assert.equal((await s.request('/api/wall?before=abc', s.other)).status, 400);
});
test('a new post notifies other wall readers unless they turned it off', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/api/notifications/preferences', s.admin, 'PATCH', {wallPost: false})).status, 200);
  await s.post(s.lead); s.hub.notifications.sync();
  const types = async user => (await (await s.request('/api/notifications', user)).json()).items.map(item => item.type);
  assert.deepEqual(await types(s.other), ['wallPost']);
  assert.deepEqual(await types(s.lead), [], 'the author is not notified');
  assert.deepEqual(await types(s.admin), [], 'disabled by preference');
  assert.deepEqual(await types(s.operator), []);
  assert.deepEqual(await types(s.plainAdmin), [], 'admins without the wall get no wall notifications');
});
test('author avatars are readable on the wall without the accounts module', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/api/wall/authors/' + s.lead.user.id + '/avatar', s.other)).status, 404, 'not an author yet');
  await s.post(s.lead);
  assert.notEqual((await s.request('/api/wall/authors/' + s.lead.user.id + '/avatar', s.other)).status, 403);
  assert.equal((await s.request('/api/wall/authors/' + s.lead.user.id + '/avatar', s.operator)).status, 403);
});
test('each person adds at most 5 photo posts per day; text posts stay allowed', async t => {
  const s = await setup(t);
  for (let i = 0; i < 5; i++) await s.post(s.lead, {photo});
  const refused = await s.request('/api/wall', s.lead, 'POST', {requestId: randomUUID(), text: 'x', photo});
  assert.equal(refused.status, 429); assert.equal((await refused.json()).error, 'WALL_PHOTO_DAILY_LIMIT');
  await s.post(s.lead); await s.post(s.other, {photo});
  s.advance(86400000 + 1000); await s.post(s.lead, {photo});
});
test('wall photos have their own 200 MB budget, independent of task photos', async t => {
  const s = await setup(t), {LIMIT_BYTES} = require('../../server/wall.cjs');
  assert.equal(LIMIT_BYTES, 200 * 1024 * 1024);
  s.hub.store.db.prepare('INSERT INTO wall_photos(id,content,created_at) VALUES(?,zeroblob(?),?)').run(randomUUID(), LIMIT_BYTES, Date.now());
  assert.equal((await s.request('/api/wall', s.lead, 'POST', {requestId: randomUUID(), text: 'x', photo})).status, 507);
  assert.equal((await s.request('/api/wall', s.lead, 'POST', {requestId: randomUUID(), text: 'Fictional text only'})).status, 201);
});
test('an existing installation announces the wall once to shift leads only', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-wall-open-')), filename = path.join(dir, 'demo.sqlite');
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const start = () => createHubServer({filename, publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  let hub = start();
  const lead = await hub.auth.create('demo-lead', password, 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const operator = await hub.auth.create('demo-operator', password, 'operator');
  const inbox = id => hub.store.db.prepare('SELECT type FROM notifications WHERE user_id=?').all(id).map(row => row.type);
  assert.deepEqual(inbox(lead.id), [], 'a new installation sends nothing');
  hub.store.db.prepare("DELETE FROM notification_state WHERE key='wall:opened'").run(); // as before the wall existed
  await hub.close(); hub = start();
  assert.deepEqual(inbox(lead.id), ['wallOpened']); assert.deepEqual(inbox(operator.id), []);
  assert.equal(hub.store.db.prepare("SELECT count(*) AS n FROM push_queue").get().n, 0, 'no devices registered in this test');
  await hub.close(); hub = start();
  assert.deepEqual(inbox(lead.id), ['wallOpened'], 'sent only once'); await hub.close();
});
