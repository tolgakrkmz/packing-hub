/* Row storage migration with the approved fictional demo modules and temporary SQLite files. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {openStore, moduleData} = require('../../server/store.cjs');
const {verifyDatabase} = require('../../server/backups.cjs');
const {createHubServer} = require('../../server/server.cjs');
const kinds = ['production-log', 'line-downtime', 'pair-targets'];
const demo = kind => JSON.parse(fs.readFileSync(path.join(__dirname, '../../data', kind + '.json'), 'utf8'));
const admin = {id: 1, role: 'admin'}, clock = {productionNow: () => Date.parse('2026-10-05T10:00:00+03:00')};
const entry = id => ({id, date: '2026-10-05', shift: 'СТИКЕРИ', tonnage: 1000, brak: 10, breakdown: null});
function directory(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-report-entries-'));
  t.after(() => fs.rmSync(value, {recursive: true, force: true}));
  return value;
}
// Rewrites a current database into the version 4 layout: records inside each document.
async function legacyDatabase(filename, documents) {
  await createHubServer({filename, publicOrigin: 'http://127.0.0.1:0', allowHttp: true}).close();
  const db = new DatabaseSync(filename);
  for (const [kind, data] of Object.entries(documents)) db.prepare('UPDATE documents SET data=?,revision=7 WHERE kind=?').run(JSON.stringify(data), kind);
  db.exec('DELETE FROM report_versions; DROP TABLE report_entries; PRAGMA user_version=4');
  db.close();
}
const raw = (filename, kind) => { const db = new DatabaseSync(filename, {readOnly: true}); try { return db.prepare('SELECT data FROM documents WHERE kind=?').get(kind).data; } finally { db.close(); } };
const backups = folder => fs.existsSync(path.join(folder, 'migration-backups')) ? fs.readdirSync(path.join(folder, 'migration-backups')) : [];

test('a version 4 database moves every record into rows without changing content, order, revision or versions', async t => {
  const folder = directory(t), filename = path.join(folder, 'hub.sqlite');
  const documents = Object.fromEntries(kinds.map(kind => [kind, demo(kind)]));
  await legacyDatabase(filename, documents);
  verifyDatabase(filename);
  let store = openStore(filename);
  for (const kind of kinds) {
    const current = store.get(kind);
    assert.equal(JSON.stringify(current.data), JSON.stringify(documents[kind]));
    assert.equal(current.revision, 7);
    assert.ok(Object.values(current.versions).every(version => version === 7));
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM report_entries WHERE kind=?').get(kind).count, documents[kind].entries.length);
    assert.equal(JSON.parse(store.db.prepare('SELECT data FROM documents WHERE kind=?').get(kind).data).entries, null);
  }
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 5);
  store.close();
  // The private pre-migration copy keeps the original documents byte for byte.
  const [copy] = backups(folder);
  assert.equal(backups(folder).length, 1);
  assert.equal(fs.statSync(path.join(folder, 'migration-backups', copy)).mode & 0o777, 0o600);
  for (const kind of kinds) assert.equal(raw(path.join(folder, 'migration-backups', copy), kind), JSON.stringify(documents[kind]));
  verifyDatabase(filename);
  store = openStore(filename);
  assert.equal(JSON.stringify(store.get('pair-targets').data), JSON.stringify(documents['pair-targets']));
  store.close();
  assert.equal(backups(folder).length, 1);
  // Older application code expects an array and stops instead of showing an empty module.
  assert.throws(() => { for (const value of JSON.parse(raw(filename, 'production-log')).entries) void value; }, TypeError);
});

test('report operations and whole-module writes keep order and change only affected rows', () => {
  const store = openStore(':memory:', clock);
  try {
    const ids = ['demo-row-a', 'demo-row-b', 'demo-row-c'];
    let saved;
    for (const id of ids) saved = store.reportOperation('production-log', {operationId: randomUUID(), action: 'create', entryId: id, entry: entry(id), reason: 'Fictional row setup'}, undefined, admin);
    const positions = () => Object.fromEntries(store.db.prepare("SELECT id,position FROM report_entries WHERE kind='production-log'").all().map(row => [row.id, row.position]));
    assert.deepEqual(positions(), {'demo-row-a': 0, 'demo-row-b': 1, 'demo-row-c': 2});
    saved = store.reportOperation('production-log', {operationId: randomUUID(), action: 'update', entryId: 'demo-row-b', entry: {...entry('demo-row-b'), tonnage: 1200}, reason: 'Fictional correction'}, saved.versions['demo-row-b'], admin);
    saved = store.reportOperation('production-log', {operationId: randomUUID(), action: 'delete', entryId: 'demo-row-a', reason: 'Fictional deletion'}, saved.versions['demo-row-a'], admin);
    assert.deepEqual(positions(), {'demo-row-b': 1, 'demo-row-c': 2});
    const deleted = store.reportHistory('production-log', 'demo-row-a', admin);
    saved = store.reportOperation('production-log', {operationId: randomUUID(), action: 'restore', entryId: 'demo-row-a', reason: 'Fictional restore', sourceVersion: deleted.events.find(event => event.action === 'update' || event.action === 'create').version}, deleted.version, admin);
    assert.deepEqual(saved.data.entries.map(value => value.id), ['demo-row-b', 'demo-row-c', 'demo-row-a']);
    assert.equal(saved.data.entries[0].tonnage, 1200);
    assert.deepEqual(positions(), {'demo-row-b': 1, 'demo-row-c': 2, 'demo-row-a': 3});
    // A reordered module with a record inserted in the middle is renumbered exactly.
    const current = store.get('production-log'), order = [current.data.entries[2], entry('demo-row-d'), current.data.entries[0], current.data.entries[1]];
    saved = store.put('production-log', {...current.data, entries: order, goalTons: 4000}, current.revision, admin, 'report', false, {reason: 'Fictional reorder'});
    assert.equal(JSON.stringify(saved.data), JSON.stringify({entries: order, goalTons: 4000}));
    assert.deepEqual(positions(), {'demo-row-a': 0, 'demo-row-d': 1, 'demo-row-b': 2, 'demo-row-c': 3});
    assert.equal(store.reportHistory('production-log', 'demo-row-d', admin).current.id, 'demo-row-d');
    assert.equal(store.reportHistoryList('production-log', admin, {limit: 50}).entries.length, 4);
  } finally { store.close(); }
});

test('a legacy module that cannot be represented as rows stays intact and readable', async t => {
  const folder = directory(t), filename = path.join(folder, 'hub.sqlite');
  const duplicated = {entries: [entry('demo-duplicate'), {...entry('demo-duplicate'), tonnage: 2000}], goalTons: 3000};
  await legacyDatabase(filename, {'production-log': duplicated});
  const store = openStore(filename, clock);
  try {
    assert.equal(JSON.stringify(store.get('production-log').data), JSON.stringify(duplicated));
    assert.equal(raw(filename, 'production-log'), JSON.stringify(duplicated));
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM report_entries').get().count, 0);
    // The next valid write replaces the whole module, as before, and stores rows.
    const current = store.get('production-log'), valid = {...duplicated, entries: [duplicated.entries[0]]};
    store.put('production-log', valid, current.revision, admin, 'report', false, {reason: 'Fictional cleanup'});
    assert.equal(JSON.stringify(store.get('production-log').data), JSON.stringify(valid));
    assert.equal(JSON.parse(raw(filename, 'production-log')).entries, null);
  } finally { store.close(); }
});

test('archive verification rejects a damaged row and accepts both storage versions', async t => {
  const folder = directory(t), filename = path.join(folder, 'hub.sqlite');
  const hub = createHubServer({filename, publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: clock.productionNow});
  hub.store.reportOperation('line-downtime', {operationId: randomUUID(), action: 'create', entryId: 'demo-row-downtime', entry: {id: 'demo-row-downtime', date: '2026-10-05', shift: 'СТИКЕРИ', start: '09:00', end: '09:30', durationMin: 30, reason: 'Друго', reasonNote: 'Fictional', note: ''}, reason: 'Fictional setup'}, undefined, admin);
  await hub.close();
  verifyDatabase(filename);
  const db = new DatabaseSync(filename);
  assert.equal(moduleData(db, 'line-downtime', db.prepare("SELECT data FROM documents WHERE kind='line-downtime'").get().data).entries[0].id, 'demo-row-downtime');
  db.exec("UPDATE report_entries SET data='{' WHERE kind='line-downtime'"); db.close();
  assert.throws(() => verifyDatabase(filename));
});
