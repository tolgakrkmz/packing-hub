/* Every account, selected file and download belongs to the isolated demo server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');
const {openAdminModule} = require('./admin-panel.cjs');
const password = 'Fictional-password-123';

async function exerciseDataTransfer({admin, hub, base, device, expect, screenshotDir}) {
  console.log('RUN unified transfer screen, retained previews and permission boundaries');
  const kinds = ['production-log','line-downtime','pair-targets'];
  const before = kinds.map(kind => hub.store.get(kind).data);
  await admin.goto(base + '/production-log.html');
  await expect(admin.locator('.server-bar #reportExport, .server-bar #reportExportKind')).toHaveCount(0);
  await openAdminModule(admin,'data-import');
  await expect(admin.locator('[data-transfer-tab=export]')).toHaveAttribute('aria-selected', 'true');
  await expect(admin.locator('#reportExportKind')).toHaveValue('production-log');
  await admin.goto(base + '/data-import.html#constructor');
  await expect(admin.locator('[data-transfer-tab=export]')).toHaveAttribute('aria-selected', 'true');
  await admin.goto(base + '/production-import.html');
  await expect(admin).toHaveURL(base + '/data-import.html#production');
  await expect(admin.locator('#importFile')).toBeVisible();
  const history = {goalTons:9999, entries:[{id:'demo-transfer-history', date:'2026-10-04', shift:'А', tonnage:1600, brak:16, breakdown:null}]};
  const selected = {name:'production-log.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(history))};
  await admin.locator('#importFile').setInputFiles(selected);
  await admin.locator('#previewImport').click();
  await expect(admin.locator('#applyImport')).toBeEnabled();
  await expect(admin.locator('[data-field=added]')).toHaveText('1');
  await admin.locator('[data-transfer-tab=modules]').click();
  await expect(admin.locator('#moduleFiles')).toBeVisible();
  await expect(admin.locator('#legacyFolder')).toBeVisible();
  await admin.locator('#moduleFiles').setInputFiles(selected);
  await admin.locator('#includeSettings').uncheck();
  await admin.locator('#checkDataImport').click();
  await expect(admin.locator('#batchPreview')).toBeVisible();
  await expect(admin.locator('#confirmDataImport')).toBeEnabled();
  await expect(admin.locator('[data-module=production-log] td').nth(2)).toHaveText('1');
  await admin.locator('[data-transfer-tab=export]').click();
  for (const kind of kinds) {
    await admin.locator('#reportExportKind').selectOption(kind);
    await expect(admin.locator('#reportExport')).toHaveAttribute('href', '/api/export/' + kind);
    const pending = admin.waitForEvent('download'); await admin.locator('#reportExport').click();
    const download = await pending, chunks = [];
    assert.equal(download.suggestedFilename(), kind + '.json');
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), hub.store.get(kind).data);
  }
  await admin.locator('[data-transfer-tab=production]').click();
  assert.equal(await admin.locator('#importFile').evaluate(element => element.files[0].name), 'production-log.json');
  await expect(admin.locator('#applyImport')).toBeEnabled();
  await expect(admin.locator('[data-field=added]')).toHaveText('1');
  await admin.locator('[data-transfer-tab=modules]').click();
  await expect(admin.locator('#confirmDataImport')).toBeEnabled();
  assert.equal(await admin.locator('#moduleFiles').evaluate(element => element.files.length), 1);

  for (const width of [320,390,768,1440]) {
    await admin.setViewportSize({width,height:1000});
    for (const language of ['en','bg']) {
      await admin.locator(`[data-hub-language=${language}]`).click();
      await expect(admin.locator('h1')).toHaveText(language === 'en' ? 'Import & export' : 'Импорт и експорт');
      for (const section of ['export','production','modules']) {
        await admin.locator(`[data-transfer-tab=${section}]`).click();
        await expect(admin.locator(`[data-transfer-panel=${section}]`)).toBeVisible();
        await expect(admin.locator('[data-transfer-panel]:visible')).toHaveCount(1);
        await assertResponsive(admin, `Transfer ${section}/${language} at ${width}px`);
        if (language === 'en') {
          const text = await admin.locator(`[data-transfer-panel=${section}]`).innerText();
          assert.doesNotMatch(text, /[А-Яа-я]/, 'Visible transfer controls translate to English');
        }
      }
    }
  }
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive:true});
    await admin.screenshot({path:path.join(screenshotDir, 'transfer-modules-desktop.png'), fullPage:true});
    await admin.setViewportSize({width:390,height:1000});
    await admin.screenshot({path:path.join(screenshotDir, 'transfer-modules-mobile.png'), fullPage:true});
    await admin.locator('[data-transfer-tab=export]').click();
    await admin.screenshot({path:path.join(screenshotDir, 'transfer-export-mobile.png'), fullPage:true});
  }
  await admin.locator('[data-transfer-tab=export]').focus();
  await admin.keyboard.press('ArrowRight');
  await expect(admin.locator('[data-transfer-tab=production]')).toHaveAttribute('aria-selected', 'true');
  await admin.keyboard.press('End');
  await expect(admin.locator('[data-transfer-tab=modules]')).toHaveAttribute('aria-selected', 'true');
  await admin.locator('#cancelDataImport').click();
  await expect(admin.locator('#dataImportMessage')).toContainText('Импортът е отказан');
  for (const [index, kind] of kinds.entries()) assert.deepEqual(hub.store.get(kind).data, before[index]);

  for (const [suffix, role, permissions] of [
    ['operator','operator',{}], ['observer','observer',{}],
    ['export-admin','admin',{canImportData:false}], ['import-admin','admin',{canExportReports:false}],
    ['denied','operator',{canExportReports:false}]
  ]) {
    const username = 'demo-transfer-' + suffix;
    await hub.auth.create(username, password, role, undefined, permissions);
    const page = await device(username, true);
    const canImport = role === 'admin' && permissions.canImportData !== false;
    const canExport = permissions.canExportReports !== false;
    await expect(page.locator('.server-bar #reportExport, .server-bar #reportExportKind')).toHaveCount(0);
    if (!canImport && !canExport) {
      await expect(page.getByRole('link', {name:'Импорт / експорт', exact:true})).toHaveCount(0);
      assert.equal(await page.evaluate(async () => (await fetch('/data-import.html')).status), 403);
    } else {
      if (role === 'admin') await openAdminModule(page,'data-import');
      else await page.getByRole('link', {name:'Импорт / експорт', exact:true}).click();
      await page.goto(base + '/data-import.html#' + (canImport ? 'export' : 'modules'));
      await expect(page.locator(`[data-transfer-tab=${canExport ? 'export' : 'production'}]`)).toHaveAttribute('aria-selected', 'true');
      assert.equal(await page.evaluate(async () => (await fetch('/data-import.html')).status), 200);
      if (canExport) await expect(page.locator('[data-transfer-tab=export]')).toBeVisible();
      else await expect(page.locator('[data-transfer-tab=export]')).toBeHidden();
      for (const section of ['production','modules']) {
        if (canImport) {
          await expect(page.locator(`[data-transfer-tab=${section}]`)).toBeVisible();
          await expect(page.locator(`[data-transfer-controls=${section}]`)).toHaveJSProperty('disabled', false);
        } else {
          await expect(page.locator(`[data-transfer-tab=${section}]`)).toBeHidden();
          await expect(page.locator(`[data-transfer-controls=${section}]`)).toHaveJSProperty('disabled', true);
          await expect(page.locator(section === 'production' ? '#importFile' : '#moduleFiles')).toBeDisabled();
        }
      }
      if (canExport) await expect(page.locator('#reportExport')).toBeVisible();
      else assert.equal(await page.evaluate(async () => (await fetch('/api/export/production-log')).status), 403);
      if (!canImport) {
        assert.equal(await page.evaluate(async () => (await fetch('/production-import.html')).status), 403);
        const status = await page.evaluate(async () => (await HubServer.json('/api/import/production-log/preview', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{"entries":[]}'}).catch(error => ({status:error.status}))).status);
        assert.equal(status, 403);
      }
      await assertResponsive(page, `Transfer ${suffix} at 390px`);
    }
    await page.context().close();
  }
  await admin.goto(base + '/index.html');
  console.log('PASS unified transfers, JSON downloads, drafts, BG/EN, keyboard and role permissions');
}

async function exerciseOfflineTransfer(browser, base, expect) {
  const context = await browser.newContext(), page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base + '/data-import.html');
  await expect(page.locator('#transferOffline')).toBeVisible();
  await expect(page.locator('#transferNavigation')).toBeHidden();
  await expect(page.locator('[data-transfer-panel]:visible')).toHaveCount(0);
  for (const id of ['importFile','moduleFiles','legacyFolder']) await expect(page.locator('#' + id)).toBeDisabled();
  await page.locator('[data-hub-language=en]').click();
  await expect(page.locator('#transferOffline')).toContainText('This page works in server mode.');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await context.close(); console.log('PASS offline transfer notice with disabled controls and no API requests');
}
module.exports = {exerciseDataTransfer, exerciseOfflineTransfer};
