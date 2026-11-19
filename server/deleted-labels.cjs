/* Labels to be deleted: a shift lead adds a label photo and the reason, the server reads its fields, a manager marks it deleted or removes it. */
const {randomUUID} = require('node:crypto');
const {problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const {createTaskPhotos, jpeg} = require('./task-photos.cjs');
const labelReader = require('./label-reader.cjs');
const DAY = 86400000, LIMIT_BYTES = 200 * 1024 * 1024;
// The reading copy is sharper than the stored photo and is never saved.
const READ_EDGE = 2400, READ_BYTES = 1536 * 1024;
function createDeletedLabels(store, {now = Date.now, photos: photoOptions, reader = labelReader.read} = {}) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS deleted_labels(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);`);
  const requests = store.requestLog('deleted_label_requests', 'INVALID_LABEL', now), idempotent = requests.run;
  // Own photo table, so task and problem retention never touch label evidence.
  const photos = createTaskPhotos(store, {...photoOptions, limitBytes: Math.min(photoOptions?.limitBytes ?? LIMIT_BYTES, LIMIT_BYTES), table: 'label_photos'});
  const access = user => { if (!can(user, 'canViewDeletedLabels')) throw problem(403, 'FORBIDDEN'); };
  const manager = user => { access(user); if (!can(user, 'canManageDeletedLabels')) throw problem(403, 'FORBIDDEN'); };
  const actor = user => ({id: user.id, username: user.username});
  const shape = (found, has = photos.exists) => { const item = JSON.parse(found.data); return {...item, id: found.id, revision: found.revision, photo: {...item.photo, available: has(item.photo.id)}}; };
  // Reading saves nothing: the lead checks the pallet number before the label is added.
  async function read(input, user) {
    access(user);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => key !== 'photo')) throw problem(400, 'INVALID_LABEL');
    return {fields: await reader(jpeg(input.photo, {maxBytes: READ_BYTES, maxEdge: READ_EDGE}).content)};
  }
  function fields(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !labelReader.FIELDS.includes(key))) throw problem(400, 'INVALID_LABEL');
    const result = Object.fromEntries(labelReader.FIELDS.map(key => {
      const value = input[key] ?? '';
      if (typeof value !== 'string' || value.length > 120) throw problem(400, 'INVALID_LABEL');
      return [key, key === 'palletNo' ? value.replace(/\s+/g, '').toUpperCase() : value.trim()];
    }));
    if (!result.palletNo) throw problem(400, 'LABEL_PALLET_REQUIRED');
    return result;
  }
  function row(id) {
    const found = db.prepare('SELECT * FROM deleted_labels WHERE id=?').get(id);
    if (!found) throw problem(404, 'NOT_FOUND');
    return found;
  }
  function list(user) {
    access(user);
    // One query for which photos still exist, instead of one per label.
    const available = new Set(db.prepare('SELECT id FROM label_photos').all().map(found => found.id));
    return {items: db.prepare('SELECT * FROM deleted_labels').all().map(found => shape(found, id => available.has(id))), photoPolicy: {...photos.policy(), maxPhotos: 1}};
  }
  function create(input, user) {
    access(user);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['requestId', 'text', 'photo', 'fields'].includes(key))) throw problem(400, 'INVALID_LABEL');
    if (typeof (input.text ?? '') !== 'string' || (input.text ?? '').length > 300) throw problem(400, 'INVALID_LABEL');
    if (typeof input.photo !== 'string') throw problem(400, 'TASK_PHOTO_REQUIRED');
    const values = fields(input.fields), text = (input.text ?? '').trim();
    if (!text) throw problem(400, 'LABEL_REASON_REQUIRED');
    return idempotent(input, user, () => {
      // Two leads may photograph the same label; only one pending entry per pallet.
      if (db.prepare("SELECT 1 FROM deleted_labels WHERE json_extract(data,'$.status')='pending' AND json_extract(data,'$.fields.palletNo')=?").get(values.palletNo)) throw problem(409, 'LABEL_DUPLICATE');
      const id = randomUUID(), at = now();
      db.prepare('INSERT INTO deleted_labels(id,data) VALUES(?,?)').run(id, JSON.stringify({text, fields: values, photo: photos.add(input.photo, at), createdAt: at, createdBy: actor(user), status: 'pending', deletedAt: null, deletedBy: null}));
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
  // After a label is marked deleted its photo is kept 7 days and its record a year, so it can still be searched.
  // shortcut: the whole list is sent to the page and searched there, fine for a few thousand records a year; move search to the server when it grows.
  function prune() {
    store.transaction(() => {
      const at = now();
      for (const found of db.prepare('SELECT id,data FROM deleted_labels').all()) {
        const item = JSON.parse(found.data);
        if (!item.deletedAt) continue;
        if (item.deletedAt < at - 7 * DAY) db.prepare('DELETE FROM label_photos WHERE id=?').run(item.photo.id);
        if (item.deletedAt < at - 365 * DAY) db.prepare('DELETE FROM deleted_labels WHERE id=?').run(found.id);
      }
      requests.prune(at - 90 * DAY);
    });
  }
  return {list, read, create, change, photo, prune};
}
module.exports = {createDeletedLabels};
