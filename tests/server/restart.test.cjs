const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fork} = require('node:child_process');
const {once} = require('node:events');
function environment(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-process-restart-demo-'));
  const filename = path.join(directory, 'fictional.sqlite'), processes = new Set();
  t.after(async () => {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
      }
    }
    fs.rmSync(directory, {recursive: true, force: true});
  });
  return {async start(mode = 'server') {
    const child = fork(path.join(__dirname, 'restart-fixture.cjs'), [filename, mode], {silent: true});
    processes.add(child);
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fictional restart process did not become ready.')), 15000);
      const earlyExit = () => { clearTimeout(timer); reject(new Error('Fictional restart process exited before readiness.')); };
      child.once('exit', earlyExit);
      child.once('message', message => { clearTimeout(timer); child.off('exit', earlyExit); resolve(message); });
    });
    const base = 'http://127.0.0.1:' + ready.port;
    async function request(route, user, options = {}) {
      const headers = {Origin: base, ...(user ? {Cookie: user.cookie, 'X-CSRF-Token': user.csrf} : {}), ...options.headers};
      if (options.data !== undefined) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.data); }
      return fetch(base + route, {...options, headers, redirect: 'manual', signal: AbortSignal.timeout(5000)});
    }
    return {request, async login(username = 'demo-restart-admin') {
      const response = await request('/api/login', null, {method: 'POST', data: {username, password: 'Fictional-restart-password-123'}});
      assert.equal(response.status, 200);
      const data = await response.json();
      return {cookie: response.headers.get('set-cookie').split(';')[0], csrf: data.csrf};
    }, async stop(signal) {
      const exited = once(child, 'exit'); child.kill(signal);
      const [code, actualSignal] = await exited;
      assert.equal(signal === 'SIGTERM' ? code : actualSignal, signal === 'SIGTERM' ? 0 : signal);
    }};
  }};
}
const entry = {id: 'demo-restart-confirmed', date: '2026-10-05', shift: 'А', tonnage: 1000, brak: 10, breakdown: null};
async function confirmedReport(app, admin) {
  const before = await (await app.request('/api/data/production-log', admin)).json();
  const response = await app.request('/api/data/production-log', admin, {method: 'PUT',
    headers: {'If-Match': '"' + before.revision + '"'}, data: {...before.data, entries: [entry]}});
  assert.equal(response.status, 200);
  return response.json();
}
for (const signal of ['SIGTERM', 'SIGKILL']) {
  test('confirmed API record, attachment, sessions and access rights survive ' + signal + ' and process restart', {timeout: 30000}, async t => {
    const demo = environment(t);
    const first = await demo.start(), admin = await first.login(), observer = await first.login('demo-restart-observer');
    const confirmed = await confirmedReport(first, admin);
    const attachment = 'data/profiles/demo-restart.txt';
    assert.equal((await first.request('/api/folders', admin, {method: 'POST', data: {path: attachment, kind: 'file'}})).status, 201);
    const uploaded = await first.request('/api/files?path=' + attachment, admin, {method: 'PUT',
      headers: {'If-Match': '"1"', 'Content-Type': 'text/plain'}, body: 'Fictional restart attachment.'});
    assert.equal(uploaded.status, 200);
    await first.stop(signal);
    const restarted = await demo.start();
    assert.equal((await restarted.request('/healthz')).status, 200);
    assert.equal((await restarted.request('/api/session', admin)).status, 200);
    const restored = await (await restarted.request('/api/data/production-log', admin)).json();
    assert.deepEqual(restored, confirmed);
    assert.deepEqual(restored.data.entries, [entry]);
    assert.equal(await (await restarted.request('/api/files?path=' + attachment, observer)).text(), 'Fictional restart attachment.');
    assert.equal((await restarted.request('/api/accounts', observer)).status, 403);
    assert.equal((await restarted.request('/api/data/production-log', observer, {method: 'PUT',
      headers: {'If-Match': '"' + restored.revision + '"'}, data: {...restored.data, entries: []}})).status, 403);
    assert.equal((await restarted.request('/api/data/production-log', null)).status, 401);
    await restarted.login(); // Password verification still works in the new process.
    const appended = await restarted.request('/api/data/production-log', admin, {method: 'PUT',
      headers: {'If-Match': '"' + restored.revision + '"'}, data: {...restored.data, entries: [...restored.data.entries, {...entry, id: 'demo-restart-next'}]}});
    assert.equal(appended.status, 200);
    assert.equal((await appended.json()).data.entries.length, 2);
    await restarted.stop('SIGTERM');
  });
}
test('killed uncommitted SQLite write is rolled back while the last confirmed API record remains', {timeout: 30000}, async t => {
  const demo = environment(t), first = await demo.start(), admin = await first.login();
  const confirmed = await confirmedReport(first, admin);
  await first.stop('SIGTERM');
  const writer = await demo.start('uncommitted');
  await writer.stop('SIGKILL');
  const restarted = await demo.start();
  assert.deepEqual(await (await restarted.request('/api/data/production-log', admin)).json(), confirmed);
  await restarted.stop('SIGTERM');
});
