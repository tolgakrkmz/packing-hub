/* Profile photos stay in the local database; only the signed-in owner reads or changes one. */
const {problem} = require('./store.cjs');
const {jpeg} = require('./task-photos.cjs');
const MAX_BYTES = 64 * 1024, MAX_EDGE = 512;
const REQUEST_BYTES = Math.ceil(MAX_BYTES / 3) * 4 + 1024;
function createAccountAvatars(store) {
  const {db} = store;
  db.exec('CREATE TABLE IF NOT EXISTS user_avatars(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, content BLOB NOT NULL, updated_at INTEGER NOT NULL);');
  // The version changes with every upload so clients never show a stale photo.
  const version = userId => db.prepare('SELECT updated_at FROM user_avatars WHERE user_id=?').get(userId)?.updated_at || null;
  function set(user, input) {
    let value;
    try { value = jpeg(input, {maxBytes: MAX_BYTES, maxEdge: MAX_EDGE}); }
    catch (error) { throw problem(error.status === 413 ? 413 : 400, 'AVATAR_INVALID'); }
    if (value.width !== value.height) throw problem(400, 'AVATAR_INVALID');
    return store.transaction(() => {
      const at = Math.max(Date.now(), (version(user.id) || 0) + 1);
      db.prepare('INSERT INTO user_avatars(user_id,content,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at').run(user.id, value.content, at);
      store.audit(user, 'avatar-update', 'accounts');
      return {avatar: at};
    });
  }
  function remove(user) {
    return store.transaction(() => {
      const result = db.prepare('DELETE FROM user_avatars WHERE user_id=?').run(user.id);
      if (result.changes) store.audit(user, 'avatar-remove', 'accounts');
      return {avatar: null};
    });
  }
  function get(user) {
    const row = db.prepare('SELECT content FROM user_avatars WHERE user_id=?').get(user.id);
    if (!row) throw problem(404, 'NOT_FOUND');
    return Buffer.from(row.content);
  }
  return {version, set, remove, get, policy: () => ({maxBytes: MAX_BYTES, maxEdge: MAX_EDGE})};
}
module.exports = {createAccountAvatars, MAX_BYTES, MAX_EDGE, REQUEST_BYTES};
