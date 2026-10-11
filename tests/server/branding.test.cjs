const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHubServer} = require('../../server/server.cjs');
const root = path.resolve(__dirname, '../..');

test('reviewed SVG and install/notification PNG icons are public for GET and HEAD; other files and APIs remain protected', async t => {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  t.after(() => hub.close());
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  const mark = fs.readFileSync(path.join(root, 'assets/package-hub-mark.svg'), 'utf8');
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(base + '/assets/package-hub-mark.svg', {method});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), method === 'GET' ? mark : '');
  }
  for (const size of [180, 192, 512]) {
    const route = `/assets/package-hub-icon-${size}.png`, expected = fs.readFileSync(path.join(root, route.slice(1)));
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(base + route, {method});
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === 'GET' ? expected : Buffer.alloc(0));
    }
  }
  for (const route of ['/assets/other.svg', '/assets/package-hub-mark.png', '/assets/private.svg', '/data/personnel.json']) assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base + '/', {redirect: 'manual'})).status, 302);
  for (const route of ['/api/data/personnel', '/api/accounts', '/server-session.js']) assert.equal((await fetch(base + route)).status, 401);
  const assertInstallLinks = html => {
    assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="assets\/package-hub-icon-180\.png">/);
    assert.equal((html.match(/rel="manifest"/g) || []).length, 1);
  };
  const loginPage = await fetch(base + '/login');
  assert.equal(loginPage.status, 200); assertInstallLinks(await loginPage.text());
  await hub.auth.create('demo-icon-admin', 'Fictional-password-123', 'admin');
  const login = await hub.auth.login('demo-icon-admin', 'Fictional-password-123');
  for (const route of ['/', '/notifications']) {
    const page = await fetch(base + route, {headers: {Cookie: 'hub-local-session=' + login.token}});
    assert.equal(page.status, 200); assertInstallLinks(await page.text());
  }
});
