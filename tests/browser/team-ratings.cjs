/* Fictional Стикери packers and shift leads only. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseTeamRatings({admin, hub, base, device, expect, setTime}) {
  const actor = hub.auth.list()[0];
  for (const name of ['demo-rate-lead', 'demo-rate-lead-2']) await hub.auth.create(name, 'Fictional-password-123', 'operator', actor, {}, () => {}, {taskSupervisor: true, taskTeam: 'СТИКЕРИ'});
  setTime('2026-10-16T19:00:00+03:00');
  const people = [1, 2, 3, 4, 5, 6].map(n => ({id: 'demo-rate-browser-' + n, name: 'Demo Rate Browser ' + n, category: 'stickers', team: '1 смяна', role: 'Опаковчик', active: true}));
  const personnel = hub.store.get('personnel');
  hub.store.put('personnel', {...personnel.data, employees: people}, personnel.revision, actor);
  const ratings = () => hub.store.db.prepare('SELECT employee_id,rating,reason FROM team_ratings ORDER BY employee_id').all().map(row => ({...row}));
  async function pair(page, first, second) {
    await page.goto(base + '/pair-targets'); await expect(page.locator('#pairAccessMessage')).toContainText('21:30');
    await page.locator('#addPairBtn').click();
    await page.locator('#memberOne').selectOption(people[first].id); await page.locator('#memberTwo').selectOption(people[second].id);
    await page.locator('#targetKg').fill('100'); await page.locator('#targetCrates').fill('1'); await page.locator('#areaManual').check();
    await page.locator('#savePairBtn').click(); await expect(page.locator('#pairDialog')).not.toBeVisible();
    await expect(page.locator('#ratingDialog')).not.toBeVisible();
  }
  async function report(page, index) {
    await page.locator('#pairsList [data-action=report]').nth(index).click();
    await page.locator('#actualKg').fill('100'); await page.locator('#actualCrates').fill('1');
    await page.locator('#savePairBtn').click(); await expect(page.locator('#pairDialog')).not.toBeVisible();
  }
  // The prompt cannot be skipped: Escape keeps it open and it returns after a reload until everyone is rated.
  const lead = await device('demo-rate-lead');
  await pair(lead, 0, 1); await pair(lead, 2, 3); await pair(lead, 4, 5);
  await report(lead, 0);
  const dialog = lead.locator('#ratingDialog'); await expect(dialog).toBeVisible();
  await expect(dialog.locator('.rating-person')).toHaveCount(3);
  await expect(dialog.getByRole('button', {name: 'Пропусни'})).toHaveCount(0);
  await lead.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  const person = name => dialog.locator('.rating-person').filter({hasText: name});
  await person('Demo Rate Browser 1').getByLabel('👍 Добре').check();
  await dialog.getByRole('button', {name: 'Запази оценките', exact: true}).click();
  await expect(dialog).toBeVisible(); assert.deepEqual(ratings(), [], 'the browser asks for the remaining people first');
  await lead.reload(); await expect(dialog).toBeVisible();
  await lead.evaluate(() => localStorage.setItem('portfolio-hub-language', 'en')); await lead.reload(); await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2')).toHaveText('How did they do today?');
  await person('Demo Rate Browser 1').getByLabel('👍 Good').check();
  await person('Demo Rate Browser 2').getByLabel('👎 Poor').check();
  await person('Demo Rate Browser 2').getByLabel('Reason (optional)').selectOption('slow');
  await person('Demo Rate Browser 3').getByLabel('👌 Okay').check();
  await dialog.getByRole('button', {name: 'Save ratings', exact: true}).click();
  await expect(dialog).not.toBeVisible(); await expect(lead.locator('#pageError')).toHaveText('The ratings are saved.');
  await lead.locator('[data-hub-language=bg]').click();
  assert.deepEqual(ratings(), [{employee_id: 'demo-rate-browser-1', rating: 'good', reason: ''}, {employee_id: 'demo-rate-browser-2', rating: 'poor', reason: 'slow'}, {employee_id: 'demo-rate-browser-3', rating: 'ok', reason: ''}]);
  await report(lead, 0);
  await lead.waitForTimeout(500); await expect(dialog).not.toBeVisible();
  // A second lead of the same team is asked on opening the page, never-rated people first.
  const second = await device('demo-rate-lead-2');
  await second.goto(base + '/pair-targets');
  await expect(second.locator('#ratingDialog .rating-person legend')).toHaveText(['Demo Rate Browser 4', 'Demo Rate Browser 5', 'Demo Rate Browser 6']);
  await assertResponsive(second, 'rating prompt');
  // Only the report right shows the summary.
  // The report is a Statistics tab, shown only with canViewRatings.
  await hub.auth.create('demo-rate-viewer', 'Fictional-password-123', 'operator', actor, {canViewStatistics: true});
  const viewer = await device('demo-rate-viewer');
  await viewer.goto(base + '/statistics'); await expect(viewer.locator('#statsTabComparison')).toBeVisible();
  await expect(viewer.locator('#statsTabRatings')).toHaveCount(0); await viewer.context().close();
  await admin.goto(base + '/statistics'); await admin.locator('#statsTabRatings').click();
  const panel = admin.locator('#statsRatings'); await expect(panel).toBeVisible();
  const row = name => panel.locator('tbody tr').filter({hasText: name});
  await expect(row('Demo Rate Browser 1')).toContainText('100 %'); await expect(row('Demo Rate Browser 1')).toContainText('малко данни');
  await expect(row('Demo Rate Browser 1')).toContainText('1 / 1');
  await panel.locator('#ratingsPeriod').selectOption('90'); await expect(row('Demo Rate Browser 2')).toContainText('100 %');
  await admin.locator('[data-hub-language=en]').click();
  await expect(panel.locator('h2')).toHaveText('Team ratings'); await expect(row('Demo Rate Browser 1')).toContainText('little data');
  await admin.locator('[data-hub-language=bg]').click();
  for (const width of [320, 390, 768, 1440]) { await admin.setViewportSize({width, height: 900}); await assertResponsive(admin, 'ratings report at ' + width + ' px'); }
  await lead.context().close(); await second.context().close();
  console.log('PASS online team spot-ratings: required prompt, reload, once per shift and report');
}
module.exports = {exerciseTeamRatings};
