const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHubServer} = require('../../server/server.cjs');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createTasks} = require('../../server/tasks.cjs');
const {createNotifications} = require('../../server/notifications.cjs');
const {createWebPush, endpointURL} = require('../../server/web-push.cjs');
const {types, available} = require('../../js/notification-model.js');
const permissions = require('../../server/permissions.cjs');
const password = 'Fictional-notification-password-123';
const report = id => ({id, date: '2026-10-05', shift: 'А', tonnage: 1000, brak: 0});
function pushConfig(fetcher = async () => ({status: 201})) {
  const {privateKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  return {privateKey: JSON.stringify(privateKey.export({format: 'jwk'})), subject: 'mailto:demo@example.test', fetcher};
}
function subscription(name = 'demo') {
  const key = crypto.createECDH('prime256v1'); key.generateKeys();
  return {endpoint: 'https://fcm.googleapis.com/fcm/send/' + name, keys: {p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url')}};
}
async function model(t, options = {}) {
  let time = Date.parse('2026-10-10T12:00:00+03:00');
  const store = openStore(options.filename || ':memory:'), auth = accounts(store), tasks = createTasks(store, {now: () => time});
  const inbox = createNotifications(store, {now: () => time, taskNow: () => time, ...options});
  const admin = await auth.create('demo-admin', password, 'admin');
  const chief = await auth.create('demo-chief', password, 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const viewer = await auth.create('demo-viewer', password, 'observer', admin);
  t.after(async () => { await inbox.close(); store.close(); });
  const payload = extra => ({requestId: crypto.randomUUID(), title: 'Fictional task', description: '', priority: 'normal', requiresPhotos: false, assigneeId: chief.id, participantIds: [], kind: 'global', dueDate: '2026-10-10', dueTime: '17:00', ...extra});
  return {store, auth, tasks, inbox, admin, chief, viewer, payload, time: value => { time = Date.parse(value); }};
}
test('every important event has an editable flag; notification flags never grant module access', () => {
  for (const type of Object.values(types)) assert.ok(permissions.keys.includes(type.flag));
  const user = {role: 'observer', permissionOverrides: {canReceiveProductionAdded: true, canViewProduction: false}};
  assert.equal(available('productionAdded', user, permissions), false);
  assert.equal(permissions.canViewModule(user, 'production-log'), false);
  assert.equal(available('taskReview', {role: 'observer'}, permissions), false);
});
test('new tonnage, corrections, no-op saves, explicit recipient flags and preferences are independent', async t => {
  const s = await model(t);
  const viewer = await s.auth.update(s.viewer.id, {permissions: {canReceiveProductionAdded: true}}, s.admin);
  s.store.put('production-log', {entries: [report('demo-row')], goalTons: 3000}, 1, s.admin); s.inbox.sync(); s.inbox.sync();
  assert.deepEqual(s.inbox.list(viewer).items.map(item => item.type), ['productionAdded']);
  assert.equal(s.inbox.list(s.chief).count, 0);
  s.store.put('production-log', {entries: [{...report('demo-row'), tonnage: 2000}], goalTons: 3000}, 2, s.admin); s.inbox.sync();
  assert.equal(s.inbox.list(viewer).count, 1); assert.equal(s.inbox.list(s.admin).items[0].type, 'productionChanged');
  const current = s.store.get('production-log'); s.store.put('production-log', current.data, current.revision, s.admin); s.inbox.sync(); assert.equal(s.inbox.list(s.admin).count, 2);
  s.inbox.updatePreferences({productionAdded: false}, viewer);
  const next = s.store.get('production-log'); s.store.put('production-log', {...next.data, entries: [...next.data.entries, report('demo-row-2')]}, next.revision, s.admin); s.inbox.sync(); assert.equal(s.inbox.list(viewer).count, 1);
  assert.throws(() => s.inbox.updatePreferences({systemDisk: true}, viewer), {code: 'INVALID_DATA'});
  const blocked = await s.auth.update(viewer.id, {permissions: {canViewProduction: false, canReceiveProductionAdded: true}}, s.admin); assert.equal(s.inbox.list(blocked).count, 0);
});
test('task assignment, reporting, review and outcome go only to entitled recipients', async t => {
  const s = await model(t);
  const request = s.payload(); const {id} = s.tasks.create(request, s.admin); s.tasks.create(request, s.admin); s.inbox.sync();
  assert.equal(s.inbox.list(s.chief).count, 1); assert.equal(s.inbox.list(s.viewer).count, 0);
  s.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional report'}, 1, s.chief); s.inbox.sync();
  assert.deepEqual(new Set(s.inbox.list(s.admin).items.map(item => item.type)), new Set(['taskReview', 'taskReport']));
  assert.equal(s.inbox.list(s.chief).count, 1);
  s.tasks.change(id, {action: 'return', note: 'Fictional correction'}, 2, s.admin); s.inbox.sync(); assert.equal(s.inbox.list(s.chief).items[0].type, 'taskChanged');
  s.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional report'}, 3, s.chief); s.inbox.sync();
  s.tasks.change(id, {action: 'approve'}, 4, s.admin); s.inbox.sync(); assert.equal(s.inbox.list(s.chief).items[0].type, 'taskOutcome');
  const restricted = await s.auth.update(s.chief.id, {permissions: {canViewTasks: false}}, s.admin); assert.equal(s.inbox.list(restricted).count, 0);
});
test('deadline reminders run without a browser, deduplicate and do not repeat after retention', async t => {
  const s = await model(t); s.tasks.create(s.payload(), s.admin); s.inbox.sync();
  s.time('2026-10-10T16:31:00+03:00'); s.inbox.sync(); s.inbox.sync(); assert.equal(s.inbox.list(s.chief).items.filter(item => item.type === 'taskDue').length, 1);
  s.time('2026-10-10T17:01:00+03:00'); s.inbox.sync(); s.inbox.sync(); assert.equal(s.inbox.list(s.chief).items.filter(item => item.type === 'taskOverdue').length, 1);
  s.time('2027-02-01T12:00:00+02:00'); s.inbox.sync(); s.inbox.sync(); assert.equal(s.inbox.list(s.chief).count, 0);
});
test('system component warnings, recovery and flags do not repeat on unchanged checks', async t => {
  const s = await model(t), healthy = {state: 'ok', database: {state: 'ok'}, disk: {state: 'ok'}, backups: {state: 'ok'}, secondary: {state: 'ok'}, updates: {state: 'ok'}, manual: {state: 'idle'}};
  s.inbox.systemStatus(healthy); assert.equal(s.inbox.list(s.admin).count, 0);
  const warned = {...healthy, state: 'warning', disk: {state: 'warning'}};
  s.inbox.systemStatus(warned); s.inbox.systemStatus(warned); assert.equal(s.inbox.list(s.admin).count, 1); assert.equal(s.inbox.list(s.admin).items[0].type, 'systemDisk');
  s.inbox.systemStatus(healthy); assert.equal(s.inbox.list(s.admin).items[0].type, 'systemRecovery'); assert.equal(s.inbox.list(s.viewer).count, 0);
});
test('VAPID signature verifies and the outgoing request contains no notification payload', async () => {
  let captured;
  const config = pushConfig(async (endpoint, options) => { captured = {endpoint, options}; return {status: 201}; });
  const transport = createWebPush({...config, now: () => 1000000}); await transport.send('https://fcm.googleapis.com/fcm/send/demo');
  assert.equal(captured.options.body, ''); assert.equal(captured.options.headers['Content-Length'], '0'); assert.equal(captured.options.redirect, 'error');
  const token = captured.options.headers.Authorization.match(/t=([^,]+)/)[1], [header, body, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')), {aud: 'https://fcm.googleapis.com', exp: 4600, sub: 'mailto:demo@example.test'});
  const key = crypto.createPublicKey(crypto.createPrivateKey({key: JSON.parse(config.privateKey), format: 'jwk'}));
  assert.equal(crypto.verify('sha256', Buffer.from(header + '.' + body), {key, dsaEncoding: 'ieee-p1363'}, Buffer.from(signature, 'base64url')), true);
});
test('subscription endpoints reject arbitrary hosts, HTTP, credentials and alternate ports', () => {
  for (const value of ['http://fcm.googleapis.com/demo', 'https://127.0.0.1/demo', 'https://example.test/demo', 'https://fcm.googleapis.com:8443/demo', 'https://user@fcm.googleapis.com/demo', 'https://fcm.googleapis.com.evil.test/demo', 'https://fcm.googleapis.com/demo#fragment']) assert.throws(() => endpointURL(value), {code: 'INVALID_SUBSCRIPTION'});
  for (const value of ['https://fcm.googleapis.com/demo', 'https://web.push.apple.com/demo', 'https://updates.push.services.mozilla.com/demo']) assert.ok(endpointURL(value));
});
test('retry queue survives transient failures; expired endpoints and account/logout revocation remove subscriptions', async t => {
  let status = 503, sent = 0;
  const s = await model(t, {push: pushConfig(async () => { sent++; return {status}; })});
  const session = await s.auth.login('demo-admin', password), hash = crypto.createHash('sha256').update(session.token).digest('hex'), device = subscription();
  s.inbox.subscribe(device, s.admin, hash);
  s.store.put('production-log', {entries: [report('demo-row')], goalTons: 3000}, 1, s.admin); s.inbox.sync(); await s.inbox.flush();
  assert.equal(sent, 1); assert.equal(s.store.db.prepare('SELECT attempts FROM push_queue').get().attempts, 1);
  await s.inbox.flush(); assert.equal(sent, 1);
  s.time('2026-10-10T12:01:00+03:00'); status = 410; await s.inbox.flush(); assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
  s.inbox.subscribe(device, s.admin, hash); s.auth.logout(session.token); assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
  const next = await s.auth.login('demo-admin', password); s.inbox.subscribe(device, s.admin, crypto.createHash('sha256').update(next.token).digest('hex'));
  await s.auth.update(s.admin.id, {permissions: {canReceiveProductionAdded: false}}, s.admin); assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
});
test('read ownership, durable event cursor, pagination and restart do not leak or duplicate inbox rows', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-notice-demo-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const filename = path.join(dir, 'demo.sqlite'); let store = openStore(filename), auth = accounts(store), tasks = createTasks(store), inbox = createNotifications(store);
  const admin = await auth.create('demo-admin', password, 'admin'), other = await auth.create('demo-other', password, 'admin');
  store.put('production-log', {entries: [report('demo-row')], goalTons: 3000}, 1, admin); inbox.sync(); const id = inbox.list(admin).items[0].id;
  inbox.read({id}, other); assert.equal(inbox.list(admin).count, 1); store.close();
  store = openStore(filename); tasks = createTasks(store); inbox = createNotifications(store); inbox.sync(); assert.equal(inbox.list(admin).count, 1);
  for (let i = 0; i < 55; i++) store.audit(admin, 'write', 'production-log', {added: true}); inbox.sync();
  const first = inbox.list(admin), second = inbox.list(admin, first.nextBefore); assert.equal(first.items.length, 50); assert.equal(second.items.length, 6);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 56); inbox.read({id: 'all'}, admin); assert.equal(inbox.list(admin).count, 0); store.close();
});
test('HTTP inbox routes enforce login, CSRF, module rights, methods and current device ownership', async t => {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, notifications: {push: pushConfig()}});
  await hub.auth.create('demo-admin', password, 'admin'); await hub.auth.create('demo-viewer', password, 'observer');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port, login = await hub.auth.login('demo-admin', password);
  const request = (route, method = 'GET', data, extra = {}) => fetch(base + route, {method, headers: {Origin: base, Cookie: 'hub-local-session=' + login.token, 'X-CSRF-Token': login.csrf, 'Content-Type': 'application/json', ...extra}, ...(data ? {body: JSON.stringify(data)} : {})});
  assert.equal((await fetch(base + '/api/notifications')).status, 401);
  assert.equal((await request('/api/notifications/read', 'POST', {id: 'all'}, {'X-CSRF-Token': ''})).status, 403);
  assert.equal((await request('/api/notifications/preferences', 'POST', {})).status, 405);
  const device = subscription('demo-http'); assert.equal((await request('/api/notifications/subscriptions', 'POST', device)).status, 201);
  assert.equal((await request('/api/notifications/device', 'POST', {endpoint: device.endpoint})).status, 200);
  assert.equal((await request('/api/notifications/test', 'POST', {endpoint: device.endpoint}, {'X-CSRF-Token': ''})).status, 403);
  assert.equal((await request('/api/notifications/test', 'GET')).status, 405);
  const publicWorker = await fetch(base + '/js/notification-worker.js'); assert.equal(publicWorker.headers.get('service-worker-allowed'), '/');
  assert.equal((await fetch(base + '/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  await hub.auth.update(login.user.id, {permissions: {canViewNotifications: false}}, login.user);
  const fresh = await hub.auth.login('demo-admin', password);
  assert.equal((await request('/api/notifications', 'GET', null, {Cookie: 'hub-local-session=' + fresh.token})).status, 403);
  assert.equal((await request('/notifications', 'GET', null, {Cookie: 'hub-local-session=' + fresh.token})).status, 403);
});
test('revocation during a pending push prevents the next device from receiving any request', async t => {
  let release, started; const began = new Promise(resolve => { started = resolve; });
  const s = await model(t, {push: pushConfig(async () => { started(); return new Promise(resolve => { release = () => resolve({status: 201}); }); })});
  const session = await s.auth.login('demo-admin', password), hash = crypto.createHash('sha256').update(session.token).digest('hex');
  s.inbox.subscribe(subscription('demo-first'), s.admin, hash); s.inbox.subscribe(subscription('demo-second'), s.admin, hash);
  s.store.put('production-log', {entries: [report('demo-race')], goalTons: 3000}, 1, s.admin); s.inbox.sync();
  const work = s.inbox.flush(); await began;
  await s.auth.update(s.admin.id, {permissions: {canReceiveProductionAdded: false}}, s.admin);
  release(); await work; assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM push_queue').get().n, 0);
});
test('restoring a private snapshot revokes its device subscriptions and retry queue', async t => {
  const {snapshot} = require('../../server/backups.cjs'), {restoreArchive} = require('../../server/restore.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-notice-restore-demo-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await model(t, {filename: path.join(dir, 'demo.sqlite'), push: pushConfig()});
  const session = await s.auth.login('demo-admin', password); s.inbox.subscribe(subscription(), s.admin, crypto.createHash('sha256').update(session.token).digest('hex'));
  s.store.put('production-log', {entries: [report('demo-restore')], goalTons: 3000}, 1, s.admin); s.inbox.sync();
  const archive = path.join(dir, 'archive.sqlite'), recovered = path.join(dir, 'recovered'); snapshot(path.join(dir, 'demo.sqlite'), archive); restoreArchive(archive, recovered);
  const {DatabaseSync} = require('node:sqlite'), db = new DatabaseSync(path.join(recovered, 'hub.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_queue').get().n, 0); db.close();
});
test('local signing configuration never overwrites a file and stores the generated key privately', t => {
  const {configure} = require('../../scripts/configure-push.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-vapid-demo-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, '.env.push'); configure(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600); assert.throws(() => configure(file)); assert.throws(() => configure(path.join(dir, 'public.js')));
  const value = fs.readFileSync(file, 'utf8').match(/HUB_PUSH_PRIVATE_JWK='([^']+)'/)[1]; assert.equal(crypto.createPrivateKey({key: JSON.parse(value), format: 'jwk'}).asymmetricKeyType, 'ec');
});
test('device inspection binds an existing opt-in to the current login without reviving a revoked subscription', async t => {
  const s = await model(t, {push: pushConfig()}), device = subscription('demo-rebind');
  const first = await s.auth.login('demo-admin', password), digest = token => crypto.createHash('sha256').update(token).digest('hex');
  s.inbox.subscribe(device, s.admin, digest(first.token));
  const next = await s.auth.login('demo-admin', password);
  assert.equal(s.inbox.device({endpoint: device.endpoint}, s.viewer, digest(next.token)).subscribed, false);
  assert.equal(s.inbox.device({endpoint: device.endpoint}, s.admin, digest(next.token)).subscribed, true);
  s.auth.logout(next.token); assert.equal(s.inbox.device({endpoint: device.endpoint}, s.admin, digest(first.token)).subscribed, false);
});
test('device opt-in and category choices survive session expiry, next-day login and a database restart with stable signing keys', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-notice-persistence-demo-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const filename = path.join(dir, 'demo.sqlite'), push = pushConfig(), device = subscription('demo-persistent'), digest = token => crypto.createHash('sha256').update(token).digest('hex');
  let store = openStore(filename), auth = accounts(store); createTasks(store);
  let inbox = createNotifications(store, {push});
  try {
    const admin = await auth.create('demo-persistent', password, 'admin'), first = await auth.login(admin.username, password);
    inbox.subscribe(device, admin, digest(first.token)); inbox.updatePreferences({productionAdded: false, productionChanged: true}, admin);
    store.db.prepare('UPDATE sessions SET expires=? WHERE user_id=?').run(Date.now() - 86400000, admin.id);
    assert.equal(auth.session(first.token), null); assert.equal(inbox.device({endpoint: device.endpoint}, admin).subscribed, true);
    await inbox.close(); store.close();
    store = openStore(filename); auth = accounts(store); createTasks(store); inbox = createNotifications(store, {push});
    const next = await auth.login(admin.username, password);
    assert.equal(auth.session(first.token), null); assert.equal(inbox.device({endpoint: device.endpoint}, next.user, digest(next.token)).subscribed, true);
    const saved = Object.fromEntries(inbox.preferences(next.user).types.map(type => [type.key, type.enabled]));
    assert.equal(saved.productionAdded, false); assert.equal(saved.productionChanged, true);
    auth.logout(next.token); assert.equal(inbox.device({endpoint: device.endpoint}, next.user).subscribed, false);
    assert.equal(inbox.preferences(next.user).types.find(type => type.key === 'productionAdded').enabled, false);
  } finally { await inbox.close(); store.close(); }
});
test('device test sends only to an owned allowed device, throttles retries and creates no production or inbox records', async t => {
  let status = 201, sent = 0;
  const s = await model(t, {push: pushConfig(async () => { sent++; return {status}; })}), device = subscription('demo-test');
  const other = await s.auth.create('demo-test-other', password, 'admin');
  s.inbox.subscribe(device, s.admin, 'demo-session');
  await assert.rejects(s.inbox.testDevice({endpoint: device.endpoint}, other), {code: 'DEVICE_NOT_SUBSCRIBED'});
  assert.equal(sent, 0);
  assert.deepEqual(await s.inbox.testDevice({endpoint: device.endpoint}, s.admin), {ok: true});
  await assert.rejects(s.inbox.testDevice({endpoint: device.endpoint}, s.admin), {code: 'RATE_LIMITED'});
  assert.equal(sent, 1); assert.equal(s.inbox.list(s.admin).count, 0); assert.equal(s.store.get('production-log').data.entries.length, 0);
  s.time('2026-10-10T12:01:00+03:00'); status = 410;
  await assert.rejects(s.inbox.testDevice({endpoint: device.endpoint}, s.admin), {code: 'DEVICE_NOT_SUBSCRIBED'});
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
  s.inbox.subscribe(device, s.admin, 'demo-session'); status = 503;
  await assert.rejects(s.inbox.testDevice({endpoint: device.endpoint}, s.admin), {code: 'PUSH_DELIVERY_FAILED'});
  s.inbox.updatePreferences(Object.fromEntries(s.inbox.preferences(s.admin).types.map(type => [type.key, false])), s.admin);
  await assert.rejects(s.inbox.testDevice({endpoint: device.endpoint}, s.admin), {code: 'FORBIDDEN'});
});
