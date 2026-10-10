/* The only push provider used here is simulated; all records/accounts are fictional. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');
const password = 'Fictional-password-123';
async function exerciseNotifications({admin, hub, base, device, expect, screenshotDir}) {
  const viewer = await hub.auth.create('demo-notice-viewer', password, 'observer');
  await admin.goto(base + '/accounts.html');
  const account = admin.locator(`form[data-id="${viewer.id}"]`);
  await account.locator('..').locator('summary').first().click();
  await account.locator('[data-permission=canReceiveProductionAdded]').check();
  await account.locator('[data-permission=canReceiveProductionChanged]').uncheck();
  await account.locator('button[type=submit]').click(); await expect(admin.locator('#accountMessage')).toHaveText('Акаунтът е обновен.');
  const changed = hub.auth.list().find(user => user.id === viewer.id); assert.equal(changed.permissions.canReceiveProductionAdded, true); assert.equal(changed.permissions.canReceiveProductionChanged, false);
  const page = await device('demo-notice-viewer', true);
  await page.goto(base + '/notifications.html');
  await expect(page.locator('#notificationList')).toContainText('Няма известия.');
  let current = hub.store.get('production-log');
  hub.store.put('production-log', {...current.data, entries: [{id: 'demo-notice-row', date: '2026-10-05', shift: 'А', tonnage: 1000, brak: 0}]}, current.revision, hub.auth.list()[0]);
  await page.reload(); await expect(page.locator('.notification-row')).toHaveCount(1); await expect(page.locator('.notification-count')).toHaveText('1');
  await assertResponsive(page, 'mobile inbox');
  await page.locator('[data-hub-language=en]').click(); await expect(page.locator('.notification-row')).toContainText('There is a new production report.');
  await page.locator('[data-hub-language=bg]').click(); await page.locator('#notificationReadAll').click(); await expect(page.locator('.notification-count')).toBeHidden();
  await page.locator('#notificationSettingsTab').click(); await expect(page.locator('[data-type=productionAdded]')).toBeChecked(); await expect(page.locator('[data-type=productionChanged]')).toHaveCount(0);
  await page.locator('[data-type=productionAdded]').uncheck(); await page.locator('#notificationPreferences button').click(); await expect(page.locator('#notificationMessage')).toHaveText('Настройките са запазени.');
  await assertResponsive(page, 'mobile notification settings'); await page.context().close();

  // Mock only device APIs; do not reach a real push endpoint or request real OS permission.
  const key = crypto.createECDH('prime256v1'); key.generateKeys();
  const demoSubscription = {endpoint: 'https://fcm.googleapis.com/fcm/send/demo-browser', keys: {p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url')}};
  const invited = await device('demo-admin', true);
  await invited.context().addInitScript(data => {
    let sub = null;
    window.demoRequests = 0; window.demoPermission = 'default';
    Object.defineProperty(window, 'Notification', {configurable: true, value: {get permission() { return window.demoPermission; }, requestPermission: async () => { window.demoRequests++; window.demoPermission = 'granted'; return 'granted'; }}});
    Object.defineProperty(window, 'PushManager', {configurable: true, value: function () {}});
    const worker = {pushManager: {getSubscription: async () => sub, subscribe: async () => { sub = {...data, toJSON: () => data, unsubscribe: async () => { sub = null; return true; }}; return sub; }}, getNotifications: async () => []};
    Object.defineProperty(navigator, 'serviceWorker', {configurable: true, value: {getRegistration: async () => worker, register: async () => worker, ready: Promise.resolve(worker)}});
  }, demoSubscription);
  await invited.goto(base + '/index.html'); await invited.locator('.notification-bell').waitFor(); await invited.locator('#notificationInvite').waitFor({state: 'attached'});
  await invited.clock.runFor(29000); await expect(invited.locator('#notificationInvite')).not.toBeVisible();
  await invited.clock.runFor(6000); await expect(invited.locator('#notificationInvite')).toBeVisible();
  assert.equal(await invited.evaluate(() => window.demoRequests), 0);
  await assertResponsive(invited, 'notification invitation');
  await invited.setViewportSize({width: 320, height: 740}); await assertResponsive(invited, '320px invitation'); await invited.setViewportSize({width: 390, height: 844});
  if (screenshotDir) { fs.mkdirSync(screenshotDir, {recursive: true}); await invited.screenshot({path: path.join(screenshotDir, 'notification-invitation.png'), fullPage: true}); }
  await invited.locator('#notificationInvite button').filter({hasText: 'По-късно'}).click();
  await invited.reload(); await invited.locator('#notificationInvite').waitFor({state: 'attached'}); await invited.clock.runFor(45000); await expect(invited.locator('#notificationInvite')).not.toBeVisible();
  // Advance beyond the deferral and start a fresh tab session.
  await invited.evaluate(() => { sessionStorage.clear(); const key = 'portfolio-hub-notification-prompt:' + window.HUB_SERVER_BOOT.user.id; localStorage.setItem(key, JSON.stringify({nextAt: 0})); });
  await invited.reload(); await invited.locator('#notificationInvite').waitFor({state: 'attached'}); await invited.clock.runFor(35000); await expect(invited.locator('#notificationInvite')).toBeVisible();
  await invited.keyboard.press('Escape'); await expect(invited.locator('#notificationInvite')).not.toBeVisible();
  await invited.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('portfolio-hub-notification-prompt:' + window.HUB_SERVER_BOOT.user.id); });
  await invited.reload(); await invited.locator('#notificationInvite').waitFor({state: 'attached'}); await invited.clock.runFor(35000); await invited.locator('#notificationInvite .notification-skip').click();
  await invited.evaluate(() => sessionStorage.clear()); await invited.reload(); await invited.locator('#notificationInvite').waitFor({state: 'attached'}); await invited.clock.runFor(45000); await expect(invited.locator('#notificationInvite')).not.toBeVisible();
  await invited.goto(base + '/notifications.html#settings'); await expect(invited.locator('#notificationNever')).toBeChecked();
  await invited.locator('#notificationEnable').click(); await expect(invited.locator('#notificationDeviceState')).toHaveText('Известията на това устройство са включени.');
  assert.equal(await invited.evaluate(() => window.demoRequests), 1); assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 1);
  await invited.locator('#notificationDisable').click(); await expect(invited.locator('#notificationDeviceState')).toHaveText('Известията на това устройство са изключени.'); assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
  // Blocked permission shows instructions and makes no native permission request.
  await invited.evaluate(() => { window.demoPermission = 'denied'; sessionStorage.clear(); localStorage.removeItem('portfolio-hub-notification-prompt:' + window.HUB_SERVER_BOOT.user.id); });
  await invited.goto(base + '/index.html'); await invited.locator('#notificationInvite').waitFor({state: 'attached'}); await invited.evaluate(() => window.demoPermission = 'denied'); await invited.clock.runFor(35000);
  await expect(invited.locator('#notificationInvite')).toBeVisible(); await expect(invited.locator('#notificationInviteCopy')).toContainText('Известията са блокирани.');
  await invited.locator('#notificationInvite .notification-primary').click(); await expect(invited).toHaveURL(base + '/notifications.html#settings'); assert.equal(await invited.evaluate(() => window.demoRequests), 0);
  // Active dialog prevents interruption; invitation waits until it closes.
  await invited.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('portfolio-hub-notification-prompt:' + window.HUB_SERVER_BOOT.user.id); });
  await invited.goto(base + '/index.html');
  await invited.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'demoEditing'; dialog.textContent = 'Fictional editing dialog'; document.body.append(dialog); dialog.showModal(); });
  await invited.clock.runFor(45000); await expect(invited.locator('#notificationInvite')).not.toBeVisible();
  await invited.evaluate(() => document.getElementById('demoEditing').close()); await invited.clock.runFor(6000); await expect(invited.locator('#notificationInvite')).toBeVisible();
  await invited.keyboard.press('Escape');
  // Unsaved typed input also suppresses the invitation after focus leaves the field.
  await invited.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('portfolio-hub-notification-prompt:' + window.HUB_SERVER_BOOT.user.id); });
  await invited.goto(base + '/index.html'); await invited.locator('#notificationInvite').waitFor({state: 'attached'});
  await invited.evaluate(() => { const input = document.createElement('input'); input.id = 'demoDraft'; input.setAttribute('aria-label', 'Fictional draft'); document.body.append(input); });
  await invited.locator('#demoDraft').fill('Fictional unfinished draft'); await invited.locator('.notification-bell').focus(); await invited.clock.runFor(35000); await expect(invited.locator('#notificationInvite')).not.toBeVisible();
  await invited.locator('#demoDraft').fill(''); await invited.locator('.notification-bell').focus(); await invited.clock.runFor(6000); await expect(invited.locator('#notificationInvite')).toBeVisible(); await invited.keyboard.press('Escape');
  // iPhone outside its Home Screen installation gives guidance without a permission request.
  const iphone = await device('demo-admin', true);
  await iphone.context().addInitScript(() => { Object.defineProperty(navigator, 'userAgent', {value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'}); });
  await iphone.goto(base + '/notifications.html#settings'); await expect(iphone.locator('#notificationDeviceHint')).toContainText('Добави към началния екран'); await expect(iphone.locator('#notificationEnable')).toBeHidden();
  await assertResponsive(iphone, 'iPhone installation guidance'); await iphone.context().close();
  // A blocked worker API cannot prevent the local inbox from rendering.
  const restrictedBrowser = await device('demo-admin', true);
  await restrictedBrowser.context().addInitScript(() => { Object.defineProperty(navigator, 'serviceWorker', {value: {getRegistration: async () => { throw Error('DEMO_WORKER_UNAVAILABLE'); }}}); });
  await restrictedBrowser.goto(base + '/notifications.html#settings'); await expect(restrictedBrowser.locator('#notificationTypes')).not.toBeEmpty(); await expect(restrictedBrowser.locator('#notificationDeviceHint')).toContainText('не са достъпни'); await restrictedBrowser.context().close();
  // The real service worker can register on localhost and has no data caching.
  const workerPage = await device('demo-admin'); await workerPage.goto(base + '/notifications.html');
  const scope = await workerPage.evaluate(async () => { const result = await navigator.serviceWorker.register('/js/notification-worker.js', {scope: '/'}); await navigator.serviceWorker.ready; return result.scope; }); assert.equal(scope, base + '/');
  assert.deepEqual(await workerPage.evaluate(() => caches.keys()), []); await workerPage.context().close();
  await invited.context().close();
  console.log('PASS notification flags, mobile inbox/settings, deferral/Escape/opt-out, permission click/denial, device toggle, dialog guard and service worker');
}
module.exports = {exerciseNotifications};
