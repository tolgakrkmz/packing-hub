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
  await admin.getByRole('link', {name: 'Статус на системата', exact: true}).click();
  await expect(admin.locator('#summaryLabel')).toHaveText('Проверките са успешни');
  await expect(admin.locator('#databaseState')).toHaveText('Изправно');
  await expect(admin.locator('#backupState')).toHaveText('Изправно');
  await expect(admin.locator('.server-links a[href="/system-status.html"]')).toHaveAttribute('aria-current', 'page');
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
  await expect(admin.locator('#manualMessage')).toContainText('не може да се стартира');
  await admin.route('**/api/admin/status', route => route.abort()); await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#systemContent')).toBeHidden(); await expect(admin.locator('#systemMessage')).toContainText('Опитай отново');
  await admin.unroute('**/api/admin/status'); await admin.locator('#refreshSystem').click();
  await expect(admin.locator('#systemContent')).toBeVisible();
  for (const role of ['operator', 'observer']) {
    await hub.auth.create('demo-status-' + role, 'Fictional-password-123', role);
    const page = await device('demo-status-' + role, true);
    await expect(page.locator('.server-links a[href="/system-status.html"]')).toHaveCount(0);
    assert.equal(await page.evaluate(async () => (await fetch('/api/admin/status')).status), 403);
    assert.equal(await page.evaluate(async () => (await fetch('/system-status.html')).status), 403);
    assert.equal(await page.evaluate(async () => (await fetch('/api/admin/backup', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': window.HUB_SERVER_BOOT.csrf}, body: '{}'})).status), 403);
  }
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
module.exports = {statusFixture, exerciseSystemStatus};
