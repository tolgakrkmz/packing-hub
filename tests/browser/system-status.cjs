/* Fictional host status over a real local socket; no production data or Docker daemon. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {assertResponsive} = require('./responsive.cjs');
const healthy = () => {
  const at = new Date(Date.now() - 1800000).toISOString();
  return {backups: {state: 'ok', lastAttempt: at, lastSuccess: at, lastPrimary: at, lastSecondary: at, intervalHours: 4, code: null, secondaryAvailable: true},
    updates: {state: 'ok', lastSuccess: at, lastAttempt: at}, manual: {available: true, state: 'idle', startedAt: null, finishedAt: null}};
};
async function statusFixture(directory) {
  let value = healthy(), available = 20n, manualReply = 202, calls = 0;
  const original = fs.statfsSync;
  fs.statfsSync = () => ({bavail: available, bsize: 1024n ** 3n, blocks: 100n});
  const socketPath = path.join(directory, 'status.sock');
  const server = http.createServer(async (req, res) => {
    if (req.url === '/backup') {
      let body = ''; for await (const chunk of req) body += chunk;
      assert.equal(body, '{}'); calls++;
      if (manualReply === 202) value.manual = {available: true, state: 'running', startedAt: new Date().toISOString()};
      res.writeHead(manualReply, {'Content-Type': 'application/json'}); res.end(JSON.stringify({state: 'running'}));
    } else { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value)); }
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  return {socketPath, healthy: () => { value = healthy(); available = 20n; }, set: update => { update(value); }, disk: amount => { available = amount; },
    calls: () => calls, reply: code => { manualReply = code; }, close: async () => { fs.statfsSync = original; await new Promise(resolve => server.close(resolve)); }};
}
async function exerciseSystemStatus({admin, hub, base, device, expect, fixture, screenshotDir}) {
  await expect(admin.locator('.server-links a[href="/tasks.html"]')).toHaveCount(0);
  await expect(admin.locator('a[href="tasks.html"]')).toBeVisible();
  await require('./admin-panel.cjs').openAdminModule(admin,'system-status');
  await expect(admin.locator('#summaryLabel')).toHaveText('Проверките са успешни');
  await expect(admin.locator('#databaseState')).toHaveText('Изправно');
  await expect(admin.locator('#backupState')).toHaveText('Изправно');
  await expect(admin.locator('.server-links a[href="/admin-panel.html"]')).toHaveAttribute('aria-current', 'location');
  // A restored page must check again before showing an old successful summary.
  await admin.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})));
  fixture.set(value => { value.backups.secondaryAvailable = false; });
  await admin.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
  await expect(admin.locator('#secondaryState')).toHaveText('Проблем');
  fixture.healthy(); await admin.locator('#refreshSystem').click();
  fixture.set(value => { value.backups.secondaryAvailable = false; value.updates.state = 'failed'; }); fixture.disk(0n);
  await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#systemWarnings')).toContainText('Свободното място е малко');
  await expect(admin.locator('#secondaryState')).toHaveText('Проблем');
  await expect(admin.locator('#updateState')).toHaveText('Проблем');
  await expect(admin.locator('#backupTime')).not.toHaveText('—');
  fixture.healthy(); fixture.set(value => {
    for (const key of ['lastSuccess', 'lastAttempt', 'lastPrimary', 'lastSecondary']) value.backups[key] = new Date(Date.now() - 6 * 3600000).toISOString();
  });
  await admin.locator('#refreshSystem').click(); await expect(admin.locator('#backupState')).toHaveText('Внимание');
  await expect(admin.locator('#systemWarnings')).toContainText('Архивът е по-стар');
  fixture.healthy(); fixture.set(value => { value.backups = {}; value.updates = {}; value.manual.available = false; });
  await admin.locator('#refreshSystem').click(); await expect(admin.locator('#backupState')).toHaveText('Няма данни');
  await expect(admin.locator('#manualBackup')).toBeDisabled();
  fixture.healthy(); await admin.locator('#refreshSystem').click();
  await admin.locator('#manualBackup').click(); await expect(admin.locator('#manualBackup')).toBeDisabled();
  await expect(admin.locator('#manualMessage')).toContainText('създава и проверява'); assert.equal(fixture.calls(), 1);
  fixture.set(value => { value.manual.state = 'ok'; value.manual.finishedAt = new Date().toISOString(); });
  await admin.locator('#refreshSystem').click(); await expect(admin.locator('#manualBackup')).toBeEnabled();
  await expect(admin.locator('#manualMessage')).toContainText('завършен');
  fixture.reply(409); await admin.locator('#manualBackup').click();
  await expect(admin.locator('#manualMessage')).toContainText('Вече се изпълнява архив');
  fixture.reply(503); await admin.locator('#manualBackup').click();
  await expect(admin.locator('#manualMessage')).toContainText('Не можем да потвърдим');
  fixture.reply(202);
  const beforeLostReply = fixture.calls();
  await admin.route('**/api/admin/backup', async route => { await route.fetch(); await route.abort(); });
  await admin.locator('#manualBackup').click();
  await expect(admin.locator('#manualMessage')).toContainText('създава и проверява');
  assert.equal(fixture.calls(), beforeLostReply + 1);
  await expect(admin.locator('#manualBackup')).toBeDisabled();
  await admin.unroute('**/api/admin/backup');
  fixture.set(value => { value.manual.state = 'ok'; value.manual.finishedAt = new Date().toISOString(); });
  await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#manualMessage')).toContainText('завършен');
  await admin.route('**/api/admin/status', route => route.abort()); await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#systemContent')).toBeHidden(); await expect(admin.locator('#systemMessage')).toContainText('Опитай отново');
  await admin.unroute('**/api/admin/status'); await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#systemContent')).toBeVisible();
  console.log('RUN bounded browser requests and recovery after stalled status/manual replies');
  const stalledStatus = [];
  await admin.route('**/api/admin/status', route => { stalledStatus.push(route); });
  await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#systemContent')).toBeHidden({timeout: 25000});
  await expect(admin.locator('#refreshSystem')).toBeEnabled();
  await expect(admin.locator('#systemMessage')).toContainText('Опитай отново');
  await admin.unroute('**/api/admin/status');
  for (const route of stalledStatus) await route.abort().catch(() => {});
  await admin.locator('#refreshSystem').click(); await expect(admin.locator('#systemContent')).toBeVisible();
  const beforeStalledBackup = fixture.calls(), stalledBackup = [];
  await admin.route('**/api/admin/backup', route => { stalledBackup.push(route); });
  await admin.locator('#manualBackup').click();
  await expect(admin.locator('#manualBackup')).toBeDisabled();
  await expect(admin.locator('#manualMessage')).toContainText('Не можем да потвърдим', {timeout: 25000});
  await expect(admin.locator('#manualBackup')).toBeEnabled();
  assert.equal(fixture.calls(), beforeStalledBackup);
  await admin.unroute('**/api/admin/backup');
  for (const route of stalledBackup) await route.abort().catch(() => {});
  fixture.reply(202); await admin.locator('#manualBackup').focus(); await admin.keyboard.press('Enter');
  await expect(admin.locator('#manualMessage')).toContainText('създава и проверява');
  assert.equal(fixture.calls(), beforeStalledBackup + 1);
  fixture.set(value => { value.manual.state = 'failed'; value.manual.finishedAt = new Date().toISOString(); });
  await admin.locator('#refreshSystem').click(); await expect(admin.locator('#manualMessage')).toContainText('неуспешен');
  console.log('PASS bounded requests, no automatic POST retry, keyboard action and manual failure');
  fixture.healthy(); await admin.locator('#refreshSystem').click();
  const beforeConcurrentBackup = fixture.calls(); let heldOldStatus, intercepted = 0, entered;
  const oldStatusArrived = new Promise(resolve => { entered = resolve; });
  await admin.route('**/api/admin/status', route => {
    if (++intercepted === 1) { heldOldStatus = route; entered(); } else return route.continue();
  });
  await admin.locator('#refreshSystem').click(); await oldStatusArrived;
  await admin.locator('#manualBackup').click();
  await expect(admin.locator('#manualMessage')).toContainText('създава и проверява');
  await expect(admin.locator('#manualBackup')).toBeDisabled();
  await expect(admin.locator('#refreshSystem')).toBeEnabled();
  assert.equal(fixture.calls(), beforeConcurrentBackup + 1); assert.ok(intercepted >= 2);
  await heldOldStatus.abort().catch(() => {}); await admin.unroute('**/api/admin/status');
  console.log('PASS manual backup during an older status request: fresh read and no stale idle result');
  for (const role of ['operator', 'observer']) {
    await hub.auth.create('demo-status-' + role, 'Fictional-password-123', role);
    const page = await device('demo-status-' + role, true);
    await expect(page.locator('.server-links a[href="/system-status.html"]')).toHaveCount(0);
    assert.equal(await page.evaluate(async () => (await fetch('/api/admin/status')).status), 403);
    assert.equal(await page.evaluate(async () => (await fetch('/system-status.html')).status), 403);
    assert.equal(await page.evaluate(async () => (await fetch('/api/admin/backup', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': window.HUB_SERVER_BOOT.csrf}, body: '{}'})).status), 403);
  }
  fixture.healthy(); fixture.set(value => { Object.assign(value.backups, {mode: 'single', lastSecondary: null, secondaryAvailable: false}); });
  await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#summaryLabel')).toHaveText('Има предупреждение');
  await expect(admin.locator('#backupMode')).toHaveText('Основен диск');
  await expect(admin.locator('#backupState')).toHaveText('Изправно');
  await expect(admin.locator('#secondaryState')).toHaveText('Няма независимо копие');
  await expect(admin.locator('#systemWarnings')).toContainText('Архивите са на основния диск');
  const beforeSingle = fixture.calls();
  await admin.locator('#manualBackup').click();
  await expect(admin.locator('#manualBackup')).toBeDisabled();
  assert.equal(fixture.calls(), beforeSingle + 1);
  fixture.set(value => { value.manual.state = 'ok'; value.manual.finishedAt = new Date().toISOString(); });
  await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#manualMessage')).toContainText('на основния диск е завършен и проверен');
  await expect(admin.locator('#manualBackup')).toBeEnabled();
  for (const language of ['bg', 'en']) {
    await admin.locator(`[data-hub-language=${language}]`).click();
    await expect(admin.locator('#backupMode')).toHaveText(language === 'bg' ? 'Основен диск' : 'Primary disk');
    await expect(admin.locator('#secondaryState')).toHaveText(language === 'bg' ? 'Няма независимо копие' : 'No independent copy');
    await expect(admin.locator('#manualMessage')).toContainText(language === 'bg' ? 'завършен и проверен' : 'completed and was verified');
    await expect(admin.locator('#systemWarnings')).toContainText(language === 'bg' ? 'работната база' : 'live database');
    for (const width of [320, 390, 768, 1440]) { await admin.setViewportSize({width, height: 1000}); await assertResponsive(admin, `Single-disk status ${language} at ${width}px`); }
  }
  console.log('PASS single-disk manual backup, explicit warning, BG/EN and responsive layouts');
  await admin.locator('[data-hub-language=bg]').click();
  fixture.healthy(); await admin.locator('#refreshSystem').click();
  for (const language of ['bg', 'en']) {
    await admin.locator(`[data-hub-language=${language}]`).click();
    await expect(admin.locator('h1')).toHaveText(language === 'bg' ? 'Статус на системата' : 'System status');
    await expect(admin.locator('#backupSchedule')).toHaveText(language === 'bg' ? 'На всеки 4 часа' : 'Every 4 hours');
    for (const width of [320, 390, 768, 1440]) { await admin.setViewportSize({width, height: 1000}); await assertResponsive(admin, `System status ${language} at ${width}px`); }
  }
  await admin.locator('[data-hub-language=bg]').click();
  if (screenshotDir) {
    await admin.reload(); await expect(admin.locator('#summaryLabel')).toHaveText('Проверките са успешни');
    const source = path.resolve(__dirname, '../..'), directory = path.resolve(screenshotDir);
    assert.ok(directory !== source && !directory.startsWith(source + path.sep)); fs.mkdirSync(directory, {recursive: true});
    for (const [width, name] of [[1440, 'status-desktop.png'], [390, 'status-mobile.png']]) {
      await admin.setViewportSize({width, height: 1600}); await admin.screenshot({path: path.join(directory, name), fullPage: true});
    }
  }
}
async function exerciseOfflineSystemStatus(browser, base, expect) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [], apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.method()); });
  try {
    await page.goto(base + '/system-status.html');
    await expect(page.locator('#systemContent')).toBeHidden();
    await expect(page.locator('#refreshSystem')).toBeDisabled();
    await expect(page.locator('#manualBackup')).toBeDisabled();
    await expect(page.locator('#systemMessage')).toContainText('само за администратор в сървърната версия');
    await page.locator('[data-hub-language=en]').click();
    await expect(page.locator('#systemMessage')).toContainText('only to an administrator in server mode');
    await assertResponsive(page, 'Standalone system status notice at 390px');
    assert.deepEqual(apiRequests, []); assert.deepEqual(errors, []);
    console.log('PASS standalone system status: server-only notice, disabled controls, BG/EN, no API requests');
  } finally { await context.close(); }
}
module.exports = {statusFixture, exerciseSystemStatus, exerciseOfflineSystemStatus};
