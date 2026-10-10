/* Shared offline/server UI checks use only fictional personnel and reports. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');
const employees = [1,2].map(id => ({id:'demo-cancellation-person-'+id,name:'Demo Cancellation Person '+id,category:'stickers',team:'1 смяна',role:'Опаковчик',active:true,note:''}));
async function exercisePairCancellation({page,base,expect,read,replace,failNextWrite,statisticsPage=page,checkReadOnly=async () => {},screenshotDir}) {
  const saved = predicate => expect.poll(async () => {
    try { return predicate(await read()); }
    catch(error) {
      if(/NotReadableError|NotFoundError/.test(error.message)) return false;
      throw error;
    }
  }).toBe(true);
  async function plan(count) {
    await page.locator('#addPairBtn').click();
    await page.locator('#memberOne').selectOption(employees[0].id);
    await page.locator('#memberTwo').selectOption(employees[1].id);
    await page.locator('#targetKg').fill('1000');
    await page.locator('#targetCrates').fill('40');
    await page.locator('#areaManual').check();
    await page.locator('#savePairBtn').click();
    await saved(data => data.entries.length === count);
    await expect(page.locator('#pairDialog')).not.toBeVisible();
  }
  await page.locator('#stickersShiftBtn').click();
  await plan(1);
  await checkReadOnly();
  const original = (await read()).entries[0];
  await page.locator('#pairsList [data-action=cancel]').click();
  await page.locator('#savePairBtn').click();
  assert.equal((await read()).entries[0].cancellation,undefined);
  await expect(page.locator('#pairDialog')).toBeVisible();
  await page.locator('#cancellationReason').selectOption('other');
  await page.locator('#cancellationText').fill('  ');
  await page.locator('#savePairBtn').click();
  await expect(page.locator('#dialogError')).toContainText('Изберете причина');
  await page.locator('#cancellationReason').selectOption('cleaning');
  await page.locator('#cancellationText').fill('Fictional cleaning note');
  for(const lang of ['en','bg']) {
    await page.locator('#cancelDialogBtn').click();
    await page.locator('[data-hub-language='+lang+']').click();
    await page.locator('#pairsList [data-action=cancel]').click();
    await page.locator('#cancellationReason').selectOption('cleaning');
    await page.locator('#cancellationText').fill('Fictional cleaning note');
    await expect(page.locator('#cancellationText')).toHaveValue('Fictional cleaning note');
    await expect(page.locator('#cancellationReason')).toHaveValue('cleaning');
    await expect(page.locator('#dialogTitle')).toHaveText(lang === 'en' ? 'Cancel pair' : 'Отмяна на двойката');
    await expect(page.locator('#cancellationReason option[value=cleaning]')).toHaveText(lang === 'en' ? 'Cleaning' : 'Чистене');
    for(const width of [320,390,1440]) {
      await page.setViewportSize({width,height:900});
      await assertResponsive(page,'Pair cancellation '+lang+' '+width);
      if(screenshotDir) {
        fs.mkdirSync(screenshotDir,{recursive:true});
        await page.screenshot({path:path.join(screenshotDir,'cancellation-'+lang+'-'+width+'.png')});
      }
    }
  }
  await failNextWrite();
  await page.locator('#savePairBtn').click();
  await expect(page.locator('#dialogError')).toContainText('Записът не е направен');
  await expect(page.locator('#cancellationText')).toHaveValue('Fictional cleaning note');
  await expect(page.locator('#cancellationReason')).toHaveValue('cleaning');
  assert.equal((await read()).entries[0].cancellation,undefined);
  await page.locator('#savePairBtn').click();
  await saved(data => data.entries[0].cancellation?.reasonKey === 'cleaning');
  await expect(page.locator('#pairDialog')).not.toBeVisible();
  const cancelled = (await read()).entries[0];
  for(const key of ['id','members','targetKg','targetCrates','createdAt','result']) assert.deepEqual(cancelled[key],original[key]);
  await expect(page.locator('#pairsList')).toContainText('Отменена');
  await expect(page.locator('#pairsList')).toContainText('Чистене');
  await expect(page.locator('#pairsList [data-action]')).toHaveCount(0);
  await expect(page.locator('#addPairBtn')).toBeEnabled();
  await page.reload();
  await page.locator('#stickersShiftBtn').click();
  await expect(page.locator('#pairsList')).toContainText('Fictional cleaning note');
  const stats = statisticsPage;
  await stats.goto(base+'/statistics.html');
  await stats.locator('[data-stats-tab=pairs]').click();
  await expect(stats.locator('#pairStatsBody')).toContainText('Отменени двойки');
  await expect(stats.locator('#pairStatsBody .kpi-card').filter({hasText:'Планирани двойки'}).locator('.val')).toHaveText('0');
  await stats.locator('#pairStatsBody details[data-group="team-СТИКЕРИ"] summary').click();
  await expect(stats.locator('#pairStatsBody .pair-state-cancelled')).toHaveText('Отменена');
  await expect(stats.locator('#pairStatsBody')).toContainText('Fictional cleaning note');
  await page.goto(base+'/pair-targets.html');
  await page.locator('#stickersShiftBtn').click();
  await plan(2);
  await page.locator('#pairsList [data-action=cancel]').click();
  await page.locator('#cancellationReason').selectOption('other');
  await page.locator('#cancellationText').fill('Fictional reassignment note');
  const changed = await read();
  changed.entries[1].targetKg = 1200;
  await replace(changed);
  await page.locator('#savePairBtn').click();
  await expect(page.locator('#dialogError')).toContainText('Двойката е променена');
  await expect(page.locator('#cancellationText')).toHaveValue('Fictional reassignment note');
  assert.equal((await read()).entries[1].cancellation,undefined);
  await page.locator('#cancelDialogBtn').click();
  await page.locator('#pairsList [data-action=cancel]').click();
  await page.locator('#cancellationReason').selectOption('other');
  await page.locator('#cancellationText').fill('Fictional reassignment note');
  await page.locator('#savePairBtn').click();
  await saved(data => data.entries[1].cancellation?.reasonKey === 'other');
  await expect(page.locator('#pairDialog')).not.toBeVisible();
  assert.equal((await read()).entries[1].targetKg,1200);
  await plan(3);
  await page.locator('#pairsList [data-action=report]').click();
  await page.locator('#actualKg').fill('1000');
  await page.locator('#actualCrates').fill('40');
  await page.locator('#savePairBtn').click();
  await saved(data => data.entries[2].result?.kg === 1000);
  await expect(page.locator('#pairsList [data-action=cancel]')).toHaveCount(0);
  await expect(page.locator('#shiftTotals')).toContainText('1 отчетени');
  await expect(page.locator('#shiftTotals')).toContainText(/1\s?000\s*\/\s*1\s?000/);
}
module.exports = {employees,exercisePairCancellation};
