/* Fictional accounts, generated images and isolated SQLite only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createTasks} = require('../../server/tasks.cjs');
const {createNotifications} = require('../../server/notifications.cjs');
const {photo} = require('./task-photo-fixture.cjs');

async function fixture(t) {
  const store = openStore(':memory:'), auth = accounts(store);
  const password = 'Fictional-transfer-password-123';
  const admin = await auth.create('demo-transfer-admin', password, 'admin');
  const owner = await auth.create('demo-transfer-owner', password, 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const other = await auth.create('demo-transfer-other', password, 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'Б'});
  let at = Date.parse('2026-12-01T23:00:00+02:00');
  const tasks = createTasks(store, {now: () => at}), inbox = createNotifications(store, {now: () => at, taskNow: () => at});
  t.after(async () => { await inbox.close(); store.close(); });
  const input = (extra = {}) => ({requestId: randomUUID(), title: 'Fictional transfer task', description: 'Fictional handover', priority: 'high', problemPhotos: [photo], assigneeId: owner.id, participantIds: [], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', ...extra});
  const create = extra => tasks.create(input(extra), admin).id;
  const item = id => tasks.list(admin).items.find(item => item.id === id);
  const transfer = (id, extra = {}, revision = item(id).revision, user = admin) => tasks.change(id, {action: 'transfer', assigneeId: other.id, note: 'Fictional responsibility handover', ...extra}, revision, user);
  return {store, auth, admin, owner, other, tasks, inbox, input, create, item, transfer, time: value => { at = Date.parse(value); }};
}

test('transfer replaces the owner, keeps task content and records both owners with the reason', async t => {
  const f = await fixture(t), id = f.create({participantIds: [f.other.id]}), before = f.item(id);
  f.transfer(id);
  const item = f.item(id);
  assert.equal(item.owner.id, f.other.id); assert.deepEqual(item.participants, []);
  for (const key of ['id', 'title', 'description', 'priority', 'due', 'createdAt', 'requiresPhotos', 'problemPhotos']) assert.deepEqual(item[key], before[key]);
  assert.equal(item.status, 'pending'); assert.equal(item.report, null); assert.equal(item.revision, 2);
  const event = item.events.at(-1);
  assert.equal(event.action, 'transfer'); assert.equal(event.actor.id, f.admin.id);
  assert.equal(event.transfer.from.id, f.owner.id); assert.equal(event.transfer.to.id, f.other.id);
  assert.equal(event.note, 'Fictional responsibility handover'); assert.equal(event.at, Date.parse('2026-12-01T23:00:00+02:00'));
  assert.equal(f.tasks.list(f.owner).items.length, 0); assert.equal(f.tasks.summary(f.owner).count, 0);
  assert.equal(f.tasks.list(f.other).items[0].id, id); assert.equal(f.tasks.summary(f.other).count, 1);
  assert.throws(() => f.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional stale owner', solutionPhotos: [photo]}, 2, f.owner), {code: 'FORBIDDEN'});
  f.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional new owner result', solutionPhotos: [photo]}, 2, f.other);
  assert.equal(f.item(id).report.actor.id, f.other.id);
});

test('transfer resets review while keeping earlier report photos accessible in history', async t => {
  const f = await fixture(t), id = f.create();
  f.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional prior result', solutionPhotos: [photo]}, 1, f.owner);
  const before = f.item(id), photoId = before.report.photo.id;
  f.time('2026-12-04T12:00:00+02:00'); f.transfer(id);
  const item = f.item(id);
  assert.equal(item.due, before.due); assert.equal(item.status, 'pending'); assert.equal(item.report, null);
  assert.equal(item.events[1].actor.id, f.owner.id); assert.equal(item.events[1].photos[0].id, photoId);
  assert.deepEqual(f.tasks.photo('items', id, photoId, f.other), Buffer.from(photo, 'base64'));
  assert.equal(f.tasks.summary(f.admin).count, 0);
  assert.throws(() => f.tasks.change(id, {action: 'approve'}, 3, f.admin), {code: 'TASK_STATE'});
  assert.throws(() => f.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional missing evidence'}, 3, f.other), {code: 'TASK_PHOTO_REQUIRED'});
});

test('shift handover preserves the original shift across teams and leaves recurring future assignments alone', async t => {
  const f = await fixture(t), scheduleId = f.create({kind: 'shift', repeat: 'every-shift', from: '2026-12-01', until: '2026-12-05'});
  const occurrence = f.tasks.list(f.admin).items.find(item => item.scheduleId === scheduleId);
  f.transfer(occurrence.id);
  const item = f.item(occurrence.id); assert.equal(item.owner.team, 'Б'); assert.deepEqual(item.shift, occurrence.shift); assert.equal(item.due, occurrence.due);
  assert.equal(f.tasks.list(f.admin).schedules[0].owner.id, f.owner.id);
  f.time('2026-12-05T23:00:00+02:00');
  const future = f.tasks.list(f.admin).items.filter(item => item.scheduleId === scheduleId && item.id !== occurrence.id);
  assert.ok(future.length > 0); assert.ok(future.every(item => item.owner.id === f.owner.id));
  assert.throws(() => f.tasks.change(scheduleId, {action: 'transfer', assigneeId: f.other.id, note: 'Fictional unsupported template transfer'}, 1, f.admin, true), {code: 'INVALID_TASK'});
});

test('only admins can transfer, including through ordinary edit and delegated management rights', async t => {
  const f = await fixture(t), id = f.create();
  const manager = await f.auth.create('demo-transfer-manager', 'Fictional-transfer-password-123', 'operator', f.admin, {canViewTasks: true, canManageTasks: true, canReviewTasks: true});
  for (const user of [manager, f.owner, f.other, {...f.admin, permissionOverrides: {canManageTasks: false}}, {...f.admin, permissionOverrides: {canViewTasks: false}}]) {
    assert.throws(() => f.transfer(id, {role: 'admin', actor: f.admin}, 1, user), {code: 'FORBIDDEN'});
  }
  assert.throws(() => f.tasks.change(id, {...f.input({assigneeId: f.other.id}), action: 'edit', note: 'Fictional edit bypass'}, 1, manager), {code: 'FORBIDDEN'});
  const shift = f.create({kind: 'shift', repeat: 'once', from: '2026-12-02'});
  assert.throws(() => f.tasks.change(shift, {...f.input({assigneeId: f.other.id}), action: 'edit', note: 'Fictional shift edit bypass'}, 1, manager), {code: 'FORBIDDEN'});
  const schedule = f.create({kind: 'shift', repeat: 'every-shift', from: '2026-12-01', until: '2026-12-05'});
  assert.throws(() => f.tasks.change(schedule, {...f.input({assigneeId: f.other.id}), action: 'edit', note: 'Fictional schedule edit bypass'}, 1, manager, true), {code: 'FORBIDDEN'});
  assert.equal(f.item(id).revision, 1);
});

test('invalid targets, missing reasons and closed tasks do not change tasks or audit history', async t => {
  const f = await fixture(t), id = f.create(), before = f.item(id);
  const auditCount = () => f.store.db.prepare("SELECT count(*) AS n FROM audit WHERE module='tasks'").get().n, audits = auditCount();
  for (const assigneeId of [f.owner.id, f.admin.id, -1, '2', null]) assert.throws(() => f.transfer(id, {assigneeId}), {code: 'INVALID_TASK_ASSIGNEE'});
  assert.throws(() => f.transfer(id, {note: '  '}), {code: 'TASK_REASON'});
  const denied = await f.auth.update(f.other.id, {permissions: {canReportTasks: false}}, f.admin);
  assert.throws(() => f.transfer(id), {code: 'INVALID_TASK_ASSIGNEE'});
  assert.deepEqual(f.item(id), before); assert.equal(auditCount(), audits);
  await f.auth.update(denied.id, {permissions: {canReportTasks: true}}, f.admin);
  f.tasks.change(id, {action: 'cancel', note: 'Fictional cancellation'}, 1, f.admin);
  assert.throws(() => f.transfer(id), {code: 'TASK_STATE'});
  const completed = f.create(); f.tasks.change(completed, {action: 'complete'}, 1, f.admin);
  assert.throws(() => f.transfer(completed), {code: 'TASK_STATE'});
});

test('accepted handover retries are idempotent and changed retries or stale versions conflict', async t => {
  const f = await fixture(t), id = f.create(), input = {requestId: randomUUID()};
  const first = f.transfer(id, input, 1);
  assert.deepEqual(f.transfer(id, input, 1), first);
  assert.equal(f.item(id).events.length, 2); assert.equal(f.item(id).revision, 2);
  assert.throws(() => f.transfer(id, {...input, note: 'Fictional changed retry'}, 1), {code: 'CONFLICT'});
  assert.throws(() => f.transfer(id, {assigneeId: f.owner.id}, 1), {code: 'CONFLICT'});
});

test('new owner receives the assignment and overdue reminder once after handover', async t => {
  const f = await fixture(t), id = f.create();
  f.time('2026-12-04T12:00:00+02:00'); f.inbox.sync();
  f.transfer(id); f.inbox.sync(); f.inbox.sync();
  const notifications = f.inbox.list(f.other).items;
  assert.equal(notifications.filter(item => item.type === 'taskAssigned').length, 1);
  assert.equal(notifications.filter(item => item.type === 'taskOverdue').length, 1);
  assert.ok(notifications.every(item => item.href === '/tasks?target=' + id));
  assert.equal(f.inbox.list(f.owner).items.length, 0);
});

test('eligible admin transferring a task to themselves still receives its assignment notification', async t => {
  const f = await fixture(t), id = f.create();
  const admin = await f.auth.update(f.admin.id, {taskSupervisor: true, taskTeam: 'А'}, f.admin);
  f.inbox.sync(); f.transfer(id, {assigneeId: admin.id}, 1, admin); f.inbox.sync(); f.inbox.sync();
  const assigned = f.inbox.list(admin).items.filter(item => item.type === 'taskAssigned');
  assert.equal(assigned.length, 1); assert.equal(assigned[0].href, '/tasks?target=' + id);
});

test('a handover during the final half hour renews the due-soon reminder for the new owner', async t => {
  const f = await fixture(t), id = f.create();
  f.time('2026-12-03T16:30:00+02:00'); f.inbox.sync();
  assert.equal(f.inbox.list(f.owner).items.filter(item => item.type === 'taskDue').length, 1);
  f.time('2026-12-03T16:40:00+02:00'); f.transfer(id); f.inbox.sync(); f.inbox.sync();
  const notices = f.inbox.list(f.other).items;
  assert.equal(notices.filter(item => item.type === 'taskDue').length, 1);
  assert.equal(notices.filter(item => item.type === 'taskAssigned').length, 1);
});

test('admin can recover an assignment from a disabled former owner without changing its history', async t => {
  const f = await fixture(t), id = f.create();
  await f.auth.update(f.owner.id, {active: false}, f.admin);
  f.transfer(id);
  assert.equal(f.item(id).owner.id, f.other.id);
  assert.equal(f.item(id).events[0].snapshot.owner.id, f.owner.id);
  assert.equal(f.item(id).events.at(-1).transfer.from.id, f.owner.id);
});
