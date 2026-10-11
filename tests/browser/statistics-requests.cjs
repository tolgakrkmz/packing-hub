/* Synthetic period races and failures in the real server statistics screen. */
const assert = require('node:assert/strict');
const {statisticsFixture} = require('./statistics-period.cjs');
async function exerciseStatisticsRequests({page,base,expect,replace}) {
  console.log('RUN targeted period requests, out-of-order responses, retry and annual freshness');
  const documents = statisticsFixture();
  await replace(documents);
  await page.goto(base+'/statistics');
  await page.locator('[data-hub-language=bg]').click();
  await expect(page.locator('#statsFilesStatus')).toHaveText('4/4 свързани');
  await expect(page.locator('#dashboardActual')).toHaveText('3 т');
  assert.deepEqual(await page.evaluate(() => entries.map(entry => entry.id)),documents['production-log'].entries.slice(0,2).map(entry => entry.id));
  assert.equal(await page.evaluate(() => aggregateByYear().reduce((sum,row) => sum+row.tonnage,0)),9000);
  await page.evaluate(() => {
    const fetch = window.fetch;
    const test = window.__periodRequests = {urls:[],block:true,fail:false};
    test.restore = () => { window.fetch = fetch; };
    window.fetch = async (...args) => {
      const url = String(args[0]); test.urls.push(url);
      if (test.fail && url.includes('/period/production-log?month=2026-09')) throw new TypeError('Fictional request failure');
      const response = await fetch(...args);
      if (test.block && url.includes('/period/production-log?month=2026-09')) await new Promise(resolve => { test.release = resolve; });
      return response;
    };
  });
  try {
    const month = page.locator('#dashboardMonthSelect');
    await month.selectOption('09');
    await page.waitForFunction(() => window.__periodRequests.release);
    // A scope change must still wait for outstanding monthly source reads.
    await page.locator('[data-stats-tab=production]').click();
    await page.locator('[data-view=year]').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#statsPeriodStatus')).toBeVisible();
    await page.locator('[data-view=month]').click();
    await month.selectOption('10');
    await expect(page.locator('#statsPeriodStatus')).toBeHidden();
    await expect(page.locator('#dashboardActual')).toHaveText('3 т');
    await page.evaluate(() => { const test = window.__periodRequests; test.block = false; test.release(); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#dashboardActual')).toHaveText('3 т');
    assert.equal(await page.evaluate(() => entries.every(entry => entry.date.startsWith('2026-10'))),true);
    await page.evaluate(() => { window.__periodRequests.fail = true; window.__periodRequests.accepted = entries; });
    await month.selectOption('09');
    await expect(page.locator('#statsPeriodStatus')).toHaveText('Периодът не е обновен изцяло. Опитай „Опресни“.');
    assert.equal(await page.evaluate(() => entries === window.__periodRequests.accepted),true);
    await expect(page.locator('#connDot')).toHaveClass(/\boff\b/);
    await page.evaluate(() => { window.__periodRequests.fail = false; });
    await page.locator('#statsFilesBtn').click(); await page.locator('#refreshBtn').click(); await page.locator('#statsFilesBtn').click();
    await expect(page.locator('#statsPeriodStatus')).toBeHidden();
    await expect(page.locator('#dashboardActual')).toHaveText('1 т');
    await month.selectOption('10');
    await expect(page.locator('#statsPeriodStatus')).toBeHidden();
    await page.evaluate(() => { window.__periodRequests.accepted = entries; window.__periodRequests.monthly = document.getElementById('monthlyTrendChart').firstElementChild; });
    documents['production-log'].entries[3].tonnage += 1000;
    await replace(documents);
    await page.evaluate(async () => { await sync.refreshFromDisk(); });
    assert.equal(await page.evaluate(() => aggregateByYear().reduce((sum,row) => sum+row.tonnage,0)),10000);
    assert.equal(await page.evaluate(() => entries === window.__periodRequests.accepted && document.getElementById('monthlyTrendChart').firstElementChild === window.__periodRequests.monthly),true);
    const urls = await page.evaluate(() => window.__periodRequests.urls);
    assert.equal(urls.some(url => url.startsWith('/api/statistics/data/')),false);
    for (const kind of ['production-log','line-downtime','pair-targets']) assert.ok(urls.some(url => url.startsWith('/api/statistics/period/'+kind+'?')));
    console.log('PASS month-only reports, exact annual totals, latest-period wins, retained failed snapshot and manual retry');
  } finally { await page.evaluate(() => { window.__periodRequests.restore(); delete window.__periodRequests; }); }
}
module.exports = {exerciseStatisticsRequests};
