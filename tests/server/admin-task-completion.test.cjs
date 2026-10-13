/* Isolated database, fictional accounts and a generated image only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createTasks} = require('../../server/tasks.cjs');
const {photo} = require('./task-photo-fixture.cjs');

async function fixture(t) {
  const store = openStore(':memory:'); t.after(() => store.close());
  const auth = accounts(store), password = 'Fictional-completion-password-123';
  const admin = await auth.create('demo-completion-admin', password, 'admin');
  const owner = await auth.create('demo-completion-owner', password, 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  let at = Date.parse('2026-12-01T23:00:00+02:00');
  const tasks = createTasks(store, {now: () => at});
  const create = (extra = {}) => tasks.create({requestId: randomUUID(), problemPhotos: [photo, photo], title: 'Fictional admin completion', description: '', priority: 'normal', assigneeId: owner.id, participantIds: [], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', ...extra}, admin).id;
  const item = id => tasks.list(admin).items.find(item => item.id === id);
  return {store, auth, admin, owner, tasks, create, item, time: value => { at = Date.parse(value); }};
}

test('admin completes required-photo global and started shift tasks without changing their photo policy', async t => {
  const f = await fixture(t);
  for (const extra of [{}, {kind: 'shift', repeat: 'once', from: '2026-12-01'}]) {
    const id = f.create(extra);
    f.tasks.change(id, {action: 'complete', note: ''}, 1, f.admin);
    const item = f.item(id);
    assert.equal(item.status, 'completed'); assert.equal(item.requiresPhotos, true);
    assert.equal(item.closedAt, Date.parse('2026-12-01T23:00:00+02:00'));
    assert.equal(item.report.actor.id, f.admin.id); assert.equal(item.report.status, 'completed');
    assert.deepEqual(item.report.photos, []);
    assert.equal(item.events.at(-1).action, 'complete'); assert.equal(item.events.at(-1).actor.id, f.admin.id);
    assert.equal(f.tasks.summary(f.owner).count, 0);
  }
});

test('admin completion saves optional photos and retains earlier reports in history', async t => {
  const f = await fixture(t), id = f.create();
  f.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional earlier result', solutionPhotos: [photo, photo]}, 1, f.owner);
  const prior = f.item(id).report;
  f.tasks.change(id, {action: 'complete', note: 'Fictional admin result', solutionPhotos: [photo]}, 2, f.admin);
  const item = f.item(id);
  assert.equal(item.status, 'completed'); assert.equal(item.report.photos.length, 1);
  assert.equal(item.events.at(-1).photos[0].id, item.report.photos[0].id);
  assert.equal(item.events[1].photos[0].id, prior.photos[0].id);
  assert.deepEqual(f.tasks.photo('items', id, item.report.photo.id, f.owner), Buffer.from(photo, 'base64'));
  assert.deepEqual(f.tasks.photo('items', id, prior.photo.id, f.admin), Buffer.from(photo, 'base64'));
});

test('completion retries write one event and photo; changed requests and stale revisions conflict', async t => {
  const f = await fixture(t), id = f.create();
  const input = {action: 'complete', requestId: randomUUID(), solutionPhotos: [photo]};
  const first = f.tasks.change(id, input, 1, f.admin);
  assert.deepEqual(f.tasks.change(id, input, 1, f.admin), first);
  assert.equal(f.item(id).events.length, 2);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM task_photos').get().n, 3);
  assert.throws(() => f.tasks.change(id, {...input, note: 'Fictional changed retry'}, 1, f.admin), {code: 'CONFLICT'});
  assert.throws(() => f.tasks.change(id, {action: 'complete'}, 1, f.admin), {code: 'CONFLICT'});
  assert.throws(() => f.tasks.change(id, {action: 'complete'}, 2, f.admin), {code: 'TASK_STATE'});
});

test('non-admin delegated managers and reviewers cannot complete or bypass required owner photos', async t => {
  const f = await fixture(t), id = f.create();
  for (const role of ['operator', 'observer']) {
    const user = await f.auth.create('demo-complete-' + role, 'Fictional-completion-password-123', role, f.admin, {canViewTasks: true, canManageTasks: true, canReviewTasks: true});
    assert.throws(() => f.tasks.change(id, {action: 'complete', role: 'admin', actor: f.admin, solutionPhotos: []}, 1, user), {code: 'FORBIDDEN'});
  }
  assert.throws(() => f.tasks.change(id, {action: 'complete'}, 1, f.owner), {code: 'FORBIDDEN'});
  assert.throws(() => f.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional result', solutionPhotos: []}, 1, f.owner), {code: 'TASK_PHOTO_REQUIRED'});
  assert.throws(() => f.tasks.change(id, {action: 'complete'}, 1, {...f.admin, permissionOverrides: {canManageTasks: false}}), {code: 'FORBIDDEN'});
  assert.throws(() => f.tasks.change(id, {action: 'complete'}, 1, {...f.admin, permissionOverrides: {canViewTasks: false}}), {code: 'FORBIDDEN'});
  assert.equal(f.item(id).revision, 1);
});

test('invalid optional uploads roll back completion, audit, history and photos', async t => {
  const f = await fixture(t), id = f.create(), before = f.item(id);
  const audits = () => f.store.db.prepare('SELECT count(*) AS n FROM audit').get().n;
  const count = audits();
  assert.throws(() => f.tasks.change(id, {action: 'complete', solutionPhotos: [photo, 'invalid']}, 1, f.admin), {code: 'TASK_PHOTO_INVALID'});
  assert.deepEqual(f.item(id), before); assert.equal(audits(), count);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM task_photos').get().n, 2);
});

test('completion preserves shift start, cancellation and recurring schedule boundaries', async t => {
  const f = await fixture(t), future = f.create({kind: 'shift', repeat: 'once', from: '2026-12-02'});
  assert.throws(() => f.tasks.change(future, {action: 'complete'}, 1, f.admin), {code: 'TASK_NOT_STARTED'});
  const cancelled = f.create(); f.tasks.change(cancelled, {action: 'cancel', note: 'Fictional cancellation'}, 1, f.admin);
  assert.throws(() => f.tasks.change(cancelled, {action: 'complete'}, 2, f.admin), {code: 'TASK_STATE'});
  const recurring = f.create({kind: 'shift', repeat: 'every-shift', from: '2026-12-01', until: '2026-12-05'});
  assert.throws(() => f.tasks.change(recurring, {action: 'complete'}, 1, f.admin, true), {code: 'INVALID_TASK'});
  const occurrence = f.tasks.list(f.admin).items.find(item => item.scheduleId === recurring);
  f.time('2026-12-02T07:00:00+02:00');
  f.tasks.change(occurrence.id, {action: 'complete'}, 1, f.admin);
  assert.equal(f.item(occurrence.id).report.late, true);
  assert.equal(f.tasks.list(f.admin).schedules.find(item => item.id === recurring).stoppedAt, null);
});
