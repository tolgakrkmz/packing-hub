/* Informal wall for shift leads: short posts, one photo, reactions and comments. Everything expires after 90 days. */
const {randomUUID, createHash} = require('node:crypto');
const {problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const {createTaskPhotos} = require('./task-photos.cjs');
const REACTIONS = ['beer', 'laugh', 'fire', 'like'];
const RETENTION = 90 * 86400000, PAGE = 10;
function createWall(store, {now = Date.now, photos: photoOptions} = {}) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS wall_posts(id TEXT PRIMARY KEY, author_id INTEGER NOT NULL, text TEXT NOT NULL, photo TEXT, created_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS wall_comments(id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE, author_id INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wall_reactions(post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(post_id,user_id,kind));
    CREATE TABLE IF NOT EXISTS wall_requests(actor INTEGER NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(actor,id));
    CREATE TABLE IF NOT EXISTS wall_seen(user_id INTEGER PRIMARY KEY, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS wall_comments_post ON wall_comments(post_id,created_at);`);
  // Wall photos have their own table, so task and problem retention never touch them and vice versa.
  const photos = createTaskPhotos(store, {...photoOptions, table: 'wall_photos'});
  const view = user => { if (!can(user, 'canViewWall')) throw problem(403, 'FORBIDDEN'); };
  const poster = user => { view(user); if (!can(user, 'canPostWall')) throw problem(403, 'FORBIDDEN'); };
  const admin = user => user.role === 'admin';
  function text(value, max, required) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw problem(400, 'INVALID_WALL');
    return value.trim();
  }
  function post(id) {
    const found = db.prepare('SELECT * FROM wall_posts WHERE id=?').get(id);
    if (!found) throw problem(404, 'NOT_FOUND');
    return found;
  }
  function cleanup() {
    store.transaction(() => {
      const cutoff = now() - RETENTION;
      db.prepare('DELETE FROM wall_comments WHERE post_id IN (SELECT id FROM wall_posts WHERE created_at<?)').run(cutoff);
      db.prepare('DELETE FROM wall_reactions WHERE post_id IN (SELECT id FROM wall_posts WHERE created_at<?)').run(cutoff);
      db.prepare('DELETE FROM wall_posts WHERE created_at<?').run(cutoff);
      db.prepare("DELETE FROM wall_photos WHERE id NOT IN (SELECT json_extract(photo,'$.id') FROM wall_posts WHERE photo IS NOT NULL)").run();
      db.prepare('DELETE FROM wall_requests WHERE at<?').run(cutoff);
    });
  }
  function person(id) {
    const found = db.prepare('SELECT u.id,u.username,a.updated_at AS avatar FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.id=?').get(id);
    return found ? {id: found.id, username: found.username, avatar: found.avatar || null} : {id, username: '—', avatar: null};
  }
  function shape(row, user) {
    const reactions = Object.fromEntries(REACTIONS.map(kind => [kind, 0]));
    for (const {kind, count} of db.prepare('SELECT kind,count(*) AS count FROM wall_reactions WHERE post_id=? GROUP BY kind').all(row.id)) reactions[kind] = count;
    const photo = row.photo ? JSON.parse(row.photo) : null;
    return {id: row.id, sequence: row.sequence, revision: row.revision, author: person(row.author_id), text: row.text, createdAt: row.created_at,
      photo: photo && {...photo, available: photos.exists(photo.id)}, reactions,
      mine: db.prepare('SELECT kind FROM wall_reactions WHERE post_id=? AND user_id=?').all(row.id, user.id).map(found => found.kind),
      comments: db.prepare('SELECT * FROM wall_comments WHERE post_id=? ORDER BY created_at,rowid').all(row.id).map(found => ({id: found.id, author: person(found.author_id), text: found.text, createdAt: found.created_at}))};
  }
  function list(user, before) {
    view(user); cleanup();
    if (before != null && (!/^\d{1,16}$/.test(before) || !Number.isSafeInteger(Number(before)))) throw problem(400, 'INVALID_DATA');
    const rows = db.prepare('SELECT rowid AS sequence,* FROM wall_posts WHERE (? IS NULL OR rowid<?) ORDER BY rowid DESC LIMIT ?').all(before ?? null, before == null ? null : Number(before), PAGE + 1);
    const items = rows.slice(0, PAGE).map(row => shape(row, user));
    // Opening the newest page counts as reading the wall, which clears the "new" badge.
    if (before == null) db.prepare('INSERT INTO wall_seen(user_id,at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET at=MAX(at,excluded.at)').run(user.id, now());
    return {items, nextBefore: rows.length > PAGE ? String(items.at(-1).sequence) : null, photoPolicy: {...photos.policy(), maxPhotos: 1}, reactions: REACTIONS};
  }
  function summary(user) {
    view(user);
    const seen = db.prepare('SELECT at FROM wall_seen WHERE user_id=?').get(user.id)?.at ?? 0;
    return {unread: db.prepare('SELECT count(*) AS n FROM wall_posts WHERE author_id<>? AND created_at>? AND created_at>=?').get(user.id, seen, now() - RETENTION).n};
  }
  function photo(id, photoId, user) {
    view(user);
    const value = post(id).photo;
    if (!value || JSON.parse(value).id !== photoId) throw problem(404, 'NOT_FOUND');
    const found = db.prepare('SELECT content FROM wall_photos WHERE id=?').get(photoId);
    if (!found) throw problem(404, 'NOT_FOUND');
    return Buffer.from(found.content);
  }
  // Author avatars are shown to wall readers without granting the accounts module.
  function authorId(id, user) {
    view(user);
    if (!db.prepare('SELECT 1 FROM wall_posts WHERE author_id=? UNION SELECT 1 FROM wall_comments WHERE author_id=?').get(id, id)) throw problem(404, 'NOT_FOUND');
    return id;
  }
  function idempotent(input, user, work) {
    if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.requestId)) throw problem(400, 'INVALID_WALL');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return store.transaction(() => {
      const prior = db.prepare('SELECT hash,result FROM wall_requests WHERE actor=? AND id=?').get(user.id, input.requestId);
      if (prior) { if (prior.hash !== hash) throw problem(409, 'CONFLICT'); return JSON.parse(prior.result); }
      const result = work();
      db.prepare('INSERT INTO wall_requests(actor,id,hash,result,at) VALUES(?,?,?,?,?)').run(user.id, input.requestId, hash, JSON.stringify(result), now());
      return result;
    });
  }
  const only = (input, keys) => { if (!input || typeof input !== 'object' || Object.keys(input).some(key => !keys.includes(key))) throw problem(400, 'INVALID_WALL'); };
  function create(input, user) {
    poster(user); only(input, ['requestId', 'text', 'photo']);
    const value = text(input.text ?? '', 500, false);
    if (input.photo != null && typeof input.photo !== 'string') throw problem(400, 'INVALID_WALL');
    if (!value && !input.photo) throw problem(400, 'INVALID_WALL');
    return idempotent(input, user, () => {
      const id = randomUUID(), at = now(), attached = input.photo ? photos.add(input.photo, at) : null;
      db.prepare('INSERT INTO wall_posts(id,author_id,text,photo,created_at) VALUES(?,?,?,?,?)').run(id, user.id, value, attached && JSON.stringify(attached), at);
      store.audit(user, 'wall-post', 'wall');
      return {id};
    });
  }
  function comment(id, input, user) {
    poster(user); only(input, ['requestId', 'text']);
    const value = text(input.text, 300, true);
    return idempotent({...input, postId: id}, user, () => {
      post(id);
      if (db.prepare('SELECT count(*) AS n FROM wall_comments WHERE post_id=?').get(id).n >= 200) throw problem(400, 'INVALID_WALL');
      const commentId = randomUUID();
      db.prepare('INSERT INTO wall_comments(id,post_id,author_id,text,created_at) VALUES(?,?,?,?,?)').run(commentId, id, user.id, value, now());
      db.prepare('UPDATE wall_posts SET revision=revision+1 WHERE id=?').run(id);
      store.audit(user, 'wall-comment', 'wall');
      return {id: commentId};
    });
  }
  function react(id, input, user) {
    view(user); only(input, ['requestId', 'kind']);
    if (!REACTIONS.includes(input.kind)) throw problem(400, 'INVALID_WALL');
    // The request id makes a retried toggle return the first answer instead of toggling back.
    return idempotent({...input, postId: id}, user, () => {
      post(id);
      const removed = db.prepare('DELETE FROM wall_reactions WHERE post_id=? AND user_id=? AND kind=?').run(id, user.id, input.kind).changes;
      if (!removed) db.prepare('INSERT INTO wall_reactions(post_id,user_id,kind) VALUES(?,?,?)').run(id, user.id, input.kind);
      db.prepare('UPDATE wall_posts SET revision=revision+1 WHERE id=?').run(id);
      return {active: !removed};
    });
  }
  function remove(id, commentId, user) {
    view(user);
    return store.transaction(() => {
      const found = post(id);
      if (commentId) {
        const entry = db.prepare('SELECT author_id FROM wall_comments WHERE id=? AND post_id=?').get(commentId, id);
        if (!entry) throw problem(404, 'NOT_FOUND');
        if (!admin(user) && entry.author_id !== user.id) throw problem(403, 'FORBIDDEN');
        db.prepare('DELETE FROM wall_comments WHERE id=?').run(commentId);
        db.prepare('UPDATE wall_posts SET revision=revision+1 WHERE id=?').run(id);
        store.audit(user, 'wall-comment-delete', 'wall');
      } else {
        if (!admin(user) && found.author_id !== user.id) throw problem(403, 'FORBIDDEN');
        db.prepare('DELETE FROM wall_comments WHERE post_id=?').run(id);
        db.prepare('DELETE FROM wall_reactions WHERE post_id=?').run(id);
        db.prepare('DELETE FROM wall_posts WHERE id=?').run(id);
        if (found.photo) db.prepare('DELETE FROM wall_photos WHERE id=?').run(JSON.parse(found.photo).id);
        store.audit(user, 'wall-delete', 'wall');
      }
      return {ok: true};
    });
  }
  return {list, summary, photo, authorId, create, comment, react, remove, cleanup};
}
module.exports = {createWall, REACTIONS};
