const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {DatabaseSync} = require('node:sqlite');
const {can} = require('./permissions.cjs');
const root = path.resolve(__dirname, '..');
const sandbox = vm.createContext({});
for (const file of ['shift-schedule', 'pair-targets-model', 'data-validation', 'personnel-model']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), sandbox);
const validate = vm.runInContext('HubDataValidation.validate', sandbox);
const pairModel = vm.runInContext('PairTargets', sandbox);
const personnelModel = vm.runInContext('PersonnelModel', sandbox);
const defaults = {
  'production-log': {entries: [], goalTons: 3000},
  'line-downtime': {entries: [], reasons: ['Друго']},
  personnel: {schemaVersion: 3, employees: [], settings: {stickersStage1: 4, stickersStage2: 6}, moveLog: []},
  'pair-targets': {module: 'pair-targets', schemaVersion: 1, entries: []},
  'package-instructions': {}
};
function problem(status, code) { const error = new Error(code); error.status = status; error.code = code; return error; }
function safePath(value) {
  if (typeof value !== 'string' || value.length > 1000 || value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || part.length > 200)) throw problem(400, 'INVALID_PATH');
  return value;
}
function validateData(kind, data) {
  if (!Object.hasOwn(defaults, kind)) throw problem(404, 'NOT_FOUND');
  try {
    validate(kind, data);
    if (kind === 'package-instructions' && Object.keys(data).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error();
  } catch { throw problem(400, 'INVALID_DATA'); }
}
function openStore(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
  const db = new DatabaseSync(filename, {timeout: 5000});
  if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS documents(kind TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','operator','observer')), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('file','directory')), content BLOB, mime TEXT, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, module TEXT NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'permissions')) {
    db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'");
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'task_supervisor')) {
    db.exec("ALTER TABLE users ADD COLUMN task_supervisor INTEGER NOT NULL DEFAULT 0; ALTER TABLE users ADD COLUMN task_team TEXT NOT NULL DEFAULT ''");
  }
  db.exec('PRAGMA user_version=3');
  for (const [kind, data] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO documents(kind,data) VALUES(?,?)').run(kind, JSON.stringify(data));
  db.prepare("INSERT OR IGNORE INTO files(path,kind) VALUES('data','directory'),('data/profiles','directory')").run();
  const get = kind => {
    const row = db.prepare('SELECT data, revision FROM documents WHERE kind=?').get(kind);
    if (!row) throw problem(404, 'NOT_FOUND');
    return {data: JSON.parse(row.data), revision: row.revision};
  };
  const audit = (user, action, module) => db.prepare('INSERT INTO audit(at,user_id,action,module) VALUES(?,?,?,?)').run(Date.now(), user?.id || null, action, module);
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function put(kind, data, revision, user, mode = 'report') {
    validateData(kind, data);
    return transaction(() => {
      const current = get(kind);
      if (current.revision !== revision) throw problem(409, 'CONFLICT');
      if (['production-log', 'line-downtime', 'pair-targets'].includes(kind) && !(mode === 'import' && can(user, 'canImportData'))) {
        if (!can(user, 'canCreateReports') && !can(user, 'canEditReports')) throw problem(403, 'FORBIDDEN');
        const next = new Map(data.entries.map(entry => [entry.id, entry]));
        const prior = new Map(current.data.entries.map(entry => [entry.id, entry]));
        // Planning and a first pair result are ordinary reporting; correcting a
        // completed result or removing an existing report requires edit rights.
        const corrected = current.data.entries.some(entry => {
          const value = next.get(entry.id);
          return kind === 'pair-targets' ? !!entry.result && !isDeepStrictEqual(entry, value) : !isDeepStrictEqual(entry, value);
        });
        const added = data.entries.some(entry => !prior.has(entry.id) || kind === 'pair-targets' && !isDeepStrictEqual(prior.get(entry.id), entry) && !prior.get(entry.id)?.result) || kind === 'pair-targets' && current.data.entries.some(entry => !entry.result && !next.has(entry.id));
        const metadata = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'entries'));
        if ((corrected || !isDeepStrictEqual(metadata(current.data), metadata(data))) && !can(user, 'canEditReports') || added && !can(user, 'canCreateReports')) throw problem(403, 'FORBIDDEN');
      }
      if (user.role !== 'admin') {
        if (user.role !== 'operator' || !['production-log', 'line-downtime', 'pair-targets'].includes(kind)) throw problem(403, 'FORBIDDEN');
        if (kind !== 'pair-targets') {
          const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
          const prior = new Map(data.entries.map(entry => [entry.id, entry]));
          if ((!can(user, 'canEditReports') && current.data.entries.some(entry => !same(entry, prior.get(entry.id)))) || !same(kind === 'production-log' ? current.data.goalTons : current.data.reasons, kind === 'production-log' ? data.goalTons : data.reasons)) throw problem(403, 'FORBIDDEN');
        }
      }
      if (kind === 'pair-targets') {
        try {
          const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
          const planFields = ['id', 'date', 'shiftCode', 'team', 'members', 'targetKg', 'targetCrates', 'createdAt'];
          const remaining = new Set(data.entries.map(entry => entry.id));
          if (current.data.entries.some(entry => entry.result && !remaining.has(entry.id))) throw new Error();
          for (const entry of data.entries) {
            const previous = current.data.entries.find(item => item.id === entry.id);
            if (previous && same(previous, entry)) continue;
            if (!previous || planFields.some(field => !same(previous[field], entry[field]))) {
              const planned = pairModel.plan({data: {...current.data, entries: current.data.entries.filter(item => remaining.has(item.id))}, employees: get('personnel').data.employees, context: entry, memberIds: entry.members.map(person => person.id), targetKg: entry.targetKg, targetCrates: entry.targetCrates, workAreas: entry.areas, existingId: previous?.id, id: entry.id, now: entry.createdAt});
              if (planFields.some(field => !same(planned[field], entry[field]))) throw new Error();
            }
            if (previous?.result && !entry.result) throw new Error();
            if (entry.result) {
              const reported = pairModel.report(entry, {context: entry, ...entry.result, workAreas: entry.areas, now: entry.result.reportedAt});
              if (!same(reported.result, entry.result)) throw new Error();
            }
          }
        } catch { throw problem(400, 'INVALID_PAIR_CHANGE'); }
      }
      db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(data), kind);
      audit(user, 'write', kind);
      return get(kind);
    });
  }
  function productionImport(input, user) {
    if (!can(user, 'canImportData')) throw problem(403, 'FORBIDDEN');
    validateData('production-log', input);
    const current = get('production-log');
    const existing = new Map(current.data.entries.map(entry => [entry.id, entry]));
    const added = []; let duplicates = 0, conflicts = 0, firstDate = null, lastDate = null, kg = 0, scrapKg = 0;
    for (const entry of input.entries) {
      firstDate = firstDate === null || entry.date < firstDate ? entry.date : firstDate;
      lastDate = lastDate === null || entry.date > lastDate ? entry.date : lastDate;
      kg += entry.tonnage; scrapKg += entry.brak;
      const prior = existing.get(entry.id);
      if (!prior) added.push(entry);
      else if (isDeepStrictEqual({...prior, breakdown: prior.breakdown ?? null}, {...entry, breakdown: entry.breakdown ?? null})) duplicates++;
      else conflicts++;
    }
    return {current, added, summary: {revision: current.revision, total: input.entries.length, added: added.length, duplicates, conflicts, firstDate, lastDate, kg, scrapKg}};
  }
  const previewProductionImport = (input, user) => productionImport(input, user).summary;
  function backupForImport() {
    if (filename === ':memory:') return false;
    const directory = path.join(path.dirname(filename), 'import-backups');
    const backup = path.join(directory, randomUUID() + '.sqlite');
    try { fs.mkdirSync(directory, {recursive: true, mode: 0o700}); db.prepare('VACUUM INTO ?').run(backup); fs.chmodSync(backup, 0o600); }
    catch { throw problem(500, 'BACKUP_FAILED'); }
    return true;
  }
  function applyProductionImport(input, revision, user) {
    const plan = productionImport(input, user);
    if (plan.current.revision !== revision) throw problem(409, 'CONFLICT');
    if (plan.summary.conflicts) throw problem(409, 'IMPORT_CONFLICT');
    if (!plan.added.length) return {...plan.summary, backup: false};
    // A private, consistent snapshot lives beside the database, outside static assets.
    // VACUUM cannot run inside a transaction. put() rechecks the revision atomically.
    const backup = backupForImport();
    const saved = put('production-log', {...plan.current.data, entries: [...plan.current.data.entries, ...plan.added]}, revision, user, 'import');
    return {...plan.summary, revision: saved.revision, backup};
  }
  function node(name) {
    safePath(name);
    if (name === 'data/package-instructions.json') {
      const current = get('package-instructions');
      return {kind: 'file', content: Buffer.from(JSON.stringify(current.data)), mime: 'application/json', revision: current.revision};
    }
    const result = db.prepare('SELECT * FROM files WHERE path=?').get(name);
    if (!result) throw problem(404, 'NOT_FOUND');
    return result;
  }
  function createNode(name, kind, user) {
    safePath(name);
    if (user.role !== 'admin') throw problem(403, 'FORBIDDEN');
    if (!['directory', 'file'].includes(kind)) throw problem(400, 'WRONG_KIND');
    const parent = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
    if (parent && node(parent).kind !== 'directory') throw problem(400, 'INVALID_PATH');
    if (name === 'data/package-instructions.json') {
      if (kind !== 'file') throw problem(400, 'WRONG_KIND');
      return node(name);
    }
    db.prepare('INSERT OR IGNORE INTO files(path,kind,content,mime) VALUES(?,?,?,?)').run(name, kind, kind === 'file' ? Buffer.alloc(0) : null, 'application/octet-stream');
    const result = node(name);
    if (result.kind !== kind) throw problem(400, 'WRONG_KIND');
    return result;
  }
  function writeFile(name, content, mime, revision, user) {
    if (user.role !== 'admin') throw problem(403, 'FORBIDDEN');
    if (name === 'data/package-instructions.json') {
      let data;
      try { data = JSON.parse(content.toString('utf8')); } catch { throw problem(400, 'INVALID_DATA'); }
      return put('package-instructions', data, revision, user);
    }
    return transaction(() => {
      const current = node(name);
      if (current.kind !== 'file') throw problem(400, 'WRONG_KIND');
      if (current.revision !== revision) throw problem(409, 'CONFLICT');
      db.prepare('UPDATE files SET content=?,mime=?,revision=revision+1 WHERE path=?').run(content, mime, name);
      audit(user, 'attachment-write', 'package-instructions');
      return {revision: current.revision + 1};
    });
  }
  function children(name) {
    if (name && node(name).kind !== 'directory') throw problem(400, 'WRONG_KIND');
    const prefix = name ? name + '/' : '';
    const list = db.prepare('SELECT path,kind FROM files').all().filter(row => row.path.startsWith(prefix) && !row.path.slice(prefix.length).includes('/')).map(row => ({name: row.path.slice(prefix.length), kind: row.kind}));
    if (name === 'data') list.push({name: 'package-instructions.json', kind: 'file'});
    return list;
  }
  return {db, get, put, previewProductionImport, applyProductionImport, backupForImport, node, createNode, writeFile, children, audit, transaction, close: () => db.close()};
}
module.exports = {openStore, defaults, problem, safePath, validateData, personnelModel};
