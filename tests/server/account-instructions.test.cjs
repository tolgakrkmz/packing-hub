const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {openStore} = require('../../server/store.cjs');
const {accounts} = require('../../server/accounts.cjs');
const {createHubServer} = require('../../server/server.cjs');
const root = path.resolve(__dirname, '../..');
const password = 'Fictional-instructions-123';
const pdf = Buffer.from('%PDF-1.4\n% Fictional test attachment\n%%EOF\n');
const attachment = 'data/profiles/Demo Client/4826/message.pdf';
const index = {'4826': {number:'4826', name:'Demo profile 4826', client:'Demo Client', category:'standard', folderName:'Demo Client/4826', images:['message.pdf'], timestamp:0}};
async function fixture(t, role = 'observer') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-account-instructions-test-'));
  const filename = path.join(directory, 'demo.sqlite'), source = path.join(directory, 'bundle');
  const store = openStore(filename), auth = accounts(store);
  const admin = await auth.create('demo-admin', password, 'admin');
  const owner = await auth.create('demo-preview', password, role);
  store.put('package-instructions', {'9001': {number:'9001', name:'Fictional shared profile', client:'Demo Shared', category:'standard', folderName:'demo-shared', images:[], timestamp:0}}, 1, admin);
  store.createNode('data/profiles/demo-shared', 'directory', admin);
  store.createNode('data/profiles/demo-shared/instruction.txt', 'file', admin);
  store.writeFile('data/profiles/demo-shared/instruction.txt', Buffer.from('Fictional shared text'), 'text/plain', 1, admin);
  store.close();
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  fs.mkdirSync(path.join(source, path.dirname(attachment)), {recursive:true});
  fs.writeFileSync(path.join(source, 'data/package-instructions.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(source, attachment), pdf);
  const install = (username = owner.username) => spawnSync(process.execPath, ['server/manage.cjs', 'install-account-instructions', username, source], {cwd:root, env:{...process.env, HUB_DATABASE:filename}, encoding:'utf8'});
  const start = async () => {
    const hub = createHubServer({filename, publicOrigin:'http://127.0.0.1:0', allowHttp:true});
    t.after(() => hub.close());
    await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + hub.server.address().port;
    const login = async user => {
      const session = await hub.auth.login(user.username, password);
      return {cookie:'hub-local-session=' + session.token, csrf:session.csrf};
    };
    const request = (url, session, method = 'GET', body, extra = {}) => fetch(base + url, {method, headers:{Origin:base, ...(session ? {Cookie:session.cookie, 'X-CSRF-Token':session.csrf} : {}), ...(body ? {'Content-Type':'application/json'} : {}), ...extra}, ...(body ? {body:JSON.stringify(body)} : {})});
    return {hub, request, ownerSession:await login(owner), adminSession:await login(admin)};
  };
  return {directory, filename, source, install, start, owner, admin};
}
test('local installation gives only its owner nested profiles and attachment downloads, preserving shared instructions', async t => {
  const f = await fixture(t);
  const installed = f.install();
  assert.equal(installed.status, 0, installed.stderr);
  const {hub, request, ownerSession, adminSession} = await f.start();
  const result = await (await request('/api/data/package-instructions', ownerSession)).json();
  assert.deepEqual(result.data, index);
  assert.deepEqual(JSON.parse(await (await request('/api/files?path=data/package-instructions.json', ownerSession)).text()), index);
  const shared = await (await request('/api/data/package-instructions', adminSession)).json();
  assert.deepEqual(Object.keys(shared.data), ['9001']);
  assert.deepEqual((await (await request('/api/folders?path=data/profiles', ownerSession)).json()).entries, [{name:'Demo Client', kind:'directory'}]);
  assert.deepEqual((await (await request('/api/folders?path=data/profiles/Demo%20Client', ownerSession)).json()).entries, [{name:'4826', kind:'directory'}]);
  const fileURL = '/api/files?path=' + encodeURIComponent(attachment);
  const download = await request(fileURL, ownerSession);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  assert.equal((await request(fileURL, adminSession)).status, 404);
  assert.equal((await request(fileURL)).status, 401);
  assert.equal((await request('/api/files?path=data/profiles/demo-shared/instruction.txt', ownerSession)).status, 404);
  assert.equal((await request('/api/folders?path=data/profiles/Demo%20Client', adminSession)).status, 404);
  await hub.auth.update(f.owner.id, {permissions:{canViewInstructions:false}}, f.admin);
  const denied = await hub.auth.login(f.owner.username, password);
  assert.equal((await request(fileURL, {cookie:'hub-local-session=' + denied.token, csrf:denied.csrf})).status, 403);
});
test('private instruction workspaces cannot mutate shared indexes, folders or imports even with an administrative role', async t => {
  const f = await fixture(t, 'admin');
  assert.equal(f.install().status, 0);
  const {hub, request, ownerSession} = await f.start();
  const original = hub.store.get('package-instructions');
  const session = await (await request('/api/session', ownerSession)).json();
  assert.equal(session.user.permissions.canManageInstructions, false);
  assert.equal(session.user.permissions.canImportData, false);
  assert.equal((await request('/api/data/package-instructions', ownerSession, 'PUT', {}, {'If-Match':'"1"'})).status, 403);
  assert.equal((await request('/api/files?path=data/package-instructions.json', ownerSession, 'PUT', {}, {'If-Match':'"1"'})).status, 403);
  assert.equal((await request('/api/folders', ownerSession, 'POST', {path:'data/profiles/demo-unwanted', kind:'directory'})).status, 403);
  assert.equal((await request('/api/import/batches', ownerSession, 'POST', {documents:{'package-instructions':index}, files:[], includeSettings:false})).status, 403);
  assert.deepEqual(hub.store.get('package-instructions'), original);
});
test('retry replaces the owner bundle atomically and account deletion removes stored documents across reopen', async t => {
  const f = await fixture(t);
  assert.equal(f.install().status, 0);
  assert.equal(f.install().status, 0);
  fs.writeFileSync(path.join(f.source, 'data/package-instructions.json'), JSON.stringify({'7754':{...index['4826'], number:'7754', images:['missing.pdf']}}));
  const rejected = f.install();
  assert.equal(rejected.status, 1);
  assert.ok(!rejected.stderr.includes('missing.pdf') && !rejected.stderr.includes('Demo Client'));
  const {hub, request, ownerSession, adminSession} = await f.start();
  assert.deepEqual((await (await request('/api/data/package-instructions', ownerSession)).json()).data, index);
  const before = hub.store.get('package-instructions');
  assert.equal((await request('/api/accounts/' + f.owner.id, adminSession, 'DELETE', {})).status, 200);
  assert.equal((await request('/api/data/package-instructions', ownerSession)).status, 401);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM account_instruction_sets WHERE user_id=?').get(f.owner.id).n, 0);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM account_instruction_files WHERE user_id=?').get(f.owner.id).n, 0);
  assert.deepEqual(hub.store.get('package-instructions'), before);
  const reopened = openStore(f.filename);
  try { assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM account_instruction_sets').get().n, 0); }
  finally { reopened.close(); }
  assert.equal(f.install().status, 1);
});
test('local import rejects escaped paths and symlink attachments without installing a partial workspace', async t => {
  const f = await fixture(t);
  const outside = path.join(f.directory, 'demo-outside.pdf');
  fs.writeFileSync(outside, pdf);
  fs.rmSync(path.join(f.source, attachment));
  fs.symlinkSync(outside, path.join(f.source, attachment));
  assert.equal(f.install().status, 1);
  const store = openStore(f.filename);
  try {
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM account_instruction_sets').get().n, 0);
    assert.deepEqual(Object.keys(store.get('package-instructions').data), ['9001']);
  } finally { store.close(); }
  fs.writeFileSync(path.join(f.source, 'data/package-instructions.json'), JSON.stringify({'4826':{...index['4826'], folderName:'../demo-outside'}}));
  assert.equal(f.install().status, 1);
});
test('local import rejects writable input directories and hard-linked files before storing private content', async t => {
  const f = await fixture(t);
  const folder = path.join(f.source, 'data/profiles/Demo Client');
  fs.chmodSync(folder, 0o777);
  assert.equal(f.install().status, 1);
  fs.chmodSync(folder, 0o700);
  const outside = path.join(f.directory, 'demo-outside.pdf');
  fs.writeFileSync(outside, pdf);
  fs.rmSync(path.join(f.source, attachment));
  fs.linkSync(outside, path.join(f.source, attachment));
  assert.equal(f.install().status, 1);
  fs.rmSync(path.join(f.source, attachment));
  fs.writeFileSync(path.join(f.source, attachment), pdf);
  fs.chmodSync(f.directory, 0o777);
  assert.equal(f.install().status, 1);
  fs.chmodSync(f.directory, 0o700);
});
