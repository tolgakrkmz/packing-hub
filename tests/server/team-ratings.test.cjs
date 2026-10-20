/* Fictional packers and shift leads only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const {shiftSchedule} = require('../../server/store.cjs');
const {selectForPrompt, summarize} = require('../../server/team-ratings.cjs');
const password = 'Fictional-rating-password-123';
const person = n => ({id: 'demo-rate-' + n, name: 'Demo Packer ' + n});
test('the prompt picks never-rated people first, then the longest unrated, at most three', () => {
  const present = [1, 2, 3, 4].map(person);
  assert.deepEqual(selectForPrompt(present, new Map()).map(p => p.id), ['demo-rate-1', 'demo-rate-2', 'demo-rate-3']);
  const last = new Map([['demo-rate-1', 300], ['demo-rate-2', 100], ['demo-rate-4', 200]]);
  assert.deepEqual(selectForPrompt(present, last).map(p => p.id), ['demo-rate-3', 'demo-rate-2', 'demo-rate-4']);
  assert.deepEqual(selectForPrompt(present.slice(0, 2), last).map(p => p.id), ['demo-rate-2', 'demo-rate-1']);
  assert.deepEqual(selectForPrompt([], last), []);
});
test('the summary keeps ratings, pair results and attendance apart and flags little data', () => {
  const [a, b, c] = [1, 2, 3].map(person);
  const entry = (date, members, result) => ({date, shiftCode: 1, team: 'А', members, targetKg: 100, targetCrates: 1, result});
  const entries = [entry('2026-10-01', [a, b], {kg: 120, crates: 1}), entry('2026-10-02', [a, c], {kg: 50, crates: 1}), {...entry('2026-10-03', [b, c], null), cancellation: {}}, entry('2026-09-01', [b, c], null)];
  const ratings = [...Array(5)].map(() => ({employee_id: a.id, name: a.name, team: 'А', date: '2026-10-02', rating: 'good'})).concat({employee_id: b.id, name: b.name, team: 'А', date: '2026-10-01', rating: 'poor'});
  const rows = summarize({ratings, entries, rosterAt: () => [a, b, c], since: '2026-09-21'});
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  assert.deepEqual([byId[a.id].good, byId[a.id].total, byId[a.id].lowData, byId[a.id].pairs, byId[a.id].achieved, byId[a.id].present, byId[a.id].absent], [5, 5, false, 2, 1, 2, 0]);
  assert.deepEqual([byId[b.id].poor, byId[b.id].lowData, byId[b.id].present, byId[b.id].absent], [1, true, 1, 1]);
  assert.deepEqual([byId[c.id].total, byId[c.id].present, byId[c.id].absent], [0, 1, 1], 'the cancelled and older shifts do not count');
  assert.deepEqual(summarize({ratings: [], entries: [], rosterAt: () => [], since: '2026-01-01'}), []);
});
async function setup(t) {
  // The first scheduled shift of team А from 2026-10-20 on, observed one hour after it starts.
  let date = '2026-10-20', shiftCode;
  for (;; date = shiftSchedule.addDays(date, 1)) { shiftCode = [1, 2, 3].find(code => shiftSchedule.teamFor(shiftSchedule.parseDate(date), code) === 'А'); if (shiftCode) break; }
  let time = 0;
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => time});
  time = hub.store.productionAccess.interval(date, 'А').start + 3600000;
  await hub.auth.create('demo-admin', password, 'admin');
  await hub.auth.create('demo-lead', password, 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  await hub.auth.create('demo-lead-2', password, 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'Б'});
  await hub.auth.create('demo-operator', password, 'operator', null, {}, () => {}, {taskTeam: 'А'});
  const users = Object.fromEntries(hub.auth.list().map(user => [user.username, user]));
  const people = [1, 2, 3, 4, 5].map(n => ({...person(n), category: 'auto', team: 'А', role: 'Опаковчик', active: true}));
  hub.store.put('personnel', {...hub.store.get('personnel').data, employees: people}, 1, users['demo-admin']);
  for (const [index, pair] of [[people[0], people[1]], [people[2], people[3]]].entries()) {
    const at = new Date(time).toISOString(), id = 'demo-pair-' + index;
    const entry = {id, date, shiftCode, team: 'А', members: pair.map(({id, name, category, role}) => ({id, name, category, role})), areas: ['auto'], targetKg: 100, targetCrates: 1, result: null, createdAt: at, updatedAt: at};
    hub.store.reportOperation('pair-targets', {operationId: randomUUID(), action: 'create', entryId: id, entry}, undefined, users['demo-lead']);
  }
  const report = id => {
    const current = hub.store.get('pair-targets'), entry = current.data.entries.find(item => item.id === id), at = new Date(time).toISOString();
    hub.store.reportOperation('pair-targets', {operationId: randomUUID(), action: 'update', entryId: id, entry: {...entry, result: {kg: 100, crates: 1, reasonKey: '', reasonText: '', reportedAt: at}, updatedAt: at}}, current.versions[id], users['demo-lead']);
  };
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const login = async name => { const logged = await hub.auth.login(name, password); return {...logged, cookie: 'hub-local-session=' + logged.token}; };
  const request = (route, user, method = 'GET', data) => fetch(base + route, {method, headers: {Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json'}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const [admin, lead, other, operator] = await Promise.all(['demo-admin', 'demo-lead', 'demo-lead-2', 'demo-operator'].map(login));
  return {hub, admin, lead, other, operator, request, report, scope: {date, shiftCode, team: 'А'}, people, advance: ms => { time += ms; }};
}
test('the prompt starts after a pair result, returns until everyone shown is rated, then never again that shift', async t => {
  const s = await setup(t);
  const ask = async () => (await (await s.request('/api/team-ratings/prompt', s.lead, 'POST', s.scope)).json()).people.map(p => p.id);
  assert.deepEqual(await ask(), [], 'no result yet');
  s.report('demo-pair-0');
  assert.deepEqual(await ask(), ['demo-rate-1', 'demo-rate-2', 'demo-rate-3'], 'person 5 is not in a pair');
  assert.deepEqual(await ask(), ['demo-rate-1', 'demo-rate-2', 'demo-rate-3'], 'an unanswered prompt comes back');
  const ratings = [{employeeId: 'demo-rate-1', rating: 'good'}, {employeeId: 'demo-rate-2', rating: 'poor', reason: 'slow'}];
  const partial = await s.request('/api/team-ratings', s.lead, 'POST', {...s.scope, ratings});
  assert.equal(partial.status, 400); assert.equal((await partial.json()).error, 'RATING_INCOMPLETE');
  ratings.push({employeeId: 'demo-rate-3', rating: 'ok'});
  assert.deepEqual(await (await s.request('/api/team-ratings', s.lead, 'POST', {...s.scope, ratings})).json(), {saved: 3});
  assert.deepEqual(await ask(), [], 'answered for this shift');
  assert.deepEqual(await (await s.request('/api/team-ratings', s.lead, 'POST', {...s.scope, ratings})).json(), {saved: 0}, 'a retry keeps the first answer');
  assert.equal((await s.request('/api/team-ratings', s.lead, 'POST', {...s.scope, ratings: [{employeeId: 'demo-rate-5', rating: 'ok'}]})).status, 403, 'absent people cannot be rated');
  for (const bad of [{employeeId: 'demo-rate-1', rating: 'great'}, {employeeId: 'demo-rate-1', rating: 'ok', reason: 'sick'}, {employeeId: 'demo-rate-1', rating: 'ok', note: 'x'}]) {
    assert.equal((await s.request('/api/team-ratings', s.lead, 'POST', {...s.scope, ratings: [bad]})).status, 400, JSON.stringify(bad));
  }
  const summary = await (await s.request('/api/team-ratings/summary?days=30', s.admin)).json();
  const row = id => summary.rows.find(item => item.id === id);
  assert.deepEqual([row('demo-rate-1').good, row('demo-rate-2').poor, row('demo-rate-3').ok, row('demo-rate-2').lowData], [1, 1, 1, true]);
  assert.deepEqual([row('demo-rate-5').present, row('demo-rate-5').absent], [0, 1]);
  assert.deepEqual(summary.reasons, [{team: 'А', reason: 'slow', count: 1}], 'reasons are counted per team');
  assert.ok(!JSON.stringify(summary.rows).includes('slow'), 'reasons stay out of the per-person rows');
});
test('foreign teams, operators without the right and closed shifts are refused; the report needs its own right', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/api/team-ratings/prompt', s.other, 'POST', s.scope)).status, 403, 'lead of another team');
  assert.equal((await s.request('/api/team-ratings/prompt', s.operator, 'POST', s.scope)).status, 403, 'operator without canRateTeam');
  assert.equal((await s.request('/api/team-ratings', s.other, 'POST', {...s.scope, ratings: [{employeeId: 'demo-rate-1', rating: 'poor'}]})).status, 403);
  for (const user of [s.lead, s.other, s.operator]) assert.equal((await s.request('/api/team-ratings/summary', user)).status, 403);
  assert.equal((await s.request('/api/team-ratings/summary?days=7', s.admin)).status, 400);
  s.advance(2 * 86400000);
  assert.equal((await s.request('/api/team-ratings/prompt', s.lead, 'POST', s.scope)).status, 403, 'outside the reporting window');
  assert.equal(s.hub.store.db.prepare('SELECT count(*) AS n FROM team_ratings').get().n, 0);
});
