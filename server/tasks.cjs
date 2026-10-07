/* Task content lives only in the local database. Supervisors see their assignments; permitted readers see the overview. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID, createHash} = require('node:crypto');
const {problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/shift-schedule.js'), 'utf8'), sandbox);
const schedule = vm.runInContext('ShiftSchedule', sandbox);
const TEAMS = ['А', 'Б', 'В', 'Г', 'СТИКЕРИ'];
const GRACE = 30 * 60000;
const dateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function nextDate(value, days = 1) { return new Date(Date.parse(value) + days * 86400000).toISOString().slice(0, 10); }
function createTasks(store, {timezone = 'Europe/Sofia', now = Date.now} = {}) {
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  function parts(at) { return Object.fromEntries(formatter.formatToParts(new Date(at)).map(part => [part.type, part.value])); }
  function localDate(at) { const p = parts(at); return `${p.year}-${p.month}-${p.day}`; }
  function instant(date, time) {
    if (!dateKey(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw problem(400, 'INVALID_TASK_DATE');
    const desired = Date.parse(date + 'T' + time + ':00Z'); let value = desired;
    for (let i = 0; i < 4; i++) {
      const p = parts(value), actual = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
      value += desired - actual;
    }
    const p = parts(value);
    if (localDate(value) !== date || `${p.hour}:${p.minute}` !== time) throw problem(400, 'INVALID_TASK_DATE');
    return value;
  }
  function shift(date, team) {
    if (!dateKey(date) || !TEAMS.includes(team)) throw problem(400, 'INVALID_TASK_DATE');
    if (team === 'СТИКЕРИ') return {date, team, code: 1, start: instant(date, '09:00'), due: instant(date, '17:00')};
    const [y, m, d] = date.split('-').map(Number);
    const code = schedule.shiftCodeFor(team, new Date(y, m - 1, d));
    if (code === 'Н') return null;
    return {date, team, code, start: instant(date, {1: '06:00', 2: '14:00', 3: '22:00'}[code]), due: instant(code === 3 ? nextDate(date) : date, {1: '14:00', 2: '22:00', 3: '06:00'}[code])};
  }
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS task_items(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_schedules(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_requests(actor INTEGER NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,id));`);
  const access = user => { if (!can(user, 'canViewTasks')) throw problem(403, 'FORBIDDEN'); };
  const supervisor = user => user.role === 'operator' && user.taskSupervisor === true;
  const admin = user => { access(user); if (user.role !== 'admin') throw problem(403, 'FORBIDDEN'); };
  function text(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw problem(400, 'INVALID_TASK');
    return value.trim();
  }
  function roster() {
    return db.prepare("SELECT id,username,role,permissions,task_team FROM users WHERE active=1 AND role='operator' AND task_supervisor=1 ORDER BY username").all()
      .filter(row => can({...row, taskSupervisor: true, permissionOverrides: JSON.parse(row.permissions)}, 'canViewTasks'))
      .map(row => ({id: row.id, username: row.username, team: row.task_team}));
  }
  function assignments(input) {
    if (!Number.isSafeInteger(input.assigneeId) || !Array.isArray(input.participantIds) || input.participantIds.length > 30 || input.participantIds.some(id => !Number.isSafeInteger(id)) || new Set(input.participantIds).size !== input.participantIds.length) throw problem(400, 'INVALID_TASK');
    const people = roster(), owner = people.find(person => person.id === input.assigneeId);
    const participants = input.participantIds.filter(id => id !== input.assigneeId).map(id => people.find(person => person.id === id));
    if (!owner || participants.some(person => !person)) throw problem(400, 'INVALID_TASK_ASSIGNEE');
    return {owner, participants};
  }
  function fields(input) {
    if (!['normal', 'high'].includes(input.priority)) throw problem(400, 'INVALID_TASK');
    return {title: text(input.title, 180, true), description: text(input.description, 4000), priority: input.priority, ...assignments(input)};
  }
  function row(table, id) {
    const found = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!found) throw problem(404, 'NOT_FOUND');
    return {...JSON.parse(found.data), id: found.id, revision: found.revision};
  }
  function all(table) { return db.prepare(`SELECT * FROM ${table}`).all().map(found => ({...JSON.parse(found.data), id: found.id, revision: found.revision})); }
  function insert(table, id, value) { db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?)`).run(id, JSON.stringify(value)); }
  function save(table, value) {
    const {id, revision, ...data} = value;
    db.prepare(`UPDATE ${table} SET data=?,revision=revision+1 WHERE id=?`).run(JSON.stringify(data), id);
    return row(table, id);
  }
  function revision(value, expected) { if (value.revision !== expected) throw problem(409, 'CONFLICT'); }
  const visible = (item, user) => !supervisor(user) || item.owner.id === user.id || item.participants.some(person => person.id === user.id);
  function event(user, action, note, at) { return {at, actor: {id: user.id, username: user.username}, action, note}; }
  function itemFrom(source, period, at) {
    const events = source.events.map(entry => entry.action === 'created' ? {...entry, snapshot: {...entry.snapshot, due: period.due}} : entry);
    return {...fieldsSnapshot(source), kind: 'shift', scheduleId: source.id || null, shift: period, due: period.due, createdAt: at, status: 'pending', report: null, events};
  }
  function fieldsSnapshot(source) { return {title: source.title, description: source.description, priority: source.priority, owner: source.owner, participants: source.participants}; }
  // Materialize missed shifts on the server, including after an outage. No browser needs to be open.
  function materialize(at = now()) {
    const today = localDate(at);
    for (const source of all('task_schedules')) {
      for (let date = source.from; date <= source.until && date <= today; date = nextDate(date)) {
        const period = shift(date, source.team);
        if (!period || period.start > at || period.due <= source.createdAt || source.stoppedAt && period.start >= source.stoppedAt) continue;
        const id = source.id + ':' + date;
        if (!db.prepare('SELECT 1 FROM task_items WHERE id=?').get(id)) insert('task_items', id, itemFrom(source, period, source.createdAt));
      }
    }
  }
  function derived(item, at) {
    const missing = item.kind === 'shift' && item.status === 'pending' && at > item.due + GRACE;
    return {...item, displayStatus: missing ? 'unreported' : item.status, overdue: item.kind === 'global' && !['completed', 'cancelled'].includes(item.status) && at > item.due,
      late: !!item.report?.late};
  }
  function currentShift(at) {
    const p = parts(at), date = Number(p.hour) < 6 ? nextDate(localDate(at), -1) : localDate(at);
    const code = Number(p.hour) < 6 || Number(p.hour) >= 22 ? 3 : Number(p.hour) < 14 ? 1 : 2;
    return {date, code};
  }
  function list(user) {
    access(user); const at = now();
    store.transaction(() => materialize(at));
    return {now: at, timezone, graceMinutes: GRACE / 60000, currentShift: currentShift(at), supervisors: user.role === 'admin' ? roster() : [],
      items: all('task_items').filter(item => visible(item, user)).map(item => derived(item, at)), schedules: all('task_schedules').filter(item => visible(item, user))};
  }
  function summary(user) {
    access(user); const at = now();
    store.transaction(() => materialize(at));
    // Count work awaiting this account, without sending task content to other pages.
    const count = all('task_items').filter(item => {
      if (user.role === 'admin') return item.status === 'review';
      if (!supervisor(user) || !visible(item, user)) return false;
      if (item.kind === 'shift') return item.status === 'pending' && item.shift.start <= at;
      return ['pending', 'in-progress', 'blocked'].includes(item.status);
    }).length;
    return {count};
  }
  function idempotent(input, user, work) {
    if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.requestId)) throw problem(400, 'INVALID_TASK');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return store.transaction(() => {
      const prior = db.prepare('SELECT hash,result FROM task_requests WHERE actor=? AND id=?').get(user.id, input.requestId);
      if (prior) { if (prior.hash !== hash) throw problem(409, 'CONFLICT'); return JSON.parse(prior.result); }
      const result = work();
      db.prepare('INSERT INTO task_requests(actor,id,hash,result) VALUES(?,?,?,?)').run(user.id, input.requestId, hash, JSON.stringify(result));
      return result;
    });
  }
  function create(input, user) {
    admin(user); const at = now(), values = fields(input);
    if (!['shift', 'global'].includes(input.kind)) throw problem(400, 'INVALID_TASK');
    if (input.kind === 'shift' && values.participants.length) throw problem(400, 'INVALID_TASK');
    return idempotent(input, user, () => {
      const id = randomUUID(), base = {...values, createdAt: at, events: [{...event(user, 'created', '', at), snapshot: values}]};
      if (input.kind === 'global') {
        const due = instant(input.dueDate, input.dueTime);
        if (due <= at) throw problem(400, 'INVALID_TASK_DATE');
        base.events[0].snapshot.due = due;
        insert('task_items', id, {...base, kind: 'global', due, status: 'pending', report: null});
      } else if (input.repeat === 'every-shift') {
        if (!dateKey(input.from) || !dateKey(input.until) || input.from < currentShift(at).date || input.until < input.from || Date.parse(input.until) - Date.parse(input.from) > 366 * 86400000) throw problem(400, 'INVALID_TASK_DATE');
        if (values.owner.team === 'СТИКЕРИ') throw problem(400, 'TASK_REPEAT_TEAM');
        insert('task_schedules', id, {...base, from: input.from, until: input.until, team: values.owner.team, stoppedAt: null});
        materialize(at);
      } else if (input.repeat === 'once') {
        const period = shift(input.from, values.owner.team);
        if (!period || period.due <= at) throw problem(400, 'INVALID_TASK_DATE');
        insert('task_items', id, itemFrom(base, period, at));
      } else throw problem(400, 'INVALID_TASK');
      store.audit(user, 'task-create', 'tasks');
      return {id};
    });
  }
  function change(id, input, expected, user, isSchedule = false) {
    access(user); const at = now();
    if (user.role !== 'admin' && !supervisor(user)) throw problem(403, 'FORBIDDEN');
    return store.transaction(() => {
      materialize(at);
      const table = isSchedule ? 'task_schedules' : 'task_items', item = row(table, id);
      if (!visible(item, user)) throw problem(403, 'FORBIDDEN');
      revision(item, expected);
      let note = text(input.note ?? '', 4000);
      if (isSchedule) {
        admin(user);
        if (item.stoppedAt) throw problem(409, 'TASK_STATE');
        if (input.action === 'stop') { if (!note) throw problem(400, 'TASK_REASON'); item.stoppedAt = at; }
        else if (input.action === 'edit') {
          if (!note) throw problem(400, 'TASK_REASON');
          const value = fields(input);
          if (value.participants.length || value.owner.team !== item.team) throw problem(400, 'INVALID_TASK_ASSIGNEE');
          Object.assign(item, value);
        } else throw problem(400, 'INVALID_TASK');
      } else {
        if (['completed', 'cancelled'].includes(item.status) && input.action !== 'reopen') throw problem(409, 'TASK_STATE');
        if (input.action === 'edit') {
          admin(user); if (!note) throw problem(400, 'TASK_REASON');
          if (item.kind === 'shift' && (at >= item.due || item.report)) throw problem(409, 'TASK_STATE');
          const value = fields(input);
          if (item.kind === 'shift' && value.participants.length) throw problem(400, 'INVALID_TASK');
          if (item.kind === 'global') {
            const due = instant(input.dueDate, input.dueTime);
            if (due <= at) throw problem(400, 'INVALID_TASK_DATE');
            item.due = due;
            if (item.status === 'review' || item.owner.id !== value.owner.id) { item.status = 'pending'; item.report = null; }
          }
          Object.assign(item, value);
        } else if (input.action === 'report') {
          if (user.role !== 'operator' || !user.taskSupervisor || item.owner.id !== user.id) throw problem(403, 'FORBIDDEN');
          if (item.kind === 'shift' && at < item.shift.start) throw problem(409, 'TASK_NOT_STARTED');
          const allowed = item.kind === 'shift' ? ['completed', 'not-done', 'not-applicable'] : ['in-progress', 'blocked', 'review'];
          if (!allowed.includes(input.status)) throw problem(400, 'INVALID_TASK');
          if (input.status !== 'completed' && !note) throw problem(400, 'TASK_REASON');
          item.status = input.status; item.report = {at, actor: {id: user.id, username: user.username}, status: input.status, note, late: at > item.due + (item.kind === 'shift' ? GRACE : 0)};
        } else if (input.action === 'progress') {
          if (item.kind !== 'global' || user.role !== 'operator' || !user.taskSupervisor || !note) throw problem(400, 'INVALID_TASK');
        } else if (['approve', 'return', 'reopen', 'cancel'].includes(input.action)) {
          admin(user);
          if (input.action === 'approve' && (item.kind !== 'global' || item.status !== 'review')) throw problem(409, 'TASK_STATE');
          if (input.action === 'return' && (item.kind !== 'global' || item.status !== 'review')) throw problem(409, 'TASK_STATE');
          if (input.action === 'reopen' && !['completed', 'cancelled', 'not-done', 'not-applicable'].includes(item.status)) throw problem(409, 'TASK_STATE');
          if (input.action !== 'approve' && !note) throw problem(400, 'TASK_REASON');
          item.status = input.action === 'approve' ? 'completed' : input.action === 'cancel' ? 'cancelled' : 'pending';
          if (input.action === 'reopen' || input.action === 'return') item.report = null;
        } else throw problem(400, 'INVALID_TASK');
      }
      item.events.push({...event(user, input.action, note, at), status: item.status || null, late: input.action === 'report' ? at > item.due + (item.kind === 'shift' ? GRACE : 0) : undefined, snapshot: input.action === 'edit' ? {...fieldsSnapshot(item), due: item.due || null} : undefined});
      store.audit(user, 'task-' + input.action, 'tasks');
      return {item: save(table, item)};
    });
  }
  function preview(date, assigneeId, user) {
    admin(user);
    const owner = roster().find(person => person.id === assigneeId);
    if (!owner) throw problem(400, 'INVALID_TASK_ASSIGNEE');
    return {shift: shift(date, owner.team), timezone};
  }
  return {list, summary, create, change, shift, instant, localDate, currentShift, preview};
}
module.exports = {createTasks};
