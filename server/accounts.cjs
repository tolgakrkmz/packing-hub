const crypto = require('node:crypto');
const {promisify} = require('node:util');
const {problem} = require('./store.cjs');
const {validateOverrides, permissionsFor} = require('./permissions.cjs');
const scrypt = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const publicUser = row => {
  const permissionOverrides = validateOverrides(JSON.parse(row.permissions || '{}'));
  const user = {id: row.id, username: row.username, role: row.role, active: !!row.active, permissionOverrides, taskSupervisor: !!row.task_supervisor && row.role === 'operator', taskTeam: row.task_team || ''};
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
  const dummy = crypto.randomBytes(16).toString('hex') + ':' + crypto.randomBytes(64).toString('hex');
  function taskProfile(values, role, previous = {}) {
    const supervisor = values.taskSupervisor === undefined ? !!previous.task_supervisor : values.taskSupervisor;
    const team = values.taskTeam === undefined ? previous.task_team || '' : values.taskTeam;
    if (typeof supervisor !== 'boolean' || typeof team !== 'string' || !['', 'А', 'Б', 'В', 'Г', 'СТИКЕРИ'].includes(team) || supervisor && role !== 'operator' || supervisor && !team) throw problem(400, 'INVALID_TASK_PROFILE');
    return {supervisor: supervisor ? 1 : 0, team: supervisor ? team : ''};
  }
  async function create(username, password, role, actor, permissions = {}, authorize = () => {}, profile = {}) {
    if (typeof username !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || !['admin', 'operator', 'observer'].includes(role)) throw problem(400, 'INVALID_ACCOUNT');
    const overrides = validateOverrides(permissions);
    const tasks = taskProfile(profile, role);
    const hash = await passwordHash(password);
    authorize();
    try { db.prepare('INSERT INTO users(username,hash,role,permissions,task_supervisor,task_team) VALUES(?,?,?,?,?,?)').run(username, hash, role, JSON.stringify(overrides), tasks.supervisor, tasks.team); }
    catch { throw problem(409, 'ACCOUNT_EXISTS'); }
    store.audit(actor, 'account-create', 'accounts');
    return publicUser(db.prepare('SELECT * FROM users WHERE username=?').get(username));
  }
  async function login(username, password) {
    const row = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username=? AND deleted_at IS NULL').get(username.toLowerCase()) : null;
    const valid = await checkPassword(password, row?.hash || dummy);
    const current = row && db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
    if (!valid || !current?.active || current.deleted_at !== null || current.hash !== row.hash) throw problem(401, 'INVALID_LOGIN');
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + 12 * 3600000;
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions(hash,user_id,csrf,expires) VALUES(?,?,?,?)').run(digest(token), row.id, csrf, expires);
    store.audit(row, 'login', 'accounts');
    return {token, csrf, expires, user: publicUser(current)};
  }
  function session(token) {
    if (typeof token !== 'string' || token.length > 100) return null;
    const row = db.prepare('SELECT u.*,s.csrf,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.active=1 AND u.deleted_at IS NULL').get(digest(token), Date.now());
    return row ? {user: publicUser(row), csrf: row.csrf, expires: row.expires} : null;
  }
  async function update(id, values, actor, authorize = () => {}) {
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!row || row.deleted_at !== null) throw problem(404, 'NOT_FOUND');
    const role = values.role === undefined ? row.role : values.role;
    const active = values.active === undefined ? row.active : values.active ? 1 : 0;
    if (!['admin', 'operator', 'observer'].includes(role) || values.active !== undefined && typeof values.active !== 'boolean') throw problem(400, 'INVALID_ACCOUNT');
    const hash = values.password === undefined ? row.hash : await passwordHash(values.password);
    const overrides = values.permissions === undefined ? JSON.parse(row.permissions) : validateOverrides(values.permissions);
    const tasks = taskProfile({...values, ...(role !== 'operator' ? {taskSupervisor: false, taskTeam: ''} : {})}, role, row);
    authorize();
    store.transaction(() => {
      const current = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!current || current.deleted_at !== null) throw problem(404, 'NOT_FOUND');
      if (current.hash !== row.hash || current.role !== row.role || current.active !== row.active || current.permissions !== row.permissions || current.task_supervisor !== row.task_supervisor || current.task_team !== row.task_team) throw problem(409, 'CONFLICT');
      if (row.role === 'admin' && row.active && (role !== 'admin' || !active) && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").get().n <= 1) throw problem(409, 'LAST_ADMIN');
      db.prepare('UPDATE users SET hash=?,role=?,active=?,permissions=?,task_supervisor=?,task_team=? WHERE id=?').run(hash, role, active, JSON.stringify(overrides), tasks.supervisor, tasks.team, id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      store.audit(actor, 'account-update', 'accounts');
    });
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }
  function remove(id, actor, authorize = () => {}) {
    authorize();
    if (actor?.role !== 'admin') throw problem(403, 'FORBIDDEN');
    return store.transaction(() => {
      const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!row || row.deleted_at !== null) throw problem(404, 'NOT_FOUND');
      if (row.role === 'admin' && row.active && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL").get().n <= 1) throw problem(409, 'LAST_ADMIN');
      if (id === actor.id) throw problem(409, 'SELF_DELETE');
      // Keep the identity reserved so historical assignments cannot pass to a new account.
      db.prepare('UPDATE users SET active=0,deleted_at=?,hash=? WHERE id=?').run(Date.now(), dummy, id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      store.audit(actor, 'account-delete', 'accounts');
      return {id};
    });
  }
  return {create, login, session, update, remove, logout: token => db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token)), list: () => db.prepare('SELECT id,username,role,active,permissions,task_supervisor,task_team FROM users WHERE deleted_at IS NULL ORDER BY username').all().map(publicUser)};
}
module.exports = {accounts};
