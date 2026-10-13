/* Private, local instruction bundles owned by one existing account. */
const fs = require('node:fs');
const path = require('node:path');
const {problem, safePath, validateData} = require('./store.cjs');
const {permissionsFor} = require('./permissions.cjs');
const FILE_BYTES = 20 * 1024 * 1024, TOTAL_BYTES = 100 * 1024 * 1024, MAX_FILES = 2000;
const mimeTypes = {'.pdf':'application/pdf', '.txt':'text/plain', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml'};
const trustedOwner = stat => !process.getuid || [0, process.getuid()].includes(stat.uid);
function trustedEntry(stat, allowSticky = false) {
  // Local imports must be controlled by the database's administrator. Other
  // UIDs may not swap source directories while their contents are being read.
  if (stat.isSymbolicLink() || !trustedOwner(stat) ||
      (stat.mode & 0o022) && !(allowSticky && stat.isDirectory() && (stat.mode & 0o1000))) throw problem(400, 'INVALID_DATA');
  if (stat.isFile() && stat.nlink !== 1) throw problem(400, 'INVALID_DATA');
}
function trustedChain(root) {
  let current = root;
  while (true) {
    let stat = fs.lstatSync(current);
    // Trusted parent aliases such as macOS /var and /tmp are allowed. The
    // selected source itself and every path inside it must be ordinary nodes.
    if (current !== root && stat.isSymbolicLink()) {
      if (!trustedOwner(stat)) throw problem(400, 'INVALID_DATA');
      stat = fs.statSync(current);
    }
    trustedEntry(stat, current !== root);
    if (!stat.isDirectory()) throw problem(400, 'INVALID_DATA');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
function sourceRoot(sourceDirectory) {
  const selected = path.resolve(sourceDirectory), original = fs.lstatSync(selected);
  trustedEntry(original);
  trustedChain(selected);
  const root = fs.realpathSync(selected), resolved = fs.lstatSync(root);
  if (original.ino !== resolved.ino || original.dev !== resolved.dev) throw problem(400, 'INVALID_DATA');
  trustedChain(root);
  return root;
}
function readLocal(root, name, optional = false) {
  safePath(name);
  let current = root, stat;
  try {
    for (const part of name.split('/')) {
      current = path.join(current, part);
      stat = fs.lstatSync(current);
      trustedEntry(stat);
    }
    if (!stat.isFile()) throw problem(400, 'INVALID_DATA');
    if (stat.size > FILE_BYTES) throw problem(413, 'TOO_LARGE');
    const descriptor = fs.openSync(current, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(descriptor);
      trustedEntry(opened);
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw problem(400, 'INVALID_DATA');
      const content = fs.readFileSync(descriptor);
      if (content.length > FILE_BYTES) throw problem(413, 'TOO_LARGE');
      return content;
    } finally { fs.closeSync(descriptor); }
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw problem(error.status || 400, error.status ? error.code : 'INVALID_DATA');
  }
}
function createAccountInstructions(store) {
  const {db} = store;
  const has = user => !!user && !!db.prepare('SELECT 1 FROM account_instruction_sets WHERE user_id=?').get(user.id);
  function userView(user) {
    if (!has(user)) return user;
    const view = {...user, permissionOverrides:{...user.permissionOverrides, canManageInstructions:false, canImportData:false}};
    return {...view, permissions:permissionsFor(view)};
  }
  function get(user) {
    const row = db.prepare('SELECT data,revision FROM account_instruction_sets WHERE user_id=?').get(user.id);
    if (!row) throw problem(404, 'NOT_FOUND');
    return {data:JSON.parse(row.data), revision:row.revision};
  }
  function node(name, user) {
    safePath(name);
    const set = get(user);
    if (name === 'data/package-instructions.json') return {kind:'file', content:Buffer.from(JSON.stringify(set.data)), mime:'application/json', revision:set.revision};
    const row = db.prepare('SELECT kind,content,mime FROM account_instruction_files WHERE user_id=? AND path=?').get(user.id, name);
    if (!row) throw problem(404, 'NOT_FOUND');
    return {...row, revision:set.revision};
  }
  function children(name, user) {
    if (name && node(name, user).kind !== 'directory') throw problem(400, 'WRONG_KIND');
    const prefix = name ? safePath(name) + '/' : '';
    const rows = db.prepare('SELECT path,kind FROM account_instruction_files WHERE user_id=? ORDER BY path').all(user.id);
    const entries = rows.filter(row => row.path.startsWith(prefix) && !row.path.slice(prefix.length).includes('/')).map(row => ({name:row.path.slice(prefix.length), kind:row.kind}));
    if (name === 'data') entries.push({name:'package-instructions.json', kind:'file'});
    return entries;
  }
  function install(username, sourceDirectory) {
    if (typeof username !== 'string' || typeof sourceDirectory !== 'string') throw problem(400, 'INVALID_DATA');
    const root = sourceRoot(sourceDirectory);
    let data;
    try { data = JSON.parse(readLocal(root, 'data/package-instructions.json').toString('utf8')); }
    catch { throw problem(400, 'INVALID_DATA'); }
    validateData('package-instructions', data);
    const profiles = Object.values(data);
    if (!profiles.length || profiles.length > MAX_FILES) throw problem(400, 'INVALID_DATA');
    const folders = new Set(), files = new Map(), directories = new Set(['data', 'data/profiles']);
    let bytes = 0;
    function addFile(name, optional = false) {
      safePath(name);
      if (files.has(name)) return;
      if (files.size >= MAX_FILES) throw problem(413, 'TOO_LARGE');
      const content = readLocal(root, name, optional);
      if (content === null) return;
      bytes += content.length;
      if (bytes > TOTAL_BYTES) throw problem(413, 'TOO_LARGE');
      files.set(name, {content, mime:mimeTypes[path.extname(name).toLowerCase()] || 'application/octet-stream'});
      let parent = name.slice(0, name.lastIndexOf('/'));
      while (parent) { directories.add(parent); parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''; }
    }
    for (const profile of profiles) {
      const folder = safePath('data/profiles/' + profile.folderName);
      if (folders.has(folder)) throw problem(400, 'INVALID_DATA');
      folders.add(folder);
      let parent = folder;
      while (parent) { directories.add(parent); parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''; }
      for (const image of profile.images) addFile(folder + '/' + image);
      addFile(folder + '/instruction.txt', true);
    }
    if ([...files.keys()].some(name => directories.has(name))) throw problem(400, 'INVALID_DATA');
    return store.transaction(() => {
      const owner = db.prepare('SELECT id FROM users WHERE username=? AND active=1 AND deleted_at IS NULL').get(username);
      if (!owner) throw problem(404, 'NOT_FOUND');
      const revision = (db.prepare('SELECT revision FROM account_instruction_sets WHERE user_id=?').get(owner.id)?.revision || 0) + 1;
      db.prepare('DELETE FROM account_instruction_sets WHERE user_id=?').run(owner.id);
      db.prepare('INSERT INTO account_instruction_sets(user_id,data,revision) VALUES(?,?,?)').run(owner.id, JSON.stringify(data), revision);
      const insert = db.prepare('INSERT INTO account_instruction_files(user_id,path,kind,content,mime) VALUES(?,?,?,?,?)');
      for (const name of directories) insert.run(owner.id, name, 'directory', null, null);
      for (const [name, file] of files) insert.run(owner.id, name, 'file', file.content, file.mime);
      store.audit(null, 'account-instructions-install', 'accounts');
      return {profiles:profiles.length, files:files.size};
    });
  }
  return {has, userView, get, node, children, install};
}
module.exports = {createAccountInstructions};
