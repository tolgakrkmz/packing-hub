/* Only generated images and fictional accounts; no production files are read. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createTasks} = require('../../server/tasks.cjs');
const {createHubServer} = require('../../server/server.cjs');
const {jpeg, afterMonths, MAX_BYTES} = require('../../server/task-photos.cjs');
const {snapshot} = require('../../server/backups.cjs');
const {photo} = require('./task-photo-fixture.cjs');
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-photo-demo-'));
  const filename = path.join(dir, 'demo.sqlite'), store = openStore(filename), auth = accounts(store);
  t.after(() => { store.close(); fs.rmSync(dir, {force: true, recursive: true}); });
  const admin = await auth.create('demo-photo-admin', 'Fictional-photo-password-123', 'admin');
  const owner = await auth.create('demo-photo-owner', 'Fictional-photo-password-123', 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  let at = Date.parse('2026-12-01T23:00:00+02:00');
  const tasks = createTasks(store, {now: () => at, photos: options});
  const input = (extra = {}) => ({requestId: randomUUID(), problemPhoto: photo, title: 'Fictional photo check', description: '', priority: 'normal', assigneeId: owner.id, participantIds: [], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', ...extra});
  const item = id => tasks.list(admin).items.find(item => item.id === id);
  const count = () => store.db.prepare('SELECT count(*) AS n FROM task_photos').get().n;
  const report = (id, status = 'review', extra = {}, revision = item(id).revision) => tasks.change(id, {action: 'report', status, note: 'Fictional report', solutionPhoto: photo, ...extra}, revision, owner);
  return {dir, filename, store, auth, admin, owner, tasks, input, item, count, report, time: value => { at = Date.parse(value); }};
}
test('creation and every report require an image; rejection rolls back task, history, audit and blobs', async t => {
  const f = await fixture(t);
  assert.throws(() => f.tasks.create(f.input({problemPhoto: null}), f.admin), {code: 'TASK_PHOTO_REQUIRED'});
  assert.equal(f.count(), 0); assert.equal(f.tasks.list(f.admin).items.length, 0);
  const {id} = f.tasks.create(f.input(), f.admin), before = f.item(id);
  for (const status of ['in-progress', 'blocked', 'review']) assert.throws(() => f.report(id, status, {solutionPhoto: null}), {code: 'TASK_PHOTO_REQUIRED'});
  assert.deepEqual(f.item(id), before); assert.equal(f.count(), 1);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM audit WHERE action='task-report'").get().n, 0);
  f.tasks.create(f.input({kind: 'shift', repeat: 'once', from: '2026-12-01'}), f.admin);
  const shift = f.tasks.list(f.admin).items.find(item => item.kind === 'shift');
  for (const status of ['completed', 'not-done', 'not-applicable']) assert.throws(() => f.report(shift.id, status, {solutionPhoto: null}), {code: 'TASK_PHOTO_REQUIRED'});
  assert.throws(() => f.tasks.create(f.input({dueDate: '2020-01-01'}), f.admin), {code: 'INVALID_TASK_DATE'});
  assert.equal(f.count(), 2);
});
test('JPEG validation rejects text, SVG, metadata, oversized dimensions, trailing bytes and truncated scans', () => {
  assert.deepEqual({width: jpeg(photo).width, height: jpeg(photo).height}, {width: 8, height: 8});
  const content = Buffer.from(photo, 'base64'), frame = content.indexOf(Buffer.from([0xff, 0xc0]));
  const huge = Buffer.from(content); huge.writeUInt16BE(1281, frame + 7);
  const metadata = Buffer.concat([content.subarray(0, 2), Buffer.from([0xff, 0xe1, 0, 8]), Buffer.from('Exif\0\0'), content.subarray(2)]);
  for (const invalid of ['!invalid!', Buffer.from('<svg/>').toString('base64'), Buffer.from('fictional text').toString('base64'), huge.toString('base64'), metadata.toString('base64'), content.subarray(0, -2).toString('base64'), Buffer.concat([content, Buffer.from('x')]).toString('base64'), Buffer.alloc(MAX_BYTES + 1).toString('base64')]) assert.throws(() => jpeg(invalid), {code: 'TASK_PHOTO_INVALID'});
});
test('accepted report retries preserve one photo and event after a lost response; changed retry or stale revision is refused', async t => {
  const f = await fixture(t), input = f.input(), {id} = f.tasks.create(input, f.admin);
  assert.deepEqual(f.tasks.create(input, f.admin), {id}); assert.equal(f.count(), 1);
  const request = {requestId: randomUUID(), action: 'report', status: 'review', note: 'Fictional resolution', solutionPhoto: photo};
  const first = f.tasks.change(id, request, 1, f.owner), retry = f.tasks.change(id, request, 1, f.owner);
  assert.deepEqual(retry, first); assert.equal(f.count(), 2); assert.equal(f.item(id).events.length, 2);
  assert.throws(() => f.tasks.change(id, {...request, note: 'Fictional changed result'}, 1, f.owner), {code: 'CONFLICT'});
  assert.throws(() => f.report(id, 'review', {}, 1), {code: 'CONFLICT'}); assert.equal(f.count(), 2);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM audit WHERE action='task-report'").get().n, 1);
  const cached = f.store.db.prepare('SELECT result FROM task_requests').all().map(row => row.result).join('');
  assert.ok(!cached.includes(photo)); assert.ok(!JSON.stringify(f.item(id)).includes(photo));
});
test('quota and disk reserve refuse the whole report and keep previous evidence; failed upload can be retried', async t => {
  let available = Infinity;
  const f = await fixture(t, {freeBytes: () => available}), {id} = f.tasks.create(f.input(), f.admin), before = f.item(id);
  available = 1;
  assert.throws(() => f.report(id), {code: 'TASK_PHOTO_STORAGE'}); assert.deepEqual(f.item(id), before); assert.equal(f.count(), 1);
  available = Infinity; f.report(id); assert.equal(f.count(), 2);
  const bytes = Buffer.from(photo, 'base64').length;
  const filler = Buffer.alloc(MAX_BYTES - bytes);
  f.store.db.prepare('INSERT INTO task_photos VALUES(?,?,?)').run(randomUUID(), filler, 0);
  // A separate active record references the quota fixture so cleanup retains it.
  const fillerId = f.store.db.prepare('SELECT id FROM task_photos WHERE created_at=0').get().id;
  const record = JSON.parse(f.store.db.prepare('SELECT data FROM task_items WHERE id=?').get(id).data);
  record.events.push({at: 0, photo: {id: fillerId}});
  f.store.db.prepare('UPDATE task_items SET data=? WHERE id=?').run(JSON.stringify(record), id);
  const limited = createTasks(f.store, {now: () => Date.parse('2026-12-01T23:00:00+02:00'), photos: {limitBytes: MAX_BYTES}});
  const revision = f.item(id).revision;
  assert.throws(() => limited.change(id, {action: 'report', status: 'review', note: 'Fictional quota test', solutionPhoto: photo}, revision, f.owner), {code: 'TASK_PHOTO_STORAGE'});
  assert.equal(f.item(id).revision, revision);
});
test('retention follows closure, keeps active and review evidence, preserves history and allows replacement after reopening', async t => {
  const f = await fixture(t), {id} = f.tasks.create(f.input(), f.admin);
  f.report(id); f.tasks.change(id, {action: 'approve'}, 2, f.admin);
  const closed = f.item(id), photoId = closed.problemPhoto.id;
  const active = f.tasks.create(f.input(), f.admin).id;
  f.report(active); // Ready for review stays active past six months.
  f.time('2027-06-01T22:59:59+02:00'); assert.equal(f.item(id).problemPhoto.available, true);
  f.time('2027-06-01T23:00:00+02:00'); f.tasks.maintain();
  assert.equal(f.item(id).problemPhoto.available, false); assert.equal(f.item(id).report.photo.available, false);
  assert.equal(f.item(id).events.length, closed.events.length); assert.equal(f.item(active).report.photo.available, true);
  assert.throws(() => f.tasks.photo('items', id, photoId, f.admin), {code: 'TASK_PHOTO_EXPIRED'});
  f.tasks.change(id, {action: 'reopen', note: 'Fictional reopened issue'}, 3, f.admin);
  assert.throws(() => f.report(id, 'review', {solutionPhoto: null}), {code: 'TASK_PHOTO_REQUIRED'});
  f.report(id); assert.equal(f.item(id).report.photo.available, true);
  assert.equal(afterMonths(Date.parse('2026-08-31T12:00:00Z'), 6), Date.parse('2027-02-28T12:00:00Z'));
});
test('reopening before expiration protects old evidence and starts a new retention period on the next closure', async t => {
  const f = await fixture(t), {id} = f.tasks.create(f.input(), f.admin); f.report(id); f.tasks.change(id, {action: 'approve'}, 2, f.admin);
  f.time('2027-05-01T23:00:00+02:00'); f.tasks.change(id, {action: 'reopen', note: 'Fictional reopened issue'}, 3, f.admin);
  f.time('2027-07-01T23:00:00+02:00'); assert.equal(f.item(id).events[1].photo.available, true);
  f.report(id); f.tasks.change(id, {action: 'approve'}, 5, f.admin);
  f.time('2027-12-01T23:00:00+02:00'); assert.equal(f.item(id).events[1].photo.available, true);
  f.time('2028-01-01T23:00:00+02:00'); assert.equal(f.item(id).events[1].photo.available, false);
});
test('recurring shifts share problem storage, retain earlier edited snapshots, and keep evidence for unfinished shifts', async t => {
  const f = await fixture(t), {id} = f.tasks.create(f.input({kind: 'shift', repeat: 'every-shift', from: '2026-12-01', until: '2026-12-05'}), f.admin);
  const first = f.tasks.list(f.admin).items[0], original = first.problemPhoto.id;
  f.tasks.change(id, {...f.input(), action: 'edit', note: 'Fictional revised problem'}, 1, f.admin, true);
  assert.equal(f.count(), 2);
  f.time('2026-12-02T23:00:00+02:00'); const items = f.tasks.list(f.admin).items;
  assert.equal(items[0].problemPhoto.id, original); assert.notEqual(items[1].problemPhoto.id, original); assert.equal(f.count(), 2);
  f.tasks.change(id, {action: 'stop', note: 'Fictional stopped plan'}, 2, f.admin, true);
  f.time('2027-12-03T23:00:00+02:00'); assert.equal(f.item(first.id).problemPhoto.available, true);
  for (const item of f.tasks.list(f.admin).items) f.report(item.id, 'not-applicable');
  f.time('2028-06-04T23:00:00+02:00'); f.tasks.maintain(); assert.equal(f.count(), 0);
});
test('legacy tasks remain readable; review approval requires fresh evidence, and additive photo storage survives snapshots', async t => {
  const f = await fixture(t), {id} = f.tasks.create(f.input(), f.admin);
  const legacy = JSON.parse(f.store.db.prepare('SELECT data FROM task_items WHERE id=?').get(id).data);
  delete legacy.problemPhoto; delete legacy.events[0].snapshot.problemPhoto; legacy.status = 'review'; legacy.report = {at: 1, status: 'review'};
  f.store.db.prepare('UPDATE task_items SET data=? WHERE id=?').run(JSON.stringify(legacy), id);
  assert.equal(f.item(id).problemPhoto, null); assert.throws(() => f.tasks.change(id, {action: 'approve'}, 1, f.admin), {code: 'TASK_PHOTO_REQUIRED'});
  f.tasks.change(id, {action: 'return', note: 'Fictional request for photo'}, 1, f.admin); f.report(id);
  const copy = path.join(f.dir, 'snapshot.sqlite'); snapshot(f.filename, copy);
  const restored = openStore(copy); t.after(() => restored.close());
  const restoredTasks = createTasks(restored, {now: () => Date.parse('2026-12-02T23:00:00+02:00')});
  assert.deepEqual(restoredTasks.photo('items', id, f.item(id).report.photo.id, f.admin), Buffer.from(photo, 'base64'));
});
test('photo HTTP reads enforce sessions, task visibility, permissions, association and private response headers', async t => {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => Date.parse('2026-12-01T23:00:00+02:00')});
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const password = 'Fictional-photo-password-123', admin = await hub.auth.create('demo-http-photo-admin', password, 'admin');
  const owner = await hub.auth.create('demo-http-photo-owner', password, 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const other = await hub.auth.create('demo-http-photo-other', password, 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'Б'});
  const denied = await hub.auth.create('demo-http-photo-denied', password, 'observer');
  const {id} = hub.tasks.create({requestId: randomUUID(), problemPhoto: photo, title: 'Fictional HTTP photo task', description: '', priority: 'normal', assigneeId: owner.id, participantIds: [], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00'}, admin);
  const photoId = hub.tasks.list(admin).items[0].problemPhoto.id, base = 'http://127.0.0.1:' + hub.server.address().port;
  const route = '/api/tasks/items/' + id + '/photos/' + photoId;
  assert.equal((await fetch(base + route)).status, 401);
  for (const [user, status] of [[owner, 200], [admin, 200], [other, 403], [denied, 403]]) {
    const session = await hub.auth.login(user.username, password), headers = {Cookie: 'hub-local-session=' + session.token};
    const response = await fetch(base + route, {headers}); assert.equal(response.status, status);
    if (status === 200) {
      assert.equal(response.headers.get('content-type'), 'image/jpeg'); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(photo, 'base64'));
      assert.equal((await fetch(base + route, {method: 'HEAD', headers})).status, 200);
      assert.equal((await fetch(base + route.replace(photoId, randomUUID()), {headers})).status, 404);
    }
    if (user === owner) { await hub.auth.update(user.id, {permissions: {canViewTasks: false}}, admin); assert.equal((await fetch(base + route, {headers})).status, 401); }
  }
});
