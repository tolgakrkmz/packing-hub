/* Validate visible results and retained DOM against independent fictional source changes. */
const assert = require('node:assert/strict');
const {statisticsFixture} = require('./statistics-period.cjs');
async function exerciseStatisticsCache({page, expect, replaceSource}) {
  console.log('RUN statistics cache freshness, independent sources, DOM retention and day rollover');
  const data = statisticsFixture();
  for (const [kind, value] of Object.entries(data)) await replaceSource(kind, value);
  await page.locator('[data-hub-language=bg]').click();
  await page.locator('[data-stats-tab=production]').click();
  await page.locator('[data-view=month]').click();
  await page.locator('#yearSelect').selectOption('2026');
  await page.locator('#dashboardMonthSelect').selectOption('10');
  await expect(page.locator('#dashboardActual')).toHaveText('3 т');
  const ids = ['chartContainer', 'tableContainer', 'monthlyTrendChart', 'lineShiftContainer', 'wfCapacityChart', 'pairStatsBody', 'avTableContainer'];
  async function remember() {
    await expect(page.locator('#statsPeriodStatus')).toBeHidden();
    await page.evaluate(ids => {
      window.__statisticsNodes = Object.fromEntries(ids.map(id => [id, document.getElementById(id).firstElementChild]));
    }, ids);
  }
  async function retained(expected) {
    const same = await page.evaluate(ids => Object.fromEntries(ids.map(id => [id,
      window.__statisticsNodes[id] === document.getElementById(id).firstElementChild])), ids);
    for (const [id, value] of Object.entries(expected)) assert.equal(same[id], value, 'DOM retention: ' + id);
  }
  await remember();
  await page.locator('#dashboardMonthSelect').selectOption('09');
  await expect(page.locator('#dashboardActual')).toHaveText('1 т');
  await retained({chartContainer:true, tableContainer:true, avTableContainer:true, monthlyTrendChart:false, lineShiftContainer:false});
  await page.locator('#dashboardMonthSelect').selectOption('10');
  await remember();
  for (const tab of ['pairs', 'downtime', 'workforce', 'overview', 'production']) await page.locator(`[data-stats-tab=${tab}]`).click();
  await retained(Object.fromEntries(ids.map(id => [id, true])));
  await page.evaluate(() => {
    window.__statisticsMemo = {monthly:getMonthlyDashboardData(), annual:aggregateByMonth('2026'), workforce:aggregateWorkforceMonth(getPersonnelSnapshot())};
    if (getMonthlyDashboardData() !== window.__statisticsMemo.monthly || aggregateByMonth('2026') !== window.__statisticsMemo.annual) throw new Error('Fictional calculations were not reused');
  });
  await page.locator('[data-stats-tab=pairs]').click();
  await page.locator('#pairStatsBody details[data-group^="team-"] > summary').first().click();
  const production = data['production-log'];
  production.entries[0] = {...production.entries[0], tonnage:3000, brak:270, breakdown:{autoKg:2000, autoCrates:80, manKg:1000, manCrates:40}};
  await remember(); await replaceSource('production-log', production);
  await expect(page.locator('#dashboardActual')).toHaveText('4 т');
  await expect(page.locator('#dashboardBrak')).toHaveText('0,4 т');
  await expect(page.locator('#pairStatsBody details[data-group^="team-"]').first()).toHaveAttribute('open', '');
  await retained({chartContainer:false, tableContainer:false, monthlyTrendChart:false, lineShiftContainer:false, wfCapacityChart:false, pairStatsBody:true, avTableContainer:true});
  assert.equal(await page.evaluate(() => getMonthlyDashboardData() !== window.__statisticsMemo.monthly && aggregateByMonth('2026') !== window.__statisticsMemo.annual), true);
  const personnel = data.personnel;
  personnel.employees.push({id:'demo-cache-manual', name:'Demo Cache Manual', category:'manual', role:'Опаковчик', team:'А', active:true, note:''});
  await remember(); await replaceSource('personnel', personnel);
  await expect(page.locator('#wfCurrentStaff')).toHaveText('3');
  await retained({chartContainer:true, tableContainer:true, monthlyTrendChart:true, lineShiftContainer:true, wfCapacityChart:false, pairStatsBody:true, avTableContainer:true});
  const downtime = data['line-downtime'];
  downtime.entries.push({id:'demo-cache-downtime', date:'2026-10-04', shift:'А', start:'08:00', end:'09:00', durationMin:60, reason:'Fictional period downtime'});
  await remember(); await replaceSource('line-downtime', downtime);
  await expect(page.locator('#avKpiRow')).toContainText('1,0 ч');
  await retained({chartContainer:true, tableContainer:true, monthlyTrendChart:true, lineShiftContainer:true, wfCapacityChart:true, pairStatsBody:true, avTableContainer:false});
  const pairs = data['pair-targets'];
  pairs.entries[0].result.kg = 2000;
  await remember(); await replaceSource('pair-targets', pairs);
  await expect(page.locator('#pairStatsBody')).toContainText('2 / 1');
  await retained({chartContainer:true, tableContainer:true, monthlyTrendChart:true, lineShiftContainer:true, wfCapacityChart:true, pairStatsBody:false, avTableContainer:true});
  await expect(page.locator('#pairStatsBody details[data-group^="team-"]').first()).toHaveAttribute('open', '');
  await page.locator('#pairStatsTeam').selectOption('Б');
  await expect(page.locator('#pairStatsBody')).toContainText('Няма двойки');
  await page.locator('#pairStatsTeam').selectOption('');
  await expect(page.locator('#pairStatsBody')).toContainText('2 / 1');
  production.goalTons = 20;
  await replaceSource('production-log', production);
  await expect(page.locator('#dashboardGoal')).toContainText('20 т');
  await expect(page.locator('#wfCalcTarget')).toHaveText('20 т');
  await page.evaluate(() => { window.__statisticsOldDay = getMonthlyDashboardData(); });
  await remember();
  await page.clock.setFixedTime(new Date('2026-10-06T08:30:00+03:00'));
  await page.evaluate(() => renderAll());
  assert.deepEqual(await page.evaluate(() => ({changed:getMonthlyDashboardData() !== window.__statisticsOldDay,
    elapsed:getMonthlyDashboardData().elapsedDays, measurement:aggregateWorkforceMonth(getPersonnelSnapshot()).measurementDays})), {changed:true, elapsed:6, measurement:5}); // workforce measures the open month up to the last reported day
  await retained({chartContainer:true, tableContainer:true, monthlyTrendChart:false, wfCapacityChart:false, pairStatsBody:true, avTableContainer:true});
  await replaceSource('production-log', {...production, entries:[]});
  await expect(page.locator('#monthlyResultEmpty')).toBeVisible();
  await replaceSource('production-log', production);
  await expect(page.locator('#dashboardActual')).toHaveText('4 т');
  await page.locator('[data-hub-language=en]').click();
  await expect(page.locator('#dashboardActual')).toHaveText('4 t');
  await expect(page.locator('#dashboardGoal')).toContainText('20 t');
  await page.locator('[data-hub-language=bg]').click();
  await expect(page.locator('#dashboardActual')).toHaveText('4 т');
  console.log('PASS cached calculations, monthly/annual scope, source freshness, goals, roster, team filters, retained disclosures, empty recovery, day rollover and BG/EN');
}
module.exports = {exerciseStatisticsCache};
