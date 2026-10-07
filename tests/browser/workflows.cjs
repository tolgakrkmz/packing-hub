const assert = require('node:assert/strict');
const {expect: baseExpect} = require('playwright/test');
const {installStorage} = require('./storage.cjs');
const {assertResponsive} = require('./responsive.cjs');
const expect = baseExpect.configure({timeout: 8000});

async function run(browser, base, {headed = false} = {}) {
  let passed = 0;
  const failures = [];
  async function scenario(name, work, options = {}) {
    const {fallback = false, ...browserOptions} = options;
    const context = await browser.newContext({timezoneId: 'Europe/Sofia', locale: 'bg-BG', ...browserOptions});
    const errors = [];
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await context.addInitScript(installStorage, {fallback});
    if (headed) await context.addInitScript(name => {
      document.addEventListener('DOMContentLoaded', () => {
        const label = document.createElement('aside');
        label.textContent = 'E2E тест · измислени данни\n' + name;
        label.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;max-width:340px;white-space:pre-wrap;padding:12px;background:#14324e;color:white;font:13px/1.5 sans-serif;border-radius:8px;pointer-events:none;box-shadow:0 2px 12px #0006';
        document.body.append(label);
      });
    }, name);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => {
      if (dialog.type() === 'prompt') { errors.push('Unexpected local password prompt'); dialog.dismiss(); }
      else dialog.accept();
    });
    await page.clock.setFixedTime(new Date('2026-10-05T08:30:00+03:00'));
    const go = async name => { await page.goto(`${base}/${name}.html`); await page.evaluate(() => window.__browserTest.ready); };
    const read = name => page.evaluate(name => window.__browserTest.read(name), name);
    const saved = (name, predicate) => expect.poll(async () => {
      try { return predicate(await read(name)); }
      catch (error) {
        // OPFS can invalidate a File snapshot while createWritable().close() replaces it.
        // Retry only transient reads; a missing/unreadable final file still times out.
        if (/NotReadableError|NotFoundError/.test(error.message)) return false;
        throw error;
      }
    }).toBe(true);
    const connect = async (button, name, dot = '#connDot') => {
      await page.evaluate(name => { window.__browserTest.nextFile = name; }, name);
      await page.locator(button).click();
      await expect(page.locator(dot)).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    };
    try {
      console.log(`RUN ${name}`);
      if (headed) await page.bringToFront();
      await work({page, go, read, saved, connect});
      assert.deepEqual(errors, [], 'No uncaught application errors');
      console.log(`PASS ${name}`);
      passed++;
    } catch (error) {
      failures.push(name);
      console.error(`FAIL ${name}\n${error.stack}`);
    } finally { await context.close(); }
  }

  async function addPerson(t, name, category, team, role = 'Опаковчик') {
    const {page, saved} = t;
    await page.locator('#addPersonBtn').click();
    await page.locator('#personName').fill(name);
    await page.locator('#personCategory').selectOption(category);
    await page.locator('#personTeam').selectOption(team);
    await page.locator('#personRole').selectOption(role);
    await page.locator('#personForm button[type=submit]').click();
    await expect(page.locator('#personModal')).not.toHaveClass(/open/);
    await saved('personnel.json', data => data.employees.some(person => person.name === name));
  }
  async function production(t, date, shift, kg, brak, breakdown) {
    const {page, read, saved} = t;
    const before = (await read('production-log.json')).entries.length;
    await page.locator(`[data-shift="${shift}"]`).click();
    await page.locator('#dateInput').fill(date);
    await page.locator('#dateInput').dispatchEvent('change');
    await page.locator('#breakdownToggle').setChecked(!!breakdown);
    if (breakdown) {
      for (const [id, value] of Object.entries(breakdown)) await page.locator('#' + id).fill(String(value));
    } else await page.locator('#tonInput').fill(String(kg));
    await page.locator('#brakInput').fill(String(brak));
    await page.locator('#saveBtn').click();
    await expect(page.locator('#msg')).toContainText('Записано');
    await saved('production-log.json', data => data.entries.length === before + 1);
  }

  await scenario('Tonnage → native file → reopen → monthly/yearly reports, downtime, pairs and workforce', async t => {
    const {page, go, connect, read, saved} = t;
    await go('index');
    await page.locator('a[href="production-log.html"]').click();
    await connect('#openFileBtn', 'production-log.json');
    await production(t, '2026-10-04', 'А', 0, 20, {autoKgInput: 2400, autoCrateInput: 96, manKgInput: 600, manCrateInput: 24});
    await production(t, '2026-10-05', 'Б', 2000, 30);
    await production(t, '2026-09-30', 'А', 1000, 10);
    await production(t, '2025-12-31', 'Г', 4000, 40);
    await production(t, '2026-10-05', 'СТИКЕРИ', 500, 5);
    assert.deepEqual((await read('production-log.json')).entries.map(row => [row.date, row.shift, row.tonnage, row.brak]), [
      ['2026-10-04', 'А', 3000, 20], ['2026-10-05', 'Б', 2000, 30], ['2026-09-30', 'А', 1000, 10], ['2025-12-31', 'Г', 4000, 40], ['2026-10-05', 'СТИКЕРИ', 500, 5]
    ]);
    await page.locator('#goalInput').fill('12');
    await page.locator('#goalInput').press('Tab');
    await saved('production-log.json', data => data.goalTons === 12);
    await page.reload();
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    await expect(page.locator('#goalInput')).toHaveValue('12');
    await expect(page.locator('#goalCur')).toHaveText('5,5 т');
    await go('line-downtime');
    await connect('#openFileBtn', 'line-downtime.json');
    await page.locator('[data-shift="А"]').click();
    await page.locator('#dateInput').fill('2026-10-04');
    await page.locator('#startInput').fill('23:45');
    await page.locator('#endInput').fill('00:15');
    await expect(page.locator('#durationReadout')).toContainText('30');
    await page.locator('#reasonSelect').selectOption('Тестов престой');
    await page.locator('#noteInput').fill('Fictional midnight downtime');
    await page.locator('#saveBtn').click();
    await saved('line-downtime.json', data => data.entries.length === 1);
    assert.equal((await read('line-downtime.json')).entries[0].durationMin, 30);
    await go('pair-targets');
    const team = await page.locator('#contextTeam').inputValue();
    await go('personnel');
    await connect('#openFileBtn', 'personnel.json');
    await addPerson(t, 'E2E Demo Packer One', 'auto', team);
    await addPerson(t, 'E2E Demo Packer Two', 'manual', team);
    await addPerson(t, 'E2E Demo Supervisor', 'auto', team, 'Началник смяна');
    await addPerson(t, 'E2E Demo Crane', 'manual', team, 'Кранист/чемберовач');
    await addPerson(t, 'E2E Demo Workforce Packer', 'auto', 'А');
    await go('pair-targets');
    await connect('#pairsOpenFileBtn', 'pair-targets.json', '#pairsConnDot');
    await expect(page.locator('#rosterConnDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    await page.locator('#addPairBtn').click();
    const people = (await read('personnel.json')).employees;
    await expect(page.locator('#memberOne')).not.toContainText('Supervisor');
    await expect(page.locator('#memberOne')).not.toContainText('Crane');
    await page.locator('#memberOne').selectOption(people[0].id);
    await page.locator('#memberTwo').selectOption(people[1].id);
    await page.locator('#targetKg').fill('1000');
    await page.locator('#targetCrates').fill('40');
    await page.locator('#areaAuto').check();
    await page.locator('#areaManual').check();
    await page.locator('#savePairBtn').click();
    await saved('pair-targets.json', data => data.entries.length === 1);
    await page.locator('#pairsList [data-action=report]').click();
    await page.locator('#actualKg').fill('800');
    await page.locator('#actualCrates').fill('35');
    await page.locator('#savePairBtn').click();
    await expect(page.locator('#dialogError')).not.toBeEmpty();
    assert.equal((await read('pair-targets.json')).entries[0].result, null);
    await page.locator('#reasonKey').selectOption('materials');
    await page.locator('#reasonText').fill('Fictional material delay');
    await page.locator('#savePairBtn').click();
    await saved('pair-targets.json', data => data.entries[0].result?.kg === 800);
    await page.reload();
    await expect(page.locator('#pairsList')).toContainText('Непостигнат');
    await go('index');
    await page.locator('a[href="statistics.html"]').click();
    await expect(page.locator('#statsFilesStatus')).toHaveText('4/4 свързани');
    await expect(page.locator('#dashboardActual')).toHaveText('5,5 т');
    await expect(page.locator('#dashboardGoal')).toContainText('12,0 т');
    await page.locator('#monthlyTrendDetails summary').click();
    await expect(page.locator('#monthlyTrendChart svg')).toBeVisible();
    await page.locator('[data-stats-tab=production]').click();
    await expect(page.locator('#kpiRow .val').first()).toHaveText('6,5 т');
    await expect(page.locator('#tableContainer')).toContainText('5500 кг');
    await expect(page.locator('#tableContainer')).toContainText('55 кг');
    await expect(page.locator('#lineShiftContainer')).toContainText('2400');
    await expect(page.locator('#lineShiftContainer')).toContainText('600');
    await page.locator('#dashboardMonthSelect').selectOption('09');
    await expect(page.locator('#dashboardActual')).toHaveText('1,0 т');
    await page.locator('#yearSelect').selectOption('2025');
    await page.locator('#dashboardMonthSelect').selectOption('12');
    await expect(page.locator('#dashboardActual')).toHaveText('4,0 т');
    await page.locator('[data-view=year]').click();
    await expect(page.locator('#kpiRow .val').first()).toHaveText('10,5 т');
    await expect(page.locator('#tableContainer')).toContainText('2025');
    await expect(page.locator('#tableContainer')).toContainText('2026');
    await page.locator('#yearSelect').selectOption('2026');
    await page.locator('#dashboardMonthSelect').selectOption('10');
    await page.locator('[data-view=month]').click();
    await page.locator('[data-stats-tab=downtime]').click();
    await expect(page.locator('#avKpiRow')).toContainText('0,5 ч');
    await expect(page.locator('#avTableContainer')).toContainText('Тестов престой');
    await page.locator('[data-stats-tab=workforce]').click();
    await expect(page.locator('#wfCurrentStaff')).toHaveText('5');
    await expect(page.locator('#wfStaffSource')).toHaveText('5 производствени + 0 допълнителни');
    await expect(page.locator('#wfMeasuredProductivity')).toHaveText('0,20 т');
    await page.locator('[data-stats-tab=pairs]').click();
    await page.locator('#pairStatsTeam').selectOption(team);
    await expect(page.locator('#pairStatsBody')).toContainText('800 / 1');
    await expect(page.locator('#pairStatsBody')).toContainText('35 / 40');
    await expect(page.locator('#pairStatsBody')).toContainText('200 кг');
    await page.locator('#pairStatsBody details').first().locator(':scope > summary').click();
    await expect(page.locator('#pairStatsBody')).toContainText('Fictional material delay');
    // Pair results must not add their quantities to the tonnage dashboard.
    await expect(page.locator('#dashboardActual')).toHaveText('5,5 т');
    await page.reload();
    await expect(page.locator('[data-stats-tab=pairs]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#dashboardActual')).toHaveText('5,5 т');
  });

  await scenario('Failed write and lost close acknowledgement → retained draft → retry exactly once', async t => {
    const {page, go, connect, read, saved} = t;
    await go('production-log');
    await connect('#openFileBtn', 'production-log.json');
    for (const stage of ['read', 'open', 'close']) {
      const before = (await read('production-log.json')).entries.length;
      await page.locator('[data-shift="А"]').click();
      await page.locator('#tonInput').fill('1234');
      await page.locator('#brakInput').fill('12');
      await page.evaluate(stage => { window.__browserTest.fault = {file: 'production-log.json', stage}; }, stage);
      await page.locator('#saveBtn').click();
      await expect(page.locator('#retrySaveBtn')).toBeVisible();
      await expect(page.locator('#tonInput')).toHaveValue('1234');
      assert.equal((await read('production-log.json')).entries.length, before + (stage === 'close' ? 1 : 0));
      await page.locator('#retrySaveBtn').click();
      await expect(page.locator('#msg')).toContainText('Записано');
      await saved('production-log.json', data => data.entries.length === before + 1);
      await expect(page.locator('#tonInput')).toHaveValue('0');
    }
    await page.reload();
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    assert.equal((await read('production-log.json')).entries.length, 3);
    await go('line-downtime');
    await connect('#openFileBtn', 'line-downtime.json');
    await page.locator('[data-shift="А"]').click();
    await page.locator('#startInput').fill('08:00');
    await page.locator('#endInput').fill('08:30');
    await page.locator('#noteInput').fill('Fictional recovery note');
    await page.evaluate(() => { window.__browserTest.fault = {file: 'line-downtime.json', stage: 'open'}; });
    await page.locator('#saveBtn').click();
    await expect(page.locator('#retrySaveBtn')).toBeVisible();
    await expect(page.locator('#startInput')).toHaveValue('08:00');
    await expect(page.locator('#noteInput')).toHaveValue('Fictional recovery note');
    assert.equal((await read('line-downtime.json')).entries.length, 0);
    await page.locator('#retrySaveBtn').click();
    await saved('line-downtime.json', data => data.entries.length === 1 && data.entries[0].durationMin === 30);
  });

  await scenario('Personnel create, move, deactivate, search, settings and shift calendar', async t => {
    const {page, go, connect, read, saved} = t;
    await go('personnel');
    await expect(page.locator('#hubContent')).toBeVisible();
    await connect('#openFileBtn', 'personnel.json');
    await addPerson(t, 'E2E Demo Moving Packer', 'auto', 'А');
    await addPerson(t, 'E2E Demo Sticker One', 'stickers', '1 смяна');
    await page.locator('#searchInput').fill('Moving Packer');
    await expect(page.locator('#peopleWrap .person-row')).toHaveCount(1);
    await page.locator('#peopleWrap [data-edit-person]').click();
    await page.locator('#personCategory').selectOption('manual');
    await page.locator('#personTeam').selectOption('Б');
    await page.locator('#personNote').fill('Fictional reassignment');
    await page.locator('#personForm button[type=submit]').click();
    await saved('personnel.json', data => data.employees[0].category === 'manual' && data.employees[0].team === 'Б');
    await page.locator('#peopleWrap [data-edit-person]').click();
    await page.locator('.status-switch').click();
    await expect(page.locator('#personActive')).not.toBeChecked();
    await page.locator('#personForm button[type=submit]').click();
    await saved('personnel.json', data => data.employees[0].active === false);
    await expect(page.locator('#peopleWrap')).not.toContainText('Moving Packer');
    await page.locator('[data-filter=inactive]').click();
    await expect(page.locator('#peopleWrap')).toContainText('Moving Packer');
    await expect(page.locator('#peopleWrap')).toContainText('Fictional reassignment');
    await page.locator('#settingsBtn').click();
    await page.locator('#stickersStage1').fill('3');
    await page.locator('#stickersStage2').fill('5');
    await page.locator('#settingsForm button[type=submit]').click();
    await saved('personnel.json', data => data.settings.stickersStage1 === 3 && data.settings.stickersStage2 === 5);
    await page.locator('#todayDate').fill('2026-10-06');
    await page.locator('#todayDate').dispatchEvent('change');
    await expect(page.locator('#stickersNote')).toContainText('1 смяна — 1 души');
    await page.locator('#schedMonth').selectOption('11');
    await page.locator('#schedYear').selectOption('2027');
    await expect(page.locator('#schedWrap')).toContainText('31');
    assert.equal((await read('personnel.json')).moveLog.length, 5);
    await page.reload();
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    await page.locator('#settingsBtn').click();
    await expect(page.locator('#stickersStage1')).toHaveValue('3');
    await expect(page.locator('#stickersStage2')).toHaveValue('5');
  });

  await scenario('Stickers pair planning, editing, deletion, reporting, correction and history', async t => {
    const {page, go, connect, read, saved} = t;
    await go('personnel');
    await connect('#openFileBtn', 'personnel.json');
    await addPerson(t, 'E2E Demo Sticker One', 'stickers', '1 смяна');
    await addPerson(t, 'E2E Demo Sticker Two', 'stickers', '1 смяна');
    await addPerson(t, 'E2E Demo Sticker Chief', 'stickers', '1 смяна', 'Началник смяна');
    const employees = (await read('personnel.json')).employees;
    await go('pair-targets');
    await connect('#pairsOpenFileBtn', 'pair-targets.json', '#pairsConnDot');
    await page.locator('#stickersShiftBtn').click();
    await expect(page.locator('#contextTeam')).toHaveValue('СТИКЕРИ');
    await expect(page.locator('#contextDate')).toHaveValue('2026-10-05');
    async function plan() {
      await page.locator('#addPairBtn').click();
      await expect(page.locator('#memberOne')).not.toContainText('Chief');
      await page.locator('#memberOne').selectOption(employees[0].id);
      await page.locator('#memberTwo').selectOption(employees[1].id);
      await page.locator('#targetKg').fill('1000');
      await page.locator('#targetCrates').fill('40');
      await page.locator('#areaManual').check();
      await page.locator('#savePairBtn').click();
      await saved('pair-targets.json', data => data.entries.length === 1);
    }
    await plan();
    await expect(page.locator('#addPairBtn')).toBeDisabled();
    await page.locator('#pairsList [data-action=edit]').click();
    await page.locator('#targetKg').fill('1200');
    await page.locator('#savePairBtn').click();
    await saved('pair-targets.json', data => data.entries[0].targetKg === 1200);
    await page.locator('#pairsList [data-action=delete]').click();
    await saved('pair-targets.json', data => data.entries.length === 0);
    await plan();
    await page.locator('#pairsList [data-action=report]').click();
    await page.locator('#actualKg').fill('1100');
    await page.locator('#actualCrates').fill('44');
    await page.locator('#savePairBtn').click();
    await saved('pair-targets.json', data => data.entries[0].result?.kg === 1100);
    await expect(page.locator('#pairsList')).toContainText('Постигнат');
    await page.locator('#pairsList [data-action=report]').click();
    await page.locator('#actualCrates').fill('39');
    await page.locator('#reasonKey').selectOption('other');
    await page.locator('#reasonText').fill('Fictional missing crate');
    await page.locator('#savePairBtn').click();
    await saved('pair-targets.json', data => data.entries[0].result?.crates === 39);
    await expect(page.locator('#pairsList')).toContainText('Непостигнат');
    await expect(page.locator('#pairsList [data-action=delete]')).toHaveCount(0);
    await page.locator('#currentShiftBtn').click();
    await page.locator('#historyList summary').click();
    await page.locator('#historyList [data-action=view]').click();
    await expect(page.locator('#contextTeam')).toHaveValue('СТИКЕРИ');
    await expect(page.locator('#pairsList')).toContainText('Fictional missing crate');
    await page.reload();
    await page.locator('#stickersShiftBtn').click();
    await expect(page.locator('#pairsList')).toContainText('Fictional missing crate');
  });

  await scenario('Report dates, quick controls, validation, deletion and downtime reasons', async t => {
    const {page, go, connect, read, saved} = t;
    for (const module of ['production-log', 'line-downtime']) {
      await go(module); await connect('#openFileBtn', module + '.json');
      await page.locator('[data-shift="А"]').click();
      await expect(page.locator('#dateInput')).toHaveValue('2026-10-04');
      await page.locator('[data-shift="СТИКЕРИ"]').click();
      await expect(page.locator('#dateInput')).toHaveValue('2026-10-05');
      await page.locator('#dateInput').fill('2026-09-20');
      await page.locator('[data-shift="Б"]').click();
      await expect(page.locator('#dateInput')).toHaveValue('2026-09-20');
      await page.locator('#yesterdayBtn').click();
      await page.locator('[data-shift="СТИКЕРИ"]').click();
      await expect(page.locator('#dateInput')).toHaveValue('2026-10-04');
    }
    await page.locator('#startInput').fill('08:00');
    await page.locator('#endInput').fill('08:00');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await page.locator('#endInput').fill('08:45');
    await page.locator('#reasonSelect').selectOption('Друго');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#msg')).toContainText('Опиши');
    assert.equal((await read('line-downtime.json')).entries.length, 0);
    await page.locator('#otherReasonInput').fill('Fictional other cause');
    await page.locator('#saveBtn').click();
    await saved('line-downtime.json', data => data.entries.length === 1);
    await page.locator('#newReasonInput').fill('E2E Demo extra reason');
    await page.locator('#addReasonBtn').click();
    await saved('line-downtime.json', data => data.reasons.includes('E2E Demo extra reason'));
    await page.locator('[data-reason="E2E Demo extra reason"]').click();
    await saved('line-downtime.json', data => !data.reasons.includes('E2E Demo extra reason'));
    await page.locator('#historyWrap .del-btn').click();
    await saved('line-downtime.json', data => data.entries.length === 0);
    await go('production-log');
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    await page.locator('[data-shift="В"]').click();
    await page.locator('[data-target=tonInput][data-step="500"]').click();
    await page.locator('[data-target=tonInput][data-step="-50"]').click();
    await expect(page.locator('#tonInput')).toHaveValue('450');
    await page.locator('#saveBtn').click();
    await saved('production-log.json', data => data.entries.length === 1);
    if (!await page.locator('#historyWrap details').evaluate(details => details.open)) await page.locator('#historyWrap details summary').click();
    await page.locator('#historyWrap .del-btn').click();
    await saved('production-log.json', data => data.entries.length === 0);
    await go('statistics');
    await expect(page.locator('#monthlyResultEmpty')).toBeVisible();
  });

  await scenario('Packing instruction files, attachment preview/download, categories, search and bulk imports', async t => {
    const {page, go, read, saved} = t;
    await go('package-instructions');
    await expect(page.locator('#addBtn')).toBeVisible();
    await page.locator('#openFileBtn').click();
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    await page.locator('#addBtn').click();
    await page.locator('#numberInput').fill('900001');
    await page.locator('#nameInput').fill('Demo Test Box');
    await page.locator('#clientInput').fill('Demo Test Customer');
    await page.locator('#textInput').fill('Fictional instruction: fold, pack, close.');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formMsg')).toContainText('Избери категория');
    await page.locator('#categoryInput').selectOption('standard');
    await page.locator('#imageFileInput').setInputFiles([
      {name: 'demo-image.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="blue"/></svg>')},
      {name: 'demo-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional downloadable attachment')}
    ]);
    await page.locator('#saveBtn').click();
    await saved('packing/data/package-instructions.json', data => !!data['900001']);
    await expect(page.locator('#formPanel')).toBeHidden();
    await page.locator('#searchInput').fill('900001');
    await page.locator('.result-head').click();
    await expect(page.locator('.result-text')).toHaveText('Fictional instruction: fold, pack, close.');
    const folder = (await read('packing/data/package-instructions.json'))['900001'].folderName;
    assert.equal(await page.evaluate(folder => window.__browserTest.text(`packing/data/profiles/${folder}/instruction.txt`), folder), 'Fictional instruction: fold, pack, close.');
    await page.locator('.gallery img').click();
    await expect(page.locator('#lightbox')).toHaveClass(/open/);
    assert.equal(await page.locator('#lightboxImg').evaluate(image => image.complete && image.naturalWidth === 30), true);
    await page.locator('#lightboxClose').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.file-tile').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'demo-note.txt');
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), 'Fictional downloadable attachment');
    await page.locator('.cat-select').selectOption('special');
    await saved('packing/data/package-instructions.json', data => data['900001'].category === 'special');
    await page.locator('[data-cat=standard]').click();
    await expect(page.locator('.result-card')).toHaveCount(0);
    await page.locator('[data-cat=special]').click();
    await expect(page.locator('.result-card')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    await page.locator('#searchInput').fill('Demo Test Customer');
    await expect(page.locator('.result-card')).toHaveCount(1);
    await page.evaluate(async () => {
      await window.__browserTest.write('packing/data/profiles/Demo Local Box - 900002/instruction.txt', 'Fictional local import');
      await window.__browserTest.write('external/Demo External Box - 900003/instruction.txt', 'Fictional external import');
    });
    await page.locator('#bulkBtn').click();
    await page.locator('#scanLocalBtn').click();
    await expect(page.locator('#bulkResults .bulk-check')).toHaveCount(1);
    await page.locator('#bulkImportBtn').click();
    await saved('packing/data/package-instructions.json', data => !!data['900002']);
    await expect(page.locator('#bulkPanel')).toBeHidden();
    await page.locator('#bulkBtn').click();
    await page.evaluate(() => { window.__browserTest.nextDirectory = 'external'; });
    await page.locator('#scanExternalBtn').click();
    await expect(page.locator('#bulkResults .bulk-check')).toHaveCount(1);
    await page.locator('#bulkSelectAll').uncheck();
    await page.locator('#bulkImportBtn').click();
    await expect(page.locator('#bulkStatus')).toHaveText('Няма избрани папки за импорт.');
    await page.locator('#bulkSelectAll').check();
    await page.locator('#bulkImportBtn').click();
    await saved('packing/data/package-instructions.json', data => !!data['900003']);
    await page.locator('#bulkCancelBtn').click();
    await page.locator('#searchInput').fill('900003');
    await page.locator('[data-cat=""]').click();
    await page.locator('.result-head').click();
    await expect(page.locator('.result-text')).toHaveText('Fictional external import');
  });

  await scenario('Connection creation, cancelled picker, invalid/wrong files, refresh and restored connection', async t => {
    const {page, go, connect, read, saved} = t;
    await go('production-log');
    await page.evaluate(async () => {
      await window.__browserTest.write('malformed.json', '{');
      await window.__browserTest.write('wrong.json', {employees: []});
      window.__browserTest.nextFile = 'cancel';
    });
    await page.locator('#openFileBtn').click();
    await expect(page.locator('#connDot')).not.toHaveClass(/(?:^|\s)on(?:\s|$)/);
    for (const name of ['malformed.json', 'wrong.json']) {
      await page.evaluate(name => { window.__browserTest.nextFile = name; }, name);
      await page.locator('#openFileBtn').click();
      await expect(page.locator('#connText')).toContainText(name === 'malformed.json' ? 'валиден JSON' : 'не е валиден');
      await expect(page.locator('#connDot')).toHaveClass(/off/);
    }
    await page.evaluate(() => { window.__browserTest.nextFile = 'production-log.json'; });
    await page.locator('#createFileBtn').click();
    await expect(page.locator('#connText')).toContainText('вече съдържа данни');
    assert.equal((await read('production-log.json')).goalTons, 10);
    await page.evaluate(() => { window.__browserTest.nextFile = 'new-production.json'; });
    await page.locator('#createFileBtn').click();
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    assert.deepEqual(await read('new-production.json'), {entries: [], goalTons: 3000});
    await page.locator('.conn-panel-toggle').click();
    await page.evaluate(() => window.__browserTest.write('new-production.json', '{'));
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#connDot')).toHaveClass(/off/);
    await connect('#openFileBtn', 'production-log.json');
    await page.evaluate(async () => {
      await window.__browserTest.write('production-log.json', {goalTons: 20, entries: [{id: 'e2e-external-write', date: '2026-10-04', shift: 'А', tonnage: 7000, brak: 70, breakdown: null}]});
    });
    await page.locator('.conn-panel-toggle').click();
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#goalCur')).toHaveText('7,0 т');
    await saved('production-log.json', data => data.entries.length === 1);
    await page.reload();
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    await expect(page.locator('#goalInput')).toHaveValue('20');
    await page.evaluate(async () => {
      const data = await window.__browserTest.read('production-log.json');
      data.entries.push({id: 'e2e-second-writer', date: '2026-10-05', shift: 'Б', tonnage: 1000, brak: 10, breakdown: null});
      await window.__browserTest.write('production-log.json', data);
    });
    await page.locator('[data-shift="В"]').click();
    await page.locator('#tonInput').fill('500');
    await page.locator('#saveBtn').click();
    await saved('production-log.json', data => data.entries.length === 3);
    assert.equal((await read('production-log.json')).entries.reduce((sum, row) => sum + row.tonnage, 0), 8500);
  });

  await scenario('Manual JSON import/export fallback, local persistence and read-only statistics', async t => {
    const {page, go} = t;
    await go('production-log');
    await expect(page.locator('#connText')).toContainText('не поддържа');
    await page.locator('#importFallback').setInputFiles({name: 'demo-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({entries: [], goalTons: 15}))});
    await expect(page.locator('#connDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
    await page.locator('[data-shift="А"]').click();
    await page.locator('#tonInput').fill('2500');
    await page.locator('#brakInput').fill('25');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#msg')).toContainText('Записано');
    const exported = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Свали .json', exact: true}).click();
    const download = await exported;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks));
    assert.equal(data.goalTons, 15);
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].tonnage, 2500);
    await page.reload();
    await expect(page.locator('#goalCur')).toHaveText('2,5 т');
    await go('statistics');
    await expect(page.locator('#dashboardActual')).toHaveText('2,5 т');
    const before = await page.evaluate(() => localStorage.getItem('portfolio-tonnage-fallback'));
    await page.locator('[data-stats-tab=production]').click();
    await page.locator('[data-view=year]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('portfolio-tonnage-fallback')), before);
  }, {fallback: true});

  await scenario('Mobile navigation and BG/EN switching preserve live form values', async t => {
    const {page, go} = t;
    await go('index');
    await expect(page.locator('a.tile:visible')).toHaveCount(6);
    await expect(page.locator('a.tile.tasks')).toBeHidden();
    for (const module of ['production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions', 'statistics']) {
      await go('index');
      await page.locator(`a[href="${module}.html"]`).click();
      const brand = page.locator('.hub-brand');
      await expect(brand).toBeVisible();
      assert.equal(await brand.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true, `Local logo loads: ${module}`);
      await expect(page.locator('link[rel=icon]')).toHaveAttribute('href', 'assets/package-hub-mark.svg');
      const editable = page.locator('#tonInput, #noteInput, #searchInput').first();
      if (await editable.isVisible()) await editable.fill(module === 'production-log' ? '567' : 'Fictional search');
      const original = await editable.count() && await editable.isVisible() ? await editable.inputValue() : null;
      await page.locator('[data-hub-language=en]').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      if (original !== null) await expect(editable).toHaveValue(original);
      await page.locator('[data-hub-language=bg]').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'bg');
      if (original !== null) await expect(editable).toHaveValue(original);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `No page overflow: ${module}`);
      await brand.click();
      await expect(page.locator('a.tile:visible')).toHaveCount(6);
    }
  }, {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

  await scenario('Responsive connected modules, expanded tables and dialogs at 320–1440 px', async t => {
    const {page, go, connect} = t;
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({width, height: 900});
      for (const module of ['index', 'production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions', 'statistics']) {
        await go(module);
        if (['production-log', 'line-downtime', 'personnel'].includes(module) && !/\bon\b/.test(await page.locator('#connDot').getAttribute('class'))) await connect('#openFileBtn', module + '.json');
        if (module === 'pair-targets') {
          if (!/\bon\b/.test(await page.locator('#pairsConnDot').getAttribute('class'))) await connect('#pairsOpenFileBtn', 'pair-targets.json', '#pairsConnDot');
          await expect(page.locator('#rosterConnDot')).toHaveClass(/(?:^|\s)on(?:\s|$)/);
        }
        if (module === 'statistics') {
          await page.locator('#statsFilesBtn').click();
          for (const tab of ['overview', 'production', 'pairs', 'downtime', 'workforce']) {
            await page.locator(`[data-stats-tab=${tab}]`).click();
            await assertResponsive(page, `${module}/${tab} at ${width}px`);
          }
        }
        for (const language of ['en', 'bg']) {
          await page.locator(`[data-hub-language=${language}]`).click();
          await assertResponsive(page, `${module}/${language} at ${width}px`);
        }
        if (module === 'production-log') {
          await production(t, '2026-10-05', 'А', 1000, 0, {autoKgInput: 800, autoCrateInput: 32, manKgInput: 200, manCrateInput: 8});
          await page.locator('.history-month summary').first().click();
          await assertResponsive(page, `Production breakdown/history at ${width}px`);
        }
        if (module === 'personnel') {
          if (width === 320) {
            await addPerson(t, 'Demo Responsive Packer One', 'stickers', '1 смяна');
            await addPerson(t, 'Demo Responsive Packer Two', 'stickers', '1 смяна');
          }
          await page.locator('#addPersonBtn').click();
          await assertResponsive(page, `Personnel dialog at ${width}px`);
        }
        if (module === 'pair-targets') {
          await page.locator('#stickersShiftBtn').click();
          await page.locator('#addPairBtn').click();
          await assertResponsive(page, `Pair dialog at ${width}px`);
        }
      }
    }
  }, {viewport: {width: 320, height: 900}, isMobile: true, hasTouch: true});

  console.log(`Browser E2E: ${passed} scenarios passed; ${failures.length} failed.`);
  if (failures.length) throw new Error('Browser E2E failed: ' + failures.join('; '));
}
module.exports = {run};
