/* Recovery copies are private, isolated and never overwrite an existing database. */
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {DatabaseSync} = require('node:sqlite');
const {copyVerified, verifyDatabase, privateDirectory, syncFile, syncDirectory} = require('./backups.cjs');
function restoreArchive(archive, directory) {
  const started = performance.now();
  if (['-wal', '-shm', '-journal'].some(suffix => fs.existsSync(archive + suffix))) throw new Error('NOT_STANDALONE_ARCHIVE');
  verifyDatabase(archive); // Check the archive before creating any recovery files.
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, {mode: 0o700});
  privateDirectory(directory);
  // An exclusive marker reserves even a newly created, empty Docker volume.
  // Existing live data, sidecars and previous/failed recovery attempts are refused.
  if (fs.readdirSync(directory).length) throw new Error('RESTORE_TARGET_NOT_EMPTY');
  const lock = path.join(directory, '.restore-in-progress');
  fs.closeSync(fs.openSync(lock, 'wx', 0o600));
  if (fs.readdirSync(directory).some(name => name !== '.restore-in-progress')) throw new Error('RESTORE_TARGET_NOT_EMPTY');
  const filename = path.join(directory, 'hub.sqlite');
  copyVerified(archive, filename);
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    if (!db.prepare("SELECT 1 FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL").get()) throw new Error('RECOVERY_ADMIN_UNAVAILABLE');
    db.prepare('DELETE FROM sessions').run();
    db.prepare("INSERT INTO audit(at,user_id,action,module) VALUES(?,NULL,'restore','system')").run(Date.now());
    db.exec('COMMIT');
  } finally { db.close(); }
  verifyDatabase(filename); syncFile(filename);
  const result = {version: 1, restoredAt: new Date().toISOString(), restoreMs: Math.ceil(performance.now() - started), sessionsRevoked: true};
  const ready = path.join(directory, 'recovery-ready.json');
  fs.writeFileSync(ready, JSON.stringify(result) + '\n', {flag: 'wx', mode: 0o600});
  syncFile(ready); fs.unlinkSync(lock); syncDirectory(directory);
  return result;
}
async function rehearse(directory) {
  privateDirectory(directory);
  const ready = path.join(directory, 'recovery-ready.json');
  const stat = fs.lstatSync(ready);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.existsSync(path.join(directory, '.restore-in-progress'))) throw new Error('RECOVERY_NOT_READY');
  const metadata = JSON.parse(fs.readFileSync(ready, 'utf8'));
  if (metadata.version !== 1 || metadata.sessionsRevoked !== true) throw new Error('RECOVERY_NOT_READY');
  const started = performance.now();
  verifyDatabase(path.join(directory, 'hub.sqlite'));
  const {createHubServer} = require('./server.cjs');
  const hub = createHubServer({filename: path.join(directory, 'hub.sqlite'), publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  try {
    const users = hub.auth.list(), admin = users.find(user => user.active && user.role === 'admin');
    if (!admin) throw new Error('RECOVERY_ADMIN_UNAVAILABLE');
    for (const kind of ['production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions']) hub.store.get(kind);
    hub.tasks.list(admin); // Reads schedules and materializes missed shifts only in the copy.
    if (hub.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n) throw new Error('RECOVERY_SESSIONS_PRESENT');
    await new Promise((resolve, reject) => { hub.server.once('error', reject); hub.server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + hub.server.address().port;
    const health = await fetch(base + '/healthz', {signal: AbortSignal.timeout(5000)});
    const denied = await fetch(base + '/api/data/production-log', {signal: AbortSignal.timeout(5000)});
    if (health.status !== 200 || denied.status !== 401) throw new Error('RECOVERY_STARTUP_FAILED');
    await health.arrayBuffer(); await denied.arrayBuffer();
    return {ok: true, startupMs: Math.ceil(performance.now() - started)};
  } finally { await hub.close(); }
}
module.exports = {restoreArchive, rehearse};
