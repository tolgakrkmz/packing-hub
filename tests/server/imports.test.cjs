const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openStore} = require('../../server/store.cjs');
const {createImports, limits} = require('../../server/imports.cjs');
const user = {id: 1, role: 'admin'};
const copy = value => JSON.parse(JSON.stringify(value));
const entry = id => ({id, date: '2026-10-04', shift: 'А', tonnage: 2000, brak: 20, breakdown: null});
const {fixture} = require('./import-fixture.cjs');
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-all-import-demo-'));
  const filename = path.join(directory, 'demo.sqlite'), store = openStore(filename), imports = createImports(store, filename);
  t.after(() => { imports.close(); store.close(); fs.rmSync(directory, {recursive: true, force: true}); });
  function stage(value = fixture()) {
    const {id} = imports.create(value.payload, user); value.contents.forEach((content, index) => imports.upload(id, index, content, user)); return id;
  }
  return {directory, filename, store, imports, stage};
}
test('all modules and nested instruction files commit together, preserve live records, normalize legacy personnel and retain retired pair history', t => {
  const {directory, store, imports, stage} = setup(t), data = fixture();
  store.put('production-log', {entries: [entry('demo-live-production')], goalTons: 3000}, 1, user);
  const id = stage(data), preview = imports.preview(id, user);
  assert.equal(preview.canApply, true); assert.equal(preview.files.added, 3);
  for (const kind of Object.keys(data.payload.documents)) assert.equal(preview.documents[kind].added, kind === 'personnel' ? 2 : 1);
  assert.equal(store.get('personnel').data.employees.length, 0);
  const result = imports.apply(id, preview.token, user); assert.equal(result.backup, true);
  assert.equal(store.get('production-log').data.entries.length, 2); assert.equal(store.get('production-log').data.goalTons, 5000);
  assert.equal(store.get('line-downtime').data.entries[0].durationMin, 30); assert.ok(store.get('line-downtime').data.reasons.includes('Друго'));
  const personnel = store.get('personnel').data; assert.equal(personnel.schemaVersion, 3); assert.ok(personnel.employees.every(person => !person.active && person.team === '1 смяна')); assert.equal(personnel.moveLog.length, 1); assert.equal(personnel.settings.stickersStage1, 3);
  assert.deepEqual(store.get('pair-targets').data.entries, data.payload.documents['pair-targets'].entries);
  for (const [index, file] of data.payload.files.entries()) assert.ok(Buffer.from(store.node(file.path).content).equals(data.contents[index]));
  const backup = openStore(path.join(directory, 'import-backups', fs.readdirSync(path.join(directory, 'import-backups'))[0]));
  assert.equal(backup.get('production-log').data.entries.length, 1); assert.equal(backup.get('personnel').data.employees.length, 0); backup.close();
  assert.equal(fs.readdirSync(path.join(directory, 'import-staging')).length, 0);
  const again = stage(data), repeated = imports.preview(again, user); assert.equal(repeated.canApply, false); assert.equal(repeated.changes, 0); assert.equal(repeated.files.duplicates, 3);
  assert.equal(repeated.documents.personnel.duplicates, 2); assert.equal(repeated.documents.personnel.historyAdded, 0);
  const revision = store.get('production-log').revision; imports.apply(again, repeated.token, user); assert.equal(store.get('production-log').revision, revision);
});
test('missing uploads or missing referenced attachments block every module until all required files are present', t => {
  const {store, imports} = setup(t), data = fixture();
  const id = imports.create(data.payload, user).id;
  let preview = imports.preview(id, user); assert.equal(preview.files.missing, 3); assert.equal(preview.canApply, false);
  assert.throws(() => imports.apply(id, preview.token, user), error => error.code === 'IMPORT_FILES_MISSING');
  assert.equal(store.get('production-log').revision, 1);
  data.contents.forEach((content, index) => imports.upload(id, index, content, user));
  assert.throws(() => imports.apply(id, preview.token, user), error => error.code === 'IMPORT_PREVIEW_REQUIRED');
  preview = imports.preview(id, user); imports.apply(id, preview.token, user);
  const absent = fixture(); absent.payload.documents['package-instructions']['900202'].images.push('demo-missing.png');
  const missing = imports.create(absent.payload, user).id; absent.contents.forEach((content, index) => imports.upload(missing, index, content, user));
  const rejected = imports.preview(missing, user); assert.equal(rejected.files.missing, 1); assert.equal(rejected.canApply, false);
});
test('changed database or attachments invalidate a preview and cannot partially import another module', t => {
  const {store, imports, stage} = setup(t), id = stage(), preview = imports.preview(id, user);
  store.put('production-log', {entries: [entry('demo-concurrent')], goalTons: 3000}, 1, user);
  assert.throws(() => imports.apply(id, preview.token, user), error => error.code === 'CONFLICT');
  assert.equal(store.get('personnel').data.employees.length, 0);
  const checked = imports.preview(id, user); imports.apply(id, checked.token, user);
  const value = fixture(); value.payload.documents['production-log'].entries.push(entry('demo-another-history'));
  const second = stage(value), before = imports.preview(second, user), file = value.payload.files[0];
  store.writeFile(file.path, Buffer.from('Fictional changed instruction'), 'text/plain', 1, user);
  assert.throws(() => imports.apply(second, before.token, user), error => error.code === 'CONFLICT');
  const conflict = imports.preview(second, user); assert.equal(conflict.files.conflicts, 1); assert.equal(conflict.canApply, false);
  assert.throws(() => imports.apply(second, conflict.token, user), error => error.code === 'IMPORT_CONFLICT');
  assert.equal(store.get('production-log').data.entries.length, 2);
});
test('conflicting record IDs and overlapping pair scopes reject atomic imports; repeated movement history retains multiplicity', t => {
  const {store, imports, stage} = setup(t), data = fixture(), first = stage(data); imports.apply(first, imports.preview(first, user).token, user);
  for (const kind of ['production-log', 'personnel', 'pair-targets', 'package-instructions']) {
    const changed = fixture();
    if (kind === 'production-log') changed.payload.documents[kind].entries[0].tonnage = 1;
    if (kind === 'personnel') changed.payload.documents[kind].employees[0].name = 'Demo Changed Person';
    if (kind === 'pair-targets') changed.payload.documents[kind].entries[0].id = 'demo-overlap';
    if (kind === 'package-instructions') changed.payload.documents[kind]['900202'].name = 'Demo Changed Box';
    const id = stage(changed), preview = imports.preview(id, user); assert.ok(preview.documents[kind].conflicts > 0);
    assert.throws(() => imports.apply(id, preview.token, user), error => error.code === 'IMPORT_CONFLICT'); imports.discard(id, user);
  }
  const history = fixture(); history.payload.documents.personnel.moveLog.push(copy(history.payload.documents.personnel.moveLog[0]));
  const id = stage(history), preview = imports.preview(id, user); assert.equal(preview.documents.personnel.historyAdded, 1); imports.apply(id, preview.token, user); assert.equal(store.get('personnel').data.moveLog.length, 2);
});
test('imports can retain current settings and fill missing instruction files without replacing an existing index', t => {
  const {store, imports, stage} = setup(t), data = fixture(); data.payload.includeSettings = false;
  store.put('package-instructions', data.payload.documents['package-instructions'], 1, user);
  const id = stage(data), preview = imports.preview(id, user); assert.equal(preview.documents['package-instructions'].duplicates, 1); assert.equal(preview.documents['production-log'].settingsChanges, 0);
  imports.apply(id, preview.token, user); assert.equal(store.get('production-log').data.goalTons, 3000); assert.equal(store.get('personnel').data.settings.stickersStage1, 4);
  assert.ok(store.node(data.payload.files[1].path).content.length > 0);
});
test('private staging is admin-owned, bounded, idempotent, cancellable and does not reveal rejected file content', t => {
  const {directory, store, imports} = setup(t), data = fixture(); data.payload.id = '11111111-1111-4111-8111-111111111111';
  const id = imports.create(data.payload, user).id; assert.equal(imports.create(data.payload, user).id, id);
  assert.throws(() => imports.preview(id, {id: 2, role: 'admin'}), error => error.code === 'FORBIDDEN');
  assert.throws(() => imports.create(data.payload, {id: 2, role: 'operator'}), error => error.code === 'FORBIDDEN');
  for (const value of [
    {...data.payload, files: [{...data.payload.files[0], path: 'data/profiles/../demo-private'}]},
    {...data.payload, files: [{...data.payload.files[0], path: 'data/profiles/unreferenced/demo-private'}]},
    {...data.payload, files: [{...data.payload.files[0], mime: 'text/plain\r\nDemoMarker'}]},
    {...data.payload, files: [{...data.payload.files[0], size: limits.fileBytes + 1}]},
    {...data.payload, documents: {personnel: {employees: [{id: 'demo', name: 'DemoMarker', category: 'unknown'}]}}}
  ]) assert.throws(() => imports.create(value, user), error => !error.message.includes('DemoMarker'));
  assert.throws(() => imports.upload(id, 0, Buffer.from('wrong'), user), error => error.code === 'INVALID_DATA');
  imports.discard(id, user); assert.equal(fs.readdirSync(path.join(directory, 'import-staging')).length, 0); assert.equal(store.get('personnel').revision, 1);
});
test('backup failures and directory collisions never leave partially imported modules or files', t => {
  const {directory, store, imports, stage} = setup(t), data = fixture(), id = stage(data), preview = imports.preview(id, user);
  fs.writeFileSync(path.join(directory, 'import-backups'), 'Fictional obstruction');
  assert.throws(() => imports.apply(id, preview.token, user), error => error.code === 'BACKUP_FAILED'); assert.equal(store.get('personnel').revision, 1);
  fs.unlinkSync(path.join(directory, 'import-backups'));
  store.createNode('data/profiles/Demo Client', 'file', user);
  const rejected = imports.preview(id, user); assert.ok(rejected.files.conflicts > 0);
  assert.throws(() => imports.apply(id, rejected.token, user), error => error.code === 'IMPORT_CONFLICT'); assert.equal(store.get('production-log').revision, 1);
});
test('a failure while inserting an attachment rolls back every document, directory and earlier file in the batch', t => {
  const {store, imports, stage} = setup(t), id = stage(), preview = imports.preview(id, user);
  store.db.exec("CREATE TRIGGER deny_demo BEFORE INSERT ON files WHEN NEW.path LIKE '%demo.pdf' BEGIN SELECT RAISE(ABORT,'Fictional database write failure'); END;");
  assert.throws(() => imports.apply(id, preview.token, user));
  for (const kind of ['production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions']) assert.equal(store.get(kind).revision, 1);
  assert.equal(store.db.prepare("SELECT count(*) AS total FROM files WHERE path LIKE 'data/profiles/%'").get().total, 0);
  store.db.exec('DROP TRIGGER deny_demo');
  imports.apply(id, imports.preview(id, user).token, user); assert.equal(store.get('personnel').data.employees.length, 2);
});
