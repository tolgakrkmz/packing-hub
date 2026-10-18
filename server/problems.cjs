/* Global problems sit outside the team's control: we record them and the solutions we propose until they are resolved. */
const {randomUUID, createHash} = require('node:crypto');
const {problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const {createTaskPhotos, photoList, photoInputs} = require('./task-photos.cjs');
const LEVELS = ['low', 'medium', 'high'];
function createProblems(store, {now = Date.now, photos: photoOptions} = {}) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS problem_items(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS problem_requests(actor INTEGER NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,id));`);
  // Problem photos live in their own table, so task retention cleanup never removes them; they stay while their problem exists.
  const photos = createTaskPhotos(store, {...photoOptions, table: 'problem_photos'});
  const references = item => [...photoList(item, 'photos'), ...item.proposals.flatMap(entry => photoList(entry, 'photos'))];
  function prune() {
    const keep = new Set(all().flatMap(item => references(item).map(photo => photo.id)));
    const remove = db.prepare('DELETE FROM problem_photos WHERE id=?');
    for (const {id} of db.prepare('SELECT id FROM problem_photos').all()) if (!keep.has(id)) remove.run(id);
  }
  const access = user => { if (!can(user, 'canViewProblems')) throw problem(403, 'FORBIDDEN'); };
  const manager = user => can(user, 'canManageProblems');
  function text(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw problem(400, 'INVALID_PROBLEM');
    return value.trim();
  }
  function fields(input) {
    if (!LEVELS.includes(input.impactLevel)) throw problem(400, 'INVALID_PROBLEM');
    return {title: text(input.title, 180, true), description: text(input.description ?? '', 4000), impactLevel: input.impactLevel, impact: text(input.impact ?? '', 1000), dependsOn: text(input.dependsOn ?? '', 160),
      // Optional English versions are written by people for meetings; free text is never sent to a translation service.
      titleEn: text(input.titleEn ?? '', 180), descriptionEn: text(input.descriptionEn ?? '', 4000), impactEn: text(input.impactEn ?? '', 1000), dependsOnEn: text(input.dependsOnEn ?? '', 160)};
  }
  function row(id) {
    const found = db.prepare('SELECT * FROM problem_items WHERE id=?').get(id);
    if (!found) throw problem(404, 'NOT_FOUND');
    return {...JSON.parse(found.data), id: found.id, revision: found.revision};
  }
  // The column follows the record: resolved, otherwise whether any solution has been proposed.
  const derived = item => ({...item, stage: item.resolvedAt ? 'resolved' : item.proposals.length ? 'proposed' : 'open'});
  function all() { return db.prepare('SELECT * FROM problem_items').all().map(found => ({...JSON.parse(found.data), id: found.id, revision: found.revision})); }
  function list(user) {
    access(user);
    const available = new Set(db.prepare('SELECT id FROM problem_photos').all().map(found => found.id));
    const mark = list => (list || []).map(photo => ({...photo, available: available.has(photo.id)}));
    return {photoPolicy: photos.policy(), items: all().map(item => derived({...item, photos: mark(item.photos), proposals: item.proposals.map(entry => ({...entry, photos: mark(entry.photos)}))}))};
  }
  function photo(id, photoId, user) {
    access(user);
    if (!references(row(id)).some(value => value.id === photoId)) throw problem(404, 'NOT_FOUND');
    const found = db.prepare('SELECT content FROM problem_photos WHERE id=?').get(photoId);
    if (!found) throw problem(404, 'NOT_FOUND');
    return Buffer.from(found.content);
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
      const id = randomUUID(), attached = photos.addMany(photoInputs(input, 'photos', 'photo'), at);
      db.prepare('INSERT INTO problem_items(id,data) VALUES(?,?)').run(id, JSON.stringify({...values, photos: attached, createdAt: at, createdBy: actor(user), resolvedAt: null, proposals: [], events: [{at, actor: actor(user), action: 'created'}]}));
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
        if (input.photos !== undefined) item.photos = photos.addMany(photoInputs(input, 'photos', 'photo'), at, photoList(item, 'photos'));
      } else if (input.action === 'propose') {
        if (!can(user, 'canCreateProblems')) throw problem(403, 'FORBIDDEN');
        if (item.resolvedAt) throw problem(409, 'PROBLEM_STATE');
        if (item.proposals.length >= 30) throw problem(400, 'INVALID_PROBLEM');
        item.proposals.push({id: randomUUID(), at, actor: actor(user), text: text(input.text, 2000, true), textEn: text(input.textEn ?? '', 2000), photos: photos.addMany(photoInputs(input, 'photos', 'photo'), at)});
      } else if (input.action === 'translate') {
        const entry = item.proposals.find(value => value.id === input.proposalId);
        if (!entry) throw problem(400, 'INVALID_PROBLEM');
        if (!manager(user) && entry.actor.id !== user.id) throw problem(403, 'FORBIDDEN');
        entry.textEn = text(input.textEn ?? '', 2000);
      } else if (input.action === 'resolve' || input.action === 'reopen') {
        if (!manager(user) && !author) throw problem(403, 'FORBIDDEN');
        if (!item.resolvedAt !== (input.action === 'resolve')) throw problem(409, 'PROBLEM_STATE');
        item.resolvedAt = input.action === 'resolve' ? at : null;
      } else throw problem(400, 'INVALID_PROBLEM');
      item.events.push({at, actor: actor(user), action: input.action});
      store.audit(user, 'problem-' + input.action, 'problems');
      const saved = save(item); prune();
      return {item: derived(saved)};
    };
    if (input.requestId) return idempotent({...input, problemId: id, expected}, user, work);
    return store.transaction(work);
  }
  function save(value) {
    const {id, revision, stage, ...data} = value;
    db.prepare('UPDATE problem_items SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(data), id);
    return row(id);
  }
  return {list, create, change, photo};
}
module.exports = {createProblems};
