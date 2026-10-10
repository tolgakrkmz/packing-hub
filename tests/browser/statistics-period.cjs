/* Fictional reports deliberately cover different months and years in each source. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');

function statisticsFixture() {
  const members = [1, 2].map(id => ({id:'demo-period-person-' + id, name:'Demo Period Person ' + id, category:'auto', role:'Опаковчик'}));
  const pair = (id, date, kg) => ({id, date, team:'А', shiftCode:1, members, areas:['auto'], targetKg:1000, targetCrates:40,
    result:{kg, crates:44, reasonKey:kg < 1000 ? 'materials' : '', reasonText:'', reportedAt:date + 'T12:00:00Z'},
    createdAt:date + 'T06:00:00Z', updatedAt:date + 'T12:00:00Z'});
  return {
    'production-log': {goalTons:10, entries:[
      {id:'demo-period-october', date:'2026-10-04', shift:'А', tonnage:2000, brak:70, breakdown:{autoKg:1400, autoCrates:56, manKg:600, manCrates:24}},
      {id:'demo-period-october-second-shift', date:'2026-10-05', shift:'Б', tonnage:1000, brak:80, breakdown:null},
      {id:'demo-period-september', date:'2026-09-30', shift:'А', tonnage:1000, brak:0, breakdown:null},
      {id:'demo-period-previous-october', date:'2025-10-04', shift:'А', tonnage:5000, brak:900, breakdown:null}
    ]},
    'line-downtime': {entries:[{id:'demo-period-downtime', date:'2024-02-20', shift:'А', start:'08:00', end:'08:30', durationMin:30, reason:'Fictional period downtime'}], reasons:['Fictional period downtime']},
    'pair-targets': {module:'pair-targets', schemaVersion:1, entries:[pair('demo-period-current', '2026-10-04', 1100), pair('demo-period-old', '2025-12-31', 800)]},
    personnel: {schemaVersion:3, employees:members.map(person => ({...person, team:'А', active:true, note:''})), settings:{stickersStage1:1, stickersStage2:2}, moveLog:[]}
  };
}

async function exerciseStatisticsPeriod({page, expect, replaceSources, screenshotDir}) {
  console.log('RUN shared statistics period, empty modules, source refresh and annual scopes');
  const month = page.locator('#dashboardMonthSelect'), year = page.locator('#yearSelect');
  await expect(year).toHaveValue('2026');
  await expect(month).toHaveValue('10');
  await expect(month.locator('option')).toHaveCount(12);
  for (const value of ['2024','2025','2026']) await expect(year.locator(`option[value="${value}"]`)).toHaveCount(1);
  await expect(page.locator('#dashboardActual')).toHaveText('3,0 т');
  await expect(page.locator('#dashboardBrak')).toHaveText('0,2 т');
  await expect(page.locator('#dashboardBrakKg')).toHaveText('150 кг');
  const refreshed = statisticsFixture();
  refreshed['production-log'].entries[0].brak = 170;
  await replaceSources(refreshed);
  await expect(page.locator('#dashboardBrak')).toHaveText('0,3 т');
  await expect(page.locator('#dashboardBrakKg')).toHaveText('250 кг');
  await expect(page.locator('#dashboardActual')).toHaveText('3,0 т');
  await page.locator('[data-stats-tab=pairs]').click();
  await expect(page.locator('#pairStatsPeriod')).toContainText('2026');
  await expect(page.locator('#pairStatsBody')).toContainText(/1\s?100\s*\/\s*1\s?000/);
  await month.selectOption('09');
  await expect(page.locator('#dashboardActual')).toHaveText('1,0 т');
  await expect(page.locator('#dashboardBrak')).toHaveText('0,0 т');
  await expect(page.locator('#dashboardBrakKg')).toHaveText('0 кг');
  await expect(page.locator('#pairStatsBody')).toContainText('Няма двойки за избрания месец и екип.');
  for (const tab of ['overview','production','downtime','workforce','pairs']) {
    await page.locator(`[data-stats-tab=${tab}]`).click();
    await expect(month).toHaveValue('09');
    await expect(year).toHaveValue('2026');
    await expect(page.locator('#dashboardTitle')).toHaveText('Септември 2026');
  }
  await page.locator('[data-stats-tab=production]').click();
  await page.locator('#statsProduction details').nth(1).locator('summary').click();
  await expect(page.locator('#lineShiftTitle')).toContainText('Септември 2026');
  await expect(page.locator('#lineShiftContainer')).toContainText('Няма данни с разбивка за избрания месец.');
  await page.locator('[data-stats-tab=workforce]').click();
  await expect(page.locator('#wfSubtitle')).toContainText('Септември 2026');
  await year.selectOption('2025');
  await expect(month).toHaveValue('09');
  await month.selectOption('10');
  await expect(page.locator('#dashboardBrak')).toHaveText('0,9 т');
  await expect(page.locator('#dashboardBrakKg')).toHaveText('900 кг');
  await month.selectOption('12');
  await expect(page.locator('#monthlyResultEmpty')).toBeVisible();
  await expect(page.locator('#dashboardBrak')).toBeHidden();
  await expect(page.locator('#wfSubtitle')).toHaveText('Декември 2025');
  await page.locator('[data-stats-tab=pairs]').click();
  await expect(page.locator('#pairStatsBody')).toContainText('800 / 1');
  await expect(page.locator('#pairStatsPeriod')).toContainText('декември 2025');
  await year.selectOption('2024');
  await month.selectOption('02');
  await page.locator('[data-stats-tab=downtime]').click();
  await expect(page.locator('#avKpiRow')).toContainText('0,5 ч');
  await expect(page.locator('#downtimeScopeTitle')).toContainText('Годишен преглед 2024');
  await page.locator('[data-view=year]').click();
  await expect(page.locator('#downtimeScopeTitle')).toContainText('Всички години');
  await expect(month).toHaveValue('02');
  await expect(year).toHaveValue('2024');
  await page.locator('[data-stats-tab=production]').click();
  await expect(page.locator('#productionScopeTitle')).toContainText('Всички години');
  await expect(page.locator('#kpiRow .val').first()).toHaveText('9,0 т');
  await page.locator('[data-view=month]').click();
  await year.selectOption('2026');
  await month.selectOption('11');
  await expect(page.locator('#monthlyResultEmpty')).toBeVisible();
  await expect(page.locator('#lineShiftTitle')).toContainText('Ноември 2026');
  await page.locator('[data-stats-tab=pairs]').click();
  await expect(page.locator('#pairStatsPeriod')).toContainText('ноември 2026');
  await expect(page.locator('#pairStatsBody')).toContainText('Няма двойки');

  for (const language of ['bg','en']) {
    await page.locator(`[data-hub-language=${language}]`).click();
    await month.selectOption('10');
    await expect(page.locator('#dashboardBrak')).toHaveText(language === 'bg' ? '0,3 т' : '0,3 t');
    await expect(page.locator('#dashboardBrakKg')).toHaveText(language === 'bg' ? '250 кг' : '250 kg');
    await expect(page.locator('.goal-scrap .goal-label')).toHaveText(language === 'bg' ? 'Общо брак' : 'Total scrap');
    for (const width of [390,1440]) {
      await page.setViewportSize({width, height:900});
      await page.locator('[data-stats-tab=overview]').click();
      await assertResponsive(page, `Monthly scrap ${language} ${width}`);
      await expect(page.locator('#dashboardBrak')).toBeVisible();
      if (screenshotDir) await page.locator('#monthDashboard').screenshot({path:screenshotDir + `/monthly-scrap-${language}-${width}.png`});
    }
    await month.selectOption('11');
    for (const width of [390,1440]) {
      await page.setViewportSize({width, height:900});
      for (const tab of ['overview','production','pairs','downtime','workforce']) {
        await page.locator(`[data-stats-tab=${tab}]`).click();
        await expect(month).toHaveValue('11');
        await expect(year).toHaveValue('2026');
        await assertResponsive(page, `Statistics ${language} ${width} ${tab}`);
      }
    }
  }
  await expect(page.locator('#dashboardTitle')).toHaveText('November 2026');
  await expect(page.locator('#wfSubtitle')).toHaveText('November 2026');
  await page.locator('[data-stats-tab=pairs]').click();
  await expect(page.locator('#pairStatsBody')).toContainText('No pairs for the selected month and team.');
  await expect(page.locator('#pairStatsPeriod')).toContainText('November 2026');
  if (screenshotDir) {
    await page.setViewportSize({width:390, height:900});
    await page.screenshot({path:screenshotDir + '/statistics-period-mobile.png', fullPage:true});
  }
  await page.locator('[data-hub-language=bg]').click();
  await year.selectOption('2025');
  await month.selectOption('12');
  await replaceSources();
  await expect(page.locator('#pairStatsBody')).toContainText('Няма двойки');
  await expect(year.locator('option[value="2023"]')).toHaveCount(1);
  await expect(year.locator('option[value="2025"]')).toHaveCount(1);
  await expect(month).toHaveValue('12');
  await expect(year).toHaveValue('2025');
  await expect(page.locator('#dashboardTitle')).toHaveText('Декември 2025');
  await expect(page.locator('#monthlyResultEmpty')).toBeVisible();
  await expect(page.locator('#dashboardBrak')).toBeHidden();
  await expect(page.locator('#pairStatsPeriod')).toContainText('декември 2025');
  assert.equal(await page.locator('#pairStatsMonth, #lineShiftMonthSelect').count(), 0);
  console.log('PASS shared statistics period, monthly scrap totals, BG/EN phone/desktop and refresh without fallback');
}

function changedSources() {
  const data = statisticsFixture();
  data['production-log'].entries = [];
  data['pair-targets'].entries = data['pair-targets'].entries.slice(0, 1).map(entry => ({...entry, date:'2023-01-04'}));
  return data;
}
module.exports = {statisticsFixture, exerciseStatisticsPeriod, changedSources};
