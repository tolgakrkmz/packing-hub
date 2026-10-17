/* All identities and credentials in this suite are fictional. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {openStore} = require('../../server/store.cjs');
const {accounts, SESSION_IDLE} = require('../../server/accounts.cjs');
const password = 'Fictional-lifecycle-password-123';
function setup(t) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  return {store, auth: accounts(store)};
}
test('session expires at its exact deadline and expired credentials cannot be revived by a fresh login', async t => {
  const {auth} = setup(t);
  await auth.create('demo-expiry', password, 'observer');
  const first = await auth.login('demo-expiry', password);
  t.mock.timers.enable({apis: ['Date'], now: first.expires - 1});
  assert.equal(auth.session(first.token).user.username, 'demo-expiry');
  t.mock.timers.tick(1);
  assert.equal(auth.session(first.token), null);
  const next = await auth.login('demo-expiry', password);
  assert.notEqual(next.token, first.token);
  assert.notEqual(next.csrf, first.csrf);
  assert.equal(auth.session(first.token), null);
  assert.ok(auth.session(next.token));
  for (const token of [undefined, '', 'fictional-invalid-token', 'x'.repeat(101)]) assert.equal(auth.session(token), null);
});
test('logout closes only the selected session and repeating it adds no duplicate logout event', async t => {
  const {store, auth} = setup(t);
  await auth.create('demo-two-sessions', password, 'operator');
  const first = await auth.login('demo-two-sessions', password), second = await auth.login('demo-two-sessions', password);
  auth.logout(first.token); auth.logout(first.token);
  assert.equal(auth.session(first.token), null);
  assert.equal(auth.session(second.token).csrf, second.csrf);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='logout'").get().n, 1);
});
for (const action of ['disable', 'delete']) test('an in-flight login cannot create a session after account ' + action, async t => {
  const {store, auth} = setup(t);
  const admin = await auth.create('demo-lifecycle-admin', password, 'admin');
  const user = await auth.create('demo-lifecycle-reader', password, 'observer');
  // Password verification yields to scrypt. The administrative mutation completes
  // synchronously before that verification can create a session; no timing sleep.
  const pending = auth.login(user.username, password);
  if (action === 'disable') await auth.update(user.id, {active: false}, admin);
  else auth.remove(user.id, admin);
  await assert.rejects(pending, {code: 'INVALID_LOGIN'});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='login'").get().n, 0);
});
test('a concurrent permission change defeats a stale password update without losing the newer restriction', async t => {
  const {auth} = setup(t);
  const admin = await auth.create('demo-update-admin', password, 'admin');
  const user = await auth.create('demo-update-reader', password, 'observer');
  const session = await auth.login(user.username, password);
  const pending = auth.update(user.id, {password: 'Fictional-replacement-password-123'}, admin);
  await auth.update(user.id, {permissions: {canViewProduction: false}}, admin);
  await assert.rejects(pending, {code: 'CONFLICT'});
  assert.equal(auth.session(session.token), null);
  const fresh = await auth.login(user.username, password);
  assert.equal(fresh.user.permissions.canViewProduction, false);
  await assert.rejects(auth.login(user.username, 'Fictional-replacement-password-123'), {code: 'INVALID_LOGIN'});
});
test('password replacement revokes every old session and accepts only the replacement credential', async t => {
  const {auth} = setup(t);
  const user = await auth.create('demo-password-reader', password, 'observer');
  const first = await auth.login(user.username, password), second = await auth.login(user.username, password);
  const replacement = 'Fictional-next-password-456';
  await auth.update(user.id, {password: replacement}, {role: 'admin'});
  for (const session of [first, second]) assert.equal(auth.session(session.token), null);
  await assert.rejects(auth.login(user.username, password), {code: 'INVALID_LOGIN'});
  assert.ok(auth.session((await auth.login(user.username, replacement)).token));
});
test('use slides the idle deadline at most hourly and never revives an expired session', async t => {
  const {auth} = setup(t);
  await auth.create('demo-idle', password, 'observer');
  const issued = await auth.login('demo-idle', password);
  t.mock.timers.enable({apis: ['Date'], now: Date.now()});
  t.mock.timers.tick(30 * 60000);
  assert.equal(auth.touch(issued.token), false);
  t.mock.timers.tick(31 * 60000);
  assert.equal(auth.touch(issued.token), true);
  assert.equal(auth.session(issued.token).expires, Date.now() + SESSION_IDLE);
  t.mock.timers.tick(SESSION_IDLE);
  assert.equal(auth.touch(issued.token), false);
  assert.equal(auth.session(issued.token), null);
  for (const token of [undefined, 'fictional-invalid-token', 'x'.repeat(101)]) assert.equal(auth.touch(token), false);
});
