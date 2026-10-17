const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHubServer} = require('../../server/server.cjs');
const password = 'Fictional-password-123';
async function setup(t) {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  await hub.auth.create('demo-route-admin', password, 'admin');
  await hub.auth.create('demo-route-observer', password, 'observer');
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  t.after(() => hub.close());
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const admin = await hub.auth.login('demo-route-admin', password);
  const observer = await hub.auth.login('demo-route-observer', password);
  const request = (route, session = admin, method = 'GET') => fetch(base + route, {method, redirect: 'manual', headers: {Origin: base, ...(session ? {Cookie: 'hub-local-session=' + session.token} : {})}});
  return {hub, admin, observer, request};
}
test('all approved screens serve clean GET/HEAD routes and redirect legacy bookmarks with query strings', async t => {
  const {request} = await setup(t);
  const screens = fs.readdirSync(path.join(__dirname, '../..')).filter(name => name.endsWith('.html') && name !== 'production-import.html');
  for (const file of screens) {
    const route = file === 'index.html' ? '/' : '/' + file.slice(0, -5);
    for (const method of ['GET', 'HEAD']) {
      const page = await request(route, undefined, method);
      assert.equal(page.status, 200, route);
      assert.match(page.headers.get('content-type'), /^text\/html/);
      const html = await page.text();
      if (method === 'HEAD') assert.equal(html, '');
      else {
        assert.doesNotMatch(html, /href="\/?[a-z-]+\.html(?:[?#"][^"]*)?/);
        assert.equal(html.includes('/server-session.js'), !['login.html', 'account-password.html'].includes(file));
      }
      const legacy = await request('/' + file + '?module=pair-targets&lang=en', undefined, method);
      assert.equal(legacy.status, 308, file);
      assert.equal(legacy.headers.get('location'), route + '?module=pair-targets&lang=en');
      assert.equal(await legacy.text(), '');
    }
    if (route !== '/') {
      const slash = await request(route + '/?lang=en');
      assert.equal(slash.status, 308);
      assert.equal(slash.headers.get('location'), route + '?lang=en');
    }
  }
  assert.equal((await request('/index')).headers.get('location'), '/');
  assert.equal((await request('/index/')).headers.get('location'), '/');
  for (const route of ['/production-import', '/production-import.html']) {
    const legacy = await request(route + '?module=production-log');
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), '/data-import?module=production-log#production');
  }
});
test('clean and legacy routes enforce login, viewing permissions and session revocation before redirects', async t => {
  const {hub, admin, observer, request} = await setup(t);
  for (const method of ['GET', 'HEAD']) {
    for (const route of ['/', '/index.html', '/personnel', '/personnel.html', '/personnel/']) {
      const response = await request(route, null, method);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/login');
    }
    for (const module of ['personnel', 'accounts', 'activity-log', 'system-status', 'tasks', 'production-import']) {
      for (const suffix of ['', '.html', '/']) assert.equal((await request('/' + module + suffix, observer, method)).status, 403);
    }
  }
  await hub.auth.update(observer.user.id, {permissions: {canViewStatistics: false}}, admin.user);
  assert.equal((await request('/statistics', observer)).status, 302);
  const fresh = await hub.auth.login('demo-route-observer', password);
  for (const suffix of ['', '.html', '/']) assert.equal((await request('/statistics' + suffix, fresh)).status, 403);
});
test('redirects do not duplicate page visits; unknown and private paths never become clean page aliases', async t => {
  const {hub, admin, request} = await setup(t);
  const visits = () => hub.store.db.prepare("SELECT module FROM audit WHERE user_id=? AND action='visit' ORDER BY id").all(admin.user.id).map(row => row.module);
  for (const route of ['/production-log.html', '/production-log/']) assert.equal((await request(route)).status, 308);
  assert.equal((await request('/production-log', admin, 'HEAD')).status, 200);
  assert.deepEqual(visits(), []);
  assert.equal((await request('/production-log')).status, 200);
  assert.deepEqual(visits(), ['production-log']);
  for (const route of ['/missing', '/missing.html', '/statistics/extra', '/css/theme', '/js/login', '/data/personnel', '/data/personnel.json', '/server/server.cjs', '/statistics.html/']) {
    for (const session of [null, admin]) assert.equal((await request(route, session)).status, 404, route);
  }
  for (const route of ['/statistics', '/statistics.html']) assert.equal((await request(route, admin, 'POST')).status, 405);
  assert.equal((await request('/css/theme.css')).status, 200);
  assert.equal((await request('/js/login.js')).status, 200);
  assert.equal((await request('/api/session')).status, 200);
  assert.deepEqual(visits(), ['production-log']);
});
