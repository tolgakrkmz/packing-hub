/* Server guidance is checked on empty fictional modules, without opening local files. */
const assert = require('node:assert/strict');

async function exerciseConnectionCopy({admin: page, base, expect}) {
  for (const module of ['production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions', 'statistics']) {
    await page.goto(base + '/' + module);
    if (module === 'statistics') {
      await expect(page.locator('#statsFilesBtn')).toContainText('Връзка');
      await page.locator('#statsFilesBtn').click();
    }
    await expect(page.locator('#connPanel .conn-dot.on')).toHaveCount(module === 'statistics' ? 4 : module === 'pair-targets' ? 2 : 1);
    const toggle = page.locator('#connPanel .conn-panel-toggle');
    await expect(toggle).toContainText('Връзка с общата база');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    for (const language of ['bg', 'en']) {
      await page.locator(`[data-hub-language=${language}]`).click();
      await expect(toggle).toContainText(language === 'bg' ? 'Връзка с общата база' : 'Shared database connection');
      const guidance = await page.locator('#connPanel').innerText();
      assert.doesNotMatch(guidance, /\.json|мрежов|network folder/i, module + ': server panel explains database access');
      await expect(page.locator('#connPanel button:visible').filter({hasText: language === 'bg' ? 'Опресни' : 'Refresh'})).not.toHaveCount(0);
      if (module === 'production-log') {
        await expect(page.locator('.note[data-server-text]')).toContainText(language === 'bg' ? 'общата база' : 'shared database');
      }
    }
    await page.locator('[data-hub-language=bg]').click();
  }
  console.log('PASS shared database guidance, connection controls and BG/EN across six modules');

  const failedRead = route => {
    const path = new URL(route.request().url()).pathname;
    if (['/api/data/personnel', '/api/statistics/workforce', '/api/data/pair-targets', '/api/pair-roster', '/api/data/package-instructions'].includes(path) || /^\/api\/statistics\/(period|data)\/(line-downtime|pair-targets)/.test(path)) {
      return route.fulfill({status: 503, json: {error: 'FICTIONAL_UNAVAILABLE'}});
    }
    return route.continue();
  };
  await page.route('**/api/**', failedRead);
  await page.goto(base + '/personnel');
  await expect(page.locator('#connPanel .conn-dot.off')).toHaveCount(1);
  await expect(page.locator('#rosterEmptyState')).toBeVisible();
  const failures = [];
  for (const language of ['bg', 'en']) {
    await page.locator(`[data-hub-language=${language}]`).click();
    const guidance = await page.locator('#rosterEmptyState').innerText();
    if (/файл|file|\.json|network folder/i.test(guidance) || !guidance.includes(language === 'bg' ? 'Опресни' : 'Refresh')) failures.push('personnel/' + language);
  }
  await page.locator('[data-hub-language=bg]').click();
  for (const [module, selector, disconnected] of [['pair-targets', '#contextNote', 2], ['package-instructions', '#resultsWrap', 1]]) {
    await page.goto(base + '/' + module);
    await expect(page.locator('#connPanel .conn-dot.off')).toHaveCount(disconnected);
    for (const language of ['bg', 'en']) {
      await page.locator(`[data-hub-language=${language}]`).click();
      const guidance = await page.locator(selector).innerText();
      if (/файл|file|\.json|папк|folder/i.test(guidance) || !guidance.includes(language === 'bg' ? 'Опресни' : 'Refresh')) failures.push(module + '/' + language);
    }
    await page.locator('[data-hub-language=bg]').click();
  }
  await page.goto(base + '/statistics');
  await page.locator('#statsFilesBtn').click();
  await expect(page.locator('#connPanel .conn-dot.off')).toHaveCount(3);
  for (const language of ['bg', 'en']) {
    await page.locator(`[data-hub-language=${language}]`).click();
    for (const [tab, selector] of [['workforce', '#wfNoData'], ['downtime', '#avHint'], ['pairs', '#pairStatsHint']]) {
      await page.locator(`[data-stats-tab=${tab}]`).click();
      await expect(page.locator(selector)).toBeVisible();
      const guidance = await page.locator(selector).innerText();
      if (/файл|file|\.json|network folder/i.test(guidance) || !guidance.includes(language === 'bg' ? 'Опресни' : 'Refresh')) failures.push(tab + '/' + language);
      if (tab === 'pairs' && /файл|file|\.json/i.test(await page.locator('#pairStatsBody').innerText())) failures.push('pairs body/' + language);
    }
  }
  assert.deepEqual(failures, [], 'Initial failed reads offer server recovery rather than local file actions');
  await page.unroute('**/api/**', failedRead);
  await page.locator('[data-hub-language=bg]').click();
  await page.locator('#personnelRefreshBtn').click();
  await page.locator('#avRefreshBtn').click();
  await page.locator('#pairStatsRefreshBtn').click();
  await expect(page.locator('#connPanel .conn-dot.on')).toHaveCount(4);
  await page.locator('[data-stats-tab=workforce]').click();
  await expect(page.locator('#wfNoData')).toContainText('Съставът в общата база е празен.');
  await expect(page.locator('#wfStaffSource')).toHaveText('празен');
  await page.locator('[data-hub-language=en]').click();
  await expect(page.locator('#wfNoData')).toContainText('The shared database has no personnel.');
  await expect(page.locator('#wfStaffSource')).toHaveText('empty');
  await page.locator('[data-hub-language=bg]').click();
  await page.locator('[data-stats-tab=downtime]').click();
  await expect(page.locator('#avHint')).not.toContainText('още не са заредени');
  await page.goto(base + '/personnel');
  await expect(page.locator('#rosterEmptyState')).toBeHidden();
  console.log('PASS initial failed reads, BG/EN database recovery guidance and successful retry');
}

module.exports = {exerciseConnectionCopy};
