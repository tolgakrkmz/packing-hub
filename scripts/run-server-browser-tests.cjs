/* Isolated server + SQLite + real visible browsers. Every account and record is fictional. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {expect: baseExpect} = require('playwright/test');
const {createHubServer} = require('../server/server.cjs');
const expect = baseExpect.configure({timeout: 10000});
const demoPassword = 'Fictional-password-123';
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-online-e2e-'));
  const hub = createHubServer({filename: path.join(dir, 'demo.sqlite'), publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  let browser;
  const errors = [];
  try {
    await hub.auth.create('demo-admin', demoPassword, 'admin');
    await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${hub.server.address().port}`;
    browser = await chromium.launch({channel: 'chrome', headless: process.argv.includes('--headless'), slowMo: process.argv.includes('--headless') ? 0 : 250});
    async function device(username, mobile = false) {
      const context = await browser.newContext({timezoneId: 'Europe/Sofia', ...(mobile ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true} : {})});
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      await context.addInitScript(() => { window.showOpenFilePicker = () => { throw new Error('Online mode must not ask for a local JSON file'); }; });
      const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-05T08:30:00+03:00'));
      await page.goto(base + '/index.html'); await expect(page).toHaveURL(base + '/login.html');
      await page.locator('#username').fill(username); await page.locator('#password').fill(demoPassword);
      await page.locator('[data-hub-language=en]').click(); await expect(page.locator('#loginForm button')).toHaveText('Sign in'); await expect(page.locator('#username')).toHaveValue(username); await expect(page.locator('#password')).toHaveValue(demoPassword);
      await page.locator('[data-hub-language=bg]').click(); await page.locator('#loginForm button').click();
      await expect(page).toHaveURL(base + '/index.html');
      return page;
    }
    console.log('RUN accounts and real browser login');
    const admin = await device('demo-admin');
    await admin.getByRole('link', {name: 'Акаунти', exact: true}).click();
    for (const [username, role] of [['demo-operator', 'operator'], ['demo-observer', 'observer']]) {
      await admin.locator('#accountUsername').fill(username); await admin.locator('#accountPassword').fill(demoPassword); await admin.locator('#accountRole').selectOption(role); await admin.locator('#accountForm button').click();
      await expect(admin.locator('#accountList')).toContainText(username);
    }
    const operator = await device('demo-operator', true), observer = await device('demo-observer', true);
    console.log('PASS accounts and real browser login');
    console.log('RUN operator entry → shared SQLite → observer report updates without reload');
    await observer.goto(base + '/statistics.html'); await expect(observer.locator('#statsContent')).toBeVisible();
    await operator.goto(base + '/production-log.html'); await expect(operator.locator('#connDot')).toHaveClass(/\bon\b/);
    await operator.locator('[data-shift="А"]').click();
    await operator.locator('#dateInput').fill('2026-10-05');
    await operator.locator('#breakdownToggle').check();
    for (const [id, value] of Object.entries({autoKgInput: '2400', autoCrateInput: '96', manKgInput: '600', manCrateInput: '24', brakInput: '30'})) await operator.locator('#' + id).fill(value);
    await operator.locator('#saveBtn').click(); await expect(operator.locator('#msg')).toContainText('Записано');
    await expect(observer.locator('#dashboardActual')).toHaveText('3,0 т');
    assert.equal(hub.store.get('production-log').data.entries[0].tonnage, 3000);
    await observer.locator('[data-stats-tab=production]').click(); await expect(observer.locator('#tableContainer')).toContainText('3000 кг');
    await observer.locator('[data-stats-tab=downtime]').click();
    await operator.goto(base + '/line-downtime.html'); await expect(operator.locator('#connDot')).toHaveClass(/\bon\b/);
    await operator.locator('[data-shift="А"]').click(); await operator.locator('#dateInput').fill('2026-10-05'); await operator.locator('#startInput').fill('23:45'); await operator.locator('#endInput').fill('00:15'); await operator.locator('#otherReasonInput').fill('Fictional online midnight downtime'); await operator.locator('#saveBtn').click();
    await expect(operator.locator('#msg')).toContainText('Записано'); await expect(observer.locator('#avKpiRow')).toContainText('0,5 ч');
    console.log('PASS operator entry → shared SQLite → observer report updates without reload');
    console.log('RUN personnel, Stickers pair planning/reporting and live pair statistics');
    await admin.goto(base + '/personnel.html'); await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
    for (const name of ['Demo Online Packer One', 'Demo Online Packer Two']) {
      await admin.locator('#addPersonBtn').click(); await admin.locator('#personName').fill(name); await admin.locator('#personCategory').selectOption('stickers'); await admin.locator('#personRole').selectOption('Опаковчик'); await admin.locator('#personForm button[type=submit]').click(); await expect(admin.locator('#personModal')).not.toHaveClass(/open/);
    }
    await operator.goto(base + '/personnel.html'); await expect(operator.locator('#peopleWrap')).toContainText('Demo Online Packer One'); await expect(operator.locator('#addPersonBtn')).toBeHidden();
    await observer.locator('[data-stats-tab=pairs]').click();
    await operator.goto(base + '/pair-targets.html'); await expect(operator.locator('#pairsConnDot')).toHaveClass(/\bon\b/); await operator.locator('#stickersShiftBtn').click(); await operator.locator('#addPairBtn').click();
    const employees = hub.store.get('personnel').data.employees;
    await operator.locator('#memberOne').selectOption(employees[0].id); await operator.locator('#memberTwo').selectOption(employees[1].id); await operator.locator('#targetKg').fill('1000'); await operator.locator('#targetCrates').fill('40'); await operator.locator('#areaManual').check(); await operator.locator('#savePairBtn').click();
    await expect(operator.locator('#pairsList')).toContainText('Очаква отчет'); await operator.locator('#pairsList [data-action=report]').click(); await operator.locator('#actualKg').fill('1100'); await operator.locator('#actualCrates').fill('44'); await operator.locator('#savePairBtn').click(); await expect(operator.locator('#pairsList')).toContainText('Постигнат');
    await expect(observer.locator('#pairStatsBody')).toContainText(/1\s?100\s*\/\s*1\s?000/); await expect(observer.locator('#dashboardActual')).toHaveText('3,0 т');
    console.log('PASS personnel, Stickers pair planning/reporting and live pair statistics');
    console.log('RUN shared packing instructions and attachments → phone reads them');
    await admin.goto(base + '/package-instructions.html'); await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/); await admin.locator('#addBtn').click(); await admin.locator('#numberInput').fill('900101'); await admin.locator('#nameInput').fill('Demo Online Box'); await admin.locator('#categoryInput').selectOption('standard'); await admin.locator('#textInput').fill('Fictional instruction from the shared database.');
    await admin.locator('#imageFileInput').setInputFiles({name: 'demo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="blue"/></svg>')});
    await admin.locator('#saveBtn').click(); await expect(admin.locator('#formPanel')).toBeHidden();
    await observer.goto(base + '/package-instructions.html'); await expect(observer.locator('#connDot')).toHaveClass(/\bon\b/); await expect(observer.locator('#addBtn')).toBeHidden(); await observer.locator('#searchInput').fill('900101'); await observer.locator('.result-head').click(); await expect(observer.locator('.result-text')).toHaveText('Fictional instruction from the shared database.'); await expect(observer.locator('.cat-select')).toBeHidden(); await observer.locator('.gallery img').click(); await expect(observer.locator('#lightbox')).toHaveClass(/open/);
    console.log('PASS shared packing instructions and attachments → phone reads them');
    console.log('RUN production history import → live report, duplicate prevention and stale preview protection');
    await observer.goto(base + '/statistics.html'); await expect(observer.locator('#dashboardActual')).toHaveText('3,0 т');
    await admin.getByRole('link', {name: 'Импорт на тонаж', exact: true}).click();
    const history = {goalTons: 9000, entries: [{id: 'demo-import-history', date: '2026-10-04', shift: 'А', tonnage: 2000, brak: 20, breakdown: null}]};
    const select = data => admin.locator('#importFile').setInputFiles({name: 'production-log.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data))});
    await select(history); await admin.locator('#previewImport').click(); await expect(admin.locator('[data-field=added]')).toHaveText('1');
    await admin.locator('#applyImport').click(); await expect(admin.locator('#importMessage')).toContainText('Импортът е завършен');
    await expect(observer.locator('#dashboardActual')).toHaveText('5,0 т'); assert.equal(hub.store.get('production-log').data.goalTons, 3000);
    await admin.locator('#previewImport').click(); await expect(admin.locator('[data-field=duplicates]')).toHaveText('1'); await expect(admin.locator('#applyImport')).toBeDisabled();
    await select({...history, entries: [{...history.entries[0], tonnage: 1}]}); await admin.locator('#previewImport').click(); await expect(admin.locator('[data-field=conflicts]')).toHaveText('1'); await expect(admin.locator('#applyImport')).toBeDisabled();
    await select({...history, entries: [{...history.entries[0], id: 'demo-import-stale'}]}); await admin.locator('#previewImport').click(); await expect(admin.locator('#applyImport')).toBeEnabled();
    const before = hub.store.get('production-log'); hub.store.put('production-log', {...before.data, goalTons: 4000}, before.revision, {role: 'admin'});
    await admin.locator('#applyImport').click(); await expect(admin.locator('#importMessage')).toContainText('Базата е променена'); assert.equal(hub.store.get('production-log').data.entries.length, 2);
    await select({employees: []}); await admin.locator('#previewImport').click(); await expect(admin.locator('#importMessage')).toContainText('Файлът не е валиден'); await expect(admin.locator('#applyImport')).toBeDisabled();
    const latest = hub.store.get('production-log'); hub.store.put('production-log', {...latest.data, goalTons: 3000}, latest.revision, {role: 'admin'});
    console.log('PASS production history import → live report, duplicate prevention and stale preview protection');
    console.log('RUN observer controls, page reload persistence and account revocation');
    await observer.goto(base + '/production-log.html'); await expect(observer.locator('#saveBtn')).toBeHidden();
    await observer.reload(); await expect(observer.locator('#goalCur')).toHaveText('5,0 т');
    await admin.goto(base + '/accounts.html'); const viewer = hub.auth.list().find(user => user.username === 'demo-observer'); const form = admin.locator(`.account-card[data-id="${viewer.id}"]`); await form.locator('input[type=checkbox]').uncheck(); await form.locator('button').click(); await expect(admin.locator('#accountMessage')).toHaveText('Акаунтът е обновен.');
    await observer.reload(); await expect(observer).toHaveURL(base + '/login.html');
    assert.deepEqual(errors, []);
    console.log('PASS observer controls, persistence and account revocation');
    console.log('Online browser E2E: 6 workflows passed.');
  } catch (error) { if (errors.length) console.error('Browser errors:', errors); throw error;
  } finally { if (browser) await browser.close(); await hub.close(); fs.rmSync(dir, {recursive: true, force: true}); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
