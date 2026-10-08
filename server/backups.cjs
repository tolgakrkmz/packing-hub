/* Local maintenance only. Never log database content, paths, hashes or credentials. */
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {validateData} = require('./store.cjs');

const ARCHIVE = /^hub-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-f0-9-]{36}\.sqlite$/;
const TABLES = ['documents', 'users', 'sessions', 'files', 'audit', 'task_items', 'task_schedules', 'task_requests'];
const CODES = new Set(['SNAPSHOT_FAILED', 'SECONDARY_UNAVAILABLE', 'SECONDARY_NOT_SEPARATE', 'SECONDARY_COPY_FAILED', 'RETENTION_FAILED',
  'CONFIGURATION_FAILED', 'APPLICATION_UNAVAILABLE', 'DATABASE_CONFIGURATION_UNSUPPORTED', 'BACKUP_WORKER_FAILED', 'BACKUP_INTERRUPTED', 'HOST_BACKUP_FAILED', 'STATUS_UNREADABLE']);
function failure(code) { return Object.assign(new Error(code), {code}); }
function regularFile(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw failure('UNSAFE_FILE');
  return stat;
}
function privateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid()) throw failure('UNSAFE_DIRECTORY');
  return stat;
}
function syncFile(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDirectory(directory) { syncFile(directory); }
function digest(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
function verifyDatabase(filename) {
  regularFile(filename);
  const db = new DatabaseSync(filename, {readOnly: true});
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=ON');
    const checks = db.prepare('PRAGMA integrity_check').all();
    if (checks.length !== 1 || checks[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw failure('INVALID_ARCHIVE');
    if (db.prepare('PRAGMA user_version').get().user_version !== 4) throw failure('UNSUPPORTED_SCHEMA');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
    if (TABLES.some(table => !tables.has(table))) throw failure('INVALID_ARCHIVE');
    // Read every table, including attachment BLOBs, without returning their contents.
    for (const table of TABLES) db.prepare(`SELECT count(*) FROM ${table}`).get();
    const modules = db.prepare('SELECT kind,data FROM documents').all();
    for (const kind of ['production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions']) {
      const row = modules.find(item => item.kind === kind);
      if (!row) throw failure('INVALID_ARCHIVE');
      validateData(kind, JSON.parse(row.data));
    }
    for (const table of ['task_items', 'task_schedules']) {
      for (const row of db.prepare(`SELECT data FROM ${table}`).iterate()) JSON.parse(row.data);
    }
  } finally { db.close(); }
}
function atomicFile(filename, create) {
  const temporary = path.join(path.dirname(filename), '.incomplete-' + randomUUID());
  const fd = fs.openSync(temporary, 'wx', 0o600);
  fs.closeSync(fd);
  try {
    create(temporary);
    fs.chmodSync(temporary, 0o600);
    syncFile(temporary);
    // A hard link publishes without ever replacing an existing archive.
    fs.linkSync(temporary, filename);
    fs.unlinkSync(temporary);
    syncDirectory(path.dirname(filename));
  } finally { fs.rmSync(temporary, {force: true}); }
}
function snapshot(database, destination) {
  regularFile(database); // Never silently create a new, empty source database.
  atomicFile(destination, temporary => {
    const db = new DatabaseSync(database, {readOnly: true});
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL');
      db.prepare('VACUUM INTO ?').run(temporary);
    } finally { db.close(); }
    verifyDatabase(temporary);
  });
}
function copyVerified(source, destination) {
  verifyDatabase(source);
  const expected = digest(source);
  atomicFile(destination, temporary => {
    fs.copyFileSync(source, temporary);
    verifyDatabase(temporary);
    if (digest(temporary) !== expected) throw failure('COPY_MISMATCH');
  });
}
function archiveTime(name) {
  const match = ARCHIVE.exec(name);
  if (!match) return null;
  const at = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  const time = Date.parse(at);
  return Number.isFinite(time) && new Date(time).toISOString() === at ? time : null;
}
function weekKey(time) {
  const date = new Date(time);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  return year + '-' + Math.ceil(((date - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
}
function retainedArchives(names) {
  const ordered = names.map(name => ({name, time: archiveTime(name)})).filter(item => item.time !== null).sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  const keep = new Set();
  for (const [limit, key] of [[7, time => new Date(time).toISOString().slice(0, 10)], [4, weekKey], [3, time => new Date(time).toISOString().slice(0, 7)]]) {
    const buckets = new Set();
    for (const item of ordered) {
      const bucket = key(item.time);
      if (buckets.has(bucket)) continue;
      if (buckets.size === limit) break;
      buckets.add(bucket); keep.add(item.name);
    }
  }
  return keep;
}
function prune(directory, newest) {
  const names = fs.readdirSync(directory).filter(name => archiveTime(name) !== null);
  // Validate all candidates before deleting anything. A damaged historical copy
  // must not displace a valid daily/weekly/monthly recovery point.
  for (const name of names) verifyDatabase(path.join(directory, name));
  const keep = retainedArchives(names); keep.add(newest);
  for (const name of names) if (!keep.has(name)) fs.unlinkSync(path.join(directory, name));
  syncDirectory(directory);
}
function readStatus(directory) {
  const filename = path.join(directory, 'status.json');
  let value = {}, unreadable = false;
  if (fs.existsSync(filename)) {
    regularFile(filename);
    const text = fs.readFileSync(filename, 'utf8');
    try { value = JSON.parse(text); } catch { unreadable = true; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { value = {}; unreadable = true; }
  }
  const timestamp = item => typeof item === 'string' && Number.isFinite(Date.parse(item)) && new Date(item).toISOString() === item ? item : null;
  const status = {state: ['ok', 'failed'].includes(value.state) ? value.state : 'unknown',
    lastAttempt: timestamp(value.lastAttempt), lastSuccess: timestamp(value.lastSuccess),
    lastPrimary: timestamp(value.lastPrimary), lastSecondary: timestamp(value.lastSecondary),
    code: CODES.has(value.code) ? value.code : null};
  // Status is a replaceable summary, never a prerequisite for creating a backup.
  // A truncated summary must neither stop the next run nor claim a verified pair.
  if (status.state === 'ok' && (!status.lastAttempt || value.code !== null ||
      [status.lastSuccess, status.lastPrimary, status.lastSecondary].some(at => at !== status.lastAttempt))) unreadable = true;
  if (unreadable) { status.state = 'unknown'; status.code = 'STATUS_UNREADABLE'; }
  const hostFailure = path.join(directory, 'host-failure');
  if (fs.existsSync(hostFailure)) {
    regularFile(hostFailure);
    const [at, code] = fs.readFileSync(hostFailure, 'utf8').trim().split('\n');
    status.state = 'failed'; status.lastAttempt = timestamp(at) || status.lastAttempt;
    status.code = CODES.has(code) ? code : 'HOST_BACKUP_FAILED';
  }
  return status;
}
function writeStatus(directory, status) {
  const temporary = path.join(directory, '.status-' + randomUUID());
  try {
    fs.writeFileSync(temporary, JSON.stringify(status) + '\n', {flag: 'wx', mode: 0o600});
    syncFile(temporary);
    fs.renameSync(temporary, path.join(directory, 'status.json'));
    syncDirectory(directory);
  } finally { fs.rmSync(temporary, {force: true}); }
}
function runBackup({database, primary, secondary, now = new Date()}) {
  privateDirectory(primary);
  const at = now.toISOString(), name = 'hub-' + at.replace(/:/g, '-').replace('.', '-') + '-' + randomUUID() + '.sqlite';
  const status = {...readStatus(primary), state: 'failed', lastAttempt: at, code: 'SNAPSHOT_FAILED'};
  try {
    snapshot(database, path.join(primary, name));
    status.lastPrimary = at;
    status.code = 'SECONDARY_UNAVAILABLE';
    const other = privateDirectory(secondary);
    if (other.dev === fs.statSync(primary).dev || other.dev === fs.statSync(database).dev) throw failure('SECONDARY_NOT_SEPARATE');
    status.code = 'SECONDARY_COPY_FAILED';
    copyVerified(path.join(primary, name), path.join(secondary, name));
    status.lastSecondary = at;
    status.code = 'RETENTION_FAILED';
    prune(primary, name); prune(secondary, name);
    status.state = 'ok'; status.code = null; status.lastSuccess = at;
  } catch (error) {
    if (error.code === 'SECONDARY_NOT_SEPARATE') status.code = error.code;
  }
  writeStatus(primary, status);
  return status;
}
module.exports = {snapshot, copyVerified, verifyDatabase, runBackup, readStatus, retainedArchives, archiveTime, privateDirectory, syncFile, syncDirectory};
