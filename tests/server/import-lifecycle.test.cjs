/* Isolated SQLite and reviewed fictional attachment fixtures only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openStore} = require('../../server/store.cjs');
const {createImports} = require('../../server/imports.cjs');
const {fixture} = require('./import-fixture.cjs');
const user = {id: 1, role: 'admin'};
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-import-lifecycle-demo-'));
  const store = openStore(path.join(directory, 'demo.sqlite'));
  const imports = createImports(store, path.join(directory, 'demo.sqlite'));
  t.after(() => { imports.close(); store.close(); fs.rmSync(directory, {recursive: true, force: true}); });
  return {store, imports, directory};
}
const source = () => ({documents: {'production-log': {entries: [], goalTons: 4200}}, files: [], includeSettings: true});
test('only the newest preview token applies; denied and repeated applies cannot add writes or audit entries', t => {
  const {store, imports} = setup(t), id = imports.create(source(), user).id;
  const first = imports.preview(id, user), next = imports.preview(id, user), before = store.get('production-log');
  assert.notEqual(first.token, next.token);
  for (const token of [first.token, '', null]) assert.throws(() => imports.apply(id, token, user), {code: 'IMPORT_PREVIEW_REQUIRED'});
  assert.deepEqual(store.get('production-log'), before);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='import'").get().n, 0);
  imports.apply(id, next.token, user);
  const accepted = store.get('production-log');
  assert.equal(accepted.data.goalTons, 4200);
  assert.throws(() => imports.apply(id, next.token, user), {code: 'IMPORT_EXPIRED'});
  assert.deepEqual(store.get('production-log'), accepted);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='import'").get().n, 1);
});
test('replacing a complete same-size upload invalidates approval and a fresh preview imports the replacement bytes', t => {
  const {store, imports} = setup(t), data = fixture(), id = imports.create(data.payload, user).id;
  data.contents.forEach((content, index) => imports.upload(id, index, content, user));
  const first = imports.preview(id, user);
  const replacement = Buffer.alloc(data.contents[0].length, 'X');
  imports.upload(id, 0, replacement, user);
  assert.throws(() => imports.apply(id, first.token, user), {code: 'IMPORT_PREVIEW_REQUIRED'});
  assert.equal(store.get('production-log').revision, 1);
  assert.throws(() => store.node(data.payload.files[0].path), {code: 'NOT_FOUND'});
  const checked = imports.preview(id, user); assert.equal(checked.canApply, true);
  imports.apply(id, checked.token, user);
  assert.deepEqual(Buffer.from(store.node(data.payload.files[0].path).content), replacement);
});
test('staging quota is owner-scoped and releasing a batch or expiring it frees capacity without importing data', t => {
  const {store, imports, directory} = setup(t);
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-11T12:00:00Z')});
  const ids = Array.from({length: 4}, () => imports.create(source(), user).id);
  assert.throws(() => imports.create(source(), user), {code: 'IMPORT_LIMIT'});
  const other = {id: 2, role: 'admin'}, theirs = imports.create(source(), other).id;
  assert.throws(() => imports.discard(theirs, user), {code: 'FORBIDDEN'});
  imports.discard(ids[0], user);
  const replacement = imports.create(source(), user).id;
  t.mock.timers.tick(4 * 3600000 + 1);
  assert.throws(() => imports.preview(replacement, user), {code: 'IMPORT_EXPIRED'});
  const fresh = imports.create(source(), user).id;
  assert.deepEqual(fs.readdirSync(path.join(directory, 'import-staging')), [fresh]);
  assert.equal(store.get('production-log').revision, 1);
});
test('lost create responses can repeat the same batch, but changed settings or manifests conflict without replacing it', t => {
  const {store, imports} = setup(t), input = {...source(), id: '22222222-2222-4222-8222-222222222222'};
  const first = imports.create(input, user);
  assert.deepEqual(imports.create(input, user), first);
  for (const changed of [{...input, includeSettings: false}, {...input, documents: {'production-log': {entries: [], goalTons: 9999}}}]) {
    assert.throws(() => imports.create(changed, user), {code: 'CONFLICT'});
  }
  const checked = imports.preview(first.id, user);
  imports.apply(first.id, checked.token, user);
  assert.equal(store.get('production-log').data.goalTons, 4200);
});
