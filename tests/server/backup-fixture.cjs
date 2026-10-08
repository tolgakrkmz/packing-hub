const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openStore} = require('../../server/store.cjs');
const {createTasks} = require('../../server/tasks.cjs');
function backupFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-backup-demo-'));
  const database = path.join(directory, 'source.sqlite');
  const primary = path.join(directory, 'primary'), secondary = path.join(directory, 'secondary');
  for (const folder of [primary, secondary]) fs.mkdirSync(folder, {mode: 0o700});
  const store = openStore(database);
  createTasks(store);
  // These are the repository's already-approved fictional fixtures, never the
  // production folder. Exercise nonempty data in every module during recovery.
  for (const kind of ['personnel', 'line-downtime', 'pair-targets', 'package-instructions']) {
    const data = fs.readFileSync(path.resolve(__dirname, '../../data', kind + '.json'), 'utf8');
    store.db.prepare('UPDATE documents SET data=? WHERE kind=?').run(data, kind);
  }
  const id = store.db.prepare("INSERT INTO users(username,hash,role,permissions) VALUES('demo-backup-admin','fictional-disabled-hash','admin','{\"canEditReports\":false}')").run().lastInsertRowid;
  store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('fictional-session', id, 'fictional-csrf', 1);
  const entry = {id: 'demo-confirmed', date: '2026-10-08', shift: 'А', tonnage: 100, brak: 2, breakdown: null};
  store.db.prepare("UPDATE documents SET data=?,revision=9 WHERE kind='production-log'").run(JSON.stringify({entries: [entry], goalTons: 3000}));
  store.db.prepare("INSERT INTO files(path,kind,content,mime) VALUES('data/demo-document.txt','file',?,'text/plain')").run(Buffer.from('Fictional document for backup verification.'));
  store.db.prepare('INSERT INTO task_items VALUES(?,?,?)').run('demo-task', 2, JSON.stringify({title: 'Fictional backup task', state: 'done'}));
  store.db.prepare('INSERT INTO task_schedules VALUES(?,?,?)').run('demo-schedule', 3, JSON.stringify({title: 'Fictional recurring task', active: true}));
  store.db.prepare('INSERT INTO task_requests VALUES(?,?,?,?)').run(id, 'demo-request', 'fictional-operation', '{}');
  store.audit({id}, 'write', 'production-log');
  t.after(() => { store.close(); fs.rmSync(directory, {recursive: true, force: true}); });
  return {directory, database, primary, secondary, store};
}
module.exports = {backupFixture};
