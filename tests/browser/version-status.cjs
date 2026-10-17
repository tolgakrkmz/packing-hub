/* Version details in the account menu against an isolated server; fictional drafts only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseVersionStatus({admin,base,expect,screenshotDir}) {
  console.log('RUN version details: same/different versions, reconnect, active save, BG/EN and 320 px');
  await admin.context().addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url,options) { super(url,options); if(url === '/api/events') window.__versionStatusSource = this; }
    };
  });
  const emit = (type,version) => admin.evaluate(([type,version]) => window.__versionStatusSource.dispatchEvent(type === 'version'
    ? new MessageEvent('version',{data:JSON.stringify({version:version || window.HUB_SERVER_BOOT.version})}) : new Event(type)),[type,version]);
  const state = admin.locator('#serverVersionStatus'), info = admin.locator('#serverVersionInfo');
  async function openMenu() {
    if(await admin.locator('#serverAccountMenu').isHidden()) {
      await admin.locator('#serverAccountButton').focus(); await admin.keyboard.press('ArrowDown');
    }
    await expect(info).toBeVisible();
  }
  async function closeMenu() { await admin.keyboard.press('Escape'); await expect(info).toBeHidden(); }

  await admin.goto(base + '/production-log');
  await expect(admin.locator('#serverState')).toHaveAttribute('data-connection','ready');
  await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
  const loaded = await admin.evaluate(() => window.HUB_SERVER_BOOT.version);
  await openMenu();
  await expect(admin.locator('#serverClientVersion')).toHaveText(loaded);
  await expect(admin.locator('#serverConfirmedVersion')).toHaveText(loaded);
  await expect(state).toHaveAttribute('data-update-state','current'); await expect(state).toHaveText('Актуална версия');
  await expect(admin.locator('#serverVersionChecked')).toHaveText(/^\d\d\.\d\d \d\d:\d\d$/);
  await expect(admin.locator('#serverVersionUpdate')).toBeHidden();

  // A lost connection keeps the last confirmed version; reconnect is not "current" until the server confirms again.
  await emit('error'); await expect(state).toHaveAttribute('data-update-state','offline');
  await expect(admin.locator('#serverVersionHint')).toHaveText('Показана е последната потвърдена версия. Тя може да е остаряла.');
  await expect(admin.locator('#serverConfirmedVersion')).toHaveText(loaded);
  await emit('open'); await expect(state).toHaveAttribute('data-update-state','checking'); await expect(state).toHaveText('Проверка…');
  await emit('version'); await expect(state).toHaveAttribute('data-update-state','current');
  await expect(admin.locator('#serverVersionHint')).toBeHidden(); await closeMenu();

  for(const width of [320,390]) {
    await admin.setViewportSize({width,height:740});
    for(const language of ['en','bg']) {
      await admin.locator('[data-hub-language=' + language + ']').click(); await openMenu();
      await expect(admin.locator('#serverVersionTitle')).toHaveText(language === 'en' ? 'Version and updates' : 'Версия и обновяване');
      await expect(state).toHaveText(language === 'en' ? 'Up to date' : 'Актуална версия');
      await expect(admin.locator('#serverClientVersion')).toHaveText(loaded);
      await assertResponsive(admin,'Version details at ' + width + ' px (' + language + ')');
      if(screenshotDir) { fs.mkdirSync(screenshotDir,{recursive:true}); await admin.screenshot({path:path.join(screenshotDir,'version-status-' + width + '-' + language + '.png')}); }
      await closeMenu();
    }
  }
  await admin.setViewportSize({width:1280,height:800});

  // A different version uses the existing guarded update: no automatic reload and the draft survives.
  await admin.locator('#tonInput').fill('319');
  await emit('version','demo-status-next'); await openMenu();
  await expect(state).toHaveAttribute('data-update-state','update'); await expect(state).toHaveText('Има нова версия');
  await expect(admin.locator('#serverConfirmedVersion')).toHaveText('demo-status-next');
  await expect(admin.locator('#serverClientVersion')).toHaveText(loaded);
  await admin.locator('#serverVersionUpdate').focus(); await admin.keyboard.press('Enter');
  await expect(admin.locator('#serverUpdateDialog')).toBeVisible();
  assert.equal(await admin.evaluate(() => document.activeElement.id),'serverUpdateCancel');
  await admin.locator('#serverUpdateCancel').click(); await expect(admin.locator('#serverUpdateDialog')).not.toBeVisible();
  await expect(admin.locator('#tonInput')).toHaveValue('319');
  assert.equal(await admin.evaluate(() => document.activeElement.id),'serverUpdate');
  await emit('error'); await openMenu();
  await expect(state).toHaveAttribute('data-update-state','offline'); await expect(admin.locator('#serverVersionUpdate')).toBeHidden();
  await closeMenu(); await emit('open'); await emit('version','demo-status-next');

  // During an active save every update entry is locked and the form value remains.
  await admin.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();
  let release, writes = 0; const gate = new Promise(resolve => { release = resolve; });
  const hold = async route => { writes++; await gate; await route.continue(); };
  await admin.route('**/api/reports/production-log/operations',hold);
  try {
    await openMenu(); await expect(admin.locator('#serverVersionUpdate')).toBeVisible();
    await expect(admin.locator('#saveBtn')).toBeEnabled(); await admin.locator('#saveBtn').evaluate(node => node.click()); await expect.poll(() => writes).toBe(1);
    await expect(admin.locator('#serverVersionUpdate')).toBeDisabled(); await expect(admin.locator('#serverUpdate')).toBeDisabled();
    await expect(admin.locator('#tonInput')).toHaveValue('319');
    release(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
  } finally { release(); await admin.unroute('**/api/reports/production-log/operations',hold); }
  await openMenu(); await expect(admin.locator('#serverVersionUpdate')).toBeEnabled();
  await Promise.all([admin.waitForEvent('load'),admin.locator('#serverVersionUpdate').click()]);
  await openMenu(); await expect(state).toHaveAttribute('data-update-state','current');
  await expect(admin.locator('#serverVersionUpdate')).toBeHidden(); await closeMenu();

  await admin.goto(base + '/report-history'); await openMenu();
  await expect(state).toHaveAttribute('data-update-state','manual'); await expect(state).toHaveText('Без автоматична проверка');
  await expect(admin.locator('#serverConfirmedVersion')).toHaveText('Не е потвърдена');
  console.log('PASS version details stay reachable, unknown states are not current and updates stay guarded');
}
module.exports = {exerciseVersionStatus};
