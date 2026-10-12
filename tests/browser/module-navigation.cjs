/* Native navigation uses isolated fictional accounts and the real permission model. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');

async function exerciseModuleNavigation({admin, hub, base, device, expect}) {
  const picker = page => page.locator('#serverModuleSelect');
  await expect(picker(admin)).toBeVisible();
  await expect(picker(admin)).toHaveValue('/');
  await admin.goto(base + '/accounts');
  await expect(picker(admin)).toHaveValue('');
  await admin.locator('.server-links a[href^="/admin-panel"]').focus();
  await admin.keyboard.press('Shift+Tab');
  await expect(picker(admin)).toBeFocused();
  await picker(admin).selectOption('/');
  await expect(admin).toHaveURL(base + '/');
  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({width, height: 900});
    for (const language of ['en', 'bg']) {
      await admin.locator(`[data-hub-language=${language}]`).click();
      await assertResponsive(admin, `Module navigation ${language}/${width}`);
      await expect(picker(admin)).toHaveAccessibleName(language === 'bg' ? 'Модул' : 'Module');
      await picker(admin).selectOption('/statistics');
      await expect(admin).toHaveURL(base + '/statistics');
      await expect(picker(admin)).toHaveValue('/statistics');
      await picker(admin).selectOption('/production-log');
      await expect(admin).toHaveURL(base + '/production-log');
      await expect(picker(admin)).toHaveValue('/production-log');
      await picker(admin).selectOption('/');
      await expect(admin).toHaveURL(base + '/');
    }
  }
  const user = hub.auth.list()[0];
  const permissions = Object.fromEntries(require('../../js/permission-model.js').keys.map(key => [key, false]));
  permissions.canViewInstructions = true;
  await hub.auth.create('demo-navigation-limited', 'Fictional-password-123', 'observer', user, permissions);
  const limited = await device('demo-navigation-limited', true);
  assert.deepEqual(await picker(limited).locator('option').evaluateAll(options => options.filter(option => !option.disabled).map(option => option.value)), ['/', '/package-instructions']);
  await picker(limited).selectOption('/package-instructions');
  await expect(limited).toHaveURL(base + '/package-instructions');
  await expect(picker(limited)).toHaveValue('/package-instructions');
  assert.equal(await limited.evaluate(async () => (await fetch('/statistics')).status), 403);
  await assertResponsive(limited, 'Restricted mobile module navigation');
  await limited.context().close();
  console.log('PASS module navigation, keyboard, BG/EN, permissions and 320–1440 px');
}

module.exports = {exerciseModuleNavigation};
