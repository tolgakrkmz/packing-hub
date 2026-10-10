const {problem} = require('./store.cjs');

// Read the existing metadata journal; report bodies and credentials never enter this view.
function createActivity(store) {
  const {db} = store;
  db.exec('CREATE INDEX IF NOT EXISTS audit_user_id ON audit(user_id,id DESC); CREATE INDEX IF NOT EXISTS audit_at ON audit(at)');
  function list(params, user) {
    if (user?.role !== 'admin') throw problem(403, 'FORBIDDEN');
    const allowed = ['userId', 'from', 'to', 'before', 'limit', 'action'];
    if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw problem(400, 'INVALID_ACTIVITY_FILTER');
    const number = (key, fallback) => {
      const value = params.get(key);
      if (value === null) return fallback;
      if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw problem(400, 'INVALID_ACTIVITY_FILTER');
      return Number(value);
    };
    const userId = number('userId', null), from = number('from', null), to = number('to', null), before = number('before', null), limit = number('limit', 50);
    const action = params.get('action') || 'all';
    if (limit > 100 || from !== null && to !== null && from >= to || !['all', 'visit', 'login', 'logout', 'changes'].includes(action)) throw problem(400, 'INVALID_ACTIVITY_FILTER');
    const clauses = [], values = [];
    for (const [value, clause] of [[userId, 'a.user_id=?'], [from, 'a.at>=?'], [to, 'a.at<?'], [before, 'a.id<?']]) {
      if (value !== null) { clauses.push(clause); values.push(value); }
    }
    if (action === 'changes') clauses.push("a.action NOT IN ('visit','login','logout')");
    else if (action !== 'all') { clauses.push('a.action=?'); values.push(action); }
    const rows = db.prepare(`SELECT a.id,a.at,a.user_id AS userId,a.action,a.module,u.username,u.active,u.deleted_at AS deletedAt
      FROM audit a LEFT JOIN users u ON u.id=a.user_id ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
      ORDER BY a.id DESC LIMIT ?`).all(...values, limit + 1);
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    const users = db.prepare(`SELECT u.id,u.username,u.role,u.active,u.deleted_at AS deletedAt,
      a.at AS lastVisitAt,a.module AS lastModule,a.action AS lastAction
      FROM users u LEFT JOIN audit a ON a.id=(SELECT id FROM audit WHERE user_id=u.id AND action IN ('visit','login') ORDER BY id DESC LIMIT 1)
      ORDER BY u.username`).all();
    return {users, events, nextBefore: hasMore ? events.at(-1).id : null};
  }
  return {list};
}
module.exports = {createActivity};
