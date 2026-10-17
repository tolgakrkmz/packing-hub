/* Avatar menu, account page and profile photo with a fictional account and generated image. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
const {photo} = require('../server/task-photo-fixture.cjs');
async function exerciseAccountCenter({admin, hub, base, device, expect}) {
  await hub.auth.create('demo-photo-owner', 'Fictional-password-123', 'operator');
  const page = await device('demo-photo-owner', true);
  const button = page.locator('#serverAccountButton'), menu = page.locator('#serverAccountMenu');
  // The phone toolbar keeps the brand, connection, notifications and avatar on one row.
  await expect(button).toBeVisible();
  await expect(button.locator('.hub-avatar')).toHaveText('DP');
  await expect(menu).toBeHidden();
  const row = await page.evaluate(() => [...document.querySelectorAll('.server-top > *')].map(node => Math.round(node.getBoundingClientRect().top)));
  assert.equal(new Set(row).size, 1, 'brand and account controls share one row');
  await assertResponsive(page, 'Account menu closed 390');
  await button.click();
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('.server-user')).toHaveText('demo-photo-owner');
  await expect(menu.locator('.server-role')).toHaveText('Оператор');
  await expect(menu.locator('.server-links a').first()).toHaveText('Моят акаунт');
  await expect(menu.locator('.server-logout')).toBeVisible();
  await assertResponsive(page, 'Account menu open 390');
  await page.locator('.server-account-backdrop').click({position: {x: 10, y: 10}});
  await expect(menu).toBeHidden();
  // Keyboard: Enter opens and focuses the first item, Escape closes and returns focus.
  await button.focus(); await page.keyboard.press('Enter');
  await expect(menu.locator('.server-links a').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(); await expect(button).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(base + '/account');
  await expect(page.locator('h1')).toHaveText('Моят акаунт');
  await expect(page.locator('#accountUsername')).toHaveText('demo-photo-owner');
  await expect(page.locator('#accountPhotoRemove')).toBeHidden();
  await expect(page.locator('.account-security')).toHaveAttribute('href', '/account-password');
  await assertResponsive(page, 'Account page 390');
  await page.locator('#accountPhoto').setInputFiles({name: 'fictional-avatar.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo, 'base64')});
  await expect(page.locator('#accountPhotoMessage')).toHaveText('Снимката е запазена.');
  await expect(page.locator('#accountAvatar .hub-avatar img')).toBeVisible();
  await expect(button.locator('.hub-avatar img')).toBeVisible();
  const owner = hub.auth.list().find(user => user.username === 'demo-photo-owner');
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM user_avatars WHERE user_id=?').get(owner.id).n, 1);
  // Account managers see the photo in the accounts list.
  await admin.goto(base + '/accounts');
  const entry = admin.locator('.account-entry', {has: admin.locator(`.account-card[data-id="${owner.id}"]`)});
  await expect(entry.locator('summary .hub-avatar img')).toBeVisible();
  expect(await entry.locator('summary .hub-avatar img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await admin.goto(base + '/');
  // The photo survives navigation and appears in every header.
  await page.goto(base + '/');
  await expect(button.locator('.hub-avatar img')).toBeVisible();
  expect(await button.locator('.hub-avatar img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.goto(base + '/account');
  await page.locator('[data-hub-language=en]').click();
  await expect(page.locator('h1')).toHaveText('My account');
  await expect(page.locator('#accountPhotoRemove')).toHaveText('Remove photo');
  await page.locator('#accountPhotoRemove').click();
  await expect(page.locator('#accountPhotoMessage')).toHaveText('The photo has been removed.');
  await expect(page.locator('#accountAvatar .hub-avatar')).toHaveText('DP');
  await expect(button.locator('.hub-avatar img')).toHaveCount(0);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM user_avatars WHERE user_id=?').get(owner.id).n, 0);
  await page.locator('[data-hub-language=bg]').click();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    await assertResponsive(page, 'Account page ' + width);
    await button.click(); await expect(menu).toBeVisible();
    await assertResponsive(page, 'Account menu open ' + width);
    await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  }
  // Administrators reach the admin panel from the same menu.
  await admin.locator('#serverAccountButton').click();
  await expect(admin.locator('#serverAccountMenu .server-links a')).toHaveText(['Моят акаунт', 'Админ панел']);
  await admin.mouse.click(5, 400);
  await expect(admin.locator('#serverAccountMenu')).toBeHidden();
  await page.context().close();
  console.log('PASS account menu, account page and profile photo on phone and desktop, BG/EN');
}
module.exports = {exerciseAccountCenter};
