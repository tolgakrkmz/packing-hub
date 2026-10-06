const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
test('task access requires a supervisor profile; admin alone assigns; each supervisor sees only their assignments', async t => {
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
});
