const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {createHubServer} = require('../../server/server.cjs');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createTasks} = require('../../server/tasks.cjs');
const password = 'Fictional-tasks-password-123';
async function setup(t, filename = ':memory:') {
  let time = Date.parse('2026-12-01T07:00:00+02:00');
  const hub = createHubServer({filename, publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => time});
  for (const role of ['admin', 'operator', 'observer']) await hub.auth.create('demo-' + role, password, role);
  for (const [name, team] of [['demo-chief-a', 'А'], ['demo-chief-b', 'Б'], ['demo-chief-c', 'В']]) await hub.auth.create(name, password, 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: team});
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  async function login(name = 'demo-admin') {
    const logged = await hub.auth.login(name, password); return {...logged, cookie: 'hub-local-session=' + logged.token};
  }
  const request = (route, user, method = 'GET', data, headers = {}) => fetch(base + route, {method, redirect: 'manual', headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', ...headers}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const admin = await login(), chief = await login('demo-chief-a'), other = await login('demo-chief-b');
  const payload = (extra = {}) => ({requestId: randomUUID(), title: 'Fictional shift check', description: 'Fictional task content', priority: 'normal', assigneeId: chief.user.id, participantIds: [], kind: 'shift', repeat: 'once', from: '2026-12-01', ...extra});
  async function create(data = payload()) { const response = await request('/api/tasks', admin, 'POST', data); assert.equal(response.status, 201); return (await response.json()).id; }
  const list = async (user = admin) => (await request('/api/tasks', user)).json();
  const change = (id, user, data, revision = 1, recurring = false) => request('/api/tasks/' + (recurring ? 'schedules/' : 'items/') + id, user, 'PATCH', data, {'If-Match': '"' + revision + '"'});
  return {hub, admin, chief, other, request, login, payload, create, list, change, time: value => { time = Date.parse(value); }};
}
test('task badges count only work awaiting the account, and expose no task content', async t => {
  const s = await setup(t);
  const count = async user => {
    const response = await s.request('/api/tasks/summary', user);
    assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(Object.keys(result), ['count']); return result.count;
  };
  const denied = await s.login('demo-observer');
  assert.equal((await s.request('/api/tasks/summary', denied)).status, 403);
  assert.equal((await s.request('/api/tasks/summary', s.admin, 'POST', {})).status, 405);
  assert.equal(await count(s.chief), 0);
  const shift = await s.create();
  const future = await s.create(s.payload({from: '2026-12-02'}));
  const global = await s.create(s.payload({kind: 'global', dueDate: '2026-12-02', dueTime: '17:00', participantIds: [s.other.user.id]}));
  assert.equal(await count(s.chief), 1); // Today's night shift has not started yet.
  s.time('2026-12-01T23:00:00+02:00');
  assert.equal(await count(s.chief), 2); assert.equal(await count(s.other), 1); assert.equal(await count(s.admin), 0);
  await s.create(s.payload({assigneeId: s.other.user.id, kind: 'global', dueDate: '2026-12-02', dueTime: '17:00'}));
  assert.equal(await count(s.chief), 2); assert.equal(await count(s.other), 2);
  assert.equal((await s.change(shift, s.chief, {action: 'report', status: 'completed', note: ''})).status, 200);
  assert.equal(await count(s.chief), 1);
  assert.equal((await s.change(global, s.chief, {action: 'report', status: 'blocked', note: 'Fictional blocker'})).status, 200);
  assert.equal(await count(s.chief), 1);
  assert.equal((await s.change(global, s.chief, {action: 'report', status: 'review', note: 'Fictional solution'}, 2)).status, 200);
  assert.equal(await count(s.chief), 0); assert.equal(await count(s.other), 1); assert.equal(await count(s.admin), 1);
  assert.equal((await s.change(global, s.admin, {action: 'return', note: 'Fictional correction'}, 3)).status, 200);
  assert.equal(await count(s.chief), 1); assert.equal(await count(s.admin), 0);
  assert.equal((await s.change(global, s.admin, {action: 'cancel', note: 'Fictional cancellation'}, 4)).status, 200);
  s.time('2026-12-03T23:00:00+02:00');
  assert.equal(await count(s.chief), 1); // The started, unreported shift still needs attention after its deadline.
  assert.equal((await s.change(future, s.chief, {action: 'report', status: 'not-done', note: 'Fictional reason'})).status, 200);
  assert.equal(await count(s.chief), 0);
  assert.equal((await s.request('/api/accounts/' + denied.user.id, s.admin, 'PATCH', {permissions: {canViewTasks: true}})).status, 200);
  assert.equal(await count(await s.login('demo-observer')), 0);
  assert.equal((await s.request('/api/accounts/' + s.chief.user.id, s.admin, 'PATCH', {permissions: {canViewTasks: false}})).status, 200);
  assert.equal((await s.request('/api/tasks/summary', s.chief)).status, 401);
  assert.equal((await s.request('/api/tasks/summary', await s.login('demo-chief-a'))).status, 403);
});
test('task viewing defaults to admin and supervisors; only admin assigns by default; supervisors see their assignments', async t => {
  const s = await setup(t), operator = await s.login('demo-operator'), observer = await s.login('demo-observer');
  for (const user of [operator, observer]) {
    for (const route of ['/tasks.html', '/api/tasks']) assert.equal((await s.request(route, user)).status, 403);
    assert.equal((await s.request('/api/tasks', user, 'POST', s.payload())).status, 403);
  }
  const id = await s.create();
  assert.equal((await s.list(s.chief)).items.length, 1); assert.equal((await s.list(s.other)).items.length, 0);
  assert.deepEqual((await s.list(s.chief)).supervisors, []);
  assert.equal((await s.change(id, s.other, {action: 'report', status: 'completed', note: ''})).status, 403);
  assert.equal((await s.change(id, s.chief, {action: 'cancel', note: 'Fictional cancellation'})).status, 403);
  assert.equal((await s.request('/api/tasks', s.chief, 'POST', s.payload())).status, 403);
  for (const route of ['/api/data/tasks', '/api/export/tasks']) assert.equal((await s.request(route, s.chief)).status, 404);
});
test('explicit assignment grants shift, global and recurring creation and preview without administrative powers', async t => {
  const s = await setup(t);
  for (const role of ['operator', 'observer']) {
    const original = await s.login('demo-' + role);
    assert.equal(original.user.permissions.canAssignTasks, false);
    assert.equal((await s.request('/api/accounts/' + original.user.id, s.admin, 'PATCH', {permissions: {canAssignTasks: true}})).status, 200);
    assert.equal((await s.request('/api/tasks', original)).status, 401);
    const user = await s.login('demo-' + role);
    assert.equal(user.user.role, role); assert.equal(user.user.taskSupervisor, false);
    assert.equal(user.user.permissions.canAssignTasks, true); assert.equal(user.user.permissions.canViewTasks, true);
    assert.equal((await s.request('/tasks.html', user)).status, 200);
    const roster = (await s.list(user)).supervisors;
    assert.ok(roster.some(person => person.id === s.chief.user.id));
    for (const person of roster) assert.deepEqual(Object.keys(person).sort(), ['id', 'team', 'username']);
    assert.equal((await s.request('/api/tasks/preview?date=2026-12-01&assigneeId=' + s.chief.user.id, user)).status, 200);
    const ids = [];
    for (const extra of [{}, {kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', participantIds: [s.other.user.id]}, {repeat: 'every-shift', until: '2026-12-05'}]) {
      const payload = s.payload(extra), response = await s.request('/api/tasks', user, 'POST', payload);
      assert.equal(response.status, 201); const created = await response.json(); ids.push(created.id);
      const retry = await s.request('/api/tasks', user, 'POST', payload);
      assert.equal(retry.status, 201); assert.deepEqual(await retry.json(), created);
      assert.equal((await s.request('/api/tasks', user, 'POST', {...payload, title: 'Fictional changed retry'})).status, 409);
    }
    assert.equal(s.hub.store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE user_id=? AND action='task-create'").get(user.user.id).n, 3);
    const created = (await s.list(user)).items.find(item => item.id === ids[1]);
    assert.equal(created.events[0].actor.id, user.user.id);
    for (const action of ['approve', 'return', 'edit', 'cancel', 'reopen', 'report', 'progress']) assert.equal((await s.change(ids[1], user, {action, note: 'Fictional forbidden action', status: 'completed'})).status, 403);
    assert.equal((await s.change(ids[2], user, {action: 'stop', note: 'Fictional forbidden stop'}, 1, true)).status, 403);
    for (const route of ['/api/accounts', '/accounts.html', '/api/data/personnel']) assert.equal((await s.request(route, user)).status, 403);
    assert.equal((await s.request('/api/accounts/' + user.user.id, user, 'PATCH', {role: 'admin', permissions: {canAssignTasks: true}})).status, 403);
    assert.equal((await s.request('/api/tasks', user, 'POST', s.payload({assigneeId: s.admin.user.id}))).status, 400);
    assert.equal((await s.request('/api/tasks', user, 'POST', s.payload(), {'X-CSRF-Token': 'fictional-wrong'})).status, 403);
    assert.equal((await s.request('/api/tasks', user, 'POST', s.payload(), {Origin: 'https://fictional.invalid'})).status, 403);
  }
});
test('supervisor assigners see their creations without reporting or counting other owners work', async t => {
  const s = await setup(t);
  await s.hub.auth.update(s.chief.user.id, {permissions: {canAssignTasks: true}}, s.admin.user);
  const assigner = await s.login('demo-chief-a');
  const unrelated = await s.create(s.payload({kind: 'global', assigneeId: s.other.user.id, dueDate: '2026-12-03', dueTime: '17:00'}));
  const owned = await s.create(s.payload({kind: 'global', dueDate: '2026-12-03', dueTime: '17:00'}));
  const response = await s.request('/api/tasks', assigner, 'POST', s.payload({kind: 'global', assigneeId: s.other.user.id, dueDate: '2026-12-03', dueTime: '17:00'}));
  assert.equal(response.status, 201); const {id} = await response.json();
  const recurring = await s.request('/api/tasks', assigner, 'POST', s.payload({assigneeId: s.other.user.id, repeat: 'every-shift', until: '2026-12-05'}));
  assert.equal(recurring.status, 201); const scheduleId = (await recurring.json()).id;
  assert.deepEqual((await s.list(assigner)).items.map(item => item.id).sort(), [id, owned].sort());
  assert.deepEqual((await s.list(assigner)).schedules.map(item => item.id), [scheduleId]);
  s.time('2026-12-04T23:00:00+02:00');
  assert.ok((await s.list(assigner)).items.some(item => item.scheduleId === scheduleId));
  assert.ok(!(await s.list(assigner)).items.some(item => item.id === unrelated));
  assert.equal((await (await s.request('/api/tasks/summary', assigner)).json()).count, 1);
  for (const action of ['progress', 'report', 'approve', 'cancel', 'edit']) assert.equal((await s.change(id, assigner, {action, note: 'Fictional forbidden action', status: 'review'})).status, 403);
  assert.equal((await s.change(id, s.other, {action: 'report', status: 'review', note: 'Fictional completed work'})).status, 200);
  assert.equal((await s.change(id, assigner, {action: 'approve'}, 2)).status, 403);
  assert.equal((await s.change(id, s.admin, {action: 'approve'}, 2)).status, 200);
  await s.hub.auth.update(assigner.user.id, {permissions: {canAssignTasks: false}}, s.admin.user);
  const restricted = await s.login('demo-chief-a');
  assert.deepEqual((await s.list(restricted)).items.map(item => item.id), [owned]);
  assert.deepEqual((await s.list(restricted)).supervisors, []);
});
test('assignment restrictions and revocation block new and in-flight creation while preserving prior tasks', async t => {
  const s = await setup(t);
  const operator = await s.login('demo-operator');
  await s.hub.auth.update(operator.user.id, {permissions: {canAssignTasks: true}}, s.admin.user);
  const user = await s.login('demo-operator'), response = await s.request('/api/tasks', user, 'POST', s.payload());
  assert.equal(response.status, 201); const id = (await response.json()).id;
  const base = 'http://127.0.0.1:' + s.hub.server.address().port, payload = JSON.stringify(s.payload());
  const received = new Promise(resolve => s.hub.server.once('request', resolve)); let pending;
  const result = new Promise((resolve, reject) => {
    pending = http.request(base + '/api/tasks', {method: 'POST', headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}}, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    pending.on('error', reject); pending.write(payload.slice(0, 4));
  });
  t.after(() => pending.destroy());
  await received; await s.hub.auth.update(user.user.id, {permissions: {canAssignTasks: false, canViewTasks: true}}, s.admin.user); pending.end(payload.slice(4));
  assert.equal(await result, 401);
  const restricted = await s.login('demo-operator');
  assert.equal((await s.request('/api/tasks', restricted, 'POST', s.payload())).status, 403);
  assert.equal((await s.request('/api/tasks/preview?date=2026-12-01&assigneeId=' + s.chief.user.id, restricted)).status, 403);
  assert.deepEqual((await s.list(restricted)).items.map(item => item.id), [id]);
  await s.hub.auth.update(user.user.id, {permissions: {canAssignTasks: true, canViewTasks: false}}, s.admin.user);
  const blocked = await s.login('demo-operator'); assert.equal(blocked.user.permissions.canAssignTasks, false);
  for (const route of ['/tasks.html', '/api/tasks', '/api/tasks/preview?date=2026-12-01&assigneeId=' + s.chief.user.id]) assert.equal((await s.request(route, blocked)).status, 403);
  assert.equal((await s.request('/api/tasks', blocked, 'POST', s.payload())).status, 403);
  await s.hub.auth.update(s.admin.user.id, {permissions: {canAssignTasks: false}}, s.admin.user);
  const admin = await s.login();
  assert.equal((await s.request('/api/tasks', admin, 'POST', s.payload())).status, 403);
  assert.equal((await s.change(id, admin, {action: 'cancel', note: 'Fictional administrator cancellation'})).status, 200);
});
test('explicit viewing grants a read-only overview without supervisor, assignment or personnel access', async t => {
  const s = await setup(t), shiftId = await s.create();
  const globalId = await s.create(s.payload({kind: 'global', assigneeId: s.other.user.id, dueDate: '2026-12-04', dueTime: '17:00'}));
  await s.create(s.payload({repeat: 'every-shift', until: '2026-12-05'}));
  const before = await s.list();
  for (const role of ['operator', 'observer']) {
    const original = await s.login('demo-' + role);
    assert.equal(original.user.permissions.canViewTasks, false);
    assert.equal((await s.request('/api/accounts/' + original.user.id, s.admin, 'PATCH', {permissions: {canViewTasks: true}})).status, 200);
    const reader = await s.login('demo-' + role);
    assert.equal(reader.user.taskSupervisor, false);
    for (const method of ['GET', 'HEAD']) assert.equal((await s.request('/tasks.html', reader, method)).status, 200);
    const view = await s.list(reader);
    assert.deepEqual(view.items, before.items); assert.deepEqual(view.schedules, before.schedules); assert.deepEqual(view.supervisors, []);
    assert.equal((await s.request('/api/tasks', reader, 'POST', s.payload())).status, 403);
    for (const id of [shiftId, globalId]) {
      for (const action of ['report', 'progress', 'cancel', 'approve', 'return', 'reopen', 'edit']) {
        assert.equal((await s.change(id, reader, {action, status: 'completed', note: 'Fictional read-only attempt'})).status, 403);
      }
    }
    assert.equal((await s.change(view.schedules[0].id, reader, {action: 'stop', note: 'Fictional stop'}, 1, true)).status, 403);
    for (const route of ['/api/accounts', '/api/data/personnel', '/api/tasks/preview?date=2026-12-01&assigneeId=' + s.chief.user.id]) assert.equal((await s.request(route, reader)).status, 403);
    assert.throws(() => s.hub.tasks.change(globalId, {action: 'progress', note: 'Fictional direct attempt'}, 1, reader.user), error => error.status === 403);
  }
  assert.deepEqual(await s.list(), before);
});
test('disabling task viewing revokes sessions and blocks supervisor reads, reports and new assignments', async t => {
  const s = await setup(t), id = await s.create();
  assert.equal(s.chief.user.permissions.canViewTasks, true);
  assert.equal((await s.request('/api/accounts/' + s.chief.user.id, s.admin, 'PATCH', {permissions: {canViewTasks: false}})).status, 200);
  assert.equal((await s.request('/api/tasks', s.chief)).status, 401);
  const denied = await s.login('demo-chief-a');
  assert.equal(denied.user.taskSupervisor, true); assert.equal(denied.user.taskTeam, 'А');
  for (const route of ['/tasks.html', '/tasks.html?role=admin', '/api/tasks']) assert.equal((await s.request(route, denied)).status, 403);
  assert.equal((await s.request('/tasks.html', denied, 'HEAD')).status, 403);
  assert.equal((await s.change(id, denied, {action: 'report', status: 'completed', note: ''})).status, 403);
  assert.ok(!(await s.list()).supervisors.some(person => person.id === denied.user.id));
  assert.equal((await s.request('/api/tasks', s.admin, 'POST', s.payload())).status, 400);
  assert.equal((await s.request('/api/tasks/preview?date=2026-12-01&assigneeId=' + denied.user.id, s.admin)).status, 400);
  await s.hub.auth.update(denied.user.id, {permissions: {canViewTasks: true}}, s.admin.user);
  const enabled = await s.login('demo-chief-a'); assert.equal((await s.list(enabled)).items.length, 1);
  assert.ok((await s.list()).supervisors.some(person => person.id === enabled.user.id));
});
test('removing supervisor status retains an explicit read-only grant but prevents reporting former assignments', async t => {
  const s = await setup(t), id = await s.create();
  await s.hub.auth.update(s.chief.user.id, {taskSupervisor: false, permissions: {canViewTasks: true}}, s.admin.user);
  const reader = await s.login('demo-chief-a');
  assert.equal(reader.user.taskSupervisor, false); assert.equal(reader.user.taskTeam, '');
  assert.equal((await s.list(reader)).items.length, 1);
  assert.equal((await s.change(id, reader, {action: 'report', status: 'completed', note: ''})).status, 403);
});
test('an explicit restriction also gates admin task creation and previews while account management remains available', async t => {
  const s = await setup(t);
  await s.hub.auth.update(s.admin.user.id, {permissions: {canViewTasks: false}}, s.admin.user);
  const denied = await s.login();
  for (const route of ['/tasks.html', '/api/tasks', '/api/tasks/preview?date=2026-12-01&assigneeId=' + s.chief.user.id]) assert.equal((await s.request(route, denied)).status, 403);
  assert.equal((await s.request('/api/tasks', denied, 'POST', s.payload())).status, 403);
  assert.equal((await s.request('/api/accounts', denied)).status, 200);
  assert.throws(() => s.hub.tasks.create(s.payload(), denied.user), error => error.status === 403);
  assert.throws(() => s.hub.tasks.preview('2026-12-01', s.chief.user.id, denied.user), error => error.status === 403);
});
test('Stickers tasks use 09:00–17:00 local time for previews, reports, grace and badges', async t => {
  const s = await setup(t);
  const account = await s.hub.auth.create('demo-stickers-chief', password, 'operator', s.admin.user, {}, () => {}, {taskSupervisor: true, taskTeam: 'СТИКЕРИ'});
  const chief = await s.login('demo-stickers-chief');
  const response = await s.request('/api/tasks/preview?date=2026-12-01&assigneeId=' + account.id, s.admin);
  assert.equal(response.status, 200);
  const {shift} = await response.json();
  assert.equal(shift.start, Date.parse('2026-12-01T09:00:00+02:00'));
  assert.equal(shift.due, Date.parse('2026-12-01T17:00:00+02:00'));
  for (const date of ['2026-03-29', '2026-10-25']) {
    const period = s.hub.tasks.shift(date, 'СТИКЕРИ');
    assert.equal(period.start, s.hub.tasks.instant(date, '09:00'));
    assert.equal(period.due - period.start, 8 * 3600000);
  }
  const id = await s.create(s.payload({assigneeId: account.id}));
  const item = () => s.hub.tasks.list(chief.user).items.find(item => item.id === id);
  const count = () => s.hub.tasks.summary(chief.user).count;
  assert.deepEqual(item().shift, shift); assert.equal(item().due, shift.due);
  s.time('2026-12-01T08:59:00+02:00'); assert.equal(count(), 0);
  assert.equal((await s.change(id, chief, {action: 'report', status: 'completed', note: ''})).status, 409);
  s.time('2026-12-01T09:00:00+02:00'); assert.equal(count(), 1);
  s.time('2026-12-01T15:00:00+02:00'); assert.equal(item().displayStatus, 'pending');
  const afternoon = await s.create(s.payload({assigneeId: account.id}));
  assert.equal((await s.change(afternoon, chief, {action: 'report', status: 'completed', note: ''})).status, 200);
  assert.equal(s.hub.tasks.list(chief.user).items.find(item => item.id === afternoon).late, false);
  s.time('2026-12-01T17:30:00+02:00'); assert.equal(item().displayStatus, 'pending');
  s.time('2026-12-01T17:31:00+02:00'); assert.equal(item().displayStatus, 'unreported'); assert.equal(count(), 1);
  assert.equal((await s.change(id, chief, {action: 'report', status: 'completed', note: ''})).status, 200);
  assert.equal(item().late, true); assert.equal(count(), 0);
});
test('shift deadline and grace use server time; night shifts keep their start date; late reports retain their time and history', async t => {
  const s = await setup(t); const id = await s.create();
  const item = (await s.list()).items[0]; assert.equal(item.shift.code, 3); assert.equal(item.shift.date, '2026-12-01');
  assert.equal(item.shift.due, Date.parse('2026-12-02T06:00:00+02:00'));
  assert.equal((await s.change(id, s.chief, {action: 'report', status: 'completed', note: ''})).status, 409);
  s.time('2026-12-02T06:15:00+02:00'); assert.equal((await s.list()).items[0].displayStatus, 'pending');
  s.time('2026-12-02T06:31:00+02:00'); assert.equal((await s.list()).items[0].displayStatus, 'unreported');
  assert.equal((await s.change(id, s.chief, {action: 'report', status: 'not-done', note: ''})).status, 400);
  assert.equal((await s.change(id, s.chief, {action: 'report', status: 'not-done', note: 'Fictional blocker'})).status, 200);
  const reported = (await s.list()).items[0]; assert.equal(reported.displayStatus, 'not-done'); assert.equal(reported.late, true); assert.equal(reported.events.length, 2);
  assert.equal((await s.change(id, s.chief, {action: 'report', status: 'completed', note: ''})).status, 409);
  assert.equal((await s.change(id, s.chief, {action: 'report', status: 'completed', note: ''}, 2)).status, 200);
  assert.equal((await s.list()).items[0].events.length, 3);
});
test('recurring tasks catch up unattended shifts, skip rest days, and stop without erasing previous obligations', async t => {
  const s = await setup(t);
  const id = await s.create(s.payload({repeat: 'every-shift', from: '2026-12-01', until: '2026-12-10'}));
  s.time('2026-12-10T23:00:00+02:00'); const view = await s.list();
  const expected = [];
  for (let d = 1; d <= 10; d++) { const period = s.hub.tasks.shift('2026-12-' + String(d).padStart(2, '0'), 'А'); if (period) expected.push(period.date); }
  assert.deepEqual(view.items.map(item => item.shift.date), expected);
  assert.equal(new Set(view.items.map(item => item.id)).size, expected.length); assert.equal((await s.list()).items.length, expected.length);
  assert.ok(view.items.some(item => item.displayStatus === 'unreported'));
  assert.equal((await s.change(id, s.admin, {action: 'stop', note: 'Fictional stop'}, 1, true)).status, 200);
  s.time('2026-12-20T23:00:00+02:00'); assert.equal((await s.list()).items.length, expected.length);
  assert.ok((await s.list()).schedules[0].stoppedAt);
});
test('editing a recurring plan changes only future snapshots; account team updates preserve existing task schedules', async t => {
  const s = await setup(t), id = await s.create(s.payload({repeat: 'every-shift', until: '2026-12-05'}));
  s.time('2026-12-01T23:00:00+02:00'); assert.equal((await s.list()).items.length, 1);
  assert.equal((await s.change(id, s.admin, {...s.payload(), action: 'edit', title: 'Fictional updated check', note: 'Fictional correction'}, 1, true)).status, 200);
  s.time('2026-12-02T23:00:00+02:00'); const view = await s.list();
  assert.equal(view.items[0].title, 'Fictional shift check'); assert.equal(view.items[1].title, 'Fictional updated check');
  await s.hub.auth.update(s.chief.user.id, {taskTeam: 'Б'}, s.admin.user);
  s.time('2026-12-03T23:00:00+02:00'); assert.ok((await s.list()).items.every(item => item.shift.team === 'А'));
  assert.equal((await s.change(view.items[0].id, s.admin, {...s.payload(), action: 'edit', note: 'Fictional edit'}, 1)).status, 409);
});
test('global participants can add progress, only owner reports completion, and admin approval or return is required', async t => {
  const s = await setup(t), id = await s.create(s.payload({kind: 'global', participantIds: [s.other.user.id], dueDate: '2026-12-04', dueTime: '17:00'}));
  assert.equal((await s.list(s.other)).items.length, 1);
  assert.equal((await s.change(id, s.other, {action: 'progress', note: 'Fictional handover'})).status, 200);
  assert.equal((await s.change(id, s.other, {action: 'report', status: 'review', note: 'Fictional completion'}, 2)).status, 403);
  assert.equal((await s.change(id, s.chief, {action: 'report', status: 'review', note: 'Fictional completion'}, 2)).status, 200);
  assert.equal((await s.change(id, s.chief, {action: 'approve', note: ''}, 3)).status, 403);
  assert.equal((await s.change(id, s.admin, {action: 'return', note: ''}, 3)).status, 400);
  assert.equal((await s.change(id, s.admin, {action: 'return', note: 'Fictional remaining work'}, 3)).status, 200);
  assert.equal((await s.change(id, s.chief, {action: 'report', status: 'review', note: 'Fictional second completion'}, 4)).status, 200);
  assert.equal((await s.change(id, s.admin, {action: 'approve', note: ''}, 5)).status, 200);
  const item = (await s.list()).items[0]; assert.equal(item.status, 'completed'); assert.equal(item.events.length, 6);
  assert.equal((await s.change(id, s.admin, {action: 'reopen', note: 'Fictional recurrence'}, 6)).status, 200);
});
test('invalid dates, owners, payloads and repeat periods do not create tasks; retries do not duplicate an accepted task', async t => {
  const s = await setup(t), input = s.payload();
  const id = await s.create(input); assert.equal(await s.create(input), id); assert.equal((await s.list()).items.length, 1);
  assert.equal((await s.request('/api/tasks', s.admin, 'POST', {...input, title: 'Fictional changed retry'})).status, 409);
  for (const extra of [{from: '2026-02-30'}, {from: '2026-01-01'}, {title: ''}, {assigneeId: s.admin.user.id}, {participantIds: ['1']}, {participantIds: [s.other.user.id]}, {repeat: 'every-shift', until: '2030-12-01'}, {repeat: 'every-shift', from: '2026-11-01', until: '2026-12-10'}, {kind: 'global', dueDate: '2026-12-01', dueTime: '01:00'}]) {
    assert.equal((await s.request('/api/tasks', s.admin, 'POST', s.payload(extra))).status, 400);
  }
  assert.equal((await s.list()).items.length, 1);
});
test('global deadline and assignment amendments retain original snapshots and require a fresh review', async t => {
  const s = await setup(t), payload = s.payload({kind: 'global', dueDate: '2026-12-02', dueTime: '17:00'}), id = await s.create(payload);
  s.time('2026-12-03T10:00:00+02:00');
  assert.equal((await s.change(id, s.chief, {action: 'report', status: 'review', note: 'Fictional late solution'})).status, 200);
  assert.equal((await s.list()).items[0].late, true);
  const amended = {...payload, action: 'edit', assigneeId: s.other.user.id, dueDate: '2026-12-05', dueTime: '17:00', note: 'Fictional changed responsibility'};
  assert.equal((await s.change(id, s.admin, amended, 2)).status, 200);
  const item = (await s.list()).items[0]; assert.equal(item.status, 'pending'); assert.equal(item.report, null);
  assert.equal(item.events[0].snapshot.due, Date.parse('2026-12-02T17:00:00+02:00')); assert.equal(item.events[0].snapshot.owner.id, s.chief.user.id);
  assert.equal(item.events[1].late, true); assert.equal(item.events[2].snapshot.owner.id, s.other.user.id);
  assert.equal((await s.change(id, s.admin, {action: 'approve', note: ''}, 3)).status, 409);
});
test('CSRF, origin, revision and active sessions are enforced for task mutations', async t => {
  const s = await setup(t), id = await s.create();
  for (const headers of [{'X-CSRF-Token': ''}, {Origin: 'https://example.invalid'}]) assert.equal((await s.request('/api/tasks', s.admin, 'POST', s.payload(), headers)).status, 403);
  assert.equal((await s.request('/api/tasks/items/' + id, s.admin, 'PATCH', {action: 'cancel', note: 'Fictional cancel'})).status, 428);
  await s.hub.auth.update(s.chief.user.id, {taskSupervisor: false}, s.admin.user);
  assert.equal((await s.request('/api/tasks', s.chief)).status, 401);
  const revoked = await s.login('demo-chief-a'); assert.equal((await s.request('/api/tasks', revoked)).status, 403);
});
test('local timezone preserves overnight dates and handles daylight-saving shift duration', async t => {
  const s = await setup(t);
  assert.deepEqual(s.hub.tasks.currentShift(Date.parse('2026-12-02T03:00:00+02:00')), {date: '2026-12-01', code: 3});
  const night = team => ['А', 'Б', 'В', 'Г'].map(value => s.hub.tasks.shift(team, value)).find(value => value?.code === 3);
  assert.equal(night('2026-03-28').due - night('2026-03-28').start, 7 * 3600000);
  assert.equal(night('2026-10-24').due - night('2026-10-24').start, 9 * 3600000);
  assert.throws(() => s.hub.tasks.instant('2026-03-29', '03:30'), error => error.code === 'INVALID_TASK_DATE');
});
test('admin shift previews use the eligible owner team and reject supervisor access', async t => {
  const s = await setup(t);
  const route = '/api/tasks/preview?date=2026-12-01&assigneeId=' + s.chief.user.id;
  const response = await s.request(route, s.admin); assert.equal(response.status, 200);
  const preview = await response.json(); assert.equal(preview.shift.code, 3); assert.equal(preview.timezone, 'Europe/Sofia');
  assert.equal((await s.request(route, s.chief)).status, 403);
  assert.equal((await s.request('/api/tasks/preview?date=2026-02-30&assigneeId=' + s.chief.user.id, s.admin)).status, 400);
});
test('supervisor setup is admin-only, validates teams, and migration does not designate existing operators', async t => {
  const s = await setup(t), operator = await s.login('demo-operator');
  assert.equal(operator.user.taskSupervisor, false); assert.equal(operator.user.taskTeam, '');
  const route = '/api/accounts/' + operator.user.id;
  assert.equal((await s.request(route, operator, 'PATCH', {taskSupervisor: true, taskTeam: 'А'})).status, 403);
  for (const values of [{taskSupervisor: true}, {taskSupervisor: 'true', taskTeam: 'А'}, {taskSupervisor: true, taskTeam: 'fictional-invalid'}]) assert.equal((await s.request(route, s.admin, 'PATCH', values)).status, 400);
  assert.equal((await s.request(route, s.admin, 'PATCH', {taskSupervisor: true, taskTeam: 'А'})).status, 200);
  const updated = await s.login('demo-operator'); assert.equal(updated.user.taskSupervisor, true);
  assert.equal((await s.request('/api/data/personnel', updated)).status, 403);
});
test('tasks, supervisor profiles, event history and recurring catch-up survive a database reopen', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-tasks-demo-')); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'demo.sqlite'); let store = openStore(filename), auth = accounts(store);
  const admin = await auth.create('demo-admin', password, 'admin'), chief = await auth.create('demo-chief', password, 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  let tasks = createTasks(store, {now: () => Date.parse('2026-12-01T07:00:00+02:00')});
  tasks.create({requestId: randomUUID(), title: 'Fictional persistent task', description: '', priority: 'normal', assigneeId: chief.id, participantIds: [], kind: 'shift', repeat: 'every-shift', from: '2026-12-01', until: '2026-12-03'}, admin); store.close();
  store = openStore(filename); t.after(() => store.close()); tasks = createTasks(store, {now: () => Date.parse('2026-12-04T07:00:00+02:00')});
  const view = tasks.list(admin); assert.equal(view.items.length, 2); assert.ok(view.items.every(item => item.displayStatus === 'unreported')); assert.equal(view.items[0].events[0].snapshot.owner.username, 'demo-chief');
  assert.equal(accounts(store).list().find(user => user.id === chief.id).taskSupervisor, true);
  const reopenedAuth = accounts(store);
  assert.equal(reopenedAuth.list().find(user => user.id === chief.id).permissions.canViewTasks, true);
  await reopenedAuth.update(chief.id, {permissions: {canViewTasks: false}}, admin); store.close();
  store = openStore(filename);
  assert.equal(accounts(store).list().find(user => user.id === chief.id).permissions.canViewTasks, false);
  assert.equal(createTasks(store).list(admin).items.length, view.items.length);
});
test('task reporting, management and review can each be delegated to every role independently', async t => {
  const s = await setup(t);
  for (const role of ['admin', 'operator', 'observer']) {
    const owner = await s.hub.auth.create('demo-delegated-owner-' + role, password, role, s.admin.user,
      {canAssignTasks: false, canManageTasks: false, canReviewTasks: false, canReportTasks: true}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
    const reporter = await s.login(owner.username);
    const id = await s.create(s.payload({kind: 'global', assigneeId: owner.id, dueDate: '2026-12-02', dueTime: '17:00'}));
    assert.equal((await s.change(id, reporter, {action: 'report', status: 'review', note: 'Fictional delegated resolution'})).status, 200);
    assert.equal((await s.change(id, reporter, {action: 'approve'}, 2)).status, 403);
    const reviewer = await s.hub.auth.create('demo-delegated-review-' + role, password, role, s.admin.user, {canReviewTasks: true, canAssignTasks: false, canManageTasks: false, canReportTasks: false});
    const review = await s.login(reviewer.username);
    assert.equal((await s.request('/api/tasks/summary', review)).status, 200);
    assert.equal((await s.change(id, review, {action: 'approve'}, 2)).status, 200);
    assert.equal((await s.change(id, review, {action: 'reopen', note: 'Fictional reopen'}, 3)).status, 403);
    await s.hub.auth.update(reviewer.id, {permissions: {canManageTasks: true, canAssignTasks: false, canReviewTasks: false}}, s.admin.user);
    const manager = await s.login(reviewer.username);
    assert.equal(manager.user.role, role);
    assert.equal((await s.change(id, manager, {action: 'reopen', note: 'Fictional delegated reopening'}, 3)).status, 200);
    assert.equal((await s.change(id, manager, {action: 'cancel', note: 'Fictional delegated cancellation'}, 4)).status, 200);
    assert.equal((await s.request('/api/tasks', manager, 'POST', s.payload())).status, 403);
    await s.hub.auth.update(owner.id, {permissions: {canReportTasks: false, canViewTasks: true}}, s.admin.user);
    const revoked = await s.login(owner.username);
    const next = await s.create(s.payload({kind: 'global', assigneeId: s.chief.user.id, dueDate: '2026-12-02', dueTime: '17:00'}));
    assert.equal((await s.change(next, revoked, {action: 'progress', note: 'Fictional denied progress'})).status, 403);
    assert.equal(s.hub.tasks.list(s.admin.user).supervisors.some(person => person.id === owner.id), false);
  }
});
test('accounts that both report and review receive reminders for their own work and work awaiting review', async t => {
  const s = await setup(t);
  await s.hub.auth.update(s.chief.user.id, {permissions: {canReviewTasks: true}}, s.admin.user);
  const chief = await s.login(s.chief.user.username);
  await s.create(s.payload({kind: 'global', dueDate: '2026-12-02', dueTime: '17:00'}));
  const id = await s.create(s.payload({kind: 'global', assigneeId: s.other.user.id, dueDate: '2026-12-02', dueTime: '17:00'}));
  assert.equal((await s.change(id, s.other, {action: 'report', status: 'review', note: 'Fictional review pending'})).status, 200);
  assert.deepEqual(await (await s.request('/api/tasks/summary', chief)).json(), {count: 2});
  assert.equal(s.hub.tasks.list(chief.user).items.length, 2);
});
