/* Serve reviewed demo assets only; never run against production files or a personal browser profile. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const {inspect, privateTokens} = require('./check-publication.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const {chromium} = require('playwright');
  const {expect} = require('playwright/test');
  const {run} = require('../tests/browser/workflows.cjs');
  const {exerciseOfflineSystemStatus} = require('../tests/browser/system-status.cjs');
  const {installStorage} = require('../tests/browser/storage.cjs');
  const {statisticsFixture, exerciseStatisticsPeriod, changedSources} = require('../tests/browser/statistics-period.cjs');
  const {exerciseOfflineTransfer} = require('../tests/browser/data-transfer.cjs');
  const tokens = privateTokens(process.env.PACKAGE_HUB_PRIVATE_SOURCE || path.resolve(root, '../..'));
  // In-memory, exact-path allowlist: neither URL traversal nor new files can expose local data.
  const assets = new Map();
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: root}).toString().split('\0');
  for (const file of files) {
    if (file !== 'assets/package-hub-mark.svg' && !/^[a-z-]+\.html$|^(?:js|css)\/[a-z0-9/-]+\.(?:js|css)$/.test(file)) continue;
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error('Only regular demo source files may be served: ' + file);
    const content = fs.readFileSync(path.join(root, file));
    inspect(file, content, tokens);
    assets.set('/' + file, content);
  }
  for (const [name, content] of assets) if (name.endsWith('.html')) {
    for (const match of content.toString('utf8').matchAll(/<script\b[^>]*\bsrc="(js\/[a-z0-9-]+\.js)"/g)) {
      if (!assets.has('/' + match[1])) throw new Error('Stage the reviewed demo script before running browser tests: ' + match[1]);
    }
  }
  // The pinned fictional seed fingerprint also prevents accidentally serving the production checkout.
  inspect('js/employees-seed.js', fs.readFileSync(path.join(root, 'js/employees-seed.js')), tokens);
  const server = http.createServer((request, response) => {
    const name = request.url === '/' ? '/index.html' : request.url;
    const body = assets.get(name);
    response.writeHead(body ? 200 : 404, {
      'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name === '/assets/package-hub-mark.svg' ? 'image/svg+xml; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(request.method === 'HEAD' ? undefined : body || 'Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const headed = !process.argv.includes('--headless');
    browser = await chromium.launch({channel: 'chrome', headless: !headed, slowMo: headed ? 350 : 0});
    if (process.argv.includes('--transfer-only')) {
      await exerciseOfflineTransfer(browser, `http://127.0.0.1:${server.address().port}`, expect); return;
    }
    if (process.argv.includes('--statistics-only')) {
      const context = await browser.newContext({timezoneId:'Europe/Sofia'});
      const base = `http://127.0.0.1:${server.address().port}`;
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      await context.addInitScript(installStorage, {});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-05T08:30:00+03:00'));
      await page.goto(base + '/statistics.html');
      await page.evaluate(() => window.__browserTest.ready);
      const write = documents => page.evaluate(async documents => {
        for (const [kind, data] of Object.entries(documents)) await window.__browserTest.write(kind + '.json', data);
      }, documents);
      await write(statisticsFixture());
      await page.locator('#statsFilesBtn').click();
      for (const [button, kind, dot] of [
        ['pairStatsOpenFileBtn','pair-targets','pairStatsConnDot'], ['openFileBtn','production-log','connDot'],
        ['avOpenFileBtn','line-downtime','avConnDot'], ['personnelOpenFileBtn','personnel','personnelConnDot']
      ]) {
        await page.evaluate(kind => { window.__browserTest.nextFile = kind + '.json'; }, kind);
        await page.locator('#' + button).click();
        await expect(page.locator('#' + dot)).toHaveClass(/\bon\b/);
        if (kind === 'pair-targets') {
          await expect(page.locator('#yearSelect option[value="2025"]')).toHaveCount(1);
          await expect(page.locator('#dashboardMonthSelect')).toHaveValue('10');
          await expect(page.locator('#monthlyResultEmpty')).toBeVisible();
        }
      }
      await page.locator('#statsFilesBtn').click();
      await exerciseStatisticsPeriod({page, expect,
        screenshotDir:process.argv.find(value => value.startsWith('--screenshots='))?.slice('--screenshots='.length),
        replaceSources:async () => {
          await write(changedSources());
          await page.locator('#statsFilesBtn').click();
          await page.locator('#refreshBtn').click();
          await page.locator('#pairStatsRefreshBtn').click();
        }
      });
      require('node:assert/strict').deepEqual(errors, []);
      await context.close(); return;
    }
    await run(browser, `http://127.0.0.1:${server.address().port}`, {headed});
    await exerciseOfflineSystemStatus(browser, `http://127.0.0.1:${server.address().port}`, expect);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
