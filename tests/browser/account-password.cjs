/* Temporary password, self-service change and sign-out from all devices. Every account is fictional. */
const {openAccountMenu} = require('./account-menu.cjs');
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
const temporary = 'Fictional-temporary-123';
const chosen = 'Fictional-chosen-456';

async function exerciseAccountPassword({admin, hub, base, browser, expect}) {
  const created = await admin.evaluate(password => HubServer.send('/api/accounts', 'POST', {username: 'demo-password-owner', password, role: 'observer'}), temporary);
  assert.equal(created.user.mustChangePassword, true);
  async function signIn(password) {
    const context = await browser.newContext({timezoneId: 'Europe/Sofia'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/login');
    await page.locator('#username').fill('demo-password-owner'); await page.locator('#password').fill(password);
    await page.locator('#loginForm button[type=submit]').click();
    return {page, errors};
  }
  const first = await signIn(temporary), page = first.page;
  await expect(page).toHaveURL(base + '/account-password');
  await expect(page.locator('#temporaryNotice')).toBeVisible();
  await expect(page.locator('#homeLink')).toBeHidden();
  await page.goto(base + '/tasks');
  await expect(page).toHaveURL(base + '/account-password');
  assert.equal(await page.evaluate(async () => (await fetch('/api/data/production-log')).status), 403);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    for (const language of ['bg', 'en']) {
      await page.locator(`[data-hub-language=${language}]`).click();
      await expect(page.locator('h1')).toHaveText(language === 'bg' ? 'Смяна на парола' : 'Change password');
      await assertResponsive(page, `Account password ${language}/${width}`);
    }
  }
  await page.locator('[data-hub-language=bg]').click();
  await page.locator('#currentPassword').fill(temporary);
  await page.locator('#newPassword').fill(chosen);
  await page.locator('#confirmPassword').fill('Fictional-mismatch-789');
  await page.locator('#passwordForm button[type=submit]').click();
  await expect(page.locator('#passwordMessage')).toHaveText('Новите пароли не съвпадат.');
  await page.locator('#showPasswords').check();
  await expect(page.locator('#newPassword')).toHaveAttribute('type', 'text');
  await page.locator('#showPasswords').uncheck();
  await page.locator('#currentPassword').fill('Fictional-wrong-000');
  await page.locator('#confirmPassword').fill(chosen);
  await page.locator('#passwordForm button[type=submit]').click();
  await expect(page.locator('#passwordMessage')).toHaveText('Сегашната парола е грешна.');
  await expect(page.locator('#newPassword')).toHaveValue(chosen);
  await page.locator('#currentPassword').fill(temporary);
  await page.locator('#currentPassword').press('Enter');
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.server-links a[href="/account"]')).toHaveText('Моят акаунт');
  console.log('PASS temporary password blocks modules until a keyboard-submitted change, BG/EN and 320–1440 px');

  const second = await signIn(chosen);
  await expect(second.page).toHaveURL(base + '/');
  await openAccountMenu(page); await page.locator('.server-links a[href="/account"]').click();
  await expect(page).toHaveURL(base + '/account');
  await page.locator('.account-security').click();
  await expect(page).toHaveURL(base + '/account-password');
  await expect(page.locator('#accountLink')).toBeVisible();
  await expect(page.locator('#temporaryNotice')).toBeHidden();
  await expect(page.locator('#homeLink')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#logoutAll').click();
  await expect(page).toHaveURL(base + '/login');
  await second.page.goto(base + '/');
  await expect(second.page).toHaveURL(base + '/login');
  const owner = hub.auth.list().find(user => user.username === 'demo-password-owner');
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(owner.id).n, 0);
  assert.equal(await admin.evaluate(async () => (await fetch('/api/session')).status), 200, 'other accounts stay signed in');
  assert.deepEqual([...first.errors, ...second.errors], []);
  await page.context().close(); await second.page.context().close();
  console.log('PASS sign-out from all devices ends only this account’s sessions');
}

module.exports = {exerciseAccountPassword};
