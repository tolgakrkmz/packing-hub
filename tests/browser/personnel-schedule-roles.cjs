const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
async function exercisePersonnelScheduleRoles({page,expect,read}) {
  await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await page.locator('#todayDate').fill('2026-10-10'); await page.locator('#todayDate').dispatchEvent('change');
  await expect(page.locator('#stickersNote')).toContainText('Почивка');
  await expect(page.locator('#stickersNote')).toContainText('09:00–17:30');
  await page.locator('#todayDate').fill('2026-10-09'); await page.locator('#todayDate').dispatchEvent('change');
  await expect(page.locator('#stickersNote')).toContainText('1 смяна');
  await page.locator('#schedMonth').selectOption('9'); await page.locator('#schedYear').selectOption('2026');
  const row = page.locator('.schedule-line').filter({has:page.locator('.schedule-team-label', {hasText:'СТИКЕРИ'})});
  await expect(row.locator('.schedule-cell').nth(8)).toHaveText('1');
  await expect(row.locator('.schedule-cell').nth(9)).toHaveText('Н');
  await expect(row.locator('.schedule-cell').nth(10)).toHaveText('Н');
  await expect(row.locator('.schedule-cell').nth(11)).toHaveAttribute('title',/09:00–17:30/);
  await page.locator('#addPersonBtn').click(); await page.locator('#personName').fill('Demo Shared Role Person');
  const options = await page.locator('#personRole option').allTextContents();
  for(const category of ['manual','stickers','auto']) {
    await page.locator('#personCategory').selectOption(category);
    assert.deepEqual(await page.locator('#personRole option').allTextContents(),options);
    await page.locator('#personRole').selectOption('Оператор пулт 2');
  }
  await page.locator('#personRole').selectOption('__new_role__');
  await expect(page.locator('#personNewRole')).toBeVisible();
  await page.locator('#personNewRole').fill('Demo Cancelled Role');
  await page.locator('#personModal [data-close-modal]').first().click();
  assert.equal((await read()).settings.customRoles,undefined);
  await page.locator('#addPersonBtn').click(); await page.locator('#personName').fill('Demo Shared Role Person');
  await page.locator('#personCategory').selectOption('stickers');
  await page.locator('#personRole').selectOption('__new_role__');
  await expect(page.locator('#personNewRole')).toHaveValue('');
  await page.locator('#personForm button[type=submit]').click(); await expect(page.locator('#personModal')).toHaveClass(/open/);
  const role = '<Demo Shared Role>';
  await page.locator('#personNewRole').fill(role);
  await page.locator('#personForm button[type=submit]').click(); await expect(page.locator('#personModal')).not.toHaveClass(/open/);
  await expect.poll(async () => (await read()).employees.find(p=>p.name==='Demo Shared Role Person')?.role).toBe(role);
  assert.deepEqual((await read()).settings.customRoles,[role]);
  await page.reload(); await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await page.locator('[data-edit-person]').first().click();
  await expect(page.locator('#personRole')).toHaveValue(role);
  for(const category of ['auto','manual','stickers']) {
    await page.locator('#personCategory').selectOption(category); await expect(page.locator('#personRole')).toHaveValue(role);
  }
  await page.locator('#personRole').selectOption('__new_role__'); await page.locator('#personNewRole').fill('  <demo shared role>  ');
  await page.locator('#personForm button[type=submit]').click(); await expect(page.locator('#personModal')).not.toHaveClass(/open/);
  assert.deepEqual((await read()).settings.customRoles,[role]);
  await page.locator('#settingsBtn').click(); await page.locator('#stickersStage1').fill('3');
  await page.locator('#settingsForm button[type=submit]').click(); await expect(page.locator('#settingsModal')).not.toHaveClass(/open/);
  assert.deepEqual((await read()).settings.customRoles,[role]);
  await page.locator('#addPersonBtn').click();
  await expect(page.locator('#personRole option').filter({hasText:role})).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});
  await assertResponsive(page,'Shared personnel roles and weekday schedule');
  await page.locator('#personModal [data-close-modal]').first().click();
  await page.locator('[data-hub-language=en]').click();
  await page.locator('#addPersonBtn').click();
  await expect(page.locator('#personRole option[value="__new_role__"]')).toHaveText('+ Add a new role…');
  await page.locator('#personRole').selectOption('__new_role__');
  await expect(page.locator('#newRoleField')).toContainText('New role');
}
module.exports = {exercisePersonnelScheduleRoles};
