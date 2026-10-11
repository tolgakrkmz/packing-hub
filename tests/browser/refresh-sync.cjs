/* Real DOM and synthetic visibility signals; only generated demo records. */
const assert = require('node:assert/strict');
const {statisticsFixture} = require('./statistics-period.cjs');
async function exerciseRefreshSync({page, expect, replace, online}) {
  console.log('RUN unchanged refresh, concurrent reads, hidden-page pause and visible catch-up');
  const data = statisticsFixture()['production-log'];
  await replace(data);
  await page.evaluate(async () => { await sync.refreshFromDisk(); });
  await page.locator('[data-hub-language=bg]').click();
  await page.locator('#dashboardMonthSelect').selectOption('10');
  await expect(page.locator('#dashboardActual')).toHaveText('3 т');
  await page.evaluate(online => {
    const test = window.__refreshTest = {reads:0, block:true, hidden:false};
    Object.defineProperty(document,'hidden',{configurable:true,get:() => test.hidden});
    test.nodes = ['chartContainer','tableContainer','monthlyTrendChart','wfCapacityChart'].map(id => document.getElementById(id).firstElementChild);
    test.entries = entries;
    if (online) {
      const fetch = window.fetch;
      test.restore = () => { window.fetch = fetch; };
      window.fetch = async (...args) => {
        const response = await fetch(...args);
        if (args[0] === '/api/statistics/data/production-log') {
          test.reads++;
          if (test.block) await new Promise(resolve => { test.release = resolve; });
        }
        return response;
      };
    } else {
      const handle = sync.fileHandle, getFile = handle.getFile.bind(handle);
      test.restore = () => { delete handle.getFile; };
      handle.getFile = async () => {
        const file = await getFile(); test.reads++;
        if (test.block) await new Promise(resolve => { test.release = resolve; });
        return file;
      };
    }
    test.work = Promise.all([sync.refreshFromDisk(),sync.refreshFromDisk(),sync.refreshFromDisk()]);
  }, online);
  try {
    await page.waitForFunction(() => window.__refreshTest.release);
    assert.equal(await page.evaluate(() => window.__refreshTest.reads),1);
    await page.evaluate(async () => { const test = window.__refreshTest; test.block = false; test.release(); await test.work; });
    assert.equal(await page.evaluate(() => {
      const ids = ['chartContainer','tableContainer','monthlyTrendChart','wfCapacityChart'];
      return entries === window.__refreshTest.entries && ids.every((id,i) => document.getElementById(id).firstElementChild === window.__refreshTest.nodes[i]);
    }),true);
    await page.evaluate(() => { window.__refreshTest.hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    data.entries[0].tonnage += 1000;
    await replace(data);
    await page.clock.runFor(60000);
    assert.equal(await page.evaluate(() => window.__refreshTest.reads),1);
    await expect(page.locator('#dashboardActual')).toHaveText('3 т');
    await page.evaluate(() => { window.__refreshTest.hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('#dashboardActual')).toHaveText('4 т');
    assert.equal(await page.evaluate(() => window.__refreshTest.reads),2);
    await page.locator('[data-hub-language=en]').click();
    await expect(page.locator('#dashboardActual')).toHaveText('4 t');
    await page.evaluate(() => { window.__refreshTest.previousDay = getMonthlyDashboardData(); window.__refreshTest.entries = entries; });
    await page.clock.setFixedTime(new Date('2026-10-07T08:30:00+03:00'));
    await page.evaluate(async () => { await sync.refreshFromDisk(); });
    assert.equal(await page.evaluate(() => entries === window.__refreshTest.entries &&
      getMonthlyDashboardData() !== window.__refreshTest.previousDay && getMonthlyDashboardData().elapsedDays === 7),true);
    console.log('PASS one concurrent read, retained unchanged DOM, no hidden reads, fresh visible BG/EN results and unchanged-data day rollover');
  } finally {
    await page.evaluate(() => { window.__refreshTest.restore(); delete document.hidden; delete window.__refreshTest; });
  }
}
async function exerciseTaskRefresh({page, base, expect}) {
  console.log('RUN task refresh coalescing, retained cards and draft protection');
  await page.goto(base+'/tasks');
  await page.locator('[data-hub-language=bg]').click();
  await expect(page.locator('#taskSubtitle')).toContainText('Възлагай');
  await page.locator('#taskTabs [data-view=global]').click();
  await expect(page.locator('.task-card').first()).toBeVisible();
  await page.evaluate(() => {
    const test = window.__taskRefreshTest = {reads:0, block:true, hidden:false, node:document.getElementById('taskContent').firstElementChild};
    Object.defineProperty(document,'hidden',{configurable:true,get:() => test.hidden});
    const fetch = window.fetch;
    test.restore = () => { window.fetch = fetch; };
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (args[0] === '/api/tasks') { test.reads++; if (test.block) await new Promise(resolve => { test.release = resolve; }); }
      return response;
    };
    document.getElementById('refreshTasks').click(); document.getElementById('refreshTasks').click(); document.getElementById('refreshTasks').click();
  });
  try {
    await page.waitForFunction(() => window.__taskRefreshTest.release);
    assert.equal(await page.evaluate(() => window.__taskRefreshTest.reads),1);
    await page.evaluate(() => { const test = window.__taskRefreshTest; test.block = false; test.release(); });
    // Let the awaited response and rendering finish before comparing the nodes.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.__taskRefreshTest.node === document.getElementById('taskContent').firstElementChild),true);
    await page.locator('#newTask').click(); await page.locator('#taskTitle').fill('Fictional protected draft');
    await page.evaluate(() => { document.getElementById('refreshTasks').click(); });
    assert.equal(await page.evaluate(() => window.__taskRefreshTest.reads),1);
    await expect(page.locator('#taskTitle')).toHaveValue('Fictional protected draft');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__taskRefreshTest.reads)).toBe(2);
    await page.evaluate(() => { window.__taskRefreshTest.hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(60000);
    assert.equal(await page.evaluate(() => window.__taskRefreshTest.reads),2);
    await page.evaluate(() => { window.__taskRefreshTest.hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => page.evaluate(() => window.__taskRefreshTest.reads)).toBe(3);
    console.log('PASS task concurrent request count, retained cards, draft protection and hidden-page pause');
  } finally {
    await page.evaluate(() => { window.__taskRefreshTest.restore(); delete document.hidden; delete window.__taskRefreshTest; });
  }
}
module.exports = {exerciseRefreshSync, exerciseTaskRefresh};
