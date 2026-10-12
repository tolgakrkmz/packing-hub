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
}

module.exports = {exerciseConnectionCopy};
