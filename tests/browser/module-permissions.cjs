/* Fictional accounts exercise delegated rights and read-only modules. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
const {keys} = require('../../server/permissions.cjs');
async function exerciseModulePermissions({admin, hub, base, device, expect, screenshotDir}) {
  const password = 'Fictional-password-123';
  await admin.goto(base + '/accounts.html'); await admin.locator('#newAccountButton').click();
  const form = admin.locator('#accountForm');
  for (const role of ['admin', 'operator', 'observer']) {
    await admin.locator('#accountRole').selectOption(role);
    assert.equal(await form.locator('[data-permission]').count(), keys.length);
    for (const key of keys) await expect(form.locator('[data-permission=' + key + ']')).toBeEnabled();
    await expect(form.locator('[data-task-supervisor]')).toBeEnabled();
  }
  for (const language of ['bg', 'en']) {
    await admin.locator('[data-hub-language=' + language + ']').click();
    if (language === 'en') assert.doesNotMatch(await form.innerText(), /[А-Яа-я]/);
    for (const width of [320, 390, 1440]) {
      await admin.setViewportSize({width, height: 1000}); await assertResponsive(admin, 'Module flags ' + language + '/' + width);
    }
  }
  await admin.locator('[data-hub-language=bg]').click(); await admin.locator('#cancelCreate').click();
  for (const role of ['operator', 'observer']) {
    const user = await hub.auth.create('demo-flex-' + role, password, role, null, {
      canCreateReports: false, canEditReports: false, canViewPersonnel: true,
      canManageProductionSettings: true, canManageDowntimeSettings: true,
      canViewStatistics: true, canViewAccounts: true, canViewSystemStatus: true,
      canExportReports: false, canViewPairs: false, canAssignTasks: true
    });
    const page = await device(user.username);
    await expect(page.locator('a[href="personnel.html"]')).toBeVisible();
    await expect(page.locator('a[href="statistics.html"]')).toBeVisible();
    await expect(page.locator('a[href="pair-targets.html"]')).toBeHidden();
    await page.goto(base + '/production-log.html'); await expect(page.locator('#connDot')).toHaveClass(/on/);
    await expect(page.locator('#goalInput')).toBeEnabled(); await expect(page.locator('#saveBtn')).toBeHidden();
    await page.locator('#goalInput').fill(role === 'operator' ? '1700' : '1800'); await page.locator('#goalInput').blur();
    await expect(page.locator('#msg')).toContainText('Целта е записана.');
    assert.equal(hub.store.get('production-log').data.goalTons, role === 'operator' ? 1700 : 1800);
    await page.goto(base + '/line-downtime.html'); await expect(page.locator('#connDot')).toHaveClass(/on/);
    await expect(page.locator('#reasonsAdminPanel')).toBeVisible(); await page.locator('#newReasonInput').fill('Fictional delegated ' + role);
    await page.locator('#addReasonBtn').click(); await expect(page.locator('#reasonsList')).toContainText('Fictional delegated ' + role);
    await page.goto(base + '/personnel.html'); await expect(page.locator('#connDot')).toHaveClass(/on/);
    await expect(page.locator('#addPersonBtn')).toBeHidden(); await expect(page.locator('#settingsBtn')).toBeHidden();
    await page.goto(base + '/statistics.html'); await expect(page.locator('#connDot')).toHaveClass(/on/);
    await page.goto(base + '/accounts.html'); await expect(page.locator('#accountList')).toContainText(user.username);
    await expect(page.locator('#newAccountButton')).toBeHidden();
    const entry = page.locator('.account-entry').filter({hasText: user.username}); await entry.locator('summary').first().click();
    await expect(entry.locator('select[aria-label="Роля"]')).toBeDisabled(); await expect(entry.locator('button[type=submit]')).toBeHidden();
    await page.goto(base + '/system-status.html'); await expect(page.locator('#manualBackup')).toBeHidden();
    await page.goto(base + '/admin-panel.html'); await expect(page.locator('.admin-card:visible')).toHaveCount(2);
    await expect(page.locator('[data-module=activity-log]')).toBeHidden();
    await expect(page.locator('[data-module=data-import]')).toBeHidden();
    if (screenshotDir && role === 'operator') {
      const fs = require('node:fs'), path = require('node:path'); fs.mkdirSync(screenshotDir, {recursive: true});
      await page.screenshot({path: path.join(screenshotDir, 'delegated-admin-panel.png'), fullPage: true});
    }
    await page.context().close();
  }
  await admin.goto(base + '/accounts.html');
  const entry = admin.locator('.account-entry').filter({hasText: 'demo-flex-operator'}); await entry.locator('summary').first().click();
  if (screenshotDir) await entry.screenshot({path: require('node:path').join(screenshotDir, 'module-permission-cards.png')});
  console.log('PASS every flag for every role, independent settings, module visibility, read-only administration and BG/EN responsive layouts');
}
module.exports = {exerciseModulePermissions};
