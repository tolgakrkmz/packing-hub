/* Fictional identifiers only; precise delivery metadata never enters audit output. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createTasks} = require('../../server/tasks.cjs');
const {createImports} = require('../../server/imports.cjs');
const {createNotifications} = require('../../server/notifications.cjs');
const {types, href} = require('../../js/notification-model.js');
const {fixture} = require('./import-fixture.cjs');
const password = 'Fictional-notification-password-123';
const report = id => ({id, date: '2026-10-05', shift: 'В', tonnage: 1000, brak: 0});
async function setup(t, persistent = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-notice-target-demo-'));
  const filename = persistent ? path.join(dir, 'demo.sqlite') : ':memory:';
  const store = openStore(filename,{productionNow:()=>Date.parse('2026-10-05T10:00:00+03:00')}), auth = accounts(store); createTasks(store);
  const inbox = createNotifications(store), admin = await auth.create('demo-admin', password, 'admin',null,{},()=>{},{taskTeam:'В'});
  t.after(async () => { await inbox.close(); store.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {store, auth, inbox, admin, filename};
}
function all(inbox, user) {
  const items = []; let before;
  do { const page = inbox.list(user, before); items.push(...page.items); before = page.nextBefore; } while (before);
  return items;
}
test('every notification category has a local encoded destination and system component', () => {
  const sections = {systemDatabase: 'databaseCard', systemDisk: 'diskCard', systemBackup: 'backupCard', systemUpdate: 'updateCard', systemRecovery: 'systemSummary'};
  for (const [type, value] of Object.entries(types)) {
    const url = new URL(href(type, 'demo / ? # & "'), 'https://demo.example.test');
    assert.equal(url.origin, 'https://demo.example.test'); assert.equal(url.pathname, '/' + value.module);
    assert.equal(url.searchParams.get('target'), sections[type] || 'demo / ? # & "');
  }
  assert.equal(href('productionAdded', null), '/production-log');
  assert.equal(href('unknown', '//demo.example.test'), '/notifications');
});
test('batch additions, corrections and deletion keep exact links and current rights without leaking identifiers to audit', async t => {
  const {store, auth, inbox, admin} = await setup(t);
  let viewer = await auth.create('demo-observer', password, 'observer', admin, {canReceiveProductionAdded: true});
  store.put('production-log', {entries: [report('demo-target-one'), report('demo-target-two')], goalTons: 3000}, 1, admin);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notification_targets').get().n, 1);
  for (const row of store.db.prepare('SELECT detail FROM audit').all()) assert.doesNotMatch(row.detail, /demo-target|tonnage/);
  inbox.sync(); inbox.sync();
  assert.deepEqual(new Set(all(inbox, viewer).map(item => item.href)), new Set(['/production-log?target=demo-target-one', '/production-log?target=demo-target-two']));
  assert.deepEqual(inbox.summary(viewer), {count: 2});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notification_targets').get().n, 0);
  let current = store.get('production-log');
  store.put('production-log', {...current.data, entries: [{...report('demo-target-one'), tonnage: 2000}, report('demo-target-two')]}, current.revision, admin, 'report', false, {reason: 'Fictional correction'});
  current = store.get('production-log');
  store.put('production-log', {...current.data, entries: [current.data.entries[0]]}, current.revision, admin, 'report', false, {reason: 'Fictional deletion', action: 'delete'});
  inbox.sync();
  assert.deepEqual(new Set(all(inbox, admin).filter(item => item.type === 'productionChanged').map(item => item.href)), new Set(['/production-log?target=demo-target-one', '/production-log?target=demo-target-two']));
  assert.equal(inbox.summary(admin).count, inbox.list(admin).count);
  viewer = await auth.update(viewer.id, {permissions: {canViewProduction: false}}, admin);
  assert.equal(inbox.list(viewer).count, 0); assert.deepEqual(inbox.summary(viewer), {count: 0});
});
test('real all-module import and nested attachment changes resolve reports, pairs and instruction profiles', async t => {
  const {store, inbox, admin, filename} = await setup(t, true), imports = createImports(store, filename);
  t.after(() => imports.close());
  const data = fixture(), staged = imports.create(data.payload, admin);
  data.contents.forEach((content, index) => imports.upload(staged.id, index, content, admin));
  imports.apply(staged.id, imports.preview(staged.id, admin).token, admin); inbox.sync();
  const items = all(inbox, admin);
  for (const [type, id] of [['productionAdded', 'demo-legacy-production'], ['downtimeAdded', 'demo-legacy-downtime'], ['pairs', 'demo-legacy-pair'], ['instructions', data.payload.documents['package-instructions']['900202'].folderName]]) {
    assert.ok(items.some(item => item.type === type && new URL(item.href, 'https://demo.example.test').searchParams.get('target') === id));
  }
  const file = data.payload.files[0], current = store.node(file.path);
  store.writeFile(file.path, Buffer.from('Fictional changed instruction.'), file.mime, current.revision, admin); inbox.sync();
  assert.equal(inbox.list(admin).items[0].href, href('instructions', data.payload.documents['package-instructions']['900202'].folderName));
  for (const row of store.db.prepare('SELECT detail FROM audit').all()) assert.doesNotMatch(row.detail, /demo-legacy|Demo Client|folderName|tonnage/);
});
test('legacy notifications retain module links while new targets survive service recreation without duplication', async t => {
  const {store, inbox, admin} = await setup(t);
  store.audit(admin, 'write', 'production-log', {added: true}); inbox.sync();
  assert.equal(inbox.list(admin).items[0].href, '/production-log');
  store.put('production-log', {entries: [report('demo-restarted-target')], goalTons: 3000}, 1, admin);
  await inbox.close();
  const restarted = createNotifications(store); t.after(() => restarted.close());
  restarted.sync(); restarted.sync();
  assert.equal(restarted.list(admin).items[0].href, '/production-log?target=demo-restarted-target');
  assert.equal(restarted.list(admin).count, 2);
});
