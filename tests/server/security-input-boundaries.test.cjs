/* Bounded local regressions; generated images, fictional records and isolated SQLite only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {openStore, safePath} = require('../../server/store.cjs');
const {createImports} = require('../../server/imports.cjs');
const {createTaskPhotos, jpeg, MAX_BYTES} = require('../../server/task-photos.cjs');
const {createTasks} = require('../../server/tasks.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createHubServer} = require('../../server/server.cjs');
const {photo} = require('./task-photo-fixture.cjs');
const user = {id: 1, username: 'demo-input-admin', role: 'admin'};
const image = Buffer.from(photo, 'base64');
const emptyTables = Buffer.from('ffd8ffdb0002ffc40002ffc0000b080001000101011100ffda0008010100003f0000ffd9', 'hex').toString('base64');
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-security-input-demo-'));
  const filename = path.join(directory, 'demo.sqlite'), store = openStore(filename), imports = createImports(store, filename);
  t.after(() => { imports.close(); store.close(); fs.rmSync(directory, {recursive: true, force: true}); });
  return {directory, store, imports};
}
const auditCount = store => store.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
const profile = {number: '900301', name: 'Demo Boundary Box', folderName: 'Demo Boundary Box', images: []};
const manifest = files => ({documents: {'package-instructions': {'900301': profile}}, files, includeSettings: false});
const file = (name, size = 0) => ({path: 'data/profiles/Demo Boundary Box/' + name, size, mime: 'application/octet-stream'});
const paddedImage = size => Buffer.concat([image.subarray(0, -2), Buffer.alloc(size - image.length), image.subarray(-2)]).toString('base64');
function nested(depth) {
  const root = {}; let current = root;
  for (let index = 0; index < depth; index++) { current.next = {}; current = current.next; }
  return root;
}
const report = extra => ({id: 'demo-depth-boundary', date: '2026-10-04', shift: 'А', tonnage: 2, brak: 0, breakdown: null, ...extra});
async function httpSetup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-security-input-http-demo-'));
  const hub = createHubServer({filename: path.join(directory, 'demo.sqlite'), publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  t.after(async () => { try { await hub.close(); } finally { fs.rmSync(directory, {recursive: true, force: true}); } });
  await hub.auth.create('demo-http-input-admin', 'Fictional-input-password-123', 'admin');
  const login = await hub.auth.login('demo-http-input-admin', 'Fictional-input-password-123');
  await new Promise((resolve, reject) => { hub.server.once('error', reject); hub.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const headers = {Origin: base, Cookie: 'hub-local-session=' + login.token, 'X-CSRF-Token': login.csrf, 'Content-Type': 'application/json'};
  const request = (route, options = {}) => fetch(base + route, {...options, headers: {...headers, ...options.headers}, redirect: 'manual'});
  return {hub, login, request};
}

test('JPEG evidence rejects empty required quantization and Huffman tables', () => {
  assert.throws(() => jpeg(emptyTables), {code: 'TASK_PHOTO_INVALID'});
});
test('JPEG evidence rejects unsupported quantization precision', () => {
  const invalid = Buffer.from(image), marker = invalid.indexOf(Buffer.from([0xff, 0xdb]));
  invalid[marker + 4] = 0x20;
  assert.throws(() => jpeg(invalid.toString('base64')), {code: 'TASK_PHOTO_INVALID'});
});
test('JPEG evidence rejects unsupported Huffman table classes', () => {
  const invalid = Buffer.from(image), marker = invalid.indexOf(Buffer.from([0xff, 0xc4]));
  invalid[marker + 4] = 0x20;
  assert.throws(() => jpeg(invalid.toString('base64')), {code: 'TASK_PHOTO_INVALID'});
});
test('JPEG evidence rejects an oversubscribed Huffman tree', () => {
  const invalid = Buffer.from(image), marker = invalid.indexOf(Buffer.from([0xff, 0xc4]));
  invalid[marker + 5] = 3; // Three length-one codes cannot fit in a binary tree.
  assert.throws(() => jpeg(invalid.toString('base64')), {code: 'TASK_PHOTO_INVALID'});
});
test('invalid JPEG evidence rolls back prior photos, task history, audit and retry receipts', async t => {
  const {store} = setup(t), auth = accounts(store);
  const admin = await auth.create('demo-boundary-manager', 'Fictional-input-password-123', 'admin');
  const owner = await auth.create('demo-boundary-owner', 'Fictional-input-password-123', 'operator', admin, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const tasks = createTasks(store, {now: () => Date.parse('2026-12-01T12:00:00Z')});
  const input = {requestId: randomUUID(), title: 'Fictional invalid evidence', description: '', priority: 'normal', assigneeId: owner.id, participantIds: [], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', problemPhotos: [photo, emptyTables]};
  const before = auditCount(store);
  assert.throws(() => tasks.create(input, admin), {code: 'TASK_PHOTO_INVALID'});
  for (const table of ['task_items', 'task_schedules', 'task_requests', 'task_photos']) assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0);
  assert.equal(auditCount(store), before);
  const {id} = tasks.create({...input, problemPhotos: [photo, photo]}, admin);
  const saved = tasks.list(admin).items.find(item => item.id === id), savedAudit = auditCount(store);
  assert.throws(() => tasks.change(id, {requestId: randomUUID(), action: 'report', status: 'review', note: 'Fictional refused evidence', solutionPhotos: [photo, emptyTables]}, 1, owner), {code: 'TASK_PHOTO_INVALID'});
  assert.deepEqual(tasks.list(admin).items.find(item => item.id === id), saved);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM task_photos').get().n, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM task_requests').get().n, 1);
  assert.equal(auditCount(store), savedAudit);
});
test('JPEG byte and storage quotas accept the exact boundary and refuse the next image without a partial blob', t => {
  const {store} = setup(t), photos = createTaskPhotos(store, {limitBytes: MAX_BYTES, freeBytes: () => Infinity});
  const input = paddedImage(MAX_BYTES);
  assert.equal(jpeg(input).content.length, 307200);
  const accepted = photos.add(input, 1);
  assert.deepEqual(photos.get({problemPhotos: [accepted]}, accepted.id), Buffer.from(input, 'base64'));
  assert.throws(() => jpeg(paddedImage(MAX_BYTES + 1)), {code: 'TASK_PHOTO_INVALID'});
  assert.throws(() => photos.add(photo, 2), {code: 'TASK_PHOTO_STORAGE'});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM task_photos').get().n, 1);
  assert.equal(photos.policy().usedBytes, 307200);
});
test('import file count is bounded before staging and accepts exactly five thousand metadata entries', t => {
  const {store, imports, directory} = setup(t);
  const files = Array.from({length: 5000}, (_, index) => file('demo-' + index + '.bin'));
  assert.throws(() => imports.create(manifest([...files, file('demo-extra.bin')]), user), {code: 'TOO_LARGE'});
  assert.deepEqual(fs.readdirSync(path.join(directory, 'import-staging')), []);
  const created = imports.create(manifest(files), user);
  assert.equal(created.files, 5000);
  imports.discard(created.id, user);
  assert.equal(store.get('package-instructions').revision, 1); assert.equal(auditCount(store), 0);
});
test('import total-byte metadata accepts exactly one GiB and rejects one byte more without allocating file contents', t => {
  const {imports, directory} = setup(t);
  const files = Array.from({length: 51}, (_, index) => file('demo-quota-' + index + '.bin', 20 * 1024 * 1024));
  files.push(file('demo-quota-last.bin', 4 * 1024 * 1024));
  const larger = files.map(value => ({...value})); larger[51].size++;
  assert.throws(() => imports.create(manifest(larger), user), {code: 'TOO_LARGE'});
  assert.deepEqual(fs.readdirSync(path.join(directory, 'import-staging')), []);
  const created = imports.create(manifest(files), user); assert.equal(created.files, 52);
  imports.discard(created.id, user);
});
test('malformed import objects, unsupported module keys and prototype keys never create staging or audit rows', t => {
  const {store, imports, directory} = setup(t);
  for (const input of [null, false, [], {}, {...manifest([]), files: null}, {...manifest([]), files: [null]}, {...manifest([]), files: [file('demo.bin', -1)]}, {...manifest([]), includeSettings: 'false'}]) {
    assert.throws(() => imports.create(input, user), error => error.code === 'INVALID_DATA' || error.code === 'INVALID_PATH');
  }
  for (const kind of ['__proto__', 'constructor', 'prototype', 'demo-unknown']) {
    assert.throws(() => imports.create({documents: JSON.parse('{"' + kind + '":{}}'), files: [], includeSettings: false}, user), {code: 'NOT_FOUND'});
    if (kind !== 'demo-unknown') assert.throws(() => store.put('package-instructions', JSON.parse('{"' + kind + '":' + JSON.stringify(profile) + '}'), 1, user), {code: 'INVALID_DATA'});
  }
  assert.deepEqual(fs.readdirSync(path.join(directory, 'import-staging')), []);
  assert.equal(auditCount(store), 0); assert.equal(store.get('package-instructions').revision, 1);
  assert.equal({}.number, undefined);
});
for (const boundary of ['operation', 'replacement', 'import']) test('excessive JSON nesting is refused before ' + boundary + ' without writes', t => {
  const {store, imports, directory} = setup(t), entry = report({extra: nested(4000)}), before = store.get('production-log');
  if (boundary === 'operation') assert.throws(() => store.reportOperation('production-log', {operationId: randomUUID(), action: 'create', entryId: entry.id, entry}, undefined, user), {code: 'INVALID_OPERATION'});
  if (boundary === 'replacement') assert.throws(() => store.put('production-log', {entries: [entry], goalTons: 3000}, 1, user), {code: 'INVALID_DATA'});
  if (boundary === 'import') assert.throws(() => imports.create({documents: {'production-log': {entries: [entry]}}, files: [], includeSettings: false}, user), {code: 'INVALID_DATA'});
  assert.deepEqual(store.get('production-log'), before); assert.equal(auditCount(store), 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM report_operations').get().n, 0);
  assert.deepEqual(fs.readdirSync(path.join(directory, 'import-staging')), []);
});
test('document nesting accepts depth sixty-four and refuses depth sixty-five without another revision', t => {
  const {store} = setup(t);
  const accepted = store.put('production-log', {entries: [], goalTons: 3000, extra: nested(63)}, 1, user);
  assert.equal(accepted.revision, 2);
  assert.throws(() => store.put('production-log', {entries: [], goalTons: 3000, extra: nested(64)}, 2, user), {code: 'INVALID_DATA'});
  assert.deepEqual(store.get('production-log'), accepted); assert.equal(auditCount(store), 1);
});
test('ordinary nested optional metadata remains readable and duplicate operations canonicalize key order', t => {
  const {store} = setup(t), entry = report({extra: nested(12)}), operationId = randomUUID();
  const first = store.reportOperation('production-log', {operationId, action: 'create', entryId: entry.id, entry}, undefined, user);
  const retry = store.reportOperation('production-log', {entry: {...entry, extra: nested(12)}, entryId: entry.id, action: 'create', operationId}, undefined, user);
  assert.equal(retry.replayed, true); assert.deepEqual(retry.receipt, first.receipt);
  assert.equal(store.get('production-log').revision, 2); assert.equal(auditCount(store), 1);
});
test('attachment paths reject traversal, ambiguous segments and bounded length while SQL-like filenames stay literal', t => {
  const {store} = setup(t);
  for (const value of [null, '', '../demo', '/demo', 'data/./demo', 'data/../demo', 'data//demo', 'data\\demo', 'data/\0demo', 'x'.repeat(201), Array(6).fill('x'.repeat(180)).join('/')]) assert.throws(() => safePath(value), {code: 'INVALID_PATH'});
  const literal = "data/profiles/demo' OR 1=1 --.bin";
  store.createNode(literal, 'file', user);
  store.writeFile(literal, Buffer.from([0, 255, 128, 10]), 'application/octet-stream', 1, user);
  assert.deepEqual(Buffer.from(store.node(literal).content), Buffer.from([0, 255, 128, 10]));
  assert.throws(() => store.node('data/%2e%2e/demo'), {code: 'NOT_FOUND'});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 3);
});
test('binary attachment HTTP preserves bytes, uses attachment disposition and refuses malformed or stale revisions', async t => {
  const {hub, login, request} = await httpSetup(t);
  const name = 'data/profiles/demo-binary.bin', route = '/api/files?path=' + encodeURIComponent(name), bytes = Buffer.from([0, 255, 128, 10]);
  hub.store.createNode(name, 'file', login.user);
  const headers = {'Content-Type': 'application/octet-stream'};
  for (const revision of [undefined, '1', '"0"', 'W/"1"', '"1", "2"']) {
    const response = await request(route, {method: 'PUT', headers: {...headers, ...(revision ? {'If-Match': revision} : {})}, body: bytes});
    assert.equal(response.status, 428); assert.deepEqual(await response.json(), {error: 'REVISION_REQUIRED'});
  }
  assert.equal((await request(route, {method: 'PUT', headers: {...headers, 'If-Match': '"1"'}, body: bytes})).status, 200);
  const before = auditCount(hub.store);
  const stale = await request(route, {method: 'PUT', headers: {...headers, 'If-Match': '"1"'}, body: Buffer.from('Fictional stale replacement')});
  assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), {error: 'CONFLICT'});
  assert.equal(auditCount(hub.store), before);
  const response = await request(route, {headers});
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('content-disposition'), 'attachment'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('etag'), '"2"'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
test('report, import and task HTTP reject malformed JSON and excessive nesting with sanitized client errors and no mutations', async t => {
  const {hub, request} = await httpSetup(t), before = hub.store.get('production-log'), audits = auditCount(hub.store);
  for (const route of ['/api/reports/production-log/operations', '/api/import/batches', '/api/tasks']) {
    for (const body of ['{', 'null', '[]', '42', '"fictional"']) {
      const response = await request(route, {method: 'POST', body});
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), {error: 'INVALID_DATA'});
    }
    const response = await request(route, {method: 'POST', body: '{}', headers: {'Content-Type': 'text/plain'}});
    assert.equal(response.status, 415); assert.deepEqual(await response.json(), {error: 'JSON_REQUIRED'});
  }
  const entry = report({extra: nested(4000)});
  const response = await request('/api/reports/production-log/operations', {method: 'POST', body: JSON.stringify({operationId: randomUUID(), action: 'create', entryId: entry.id, entry})});
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), {error: 'INVALID_OPERATION'});
  const replaced = await request('/api/data/production-log', {method: 'PUT', headers: {'If-Match': '"1"'}, body: JSON.stringify({entries: [entry], goalTons: 3000})});
  assert.equal(replaced.status, 400); assert.deepEqual(await replaced.json(), {error: 'INVALID_DATA'});
  assert.deepEqual(hub.store.get('production-log'), before); assert.equal(auditCount(hub.store), audits);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM report_operations').get().n, 0);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM task_items').get().n, 0);
  assert.equal((await request('/api/session')).status, 200);
});
