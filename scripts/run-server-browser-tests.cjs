/* Isolated server + SQLite + real visible browsers. Every account and record is fictional. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {expect: baseExpect} = require('playwright/test');
const {createHubServer} = require('../server/server.cjs');
const expect = baseExpect.configure({timeout: 10000});
const {fixture: migrationFixture} = require('../tests/server/import-fixture.cjs');
const {assertResponsive} = require('../tests/browser/responsive.cjs');
const {exerciseTasks} = require('../tests/browser/tasks.cjs');
const demoPassword = 'Fictional-password-123';
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-online-e2e-'));
  let taskTime = Date.now();
  const hub = createHubServer({filename: path.join(dir, 'demo.sqlite'), publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => taskTime});
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
    if (process.argv.includes('--tasks-only')) {
      await exerciseTasks({admin, hub, base, device, expect, setTime: value => { taskTime = Date.parse(value); }, screenshotDir: process.argv.find(value => value.startsWith('--screenshots='))?.slice('--screenshots='.length)});
      assert.deepEqual(errors, []); console.log('PASS tasks browser workflows'); return;
    }
    await admin.getByRole('link', {name: 'Акаунти', exact: true}).click();
    for (const [username, role] of [['demo-operator', 'operator'], ['demo-observer', 'observer']]) {
      await admin.locator('#newAccountButton').click();
      await admin.locator('#accountUsername').fill(username); await admin.locator('#accountPassword').fill(demoPassword); await admin.locator('#accountRole').selectOption(role); await admin.locator('#accountForm button[type=submit]').click();
      await expect(admin.locator('#accountList')).toContainText(username);
    }
    const operator = await device('demo-operator', true), observer = await device('demo-observer', true);
    console.log('PASS accounts and real browser login');
    console.log('RUN compact account search, role defaults, reset and independent drafts');
    await expect(admin.locator('#accountCreate')).toBeHidden();
    await expect(admin.locator('.account-entry[open]')).toHaveCount(0);
    await admin.locator('#accountSearch').fill('DEMO-OPERATOR');
    await expect(admin.locator('.account-entry:visible')).toHaveCount(1);
    await expect(admin.locator('#accountCount')).toHaveText('1 / 3');
    await admin.locator('#accountFilter').selectOption('observer');
    await expect(admin.locator('#accountEmpty')).toBeVisible();
    await admin.locator('#accountSearch').fill(''); await admin.locator('#accountFilter').selectOption('all');
    const operatorId = hub.auth.list().find(user => user.username === 'demo-operator').id;
    const operatorForm = admin.locator(`.account-card[data-id="${operatorId}"]`);
    await operatorForm.locator('..').locator('summary').first().click();
    await expect(operatorForm.locator('[data-permission=canCreateReports]')).toBeChecked();
    await expect(operatorForm.locator('[data-permission=canImportData]')).toBeDisabled();
    await operatorForm.locator('[data-permission=canEditReports]').check();
    await operatorForm.locator('button[type=submit]').click();
    await expect(operatorForm.locator('.account-feedback')).toHaveText('Акаунтът е обновен.');
    assert.deepEqual(hub.auth.list().find(user => user.id === operatorId).permissionOverrides, {canEditReports: true});
    await operatorForm.getByRole('button', {name: 'Върни правата по роля', exact: true}).click();
    await expect(operatorForm.locator('[data-permission=canEditReports]')).not.toBeChecked();
    await operatorForm.locator('button[type=submit]').click();
    await expect(operatorForm.locator('.account-feedback')).toHaveText('Акаунтът е обновен.');
    assert.deepEqual(hub.auth.list().find(user => user.id === operatorId).permissionOverrides, {});
    await operatorForm.locator('select[aria-label="Роля"]').selectOption('observer');
    await expect(operatorForm.locator('[data-permission=canCreateReports]')).toBeDisabled();
    await expect(operatorForm.locator('[data-permission=canCreateReports]')).not.toBeChecked();
    await operatorForm.locator('select[aria-label="Роля"]').selectOption('operator');
    await expect(operatorForm.locator('[data-permission=canCreateReports]')).toBeChecked();
    await operatorForm.locator('.account-password summary').click();
    await operatorForm.locator('input[type=password]').fill('short');
    await operatorForm.locator('.account-password summary').click();
    await operatorForm.locator('button[type=submit]').click();
    await expect(operatorForm.locator('input[type=password]')).toBeVisible();
    await expect(operatorForm.locator('input[type=password]')).toBeFocused();
    await operatorForm.locator('input[type=password]').fill('Fictional-unsaved-123');
    const observerId = hub.auth.list().find(user => user.username === 'demo-observer').id;
    const observerForm = admin.locator(`.account-card[data-id="${observerId}"]`);
    await observerForm.locator('..').locator('summary').first().click();
    await observerForm.locator('button[type=submit]').click();
    await expect(observerForm.locator('.account-feedback')).toHaveText('Акаунтът е обновен.');
    await expect(operatorForm.locator('input[type=password]')).toHaveValue('Fictional-unsaved-123');
    await operatorForm.locator('input[type=password]').fill('');
    await operatorForm.locator('.account-password summary').click();
    await observerForm.locator('..').locator('summary').first().click();
    for (const language of ['bg', 'en']) {
      await admin.locator(`[data-hub-language=${language}]`).click();
      for (const width of [320, 390, 768, 1440]) {
        await admin.setViewportSize({width, height: 900}); await assertResponsive(admin, `Expanded account ${language} at ${width}px`);
        await admin.locator('#newAccountButton').click(); await assertResponsive(admin, `Create account ${language} at ${width}px`);
        await admin.locator('#cancelCreate').click();
      }
    }
    await admin.locator('[data-hub-language=bg]').click();
    const screenshotArgument = process.argv.find(value => value.startsWith('--screenshots='));
    if (screenshotArgument) {
      const directory = path.resolve(screenshotArgument.slice('--screenshots='.length));
      const sourceRoot = path.resolve(__dirname, '..');
      assert.ok(directory !== sourceRoot && !directory.startsWith(sourceRoot + path.sep), 'Demo screenshots must stay outside the source checkout');
      fs.mkdirSync(directory, {recursive: true});
      // Fresh viewports avoid stitched capture artifacts after the responsive checks.
      const captures = await browser.newContext({storageState: await admin.context().storageState(), viewport: {width: 1280, height: 1600}});
      await captures.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await captures.newPage(); await page.goto(base + '/accounts.html');
      const entry = page.locator(`.account-entry:has(.account-card[data-id="${operatorId}"])`);
      await entry.locator('summary').first().click();
      await page.locator('main').screenshot({path: path.join(directory, 'accounts-desktop.png')});
      await page.setViewportSize({width: 390, height: 1600});
      await entry.screenshot({path: path.join(directory, 'accounts-mobile-permissions.png')});
      await entry.locator('summary').first().click();
      await page.locator('main').screenshot({path: path.join(directory, 'accounts-mobile-list.png')});
      await captures.close();
    }
    await admin.setViewportSize({width: 1280, height: 900});
    // The draft checks revoke the demo users' sessions; sign in again for subsequent flows.
    for (const [page, username] of [[operator, 'demo-operator'], [observer, 'demo-observer']]) {
      await page.goto(base + '/login.html'); await page.locator('#username').fill(username); await page.locator('#password').fill(demoPassword);
      await page.locator('#loginForm button').click(); await expect(page).toHaveURL(base + '/index.html');
    }
    console.log('PASS compact account search, role defaults, reset and independent drafts');
    console.log('RUN operator entry → shared SQLite → observer report updates without reload');
    await observer.goto(base + '/statistics.html'); await expect(observer.locator('#statsContent')).toBeVisible();
    await operator.goto(base + '/production-log.html'); await expect(operator.locator('#connDot')).toHaveClass(/\bon\b/);
    await expect(operator.locator('#reportEntryPanel')).toBeVisible(); await expect(operator.locator('#dayFilter')).toBeHidden();
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
    await operator.goto(base + '/index.html'); await expect(operator.locator('a[href="personnel.html"]')).toBeHidden(); await expect(operator.locator('a[href="statistics.html"]')).toBeHidden();
    assert.equal(await operator.evaluate(async () => (await fetch('/personnel.html')).status), 403);
    assert.equal(await operator.evaluate(async () => (await fetch('/statistics.html')).status), 403);
    await observer.goto(base + '/index.html'); await expect(observer.locator('a[href="personnel.html"]')).toBeHidden(); await expect(observer.locator('a[href="statistics.html"]')).toBeVisible();
    assert.equal(await observer.evaluate(async () => (await fetch('/personnel.html')).status), 403);
    await observer.goto(base + '/statistics.html');
    await observer.locator('[data-stats-tab=workforce]').click();
    await expect(observer.locator('#personnelConnDot')).toHaveClass(/\bon\b/);
    await expect(observer.locator('#wfStaffSource')).toHaveText('0 производствени');
    await observer.locator('[data-stats-tab=pairs]').click();
    await operator.goto(base + '/pair-targets.html'); await expect(operator.locator('#pairsConnDot')).toHaveClass(/\bon\b/); await operator.locator('#stickersShiftBtn').click(); await operator.locator('#addPairBtn').click();
    const employees = hub.store.get('personnel').data.employees;
    await operator.locator('#memberOne').selectOption(employees[0].id); await operator.locator('#memberTwo').selectOption(employees[1].id); await operator.locator('#targetKg').fill('1000'); await operator.locator('#targetCrates').fill('40'); await operator.locator('#areaManual').check(); await operator.locator('#savePairBtn').click();
    await expect(operator.locator('#pairsList')).toContainText('Очаква отчет'); await operator.locator('#pairsList [data-action=report]').click(); await operator.locator('#actualKg').fill('1100'); await operator.locator('#actualCrates').fill('44'); await operator.locator('#savePairBtn').click(); await expect(operator.locator('#pairsList')).toContainText('Постигнат');
    await expect(observer.locator('#pairStatsBody')).toContainText(/1\s?100\s*\/\s*1\s?000/); await expect(observer.locator('#dashboardActual')).toHaveText('3,0 т');
    await expect(operator.locator('#pairsList [data-action=report]')).toBeHidden();
    console.log('PASS personnel, Stickers pair planning/reporting and live pair statistics');
    console.log('RUN shared packing instructions and attachments → phone reads them');
    await admin.goto(base + '/package-instructions.html'); await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/); await admin.locator('#addBtn').click(); await admin.locator('#numberInput').fill('900101'); await admin.locator('#nameInput').fill('Demo Online Box'); await admin.locator('#categoryInput').selectOption('standard'); await admin.locator('#textInput').fill('Fictional instruction from the shared database.');
    await admin.locator('#imageFileInput').setInputFiles({name: 'demo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="blue"/></svg>')});
    await admin.locator('#saveBtn').click(); await expect(admin.locator('#formPanel')).toBeHidden();
    await observer.goto(base + '/package-instructions.html'); await expect(observer.locator('#connDot')).toHaveClass(/\bon\b/); await expect(observer.locator('#addBtn')).toBeHidden(); await observer.locator('#searchInput').fill('900101'); await observer.locator('.result-head').click(); await expect(observer.locator('.result-text')).toHaveText('Fictional instruction from the shared database.'); await expect(observer.locator('.cat-select')).toBeHidden(); await observer.locator('.gallery img').click(); await expect(observer.locator('#lightbox')).toHaveClass(/open/);
    console.log('PASS shared packing instructions and attachments → phone reads them');
    console.log('RUN production history import → live report, duplicate prevention and stale preview protection');
    await observer.goto(base + '/statistics.html'); await expect(observer.locator('#dashboardActual')).toHaveText('3,0 т');
    await admin.goto(base + '/production-import.html');
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
    console.log('RUN all-module folder import → historical pairs, personnel, downtime, nested instructions and live totals');
    const migration = migrationFixture(), migrationDir = path.join(dir, 'migration-demo'); fs.mkdirSync(migrationDir);
    for (const [kind, data] of Object.entries(migration.payload.documents)) fs.writeFileSync(path.join(migrationDir, kind + '.json'), JSON.stringify(data));
    for (const [index, file] of migration.payload.files.entries()) { const filename = path.join(migrationDir, file.path); fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, migration.contents[index]); }
    fs.writeFileSync(path.join(migrationDir, 'unrelated-demo.txt'), 'Fictional unrelated file, must be skipped.');
    await admin.getByRole('link', {name: 'Импорт на данни', exact: true}).click();
    await admin.locator('[data-hub-language=en]').click(); await expect(admin.locator('h1')).toHaveText('Data import'); await expect(admin.locator('#checkDataImport')).toHaveText('Check selected data');
    await admin.locator('[data-hub-language=bg]').click();
    console.log('RUN import JSON equality, conflicting folder copies and explicit-file priority');
    const duplicateDir = path.join(migrationDir, 'data'); fs.mkdirSync(duplicateDir, {recursive: true});
    const production = migration.payload.documents['production-log'];
    const reordered = Object.fromEntries(Object.entries({...production, entries: production.entries.map(entry => Object.fromEntries(Object.entries(entry).reverse()))}).reverse());
    const duplicateFile = path.join(duplicateDir, 'production-log.json'); fs.writeFileSync(duplicateFile, JSON.stringify(reordered));
    await admin.locator('#legacyFolder').setInputFiles(migrationDir);
    await admin.locator('#checkDataImport').click(); await expect(admin.locator('#dataImportMessage')).toHaveText('Данните са проверени. Потвърди общото добавяне.');
    await admin.locator('#cancelDataImport').click();
    fs.writeFileSync(duplicateFile, JSON.stringify({...production, entries: production.entries.map(entry => ({...entry, tonnage: 1}))}));
    await admin.locator('#legacyFolder').setInputFiles(migrationDir);
    await admin.locator('#checkDataImport').click(); await expect(admin.locator('#dataImportMessage')).toContainText('Избрани са различни копия на JSON файл.');
    await expect(admin.locator('#dataImportMessage')).toContainText('(production-log.json)'); await expect(admin.locator('#confirmDataImport')).toBeDisabled();
    assert.equal(hub.store.get('production-log').data.entries.length, 2);
    await admin.reload(); await expect(admin.locator('#checkDataImport')).toBeDisabled();
    await admin.locator('#moduleFiles').setInputFiles(Object.keys(migration.payload.documents).map(kind => path.join(migrationDir, kind + '.json')));
    await admin.locator('#checkDataImport').click(); await expect(admin.locator('#dataImportMessage')).toHaveText('За импорта на инструкции избери и папката с профилите.');
    const incompleteDir = path.join(dir, 'incomplete-demo'); fs.mkdirSync(incompleteDir); fs.writeFileSync(path.join(incompleteDir, 'unrelated-demo.txt'), 'Fictional unrelated file.');
    await admin.locator('#legacyFolder').setInputFiles(incompleteDir);
    await admin.locator('#checkDataImport').click(); await expect(admin.locator('#missingCount')).toHaveText('2'); await expect(admin.locator('#confirmDataImport')).toBeDisabled();
    await admin.locator('#legacyFolder').setInputFiles(migrationDir);
    await admin.locator('#checkDataImport').click(); await expect(admin.locator('#dataImportMessage')).toHaveText('Данните са проверени. Потвърди общото добавяне.');
    await expect(admin.locator('[data-module=personnel]')).toContainText('2'); await expect(admin.locator('[data-module=attachments]')).toContainText('3');
    await admin.locator('#confirmDataImport').click(); await expect(admin.locator('#dataImportMessage')).toHaveText('Всички избрани данни са добавени. Провери модулите и отчетите.');
    await expect(observer.locator('#dashboardActual')).toHaveText('7,0 т'); await observer.locator('[data-stats-tab=pairs]').click(); await expect(observer.locator('#pairStatsBody')).toContainText('Demo Legacy Person 1');
    assert.equal(hub.store.get('line-downtime').data.entries.length, 2); assert.equal(hub.store.get('personnel').data.settings.stickersStage1, 3); assert.equal(hub.store.get('production-log').data.goalTons, 5000);
    assert.equal(hub.store.db.prepare('SELECT 1 FROM files WHERE path=?').get('unrelated-demo.txt'), undefined);
    console.log('PASS import JSON equality, conflicting folder copies and explicit-file priority');
    await admin.locator('#checkDataImport').click(); await expect(admin.locator('#dataImportMessage')).toHaveText('Избраните данни вече са добавени.'); await expect(admin.locator('#confirmDataImport')).toBeDisabled();
    await admin.locator('#cancelDataImport').click(); await expect(admin.locator('#dataImportMessage')).toContainText('Импортът е отказан');
    await admin.goto(base + '/personnel.html'); await admin.locator('[data-filter=inactive]').click(); await expect(admin.locator('#peopleWrap')).toContainText('Demo Legacy Person 1');
    await observer.goto(base + '/package-instructions.html'); await expect(observer.locator('#connDot')).toHaveClass(/\bon\b/); await observer.locator('#searchInput').fill('900202'); await observer.locator('.result-head').click(); await expect(observer.locator('.result-text')).toHaveText('Fictional imported instruction.'); await expect(observer.locator('.file-tile-name')).toHaveText('demo.pdf'); await expect(observer.locator('.gallery img')).toBeVisible();
    console.log('PASS all-module folder import → historical pairs, personnel, downtime, nested instructions and live totals');
    console.log('RUN responsive shared modules, accounts and imports at 320–1440 px');
    for (const width of [320, 390, 768, 1440]) {
      await admin.setViewportSize({width, height: 900});
      for (const module of ['index', 'production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions', 'statistics', 'accounts', 'data-import', 'production-import', 'login']) {
        await admin.goto(`${base}/${module}.html`);
        if (module !== 'login') await expect(admin.locator('.server-bar')).toBeVisible();
        for (const language of ['en', 'bg']) {
          await admin.locator(`[data-hub-language=${language}]`).click();
          await assertResponsive(admin, `Online ${module}/${language} at ${width}px`);
        }
      }
    }
    console.log('PASS responsive shared modules, accounts and imports at 320–1440 px');
    console.log('RUN observer controls, page reload persistence and account revocation');
    await observer.goto(base + '/production-log.html'); await expect(observer.locator('#saveBtn')).toBeHidden();
    await expect(observer.locator('#reportEntryPanel')).toBeHidden();
    await expect(observer.locator('#dayFilter #dateInput')).toBeVisible();
    await expect(observer.locator('#tonInput')).toBeHidden(); await expect(observer.locator('#shiftGrid')).toBeHidden();
    await observer.locator('#dateInput').fill('2026-10-04'); await expect(observer.locator('#dayVal')).toHaveText('4000 кг');
    await observer.locator('#dateInput').fill('2026-10-05'); await expect(observer.locator('#dayVal')).toHaveText('3000 кг');
    await expect(observer.locator('#summaryGrid')).toBeVisible(); await expect(observer.locator('#historyWrap')).toContainText('2026');
    for (const width of [320, 390, 1440]) {
      await observer.setViewportSize({width, height: 900});
      for (const language of ['en', 'bg']) {
        await observer.locator(`[data-hub-language=${language}]`).click();
        await expect(observer.locator('#dayVal')).toHaveText('3000 ' + (language === 'en' ? 'kg' : 'кг'));
        await assertResponsive(observer, `Observer tonnage view ${language} at ${width}px`);
      }
    }
    await observer.reload(); await expect(observer.locator('#goalCur')).toHaveText('7,0 т');
    await expect(observer.locator('#reportEntryPanel')).toBeHidden(); await expect(observer.locator('#dayFilter #dateInput')).toBeVisible();
    await admin.goto(base + '/accounts.html'); const viewer = hub.auth.list().find(user => user.username === 'demo-observer'); const form = admin.locator(`.account-card[data-id="${viewer.id}"]`); await form.locator('..').locator('summary').first().click(); await form.locator('[data-active]').uncheck(); await form.locator('button[type=submit]').click(); await expect(admin.locator('#accountMessage')).toHaveText('Акаунтът е обновен.');
    await expect(observer).toHaveURL(base + '/login.html');
    console.log('RUN account permissions, mobile restrictions, authorized export and immediate revocation');
    await admin.locator('#newAccountButton').click();
    await admin.locator('#accountUsername').fill('demo-permissions'); await admin.locator('#accountPassword').fill(demoPassword); await admin.locator('#accountRole').selectOption('operator');
    await admin.locator('#accountForm [data-permission=canExportReports]').uncheck();
    await admin.locator('#accountForm [data-permission=canCreateReports]').uncheck();
    await admin.locator('#accountForm [data-permission=canEditReports]').check();
    await expect(admin.locator('#accountForm [data-permission=canImportData]')).toBeDisabled();
    await admin.locator('#accountForm button[type=submit]').click(); await expect(admin.locator('#accountList')).toContainText('demo-permissions');
    const limited = await device('demo-permissions', true);
    await limited.goto(base + '/production-log.html'); await expect(limited.locator('#connDot')).toHaveClass(/\bon\b/);
    await expect(limited.locator('#reportEntryPanel')).toBeHidden(); await expect(limited.locator('#dayFilter #dateInput')).toBeVisible();
    await expect(limited.locator('#saveBtn')).toBeHidden(); await expect(limited.locator('#reportExport')).toHaveCount(0); await expect(limited.locator('#goalInput')).toBeDisabled();
    const firstMonth = limited.locator('.history-month').first();
    if (!await firstMonth.evaluate(element => element.open)) await firstMonth.locator('summary').click();
    await expect(firstMonth.locator('.del-btn').first()).toBeVisible();
    assert.equal(await limited.evaluate(async () => (await fetch('/api/export/production-log')).status), 403);
    const account = hub.auth.list().find(user => user.username === 'demo-permissions');
    const limitedForm = admin.locator(`.account-card[data-id="${account.id}"]`);
    await limitedForm.locator('..').locator('summary').first().click();
    await limitedForm.locator('[data-permission=canExportReports]').check(); await limitedForm.locator('[data-permission=canCreateReports]').check();
    await limitedForm.locator('[data-permission=canEditReports]').uncheck(); await limitedForm.locator('button[type=submit]').click();
    await expect(limited).toHaveURL(base + '/login.html');
    await limited.locator('#username').fill('demo-permissions'); await limited.locator('#password').fill(demoPassword); await limited.locator('#loginForm button').click();
    await expect(limited).toHaveURL(base + '/index.html');
    await limited.goto(base + '/production-log.html'); await expect(limited.locator('#saveBtn')).toBeVisible(); await expect(limited.locator('.del-btn')).toHaveCount(0);
    await expect(limited.locator('#reportEntryPanel')).toBeVisible(); await expect(limited.locator('#dayFilter')).toBeHidden();
    const downloadPromise = limited.waitForEvent('download'); await limited.locator('#reportExport').click(); const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'production-log.json'); const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), hub.store.get('production-log').data);
    for (const width of [320, 390]) { await limited.setViewportSize({width, height: 900}); await assertResponsive(limited, `Restricted operator at ${width}px`); }
    await admin.locator('[data-hub-language=en]').click(); await expect(limitedForm.locator('legend').first()).toHaveText('Account permissions');
    await expect(limitedForm.locator('[data-permission=canEditReports]').locator('..')).toContainText('Correct and delete reports');
    await admin.locator('[data-hub-language=bg]').click();
    const own = hub.auth.list().find(user => user.username === 'demo-admin'), ownForm = admin.locator(`.account-card[data-id="${own.id}"]`);
    await ownForm.locator('..').locator('summary').first().click();
    await ownForm.locator('[data-permission=canImportData]').uncheck(); await ownForm.locator('button[type=submit]').click(); await expect(admin).toHaveURL(base + '/login.html');
    await admin.locator('#username').fill('demo-admin'); await admin.locator('#password').fill(demoPassword); await admin.locator('#loginForm button').click();
    await expect(admin).toHaveURL(base + '/index.html');
    await expect(admin.getByRole('link', {name: 'Импорт на данни', exact: true})).toHaveCount(0);
    assert.equal(await admin.evaluate(async () => (await fetch('/data-import.html')).status), 403);
    console.log('PASS account permissions, mobile restrictions, authorized export and immediate revocation');
    console.log('RUN shift and global tasks, approvals, missed reports and responsive task screens');
    const screenshotDir = process.argv.find(value => value.startsWith('--screenshots='))?.slice('--screenshots='.length);
    await exerciseTasks({admin, hub, base, device, expect, setTime: value => { taskTime = Date.parse(value); }, screenshotDir});
    console.log('PASS shift and global tasks, approvals, missed reports and responsive task screens');
    assert.deepEqual(errors, []);
    console.log('PASS observer controls, persistence and account revocation');
    console.log('Online browser E2E: 12 workflows passed.');
  } catch (error) {
    const screenshotDir = process.argv.find(value => value.startsWith('--screenshots='))?.slice('--screenshots='.length);
    if (screenshotDir && browser) {
      fs.mkdirSync(screenshotDir, {recursive: true});
      const page = browser.contexts()[0]?.pages()[0];
      if (page) { await page.screenshot({path: path.join(screenshotDir, 'browser-failure.png'), fullPage: true}); console.log(await page.evaluate(() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, wide: [...document.querySelectorAll('body *')].filter(el => el.checkVisibility() && el.scrollWidth > el.clientWidth + 3).map(el => ({tag: el.tagName, id: el.id, cls: el.className, width: el.clientWidth, scroll: el.scrollWidth, rect: {left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right}})).slice(0, 12)}))); }
    }
    if (errors.length) console.error('Browser errors:', errors); throw error;
  } finally { if (browser) await browser.close(); await hub.close(); fs.rmSync(dir, {recursive: true, force: true}); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
