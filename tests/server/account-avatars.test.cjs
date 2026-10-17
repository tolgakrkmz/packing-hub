/* All identities, credentials and images in this suite are fictional. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHubServer} = require('../../server/server.cjs');
const {photo} = require('./task-photo-fixture.cjs');
const password = 'Fictional-avatar-pass-123';
async function setup(t) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  await hub.auth.create('demo-admin', password, 'admin');
  await hub.auth.create('demo-reader', password, 'observer');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  t.after(() => hub.close());
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  async function login(username) {
    const response = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({username, password})});
    assert.equal(response.status, 200);
    const result = await response.json();
    return {cookie: response.headers.get('set-cookie').split(';')[0], csrf: result.csrf, user: result.user};
  }
  async function request(route, user, options = {}) {
    const headers = {Origin: base, ...(user ? {Cookie: user.cookie, 'X-CSRF-Token': user.csrf} : {}), ...options.headers};
    if (options.data !== undefined) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.data); }
    return fetch(base + route, {...options, headers, redirect: 'manual'});
  }
  const session = async user => (await (await request('/api/session', user)).json()).user;
  return {hub, base, login, request, session};
}
// Rewrites the frame width so the image is no longer square; the structure stays valid.
function wide(source) {
  const content = Buffer.from(source, 'base64');
  const frame = content.indexOf(Buffer.from([0xff, 0xc0]));
  content.writeUInt16BE(16, frame + 7);
  return content.toString('base64');
}
test('the owner uploads, reads, replaces and removes a profile photo', async t => {
  const {login, request, session} = await setup(t);
  const reader = await login('demo-reader');
  assert.equal((await session(reader)).avatar, null);
  assert.equal((await request('/api/account/avatar', reader)).status, 404);
  const saved = await request('/api/account/avatar', reader, {method: 'PUT', data: {photo}});
  assert.equal(saved.status, 200);
  const {avatar} = await saved.json();
  assert.ok(Number.isSafeInteger(avatar));
  assert.equal((await session(reader)).avatar, avatar);
  const image = await request('/api/account/avatar', reader);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(photo, 'base64'));
  const replaced = await (await request('/api/account/avatar', reader, {method: 'PUT', data: {photo}})).json();
  assert.ok(replaced.avatar > avatar);
  const removed = await request('/api/account/avatar', reader, {method: 'DELETE'});
  assert.deepEqual(await removed.json(), {avatar: null});
  assert.equal((await session(reader)).avatar, null);
  assert.equal((await request('/api/account/avatar', reader)).status, 404);
});
test('profile photos stay private to their owner and require a valid session and CSRF token', async t => {
  const {hub, login, request} = await setup(t);
  const admin = await login('demo-admin'), reader = await login('demo-reader');
  assert.equal((await request('/api/account/avatar', reader, {method: 'PUT', data: {photo}})).status, 200);
  assert.equal((await request('/api/account/avatar', admin)).status, 404);
  assert.equal((await request('/api/account/avatar', null)).status, 401);
  assert.equal((await request('/api/account/avatar', {...reader, csrf: 'wrong'}, {method: 'DELETE'})).status, 403);
  assert.equal((await request('/api/account/avatar', reader, {method: 'PUT', data: {photo}, headers: {Origin: 'http://example.test'}})).status, 403);
  assert.equal((await request('/api/account/avatar', reader, {method: 'POST', data: {photo}})).status, 405);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM user_avatars').get().n, 1);
});
test('invalid, oversized and non-square images are rejected without storing anything', async t => {
  const {hub, login, request} = await setup(t);
  const reader = await login('demo-reader');
  for (const [data, status] of [[{photo: 'not-a-photo'}, 400], [{photo: Buffer.from('fictional text').toString('base64')}, 400], [{photo: wide(photo)}, 400], [{photo, extra: true}, 400], [{}, 400], [{photo: 'A'.repeat(100 * 1024)}, 413]]) {
    const response = await request('/api/account/avatar', reader, {method: 'PUT', data});
    assert.equal(response.status, status, JSON.stringify(data).slice(0, 40));
  }
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM user_avatars').get().n, 0);
});
test('a temporary password blocks the photo and deleting an account removes it', async t => {
  const {hub, login, request} = await setup(t);
  const admin = await login('demo-admin');
  const created = await (await request('/api/accounts', admin, {method: 'POST', data: {username: 'demo-temporary', password, role: 'operator'}})).json();
  const temporary = await login('demo-temporary');
  const blocked = await request('/api/account/avatar', temporary, {method: 'PUT', data: {photo}});
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, 'PASSWORD_CHANGE_REQUIRED');
  const reader = await login('demo-reader');
  assert.equal((await request('/api/account/avatar', reader, {method: 'PUT', data: {photo}})).status, 200);
  const readerId = hub.store.db.prepare("SELECT id FROM users WHERE username='demo-reader'").get().id;
  assert.equal((await request('/api/accounts/' + readerId, admin, {method: 'DELETE', data: {}})).status, 200);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM user_avatars').get().n, 0);
  assert.ok(created.user.id);
});
test('the account page is available to every signed-in account', async t => {
  const {login, request} = await setup(t);
  const reader = await login('demo-reader');
  const page = await request('/account', reader);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /server-connection\.js/);
  assert.equal((await request('/account', null)).status, 302);
});
test('account managers see listed photo versions and read photos only with the view-accounts right', async t => {
  const {hub, login, request} = await setup(t);
  const admin = await login('demo-admin'), reader = await login('demo-reader');
  assert.equal((await request('/api/account/avatar', reader, {method: 'PUT', data: {photo}})).status, 200);
  const readerId = hub.store.db.prepare("SELECT id FROM users WHERE username='demo-reader'").get().id;
  const adminId = hub.store.db.prepare("SELECT id FROM users WHERE username='demo-admin'").get().id;
  const {users} = await (await request('/api/accounts', admin)).json();
  assert.ok(Number.isSafeInteger(users.find(user => user.id === readerId).avatar));
  assert.equal(users.find(user => user.id === adminId).avatar, null);
  const image = await request('/api/accounts/' + readerId + '/avatar', admin);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(photo, 'base64'));
  assert.equal((await request('/api/accounts/' + adminId + '/avatar', admin)).status, 404);
  assert.equal((await request('/api/accounts/999/avatar', admin)).status, 404);
  assert.equal((await request('/api/accounts/' + readerId + '/avatar', reader)).status, 403);
  assert.equal((await request('/api/accounts/' + readerId + '/avatar', null)).status, 401);
  assert.equal((await request('/api/accounts/' + readerId + '/avatar', admin, {method: 'DELETE'})).status, 405);
  const patched = await (await request('/api/accounts/' + readerId, admin, {method: 'PATCH', data: {active: true}})).json();
  assert.ok(Number.isSafeInteger(patched.user.avatar));
  assert.equal((await request('/api/accounts/' + readerId, admin, {method: 'DELETE', data: {}})).status, 200);
  assert.equal((await request('/api/accounts/' + readerId + '/avatar', admin)).status, 404);
});
