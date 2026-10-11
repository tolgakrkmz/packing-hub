/* Real browser navigation against the isolated fictional server. */
const assert = require('node:assert/strict');
async function exerciseRoutes({admin, hub, base, device, expect}) {
  console.log('RUN clean navigation, reloads, legacy fragments and permission-aware data reads');
  const modules = ['production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions', 'statistics', 'tasks'];
  for (const module of modules) {
    await admin.goto(base + '/');
    await admin.locator('a[href="/' + module + '"]').click();
    await expect(admin).toHaveURL(base + '/' + module);
    await expect(admin.locator('.server-bar')).toBeVisible();
    await admin.reload();
    await expect(admin).toHaveURL(base + '/' + module);
    await expect(admin.locator('#serverState')).toHaveAttribute('data-connection', 'ready');
    const links = await admin.locator('a[href]').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
    assert.ok(links.every(href => !/^\/?[a-z-]+\.html(?:[?#]|$)/.test(href)), module);
  }
  await admin.goto(base + '/admin-panel.html?module=pair-targets#demo');
  await expect(admin).toHaveURL(base + '/admin-panel?module=pair-targets#demo');
  await admin.locator('#adminTransfer').click();
  await expect(admin).toHaveURL(base + '/data-import?module=pair-targets');
  await expect(admin.locator('#reportExportKind')).toHaveValue('pair-targets');
  await admin.goto(base + '/notifications.html#settings');
  await expect(admin).toHaveURL(base + '/notifications#settings');
  await expect(admin.locator('#notificationEnable')).toBeAttached();
  await admin.goto(base + '/statistics/?lang=en#demo');
  await expect(admin).toHaveURL(base + '/statistics?lang=en#demo');
  await admin.goto(base + '/production-import.html?module=production-log');
  await expect(admin).toHaveURL(base + '/data-import?module=production-log#production');
  const manifest = await (await admin.request.get(base + '/manifest.webmanifest')).json();
  assert.equal(manifest.start_url, '/notifications');

  await hub.auth.create('demo-route-reader', 'Fictional-password-123', 'observer', hub.auth.list()[0]);
  const reader = await device('demo-route-reader');
  await expect(reader.locator('a[href="/personnel"]')).toBeHidden();
  const reads = [];
  reader.on('request', request => reads.push(new URL(request.url()).pathname));
  await reader.goto(base + '/pair-targets');
  await expect(reader.locator('#pairsConnDot')).toHaveClass(/\bon\b/);
  await expect(reader.locator('#addPairBtn')).toBeHidden();
  assert.ok(reads.includes('/api/pair-roster'));
  await reader.goto(base + '/statistics');
  await expect(reader.locator('#connDot')).toHaveClass(/\bon\b/);
  await expect.poll(() => reads.includes('/api/statistics/workforce')).toBe(true);
  assert.ok(reads.includes('/api/statistics/data/production-log'));
  assert.ok(!reads.includes('/api/data/personnel'));
  assert.equal((await reader.request.get(base + '/personnel')).status(), 403);
  await reader.locator('.server-logout').click();
  await expect(reader).toHaveURL(base + '/login');
  await reader.context().close();
  console.log('PASS clean routes, legacy query/fragment preservation, reloads, shared reads, permissions and logout');
}
module.exports = {exerciseRoutes};
