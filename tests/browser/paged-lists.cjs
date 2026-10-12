/* Generated fictional lists only; no production imports, screenshots or traces. */
const assert = require('node:assert/strict');
const {installStorage} = require('./storage.cjs');
const {assertResponsive} = require('./responsive.cjs');

function historyFixture() {
  return {goalTons: 100, entries: ['10', '09', '08'].flatMap(month => Array.from({length: 35}, (_, i) => ({
    id: `demo-page-report-${month}-${i}`, date: `2026-${month}-05`, shift: 'А', tonnage: 1000, brak: 10, breakdown: null
  })))};
}
function profilesFixture() {
  return Object.fromEntries(Array.from({length: 105}, (_, i) => [String(i), {
    number: String(i), name: `Fictional profile ${i}`, client: 'Fictional customer', folderName: `Demo-${i}`,
    category: i % 2 ? 'special' : 'standard', timestamp: i, images: []
  }]));
}
async function historyChecks({page, expect, replace, read, online = false}) {
  const month = key => page.locator(`.history-month[data-month="2026-${key}"]`);
  await expect(page.locator('.history-month')).toHaveCount(3);
  await expect(month('10')).toHaveAttribute('open', '');
  await expect(page.locator('.history-month tbody tr')).toHaveCount(35);
  await expect(month('09').locator('table')).toHaveCount(0);
  await expect(month('09').locator('summary')).toContainText('35 записа');
  await expect(month('09').locator('summary b')).toContainText('35');
  await month('09').locator('summary').click();
  await expect(month('09').locator('tbody tr')).toHaveCount(35);
  await month('10').locator('summary').click();
  await expect(month('10').locator('table')).toHaveCount(0);
  const updated = historyFixture();
  updated.entries.push({id: 'demo-page-added', date: '2026-09-06', shift: 'Б', tonnage: 2000, brak: 20, breakdown: null});
  await replace(updated);
  await expect(month('09').locator('tbody tr')).toHaveCount(36);
  await expect(month('10').locator('table')).toHaveCount(0);
  await expect(month('09').locator('summary')).toContainText('36 записа');
  await month('09').locator('[data-id=demo-page-added].del-btn').click();
  await expect.poll(async () => (await read()).entries.length).toBe(105);
  await expect(month('09').locator('tbody tr')).toHaveCount(35);
  await month('09').locator('summary').click();
  await expect(month('09').locator('table')).toHaveCount(0);
  await month('09').locator('summary').click();
  await expect(month('09').locator('tbody tr')).toHaveCount(35);
  if (online) {
    await month('09').locator('.edit-report-btn').first().click();
    await expect(page.locator('#tonInput')).toHaveValue('1000');
    await expect(page.locator('#dateInput')).toHaveValue('2026-09-05');
  }
  await page.locator('[data-hub-language=en]').click();
  await expect(month('09').locator('th').first()).toHaveText('Date');
}
async function profileChecks({page, expect, replace}) {
  const cards = page.locator('.result-card'), pager = page.locator('#profilePagination');
  const next = () => pager.locator('[data-page-action=next]');
  await expect(cards).toHaveCount(50);
  await expect(pager).toContainText('1–50 от 105');
  const found = new Set(await cards.evaluateAll(nodes => nodes.map(node => node.dataset.number)));
  await next().focus(); await page.keyboard.press('Enter');
  await expect(pager).toContainText('51–100 от 105');
  await expect(next()).toBeFocused();
  (await cards.evaluateAll(nodes => nodes.map(node => node.dataset.number))).forEach(id => found.add(id));
  await cards.first().locator('.result-head').click();
  await expect(cards.first().locator('.result-text')).toHaveText('Fictional page two instructions');
  await page.locator('[data-hub-language=en]').click();
  await expect(pager).toContainText('Page 2 of 3');
  await expect(cards.first()).toHaveClass(/open/);
  await expect(cards.first().locator('.result-text')).toHaveText('Fictional page two instructions');
  await page.locator('#searchInput').fill('Fictional profile 54');
  // Open the still-visible result before the search timer fires.
  await cards.first().locator('.result-head').evaluate(node => node.click());
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('.result-text')).toHaveText('Fictional page two instructions');
  await page.locator('#searchInput').fill(''); await expect(cards).toHaveCount(50); await next().click();
  await next().click();
  await expect(cards).toHaveCount(5);
  (await cards.evaluateAll(nodes => nodes.map(node => node.dataset.number))).forEach(id => found.add(id));
  assert.equal(found.size, 105, 'Every profile remains reachable without duplicates');
  await expect(next()).toBeDisabled();
  await expect(pager.locator('.hub-page-status')).toBeFocused();
  await page.locator('#searchInput').fill('Fictional profile 100');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute('data-number', '100');
  await expect(pager).toContainText('Page 1 of 1');
  await page.locator('#searchInput').fill('no-fictional-match');
  await expect(cards).toHaveCount(0);
  await expect(pager).toHaveCount(0);
  await page.locator('#searchInput').fill('');
  await page.locator('[data-cat=special]').click();
  await expect(pager).toContainText('1–50 of 52');
  await next().click(); await expect(cards).toHaveCount(2);
  await page.locator('[data-cat=""]').click();
  await expect(pager).toContainText('Page 1 of 3');
  await next().click(); await next().click();
  await replace(Object.fromEntries(Object.entries(profilesFixture()).slice(0, 3)));
  await expect(cards).toHaveCount(3);
  await expect(pager).toContainText('Page 1 of 1');
  for (const language of ['bg', 'en']) {
    await page.locator(`[data-hub-language=${language}]`).click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({width, height: 900}); await assertResponsive(page, 'Fictional profile pagination');
    }
  }
}
async function exerciseOfflinePagedLists(browser, base, expect) {
  const context = await browser.newContext({timezoneId: 'Europe/Sofia'}), errors = [];
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await context.addInitScript(installStorage, {});
  const page = await context.newPage(); page.on('pageerror', () => errors.push('Fictional list page error'));
  await page.clock.setFixedTime(new Date('2026-10-05T08:30:00+03:00'));
  await page.goto(base + '/production-log.html'); await page.evaluate(() => window.__browserTest.ready);
  await page.evaluate(data => window.__browserTest.write('production-log.json', data), historyFixture());
  await page.evaluate(() => { window.__browserTest.nextFile = 'production-log.json'; });
  await page.locator('#openFileBtn').click(); await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await historyChecks({page, expect,
    read: () => page.evaluate(() => window.__browserTest.read('production-log.json')),
    replace: async data => { await page.evaluate(data => window.__browserTest.write('production-log.json', data), data); await page.evaluate(async () => { await sync.refreshFromDisk(); render(); }); }
  });
  await page.goto(base + '/package-instructions.html');
  await page.locator('[data-hub-language=bg]').click();
  await page.evaluate(async data => {
    await window.__browserTest.ready;
    await window.__browserTest.write('packing/data/package-instructions.json', data);
    await window.__browserTest.write('packing/data/profiles/Demo-54/instruction.txt', 'Fictional page two instructions');
  }, profilesFixture());
  await page.locator('#openFileBtn').click(); await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await profileChecks({page, expect, replace: async data => {
    await page.evaluate(data => window.__browserTest.write('packing/data/package-instructions.json', data), data);
    await page.evaluate(() => sync.refreshFromDisk());
  }});
  assert.deepEqual(errors, []); await context.close();
  console.log('PASS offline lazy months, full totals, delete, profile pages, search, filters, refresh, preview and BG/EN mobile controls');
}
async function exerciseServerPagedLists({admin, hub, base, expect}) {
  const manager = hub.auth.list()[0], now = Date.parse('2026-10-05T08:30:00+03:00');
  const writeReports = data => hub.store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(data), 'production-log');
  writeReports(historyFixture()); await admin.goto(base + '/production-log');
  await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
  await historyChecks({page: admin, expect, online: true,
    read: async () => hub.store.get('production-log').data,
    replace: async data => { writeReports(data); await admin.evaluate(async () => { await sync.refreshFromDisk(); render(); }); }
  });
  const insert = hub.store.db.prepare('INSERT INTO task_items(id,data) VALUES(?,?)');
  hub.store.transaction(() => { for (let i = 0; i < 105; i++) {
    const item = {id: `demo-page-task-${i}`, kind: 'global', title: `Fictional paged task ${i}`, description: 'Fictional list test',
      priority: 'normal', requiresPhotos: false, owner: {id: manager.id, username: manager.username, team: 'А'}, participants: [],
      status: 'pending', due: now + i * 60000, createdAt: now, updatedAt: now, events: [], problemPhotos: []};
    insert.run(item.id, JSON.stringify(item));
  }});
  await admin.goto(base + '/tasks'); await admin.locator('[data-view=global]').click();
  await admin.locator('[data-hub-language=en]').click();
  const cards = admin.locator('.task-card'), pager = admin.locator('#taskPagination');
  const next = () => pager.locator('[data-page-action=next]');
  await expect(cards).toHaveCount(50); await expect(pager).toContainText('1–50 of 105');
  await expect(admin.locator('.task-metric strong').first()).toHaveText('105');
  const found = new Set(await cards.evaluateAll(nodes => nodes.map(node => node.dataset.taskId)));
  await next().click(); await expect(pager).toContainText('Page 2 of 3');
  (await cards.evaluateAll(nodes => nodes.map(node => node.dataset.taskId))).forEach(id => found.add(id));
  await cards.first().getByRole('button', {name: 'History', exact: true}).click();
  await expect(admin.locator('#historyContent h3')).toHaveText('Fictional paged task 50');
  await admin.locator('[data-close=taskHistory]').click();
  await admin.locator('#refreshTasks').click(); await expect(pager).toContainText('Page 2 of 3');
  await next().click(); await expect(cards).toHaveCount(5);
  (await cards.evaluateAll(nodes => nodes.map(node => node.dataset.taskId))).forEach(id => found.add(id));
  assert.equal(found.size, 105, 'Every task remains reachable without duplicates');
  await admin.locator('#taskSearch').fill('Fictional paged task 100');
  await expect(cards).toHaveCount(1); await expect(cards.first()).toHaveAttribute('data-task-id', 'demo-page-task-100');
  await admin.locator('#taskSearch').fill('Fictional paged task');
  await expect(cards).toHaveCount(50); await expect(pager).toContainText('Page 1 of 3');
  await admin.locator('[data-view=history]').click();
  await admin.locator('#statsFrom').fill('2026-10-05'); await admin.locator('#statsUntil').fill('2026-10-05');
  await admin.locator('[data-history-view=unreported]').click();
  await expect(admin.locator('[data-history-view=unreported] .task-badge')).toHaveText('105');
  await expect(cards).toHaveCount(50); await next().click();
  await expect(pager).toContainText('Page 2 of 3');
  await admin.locator('#statsFrom').fill('2026-10-01'); await expect(pager).toContainText('Page 1 of 3');
  await admin.locator('[data-view=global]').click(); await next().click(); await next().click();
  hub.store.db.prepare("DELETE FROM task_items WHERE id LIKE 'demo-page-task-%' AND id NOT IN ('demo-page-task-0','demo-page-task-1','demo-page-task-2')").run();
  await admin.locator('#refreshTasks').click(); await expect(cards).toHaveCount(3); await expect(pager).toContainText('Page 1 of 1');
  for (const language of ['bg', 'en']) {
    await admin.locator(`[data-hub-language=${language}]`).click();
    for (const width of [320, 390, 1440]) {
      await admin.setViewportSize({width, height: 900}); await assertResponsive(admin, 'Fictional task pagination');
    }
  }
  console.log('PASS server lazy months, edit/delete, task pages, total counts, history, search, refresh and BG/EN mobile controls');
}
module.exports = {exerciseOfflinePagedLists, exerciseServerPagedLists, profilesFixture};
