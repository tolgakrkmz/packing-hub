/* Global problems sit outside the team's control: we describe, escalate and follow them up until the fix is verified. */
const {randomUUID, createHash} = require('node:crypto');
const {problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const STATUSES = ['new', 'described', 'presented', 'escalated', 'in-resolution', 'verification', 'resolved', 'postponed', 'rejected'];
const WAITING = ['escalated', 'in-resolution'];
const CLOSED = ['resolved', 'rejected'];
const CATEGORIES = ['equipment', 'materials', 'quality', 'safety', 'it', 'organization', 'other'];
const LEVELS = ['low', 'medium', 'high'];
const EFFORTS = ['S', 'M', 'L'];
const DAY = 86400000;
const dateKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function createProblems(store, {timezone = 'Europe/Sofia', now = Date.now} = {}) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS problem_items(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS problem_requests(actor INTEGER NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,id));`);
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'});
  const localDate = at => formatter.format(new Date(at));
  const access = user => { if (!can(user, 'canViewProblems')) throw problem(403, 'FORBIDDEN'); };
  const manager = user => can(user, 'canManageProblems');
  function text(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw problem(400, 'INVALID_PROBLEM');
    return value.trim();
  }
  function choice(value, list) { if (!list.includes(value)) throw problem(400, 'INVALID_PROBLEM'); return value; }
  function day(value) {
    if (value === null || value === undefined || value === '') return null;
    if (!dateKey(value)) throw problem(400, 'INVALID_PROBLEM_DATE');
    return value;
  }
  function owners() {
    return db.prepare('SELECT id,username,role,permissions,task_supervisor FROM users WHERE active=1 AND deleted_at IS NULL ORDER BY username').all()
      .filter(row => can({role: row.role, taskSupervisor: row.task_supervisor === 1, permissionOverrides: JSON.parse(row.permissions)}, 'canViewProblems'))
      .map(row => ({id: row.id, username: row.username}));
  }
  function owner(id) {
    if (id === null) return null;
    const found = Number.isSafeInteger(id) && owners().find(person => person.id === id);
    if (!found) throw problem(400, 'INVALID_PROBLEM_OWNER');
    return found;
  }
  function fields(input) {
    return {title: text(input.title, 180, true), area: text(input.area ?? '', 120), category: choice(input.category, CATEGORIES), description: text(input.description ?? '', 4000),
      impactLevel: choice(input.impactLevel, LEVELS), impact: text(input.impact ?? '', 1000), rootCause: text(input.rootCause ?? '', 2000),
      dependsOn: text(input.dependsOn ?? '', 160), contact: text(input.contact ?? '', 160), request: text(input.request ?? '', 2000)};
  }
  // Waiting on others is only meaningful with a party, a concrete request, our follow-up owner and a next contact date.
  function ready(item) {
    if (item.status === 'escalated' && (!item.dependsOn || !item.request || !item.owner || !item.nextContact)) throw problem(400, 'PROBLEM_ESCALATION_INCOMPLETE');
    if (item.status === 'in-resolution' && (!item.dependsOn || !item.owner)) throw problem(400, 'PROBLEM_ESCALATION_INCOMPLETE');
  }
  function row(id) {
    const found = db.prepare('SELECT * FROM problem_items WHERE id=?').get(id);
    if (!found) throw problem(404, 'NOT_FOUND');
    return {...JSON.parse(found.data), id: found.id, revision: found.revision};
  }
  function all() { return db.prepare('SELECT * FROM problem_items').all().map(found => ({...JSON.parse(found.data), id: found.id, revision: found.revision})); }
  function save(value) {
    const {id, revision, ...data} = value;
    db.prepare('UPDATE problem_items SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(data), id);
    return row(id);
  }
  const actor = user => ({id: user.id, username: user.username});
  function derived(item, today) {
    const waiting = WAITING.includes(item.status), open = !CLOSED.includes(item.status);
    const last = item.contacts.at(-1);
    const since = last?.date || item.escalatedOn;
    const promised = [...item.contacts].reverse().find(entry => entry.promisedDate)?.promisedDate || null;
    return {...item, quietDays: waiting && since ? Math.max(0, Math.round((Date.parse(today) - Date.parse(since)) / DAY)) : null,
      contactOverdue: waiting && !!item.nextContact && item.nextContact < today, promisedDate: open ? promised : null, promiseOverdue: open && !!promised && promised < today};
  }
  function list(user) {
    access(user); const at = now(), today = localDate(at);
    return {now: at, today, timezone, owners: manager(user) ? owners() : [], items: all().map(item => derived(item, today))};
  }
  function idempotent(input, user, work) {
    if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.requestId)) throw problem(400, 'INVALID_PROBLEM');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return store.transaction(() => {
      const prior = db.prepare('SELECT hash,result FROM problem_requests WHERE actor=? AND id=?').get(user.id, input.requestId);
      if (prior) { if (prior.hash !== hash) throw problem(409, 'CONFLICT'); return JSON.parse(prior.result); }
      const result = work();
      db.prepare('INSERT INTO problem_requests(actor,id,hash,result) VALUES(?,?,?,?)').run(user.id, input.requestId, hash, JSON.stringify(result));
      return result;
    });
  }
  function create(input, user) {
    access(user); if (!can(user, 'canCreateProblems')) throw problem(403, 'FORBIDDEN');
    const values = fields(input), at = now();
    return idempotent(input, user, () => {
      const id = randomUUID();
      db.prepare('INSERT INTO problem_items(id,data) VALUES(?,?)').run(id, JSON.stringify({...values, status: 'new', owner: null, nextContact: null, escalatedOn: null, closedAt: null,
        createdAt: at, createdBy: actor(user), proposals: [], contacts: [], events: [{at, actor: actor(user), action: 'created', note: '', status: 'new'}]}));
      store.audit(user, 'problem-create', 'problems');
      return {id};
    });
  }
  function change(id, input, expected, user) {
    access(user);
    const work = () => {
      const at = now(), today = localDate(at), item = row(id);
      if (item.revision !== expected) throw problem(409, 'CONFLICT');
      const note = text(input.note ?? '', 4000);
      if (CLOSED.includes(item.status) && input.action !== 'status') throw problem(409, 'PROBLEM_STATE');
      if (input.action === 'edit') {
        const author = item.createdBy.id === user.id && item.status === 'new' && can(user, 'canCreateProblems');
        if (!manager(user) && !author) throw problem(403, 'FORBIDDEN');
        Object.assign(item, fields(input)); ready(item);
      } else if (input.action === 'status') {
        if (!manager(user)) throw problem(403, 'FORBIDDEN');
        const status = choice(input.status, STATUSES);
        if (['postponed', 'rejected'].includes(status) && !note) throw problem(400, 'PROBLEM_REASON');
        if (Object.hasOwn(input, 'ownerId')) item.owner = owner(input.ownerId);
        if (Object.hasOwn(input, 'nextContact')) item.nextContact = day(input.nextContact);
        if (status === 'escalated' && item.status !== 'escalated') item.escalatedOn = today;
        item.status = status; item.closedAt = CLOSED.includes(status) ? at : null;
        ready(item);
      } else if (input.action === 'propose') {
        if (!can(user, 'canCreateProblems')) throw problem(403, 'FORBIDDEN');
        if (item.proposals.length >= 30) throw problem(400, 'INVALID_PROBLEM');
        item.proposals.push({id: randomUUID(), at, actor: actor(user), text: text(input.text, 2000, true), effort: choice(input.effort, EFFORTS), accepted: false});
      } else if (input.action === 'accept') {
        if (!manager(user)) throw problem(403, 'FORBIDDEN');
        if (!item.proposals.some(entry => entry.id === input.proposalId)) throw problem(400, 'INVALID_PROBLEM');
        for (const entry of item.proposals) entry.accepted = entry.id === input.proposalId;
      } else if (input.action === 'contact') {
        if (!manager(user) && item.owner?.id !== user.id) throw problem(403, 'FORBIDDEN');
        if (item.contacts.length >= 200) throw problem(400, 'INVALID_PROBLEM');
        const date = day(input.date);
        if (!date || date > today) throw problem(400, 'INVALID_PROBLEM_DATE');
        if (!note) throw problem(400, 'PROBLEM_REASON');
        item.contacts.push({id: randomUUID(), at, actor: actor(user), date, with: text(input.with ?? '', 160), note, promisedDate: day(input.promisedDate)});
        if (Object.hasOwn(input, 'nextContact')) item.nextContact = day(input.nextContact);
        ready(item);
      } else throw problem(400, 'INVALID_PROBLEM');
      item.events.push({at, actor: actor(user), action: input.action, note, status: item.status});
      store.audit(user, 'problem-' + input.action, 'problems');
      return {item: derived(save(item), today)};
    };
    if (input.requestId) return idempotent({...input, problemId: id, expected}, user, work);
    return store.transaction(work);
  }
  return {list, create, change, localDate};
}
module.exports = {createProblems, STATUSES, CATEGORIES};
