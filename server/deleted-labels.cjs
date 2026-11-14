/* Labels to be deleted: anyone with access adds one with a required photo; a manager marks it deleted or removes it. */
const {randomUUID} = require('node:crypto');
const {problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const {createTaskPhotos} = require('./task-photos.cjs');
const DAY = 86400000, LIMIT_BYTES = 200 * 1024 * 1024;
function createDeletedLabels(store, {now = Date.now, photos: photoOptions} = {}) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS deleted_labels(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);`);
  const requests = store.requestLog('deleted_label_requests', 'INVALID_LABEL', now), idempotent = requests.run;
  // Own photo table, so task and problem retention never touch label evidence.
  const photos = createTaskPhotos(store, {...photoOptions, limitBytes: Math.min(photoOptions?.limitBytes ?? LIMIT_BYTES, LIMIT_BYTES), table: 'label_photos'});
  const access = user => { if (!can(user, 'canViewDeletedLabels')) throw problem(403, 'FORBIDDEN'); };
  const manager = user => { access(user); if (!can(user, 'canManageDeletedLabels')) throw problem(403, 'FORBIDDEN'); };
  const actor = user => ({id: user.id, username: user.username});
  const shape = found => { const item = JSON.parse(found.data); return {...item, id: found.id, revision: found.revision, photo: {...item.photo, available: photos.exists(item.photo.id)}}; };
  function row(id) {
    const found = db.prepare('SELECT * FROM deleted_labels WHERE id=?').get(id);
    if (!found) throw problem(404, 'NOT_FOUND');
    return found;
  }
  function list(user) {
    access(user);
    return {items: db.prepare('SELECT * FROM deleted_labels').all().map(shape), photoPolicy: {...photos.policy(), maxPhotos: 1}};
  }
  function create(input, user) {
    access(user);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['requestId', 'text', 'photo'].includes(key))) throw problem(400, 'INVALID_LABEL');
    if (typeof (input.text ?? '') !== 'string' || (input.text ?? '').length > 300) throw problem(400, 'INVALID_LABEL');
    if (typeof input.photo !== 'string') throw problem(400, 'TASK_PHOTO_REQUIRED');
    return idempotent(input, user, () => {
      const id = randomUUID(), at = now();
      db.prepare('INSERT INTO deleted_labels(id,data) VALUES(?,?)').run(id, JSON.stringify({text: (input.text ?? '').trim(), photo: photos.add(input.photo, at), createdAt: at, createdBy: actor(user), status: 'pending', deletedAt: null, deletedBy: null}));
      store.audit(user, 'deleted-label-create', 'deleted-labels');
      return {id};
    });
  }
  function change(id, input, expected, user) {
    manager(user);
    const work = () => {
      const found = row(id), item = JSON.parse(found.data);
      if (found.revision !== expected) throw problem(409, 'CONFLICT');
      if (input.action === 'remove') {
        db.prepare('DELETE FROM deleted_labels WHERE id=?').run(id);
        db.prepare('DELETE FROM label_photos WHERE id=?').run(item.photo.id);
      } else if (input.action === 'delete' || input.action === 'reopen') {
        if ((item.status === 'pending') !== (input.action === 'delete')) throw problem(409, 'LABEL_STATE');
        Object.assign(item, input.action === 'delete' ? {status: 'deleted', deletedAt: now(), deletedBy: actor(user)} : {status: 'pending', deletedAt: null, deletedBy: null});
        db.prepare('UPDATE deleted_labels SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(item), id);
      } else throw problem(400, 'INVALID_LABEL');
      store.audit(user, 'deleted-label-' + input.action, 'deleted-labels');
      return input.action === 'remove' ? {removed: id} : {item: shape(row(id))};
    };
    if (input.requestId) return idempotent({...input, labelId: id, expected}, user, work);
    return store.transaction(work);
  }
  function photo(id, photoId, user) {
    access(user);
    if (JSON.parse(row(id).data).photo.id !== photoId) throw problem(404, 'NOT_FOUND');
    const found = db.prepare('SELECT content FROM label_photos WHERE id=?').get(photoId);
    if (!found) throw problem(404, 'NOT_FOUND');
    return Buffer.from(found.content);
  }
  // Labels marked deleted are kept 30 days so the mark can still be checked or undone; request ids follow the 90-day window.
  function prune() {
    store.transaction(() => {
      const cutoff = now() - 30 * DAY;
      for (const found of db.prepare('SELECT id,data FROM deleted_labels').all()) {
        const item = JSON.parse(found.data);
        if (item.deletedAt && item.deletedAt < cutoff) { db.prepare('DELETE FROM deleted_labels WHERE id=?').run(found.id); db.prepare('DELETE FROM label_photos WHERE id=?').run(item.photo.id); }
      }
      requests.prune(now() - 90 * DAY);
    });
  }
  return {list, create, change, photo, prune};
}
module.exports = {createDeletedLabels};
