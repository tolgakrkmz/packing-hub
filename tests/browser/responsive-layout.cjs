/* Responsive regressions use only generated fictional data and isolated browser storage. */
const assert = require('node:assert/strict');
const {installStorage} = require('./storage.cjs');
const {assertResponsive} = require('./responsive.cjs');

async function assertTouchTarget(locator, description) {
  const rect = await locator.boundingBox();
  assert.ok(rect && rect.width >= 43 && rect.height >= 43, description + ': usable touch target');
}

async function exerciseOfflineResponsiveLayouts(browser, base, expect) {
  const context = await browser.newContext({timezoneId:'Europe/Sofia', viewport:{width:320,height:568}, isMobile:true, hasTouch:true});
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await context.addInitScript(installStorage, {});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', () => errors.push('Responsive application error'));
  page.setDefaultTimeout(8000);
  await page.clock.setFixedTime(new Date('2026-10-05T08:30:00+03:00'));
  const failures = [];
  async function check(name, work) {
    try { await work(); console.log('PASS ' + name); }
    catch(error) { failures.push(name + ': ' + error.message); }
  }
  const go = async module => {
    await page.goto(base + '/' + module + '.html');
    await page.evaluate(() => window.__browserTest.ready);
  };
  const connect = async (button, file, dot = '#connDot') => {
    await page.evaluate(file => { window.__browserTest.nextFile = file; }, file);
    await page.locator(button).click();
    await expect(page.locator(dot)).toHaveClass(/\bon\b/);
  };
  try {
    await go('line-downtime');
    const longReason = 'Fictional' + 'LongToken'.repeat(20);
    await page.evaluate(async reason => {
      await window.__browserTest.write('line-downtime.json', {entries:[], reasons:[reason]});
    }, longReason);
    await connect('#openFileBtn', 'line-downtime.json');
    for (const language of ['bg', 'en']) {
      await page.locator(`[data-hub-language=${language}]`).click();
      await check('Downtime long reason fits ' + language, async () => {
        await expect(page.locator('.reason-chip')).toContainText(longReason);
        await assertResponsive(page, 'Downtime long reason ' + language + ' 320px');
        await assertTouchTarget(page.locator('.reason-chip button'), 'Reason delete');
      });
    }
    await check('History navigation has usable touch target', () => assertTouchTarget(page.locator('.history-note a'), 'Report history link'));
    await go('statistics');
    for (const language of ['bg', 'en']) {
      await page.locator(`[data-hub-language=${language}]`).click();
      for (const width of [320, 390, 600, 601, 650, 651, 768, 1024, 1440]) {
        await page.setViewportSize({width, height:900});
        await check('Statistics navigation fits ' + language + ' ' + width + 'px', async () => {
          await assertResponsive(page, 'Statistics ' + language + ' ' + width + 'px');
          const clipped = await page.locator('.stats-navigation button').evaluateAll(buttons => buttons.some(button => button.scrollWidth > button.clientWidth + 1));
          assert.equal(clipped, false, 'Statistics navigation labels stay within their buttons');
        });
      }
    }
    await page.setViewportSize({width:320, height:568});
    await go('personnel');
    await connect('#openFileBtn', 'personnel.json');
    await check('Wide schedule scrolls within the page', async () => {
      await assertResponsive(page, 'Personnel schedule 320px');
      const scroll = await page.locator('.sched-scroll').evaluate(element => {
        element.scrollLeft = element.scrollWidth;
        return {width:element.clientWidth, content:element.scrollWidth, left:element.scrollLeft};
      });
      assert.ok(scroll.content > scroll.width && scroll.left > 0, 'Wide schedule remains horizontally reachable inside its container');
    });
    await page.locator('#addPersonBtn').click();
    await page.locator('#personName').fill('Demo Fictional Responsive Person');
    for (const viewport of [{width:320,height:568}, {width:844,height:390}, {width:667,height:320}]) {
      await page.setViewportSize(viewport);
      await check('Personnel dialog usable ' + viewport.width + 'x' + viewport.height, async () => {
        await assertResponsive(page, 'Personnel dialog ' + viewport.width + 'x' + viewport.height);
        await page.locator('#personForm button[type=submit]').scrollIntoViewIfNeeded();
        const rect = await page.locator('#personForm button[type=submit]').boundingBox();
        assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= viewport.height + 1, 'Dialog save remains reachable by scrolling');
        await expect(page.locator('#personName')).toHaveValue('Demo Fictional Responsive Person');
      });
    }
    await page.setViewportSize({width:320,height:568});
    await go('pair-targets');
    await page.evaluate(async () => {
      await window.__browserTest.write('pair-targets.json', {
        module:'pair-targets', schemaVersion:1, entries:[{
          id:'demo-responsive-history', date:'2026-10-04', team:'А', shiftCode:1,
          members:[1,2].map(id => ({id:'demo-responsive-member-' + id, name:'Demo Responsive Person ' + id, category:'auto', role:'Опаковчик'})),
          areas:['auto'], targetKg:1000, targetCrates:40,
          result:{kg:1100, crates:44, reasonKey:'', reasonText:'', reportedAt:'2026-10-04T12:00:00Z'},
          createdAt:'2026-10-04T06:00:00Z', updatedAt:'2026-10-04T12:00:00Z'
        }]
      });
    });
    await connect('#pairsOpenFileBtn', 'pair-targets.json', '#pairsConnDot');
    await expect(page.locator('#rosterConnDot')).toHaveClass(/\bon\b/);
    await check('Roster disclosure has usable touch target', () => assertTouchTarget(page.locator('#rosterSummary'), 'Roster disclosure'));
    await page.locator('#rosterSummary').click();
    assert.equal(await page.locator('.roster-details').evaluate(element => element.open), true, 'Roster disclosure opens');
    await check('Pair history disclosure remains usable', async () => {
      // The monthly history is collapsed and rendered only after it is opened.
      await assertTouchTarget(page.locator('#historyDetails > summary'), 'Pair history section');
      await page.locator('#historyDetails > summary').click();
      await assertTouchTarget(page.locator('.history-group > summary'), 'Pair history disclosure');
      await page.locator('.history-group > summary').click();
      await expect(page.locator('.history-group .pair-card')).toBeVisible();
      await assertResponsive(page, 'Expanded pair history 320px');
    });
    assert.deepEqual(errors, [], 'No responsive application errors');
    assert.deepEqual(failures, [], 'Responsive layout regressions:\n' + failures.join('\n'));
  } finally { await context.close(); }
}

module.exports = {exerciseOfflineResponsiveLayouts};
