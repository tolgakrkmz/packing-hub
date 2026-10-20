/* Fictional reports deliberately cover different months and years in each source. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
const fs = require('node:fs');
const {unzipText, slideText} = require('../pptx-zip.cjs');

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
  await expect(page.locator('#dashboardActual')).toHaveText('3 т');
  await expect(page.locator('#dashboardBrak')).toHaveText('0,2 т');
  await exerciseStatisticsComparison({page, expect, screenshotDir});
  await exerciseMonthlyPresentation({page, expect});
  const refreshed = statisticsFixture();
  refreshed['production-log'].entries[0].brak = 170;
  await replaceSources(refreshed);
  await expect(page.locator('#dashboardBrak')).toHaveText('0,3 т');
  await expect(page.locator('#dashboardActual')).toHaveText('3 т');
  await page.locator('[data-stats-tab=pairs]').click();
  await expect(page.locator('#pairStatsPeriod')).toContainText('2026');
  await expect(page.locator('#pairStatsBody')).toContainText(/1,1\s*\/\s*1/);
  await month.selectOption('09');
  await expect(page.locator('#dashboardActual')).toHaveText('1 т');
  await expect(page.locator('#dashboardBrak')).toHaveText('0 т');
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
  await month.selectOption('12');
  await expect(page.locator('#monthlyResultEmpty')).toBeVisible();
  await expect(page.locator('#dashboardBrak')).toBeHidden();
  await expect(page.locator('#wfSubtitle')).toHaveText('Декември 2025');
  await page.locator('[data-stats-tab=pairs]').click();
  await expect(page.locator('#pairStatsBody')).toContainText('0,8 / 1');
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
  await expect(page.locator('#kpiRow .val').first()).toHaveText('9 т');
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
  await exerciseStatisticsUnits({page, expect, replaceSources, screenshotDir});
  console.log('PASS shared statistics period, monthly scrap totals, BG/EN phone/desktop and refresh without fallback');
}

async function exerciseMonthlyPresentation({page, expect}) {
  console.log('RUN monthly presentation built from statistics');
  // Offline files have no accounts, so the administrator-only button stays hidden there.
  if (await page.evaluate(() => typeof HubServer === 'undefined')) { await expect(page.locator('#presentationBtn')).toBeHidden(); return; }
  const dialog = page.locator('#presentationDialog'), feedback = page.locator('#presentationFeedback');
  await page.locator('#presentationBtn').click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('#presentationPeriod')).toHaveText('Октомври 2026');
  await dialog.locator('input[name=stations]').fill('2.5');
  await dialog.locator('input[name=specialLabel]').fill('Fictional special line');
  await dialog.locator('textarea[name=improvements]').fill('Fictional count: Stock checked.');
  const download = page.waitForEvent('download');
  await page.locator('#presentationSubmit').click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'packing-presentation-2026-10.pptx');
  // September comes from a separate server read of the previous month.
  const files = unzipText(fs.readFileSync(await file.path()));
  const slide = n => slideText(files[`ppt/slides/slide${n}.xml`]);
  for (const line of ['October 2026', 'Prepared 05.10.2026']) assert.ok(slide(1).includes(line), line);
  assert.ok(slide(2).includes('3 t'));
  assert.ok(slide(3).includes('Fictional special line'));
  for (const line of ['3 t', '1 t', '0 t']) assert.ok(slide(4).includes(line), line);
  assert.ok(slide(5).includes('50.0%'));
  assert.ok(slide(6).includes('Fictional count') && slide(6).includes('Stock checked.'));
  assert.ok(slide(7).includes('Global Problems') && slide(7).includes('No active problems at month end.'));
  assert.ok(slide(8).includes('Workforce') && slide(8).includes('Team A'));
  await expect(feedback).toHaveText('Свалено. За някой от предишните два месеца няма отчети.');
  // Repeated settings return on the next visit; monthly figures do not.
  await page.reload();
  await page.locator('#presentationBtn').click();
  await expect(dialog.locator('input[name=specialLabel]')).toHaveValue('Fictional special line');
  await expect(dialog.locator('input[name=stations]')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

async function exerciseStatisticsComparison({page, expect, screenshotDir}) {
  console.log('RUN period comparison cards, cumulative chart, any base month and report coverage');
  await page.locator('[data-stats-tab=comparison]').click();
  const body = page.locator('#comparisonBody'), base = page.locator('#comparisonBase'), kg = body.locator('.cmp-kpi[data-metric=kg]');
  // The fixed time is 05.10 08:30, so 1-4 October are the completed days.
  await expect(page.locator('#comparisonPeriods')).toHaveText('01.10.2026 – 04.10.2026 спрямо 01.09.2026 – 04.09.2026');
  await expect(kg.locator('.val')).toHaveText('2 т');
  await expect(kg.locator('.cmp-base')).toHaveText('0 т');
  await expect(kg.locator('.cmp-delta')).toHaveText('+2 т');
  await expect(kg.locator('.cmp-delta')).toHaveClass(/good/);
  await expect(body).toContainText('Няма отчети в сравнителния период.');
  await expect(body).toContainText('Сравняват се само завършените дни: 1–4.');
  await expect(body).toContainText('Има смени без отчет');
  await expect(body.locator('.cmp-coverage .val').first()).toHaveText(/^1 \/ \d+$/);
  await expect(body.locator('.cmp-chart svg polyline')).toHaveCount(2);
  await expect(body.locator('table')).toHaveCount(0);
  await expect(base.locator('option[value="2025-10"]')).toHaveText('Октомври 2025');
  await expect(base.locator('option[value="2026-10"]')).toHaveCount(0);
  await base.selectOption('year');
  await expect(page.locator('#comparisonPeriods')).toContainText('01.10.2025 – 04.10.2025');
  await expect(kg.locator('.cmp-base')).toHaveText('5 т');
  await expect(kg.locator('.cmp-delta')).toHaveText('-3 т (-60%)');
  await expect(kg.locator('.cmp-delta')).toHaveClass(/bad/);
  await expect(body.locator('.cmp-kpi[data-metric=scrapPct] .cmp-delta')).toHaveText(/п\.п\.$/);
  await base.selectOption('2025-10');
  await page.locator('#dashboardMonthSelect').selectOption('09');
  await expect(base).toHaveValue('2025-10');
  await expect(page.locator('#comparisonPeriods')).toHaveText('01.09.2026 – 30.09.2026 спрямо 01.10.2025 – 30.10.2025');
  await expect(kg.locator('.val')).toHaveText('1 т');
  await expect(kg.locator('.cmp-base')).toHaveText('5 т');
  await expect(body.locator('.cmp-legend-row')).toContainText('Септември 2026');
  await expect(body.locator('.cmp-legend-row')).toContainText('Октомври 2025');
  await page.locator('[data-hub-language=en]').click();
  await expect(page.locator('#comparisonTitle')).toHaveText('Period comparison');
  await expect(kg.locator('.cmp-delta')).toHaveText('-4 t (-80%)');
  await expect(base.locator('option[value="2025-10"]')).toHaveText('October 2025');
  for (const width of [390, 1440]) {
    await page.setViewportSize({width, height:900});
    await assertResponsive(page, `Comparison en ${width}`);
    if (screenshotDir) await page.locator('#statsComparison').screenshot({path:screenshotDir + `/comparison-en-${width}.png`});
  }
  await page.locator('[data-hub-language=bg]').click();
  await page.locator('#dashboardMonthSelect').selectOption('11');
  await expect(body).toContainText('Няма завършени дни за сравнение в избраните месеци.');
  await base.selectOption('');
  await page.locator('#dashboardMonthSelect').selectOption('10');
  await page.locator('[data-stats-tab=overview]').click();
  console.log('PASS period comparison cards, cumulative chart, any base month and report coverage');
}

async function exerciseStatisticsUnits({page, expect, replaceSources, screenshotDir}) {
  console.log('RUN legacy kg reports displayed as tonnes, including 1 kg scrap and pair deficit');
  const documents = statisticsFixture();
  documents['production-log'].entries[0] = {...documents['production-log'].entries[0],
    tonnage:1250, brak:1, breakdown:{autoKg:1000, autoCrates:40, manKg:250, manCrates:10}};
  documents['production-log'].entries[1] = {...documents['production-log'].entries[1],
    tonnage:1, brak:0, breakdown:{autoKg:1, autoCrates:1, manKg:0, manCrates:0}};
  const pair = documents['pair-targets'].entries[0];
  pair.targetKg = 1250;
  pair.result = {...pair.result, kg:1249, reasonKey:'materials'};
  await replaceSources(documents);
  await page.locator('#yearSelect').selectOption('2026');
  await page.locator('#dashboardMonthSelect').selectOption('10');

  for (const language of ['bg','en']) {
    const unit = language === 'bg' ? 'т' : 't';
    await page.locator(`[data-hub-language=${language}]`).click();
    await expect(page.locator('#dashboardActual')).toHaveText('1,3 ' + unit);
    await expect(page.locator('#dashboardBrak')).toHaveText('0 ' + unit);
    await expect(page.locator('#dashboardGoal')).toContainText('10 ' + unit);
    await expect(page.locator('#dashboardRemaining')).toContainText('8,7 ' + unit);
    await expect(page.locator('#dashboardBrakKg')).toHaveCount(0);

    await page.locator('[data-stats-tab=production]').click();
    await page.locator('[data-view=month]').click();
    const october = page.locator('#tableContainer tbody tr').filter({hasText:language === 'bg' ? 'Окт' : 'Oct'});
    await expect(october.locator('td').nth(1)).toHaveText('1,3 ' + unit);
    await expect(october.locator('td').nth(2)).toHaveText('0 ' + unit);
    await expect(october.locator('td').nth(4)).toHaveText('1,3');
    await expect(october.locator('td').nth(5)).toHaveText('0');
    await expect(page.locator('#tableContainer thead')).toContainText('(' + unit + ')');
    await expect(page.locator('#kpiRow .prod-brak .val')).toHaveText('0 ' + unit);
    await expect(page.locator('#lineShiftSummary .prod-line.auto .v')).toHaveText('1 ' + unit);
    await expect(page.locator('#lineShiftSummary .prod-line.manual .v')).toHaveText('0,3 ' + unit);
    await expect(page.locator('#prodTeamShare .prod-team')).toHaveCount(2);
    await expect(page.locator('#prodTeamShare .prod-team').first()).toContainText('1,3 ' + unit);
    await expect(page.locator('#lineShiftContainer .total-row td').nth(1)).toHaveText('1 ' + unit);
    await expect(page.locator('#lineShiftContainer .total-row td').nth(2)).toHaveText('0,3 ' + unit);
    await expect(page.locator('#lineShiftContainer .total-row td').nth(3)).toHaveText('41');
    await expect(page.locator('#lineShiftContainer .total-row td').nth(4)).toHaveText('10');
    await expect(page.locator('#chartContainer')).toContainText('2' + unit);
    await page.locator('[data-view=year]').click();
    await expect(page.locator('#kpiRow .val').first()).toHaveText('7,3 ' + unit);
    await expect(page.locator('#tableContainer .total-row td').nth(1)).toHaveText('7,3 ' + unit);
    await page.locator('[data-view=month]').click();

    await page.locator('[data-stats-tab=pairs]').click();
    const cards = page.locator('.pair-stats-kpis .kpi-card');
    await expect(cards.nth(2).locator('.sub')).toContainText('1,2 / 1,3 ' + unit);
    await expect(cards.nth(2).locator('.val')).toHaveText('99,92%');
    await expect(cards.nth(3).locator('.sub')).toContainText('44 / 40');
    await expect(cards.nth(4).locator('.val')).toHaveText('0 ' + unit);
    await expect(cards.nth(5).locator('.val')).toHaveText('1,2 ' + unit);
    await expect(page.locator('#pairStatsBody details[data-group="team-А"] td').nth(2)).toHaveText('1,2 / 1,3');
    await expect(page.locator('#pairStatsBody details[data-group="team-А"] td').nth(3)).toHaveText('44 / 40');
    await expect(page.locator('#pairStatsBody .ps-team[data-team="А"]')).toContainText('1,2 ' + unit);
    await expect(page.locator('#pairStatsHint')).not.toContainText(/килограм|kilogram/i);

    await page.locator('[data-stats-tab=workforce]').click();
    await expect(page.locator('#wfMeasuredProductivity')).toHaveText('0,1 ' + unit);
    await expect(page.locator('#wfMeasuredProductivitySub')).toContainText('1,3 ' + unit);
    await expect(page.locator('#wfCalcTarget')).toHaveText('10 ' + unit);
    await expect(page.locator('#wfCapacityChart')).toContainText('10 ' + unit);

    for (const width of [390,1440]) {
      await page.setViewportSize({width, height:900});
      for (const tab of ['overview','production','pairs','downtime','workforce']) {
        await page.locator(`[data-stats-tab=${tab}]`).click();
        assert.doesNotMatch(await page.locator('.wrap').innerText(), /\bkg\b|(?:^|\s)кг(?:\s|$)|килограм/iu);
        await assertResponsive(page, `Statistics tonnes ${language} ${width} ${tab}`);
        if (screenshotDir && ['production','pairs','workforce'].includes(tab)) {
          await page.screenshot({path:screenshotDir + `/statistics-tonnes-${tab}-${language}-${width}.png`, fullPage:true});
        }
      }
      if (screenshotDir) await page.screenshot({path:screenshotDir + `/statistics-tonnes-${language}-${width}.png`, fullPage:true});
    }
  }
  await page.locator('[data-hub-language=bg]').click();
  console.log('PASS statistics tonnes, small amounts, unchanged crate counts/percentages and BG/EN layouts');
}

function changedSources() {
  const data = statisticsFixture();
  data['production-log'].entries = [];
  data['pair-targets'].entries = data['pair-targets'].entries.slice(0, 1).map(entry => ({...entry, date:'2023-01-04'}));
  return data;
}
module.exports = {statisticsFixture, exerciseStatisticsPeriod, changedSources};
