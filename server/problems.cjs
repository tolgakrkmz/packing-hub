/* Global problems sit outside the team's control: we record them and the solutions we propose until they are resolved. */
const {randomUUID, createHash} = require('node:crypto');
const {problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const LEVELS = ['low', 'medium', 'high'];
function createProblems(store, {now = Date.now} = {}) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS problem_items(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS problem_requests(actor INTEGER NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,id));`);
  const access = user => { if (!can(user, 'canViewProblems')) throw problem(403, 'FORBIDDEN'); };
  const manager = user => can(user, 'canManageProblems');
  function text(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw problem(400, 'INVALID_PROBLEM');
    return value.trim();
  }
  function fields(input) {
    if (!LEVELS.includes(input.impactLevel)) throw problem(400, 'INVALID_PROBLEM');
    return {title: text(input.title, 180, true), description: text(input.description ?? '', 4000), impactLevel: input.impactLevel, impact: text(input.impact ?? '', 1000), dependsOn: text(input.dependsOn ?? '', 160)};
  }
  function row(id) {
    const found = db.prepare('SELECT * FROM problem_items WHERE id=?').get(id);
    if (!found) throw problem(404, 'NOT_FOUND');
    return {...JSON.parse(found.data), id: found.id, revision: found.revision};
  }
  // The column follows the record: resolved, otherwise whether any solution has been proposed.
  const derived = item => ({...item, stage: item.resolvedAt ? 'resolved' : item.proposals.length ? 'proposed' : 'open'});
  function list(user) {
    access(user);
    return {items: db.prepare('SELECT * FROM problem_items').all().map(found => derived({...JSON.parse(found.data), id: found.id, revision: found.revision}))};
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
  const actor = user => ({id: user.id, username: user.username});
  function create(input, user) {
    access(user); if (!can(user, 'canCreateProblems')) throw problem(403, 'FORBIDDEN');
    const values = fields(input), at = now();
    return idempotent(input, user, () => {
      const id = randomUUID();
      db.prepare('INSERT INTO problem_items(id,data) VALUES(?,?)').run(id, JSON.stringify({...values, createdAt: at, createdBy: actor(user), resolvedAt: null, proposals: [], events: [{at, actor: actor(user), action: 'created'}]}));
      store.audit(user, 'problem-create', 'problems');
      return {id};
    });
  }
  function change(id, input, expected, user) {
    access(user);
    const work = () => {
      const at = now(), item = row(id);
      if (item.revision !== expected) throw problem(409, 'CONFLICT');
      const author = item.createdBy.id === user.id && can(user, 'canCreateProblems');
      if (input.action === 'edit') {
        if (!manager(user) && !author) throw problem(403, 'FORBIDDEN');
        Object.assign(item, fields(input));
      } else if (input.action === 'propose') {
        if (!can(user, 'canCreateProblems')) throw problem(403, 'FORBIDDEN');
        if (item.resolvedAt) throw problem(409, 'PROBLEM_STATE');
        if (item.proposals.length >= 30) throw problem(400, 'INVALID_PROBLEM');
        item.proposals.push({id: randomUUID(), at, actor: actor(user), text: text(input.text, 2000, true)});
      } else if (input.action === 'resolve' || input.action === 'reopen') {
        if (!manager(user) && !author) throw problem(403, 'FORBIDDEN');
        if (!item.resolvedAt !== (input.action === 'resolve')) throw problem(409, 'PROBLEM_STATE');
        item.resolvedAt = input.action === 'resolve' ? at : null;
      } else throw problem(400, 'INVALID_PROBLEM');
      item.events.push({at, actor: actor(user), action: input.action});
      store.audit(user, 'problem-' + input.action, 'problems');
      return {item: derived(save(item))};
    };
    if (input.requestId) return idempotent({...input, problemId: id, expected}, user, work);
    return store.transaction(work);
  }
  function save(value) {
    const {id, revision, stage, ...data} = value;
    db.prepare('UPDATE problem_items SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(data), id);
    return row(id);
  }
  return {list, create, change};
}
module.exports = {createProblems};
