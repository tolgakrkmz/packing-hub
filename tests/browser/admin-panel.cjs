const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
async function openAdminModule(page, module) {
  await page.locator('.server-links a').click();
  await page.locator('.admin-card[data-module="'+module+'"]').click();
}
async function exerciseAdminPanel({admin,hub,base,device,expect,screenshotDir}) {
  await expect(admin.locator('.server-links a')).toHaveCount(1);
  await expect(admin.locator('.server-links a')).toHaveText('Админ панел');
  await admin.locator('.server-links a').click();
  await expect(admin.locator('h1')).toHaveText('Админ панел');
  await expect(admin.locator('.admin-card:visible')).toHaveCount(4);
  await expect(admin.locator('.server-links a')).toHaveAttribute('aria-current','page');
  await admin.locator('[data-module=accounts]').focus();
  await admin.keyboard.press('Enter');
  await expect(admin.locator('h1')).toHaveText('Потребители');
  await expect(admin.locator('.server-links a')).toHaveAttribute('aria-current','location');
  for (const module of ['activity-log','system-status']) {
    await openAdminModule(admin,module);
    await expect(admin).toHaveURL(base+'/'+module+'.html');
    await expect(admin.locator('.server-links a')).toHaveCount(1);
    await expect(admin.locator('.server-links a')).toHaveAttribute('aria-current','location');
  }
  for (const module of ['production-log','line-downtime','pair-targets']) {
    await admin.goto(base+'/'+module+'.html');
    await expect(admin.locator('.server-links a')).toHaveAttribute('href','/admin-panel.html?module='+module);
    await openAdminModule(admin,'data-import');
    await expect(admin.locator('#reportExportKind')).toHaveValue(module);
  }
  await admin.goto(base+'/admin-panel.html?module=unapproved');
  await expect(admin.locator('#adminTransfer')).toHaveAttribute('href','data-import.html');
  for (const language of ['bg','en']) {
    await admin.locator('[data-hub-language='+language+']').click();
    await expect(admin.locator('h1')).toHaveText(language === 'en' ? 'Admin panel' : 'Админ панел');
    if (language === 'en') assert.doesNotMatch(await admin.locator('#adminModules').innerText(),/[А-Яа-я]/);
    for (const width of [320,390,768,1440]) {
      await admin.setViewportSize({width,height:1000});
      await assertResponsive(admin,'Admin panel '+language+' at '+width+'px');
      if (screenshotDir && [390,1440].includes(width)) {
        require('node:fs').mkdirSync(screenshotDir,{recursive:true});
        await admin.screenshot({path:require('node:path').join(screenshotDir,'admin-panel-'+language+'-'+width+'.png'),fullPage:true});
      }
    }
  }
  await admin.locator('[data-hub-language=bg]').click();
  for (const role of ['operator','observer']) {
    const username='demo-panel-'+role;
    await hub.auth.create(username,'Fictional-password-123',role);
    const page=await device(username,true);
    await expect(page.locator('.server-links a')).toHaveCount(1);
    await expect(page.locator('.server-links a')).toHaveText('Админ панел');
    for (const method of ['GET','HEAD']) assert.equal((await page.request.fetch(base+'/admin-panel.html',{method})).status(),200);
    await page.locator('.server-links a').click();
    await expect(page.locator('.admin-card:visible')).toHaveCount(1);
    await page.locator('#adminTransfer').click();
    await expect(page.locator('#reportExport')).toBeVisible();
    await page.context().close();
  }
  for (const [suffix,permissions,description] of [
    ['export',{canImportData:false},'Сваляне на текущите отчети.'],
    ['import',{canExportReports:false},'Добавяне и проверка на данни.'],
    ['neither',{canImportData:false,canExportReports:false},null]
  ]) {
    const username='demo-panel-'+suffix;
    await hub.auth.create(username,'Fictional-password-123','admin',undefined,permissions);
    const page=await device(username,true);
    await page.locator('.server-links a').click();
    await expect(page.locator('.admin-card:visible')).toHaveCount(description ? 4 : 3);
    if (description) {
      await expect(page.locator('#adminTransferDescription')).toHaveText(description);
      await page.locator('#adminTransfer').click();
      await expect(page.locator('[data-transfer-tab='+ (suffix === 'export' ? 'export' : 'production')+']')).toBeVisible();
    } else {
      await expect(page.locator('#adminTransfer')).toBeHidden();
      assert.equal((await page.request.get(base+'/data-import.html')).status(),403);
    }
    await page.context().close();
  }
  await admin.setViewportSize({width:1440,height:1000});
  console.log('PASS single admin header entry, module navigation, report context, permissions, keyboard and BG/EN responsive layouts');
}
module.exports={openAdminModule,exerciseAdminPanel};
