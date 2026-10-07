const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHubServer} = require('../../server/server.cjs');
const root = path.resolve(__dirname, '../..');

test('the reviewed logo is public with SVG MIME for GET and HEAD; other files and APIs remain protected', async t => {
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
  for (const route of ['/assets/other.svg', '/assets/package-hub-mark.png', '/assets/private.svg', '/data/personnel.json']) assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base + '/index.html', {redirect: 'manual'})).status, 302);
  for (const route of ['/api/data/personnel', '/api/accounts', '/server-session.js']) assert.equal((await fetch(base + route)).status, 401);
  assert.equal((await fetch(base + '/login.html')).status, 200);
});
