const crypto = require('node:crypto');
const {promisify} = require('node:util');
const {problem} = require('./store.cjs');
const {validateOverrides, permissionsFor, can} = require('./permissions.cjs');
const scrypt = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const publicUser = row => {
  const permissionOverrides = validateOverrides(JSON.parse(row.permissions || '{}'));
  const user = {id: row.id, username: row.username, role: row.role, active: !!row.active, permissionOverrides, taskSupervisor: !!row.task_supervisor, taskTeam: row.task_team || '', mustChangePassword: !!row.must_change_password};
  return {...user, permissions: permissionsFor(user)};
};
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw problem(400, 'PASSWORD_LENGTH');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024});
  return salt + ':' + hash.toString('hex');
}
async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const result = await scrypt(typeof password === 'string' && password.length <= 128 ? password : '', salt, 64, {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024});
  return crypto.timingSafeEqual(result, Buffer.from(hash, 'hex'));
}
function accounts(store) {
  const {db} = store;
  function revokePush(column, value) {
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='push_subscriptions'").get()) db.prepare('DELETE FROM push_subscriptions WHERE ' + column + '=?').run(value);
  }
  // Only this device keeps its push subscription after the session rotates.
  function keepPush(userId, previous, next) {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='push_subscriptions'").get()) return;
    db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND session_hash<>?').run(userId, previous);
    db.prepare('UPDATE push_subscriptions SET session_hash=? WHERE user_id=? AND session_hash=?').run(next, userId, previous);
  }
  const dummy = crypto.randomBytes(16).toString('hex') + ':' + crypto.randomBytes(64).toString('hex');
  function taskProfile(values, role, previous = {}) {
    const supervisor = values.taskSupervisor === undefined ? !!previous.task_supervisor : values.taskSupervisor;
    const team = values.taskTeam === undefined ? previous.task_team || '' : values.taskTeam;
    if (typeof supervisor !== 'boolean' || typeof team !== 'string' || !['', 'А', 'Б', 'В', 'Г', 'СТИКЕРИ'].includes(team) || supervisor && !team) throw problem(400, 'INVALID_TASK_PROFILE');
    return {supervisor: supervisor ? 1 : 0, team};
  }
  // Passwords set by an account manager are temporary until the account owner replaces them.
  async function create(username, password, role, actor, permissions = {}, authorize = () => {}, profile = {}, {temporary = false} = {}) {
    if (typeof username !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || !['admin', 'operator', 'observer'].includes(role)) throw problem(400, 'INVALID_ACCOUNT');
    const overrides = validateOverrides(permissions);
    const tasks = taskProfile(profile, role);
    const hash = await passwordHash(password);
    authorize();
    try { db.prepare('INSERT INTO users(username,hash,role,permissions,task_supervisor,task_team,must_change_password) VALUES(?,?,?,?,?,?,?)').run(username, hash, role, JSON.stringify(overrides), tasks.supervisor, tasks.team, temporary ? 1 : 0); }
    catch { throw problem(409, 'ACCOUNT_EXISTS'); }
    store.audit(actor, 'account-create', 'accounts');
    return publicUser(db.prepare('SELECT * FROM users WHERE username=?').get(username));
  }
  async function login(username, password) {
    const row = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username=? AND deleted_at IS NULL').get(username.toLowerCase()) : null;
    const valid = await checkPassword(password, row?.hash || dummy);
    const current = row && db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
    if (!valid || !current?.active || current.deleted_at !== null || current.hash !== row.hash) throw problem(401, 'INVALID_LOGIN');
    const issued = issue(row);
    store.audit(row, 'login', 'accounts');
    return {...issued, user: publicUser(current)};
  }
  function issue(row) {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + 12 * 3600000;
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions(hash,user_id,csrf,expires) VALUES(?,?,?,?)').run(digest(token), row.id, csrf, expires);
    return {token, csrf, expires};
  }
  function session(token) {
    if (typeof token !== 'string' || token.length > 100) return null;
    const row = db.prepare('SELECT u.*,s.csrf,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.active=1 AND u.deleted_at IS NULL').get(digest(token), Date.now());
    return row ? {user: publicUser(row), csrf: row.csrf, expires: row.expires} : null;
  }
  async function update(id, values, actor, authorize = () => {}, {temporaryPassword = false} = {}) {
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!row || row.deleted_at !== null) throw problem(404, 'NOT_FOUND');
    const role = values.role === undefined ? row.role : values.role;
    const active = values.active === undefined ? row.active : values.active ? 1 : 0;
    if (!['admin', 'operator', 'observer'].includes(role) || values.active !== undefined && typeof values.active !== 'boolean') throw problem(400, 'INVALID_ACCOUNT');
    const hash = values.password === undefined ? row.hash : await passwordHash(values.password);
    const overrides = values.permissions === undefined ? JSON.parse(row.permissions) : validateOverrides(values.permissions);
    const tasks = taskProfile(values, role, row);
    authorize();
    store.transaction(() => {
      const current = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!current || current.deleted_at !== null) throw problem(404, 'NOT_FOUND');
      if (current.hash !== row.hash || current.role !== row.role || current.active !== row.active || current.permissions !== row.permissions || current.task_supervisor !== row.task_supervisor || current.task_team !== row.task_team) throw problem(409, 'CONFLICT');
      if (row.role === 'admin' && row.active && (role !== 'admin' || !active) && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").get().n <= 1) throw problem(409, 'LAST_ADMIN');
      const next = {role, taskSupervisor: !!tasks.supervisor, permissionOverrides: overrides};
      if (can(publicUser(row), 'canManageAccounts') && row.active && (!active || !can(next, 'canManageAccounts')) && !db.prepare('SELECT * FROM users WHERE active=1 AND deleted_at IS NULL AND id<>?').all(id).some(other => can(publicUser(other), 'canManageAccounts'))) throw problem(409, 'LAST_ACCOUNT_MANAGER');
      const temporary = values.password === undefined ? current.must_change_password : temporaryPassword ? 1 : 0;
      db.prepare('UPDATE users SET hash=?,role=?,active=?,permissions=?,task_supervisor=?,task_team=?,must_change_password=? WHERE id=?').run(hash, role, active, JSON.stringify(overrides), tasks.supervisor, tasks.team, temporary, id);
      revokePush('user_id', id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      store.audit(actor, 'account-update', 'accounts');
    });
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }
  function remove(id, actor, authorize = () => {}) {
    authorize();
    if (!can(actor, 'canManageAccounts')) throw problem(403, 'FORBIDDEN');
    return store.transaction(() => {
      const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!row || row.deleted_at !== null) throw problem(404, 'NOT_FOUND');
      if (row.role === 'admin' && row.active && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL").get().n <= 1) throw problem(409, 'LAST_ADMIN');
      if (row.active && can(publicUser(row), 'canManageAccounts') && !db.prepare('SELECT * FROM users WHERE active=1 AND deleted_at IS NULL AND id<>?').all(id).some(other => can(publicUser(other), 'canManageAccounts'))) throw problem(409, 'LAST_ACCOUNT_MANAGER');
      if (id === actor.id) throw problem(409, 'SELF_DELETE');
      // Keep the identity reserved so historical assignments cannot pass to a new account.
      db.prepare('UPDATE users SET active=0,deleted_at=?,hash=? WHERE id=?').run(Date.now(), dummy, id);
      revokePush('user_id', id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      store.audit(actor, 'account-delete', 'accounts');
      return {id};
    });
  }
  // The owner proves the current password; every older session ends and only this device receives a new one.
  async function changePassword(token, currentPassword, nextPassword) {
    const before = session(token);
    if (!before) throw problem(401, 'LOGIN_REQUIRED');
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(before.user.id);
    const valid = await checkPassword(currentPassword, row.hash);
    if (!valid) throw problem(400, 'CURRENT_PASSWORD_INVALID');
    if (nextPassword === currentPassword) throw problem(400, 'PASSWORD_REUSED');
    const hash = await passwordHash(nextPassword);
    return store.transaction(() => {
      const current = db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
      if (!session(token)) throw problem(401, 'LOGIN_REQUIRED');
      if (current.hash !== row.hash) throw problem(409, 'CONFLICT');
      db.prepare('UPDATE users SET hash=?,must_change_password=0 WHERE id=?').run(hash, row.id);
      const issued = issue(row);
      keepPush(row.id, digest(token), digest(issued.token));
      db.prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?').run(row.id, digest(issued.token));
      store.audit(current, 'password-change', 'accounts');
      return {...issued, user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(row.id))};
    });
  }
  // Ends every session and device subscription of the signed-in account.
  function logoutAll(token) {
    const current = session(token);
    if (!current) throw problem(401, 'LOGIN_REQUIRED');
    return store.transaction(() => {
      revokePush('user_id', current.user.id);
      const result = db.prepare('DELETE FROM sessions WHERE user_id=?').run(current.user.id);
      store.audit(current.user, 'logout-all', 'accounts');
      return {sessions: Number(result.changes)};
    });
  }
  function logout(token) {
    const current = session(token);
    return store.transaction(() => {
      revokePush('session_hash', digest(token));
      const result = db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));
      if (current) store.audit(current.user, 'logout', 'accounts');
      return result;
    });
  }
  return {create, login, session, update, remove, logout, logoutAll, changePassword, list: () => db.prepare('SELECT id,username,role,active,permissions,task_supervisor,task_team FROM users WHERE deleted_at IS NULL ORDER BY username').all().map(publicUser)};
}
module.exports = {accounts};
