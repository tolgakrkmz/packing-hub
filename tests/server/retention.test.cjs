/* Retention of retry receipts and reminder state; fictional data in temporary databases only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {createHubServer} = require('../../server/server.cjs');
const day = 86400000;
test('retry receipts and dead reminder keys are pruned by age; live ones and legacy receipts are kept', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-retention-demo-')); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'demo.sqlite');
  // A database from before receipts had a timestamp.
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE task_requests(actor INTEGER NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,id));
    CREATE TABLE problem_requests(actor INTEGER NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,id));
    INSERT INTO task_requests VALUES(1,'demo-legacy-task','x','{}'); INSERT INTO problem_requests VALUES(1,'demo-legacy-problem','x','{}');`);
  legacy.close();
  let time = Date.parse('2026-12-01T10:00:00+02:00');
  const hub = createHubServer({filename, publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => time}); t.after(() => hub.close());
  const admin = await hub.auth.create('demo-admin', 'Fictional-retention-123', 'admin');
  const chief = await hub.auth.create('demo-chief', 'Fictional-retention-123', 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const task = (extra = {}) => hub.tasks.create({requestId: randomUUID(), title: 'Fictional task', description: '', priority: 'normal', requiresPhotos: false, assigneeId: chief.id, participantIds: [], kind: 'global', dueDate: '2026-12-01', dueTime: '17:00', ...extra}, admin).id;
  const db = hub.store.db, count = table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const closed = task(), open = task(); hub.tasks.change(closed, {action: 'complete'}, 1, admin);
  const keys = ['taskOverdue:' + closed + ':0', 'taskDue:' + open + ':0', 'closeout:2026-11-30/А/1:due:1', 'closeout:2026-12-01/А/1:due:1'];
  for (const key of keys) db.prepare('INSERT INTO notification_state(key,value) VALUES(?,1)').run(key);
  const prune = () => { hub.tasks.pruneRequests(); hub.problems.pruneRequests(); hub.notifications.prune(); };
  time += 31 * day; task({dueDate: '2027-01-02'}); prune();
  const state = key => db.prepare('SELECT 1 FROM notification_state WHERE key=?').get(key) !== undefined;
  assert.deepEqual(keys.map(state), [false, true, false, false]); assert.ok(state('closeout:activation'));
  assert.equal(count('task_requests'), 4); assert.equal(count('problem_requests'), 1);
  time += 60 * day; prune();
  assert.deepEqual(db.prepare('SELECT id FROM task_requests').all().length, 1); assert.equal(count('problem_requests'), 0);
});
