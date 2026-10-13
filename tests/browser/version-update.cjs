/* Version updates against an isolated server; only fictional drafts/fixtures. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseVersionUpdate({admin,base,hub,expect}) {
  console.log('RUN safe version updates: six editors, explicit discard, pending saves and unconfirmed responses');
  await admin.context().addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url,options) { super(url,options); if(url === '/api/events') window.__versionTestSource = this; }
    };
  });
  async function open(module) {
    await admin.goto(base + '/' + module);
    await expect(admin.locator('#serverState')).toHaveAttribute('data-connection','ready');
    if(module === 'pair-targets') await expect(admin.locator('#rosterConnDot')).toHaveClass(/\bon\b/);
    else if(['production-log','line-downtime','personnel','package-instructions'].includes(module)) await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
  }
  const announce = () => admin.evaluate(() => window.__versionTestSource.dispatchEvent(new MessageEvent('version',{data:JSON.stringify({version:'demo-next-version'})})));
  async function update({modal = false} = {}) {
    // The server bar is inert behind a modal editor. Invoke its existing handler
    // to prove the guard also protects keyboard/programmatic update attempts.
    if(modal) await admin.locator('#serverUpdate').evaluate(node => node.onclick());
    else await admin.locator('#serverUpdate').click();
    await expect(admin.locator('#serverUpdateDialog')).toBeVisible();
  }
  async function cancelAndKeep(selector,value,options) {
    await announce(); await update(options); await admin.locator('#serverUpdateCancel').click();
    await expect(admin.locator('#serverUpdateDialog')).not.toBeVisible(); await expect(admin.locator(selector)).toHaveValue(value);
  }
  await open('production-log'); await admin.locator('#tonInput').fill('418');
  await cancelAndKeep('#tonInput','418');
  assert.equal(await admin.locator('#serverCurrentVersion').textContent(),await admin.evaluate(() => window.HUB_SERVER_BOOT.version));
  await expect(admin.locator('#serverAvailableVersion')).toHaveText('demo-next-version');
  await admin.setViewportSize({width:390,height:844}); await admin.locator('[data-hub-language=en]').click(); await update();
  await expect(admin.locator('#serverUpdateTitle')).toHaveText('Update with unsaved changes');
  await expect(admin.locator('#serverUpdateCancel')).toHaveText('Return to the form');
  await expect(admin.locator('#serverUpdateConfirm')).toHaveText('Discard changes and update');
  await assertResponsive(admin,'Safe update dialog on mobile');
  assert.equal(await admin.evaluate(() => document.activeElement.id),'serverUpdateCancel');
  await admin.keyboard.press('Escape'); await expect(admin.locator('#tonInput')).toHaveValue('418');
  await admin.locator('[data-hub-language=bg]').click(); await update();
  await expect(admin.locator('#serverUpdateTitle')).toHaveText('Обновяване с незапазени промени');
  await Promise.all([admin.waitForEvent('load'),admin.locator('#serverUpdateConfirm').click()]);
  await expect(admin.locator('#tonInput')).toHaveValue('0'); await expect(admin.locator('#serverUpdate')).toHaveCount(0);
  await announce(); await Promise.all([admin.waitForEvent('load'),admin.locator('#serverUpdate').click()]);
  await expect(admin.locator('#serverUpdateDialog')).toHaveCount(0);
  await admin.setViewportSize({width:1280,height:800});

  await admin.locator('#goalInput').fill('1.5'); await admin.locator('#goalInput').blur();
  await cancelAndKeep('#goalInput','1.5');
  await open('line-downtime'); await admin.locator('#noteInput').fill('Fictional downtime draft');
  await cancelAndKeep('#noteInput','Fictional downtime draft');
  await open('personnel'); await admin.locator('#addPersonBtn').click(); await admin.locator('#personName').fill('Demo Update Person');
  await cancelAndKeep('#personName','Demo Update Person',{modal:true});
  await update({modal:true}); await admin.keyboard.press('Escape');
  await expect(admin.locator('#serverUpdateDialog')).not.toBeVisible();
  await expect(admin.locator('#personModal')).toHaveClass(/\bopen\b/); await expect(admin.locator('#personName')).toHaveValue('Demo Update Person');
  await admin.keyboard.press('Escape'); await admin.locator('#settingsBtn').click(); await admin.locator('#stickersStage1').fill('8');
  await cancelAndKeep('#stickersStage1','8',{modal:true});
  await update({modal:true}); await admin.keyboard.press('Escape');
  await expect(admin.locator('#settingsModal')).toHaveClass(/\bopen\b/); await expect(admin.locator('#stickersStage1')).toHaveValue('8');

  const personnel = hub.store.get('personnel');
  hub.store.put('personnel',{...personnel.data,employees:[1,2].map(id => ({id:'demo-version-person-'+id,name:'Demo Version Person '+id,category:'stickers',team:'1 смяна',role:'Опаковчик',active:true}))},personnel.revision,hub.auth.list()[0]);
  await open('pair-targets'); await admin.locator('#stickersShiftBtn').click(); await admin.locator('#addPairBtn').click();
  await admin.locator('#targetKg').fill('1250'); await cancelAndKeep('#targetKg','1250',{modal:true});
  await open('tasks'); await admin.locator('#newTask').click(); await admin.locator('#taskTitle').fill('Fictional version draft');
  await cancelAndKeep('#taskTitle','Fictional version draft',{modal:true});
  await open('package-instructions'); await admin.locator('#addBtn').click(); await admin.locator('#nameInput').fill('Fictional instruction draft');
  await admin.locator('#imageFileInput').setInputFiles({name:'demo-note.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional attachment')});
  await cancelAndKeep('#nameInput','Fictional instruction draft'); await expect(admin.locator('#thumbGrid')).toContainText('demo-note.txt');
  await admin.locator('#cancelBtn').click(); await admin.locator('#bulkBtn').click(); await admin.locator('#importLayout').selectOption('clients');
  await cancelAndKeep('#importLayout','clients');

  await open('production-log'); await announce(); await admin.locator('#tonInput').fill('125'); await admin.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();
  let release, writes = 0; const gate = new Promise(resolve => { release = resolve; });
  const hold = async route => { writes++; await gate; await route.continue(); };
  await admin.route('**/api/reports/production-log/operations',hold);
  try {
    await admin.locator('#saveBtn').click(); await expect.poll(() => writes).toBe(1);
    await expect(admin.locator('#serverUpdate')).toBeDisabled();
    await admin.locator('#serverUpdate').evaluate(node => node.onclick());
    await expect(admin.locator('#serverUpdateFeedback')).toContainText('Изчакай текущия запис');
    await expect(admin.locator('#tonInput')).toHaveValue('125');
    release(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
    await Promise.all([admin.waitForEvent('load'),admin.locator('#serverUpdate').click()]);
    await expect(admin.locator('#serverUpdateDialog')).toHaveCount(0);
  } finally { release(); await admin.unroute('**/api/reports/production-log/operations',hold); }
  await announce(); await admin.locator('#tonInput').fill('222'); await admin.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();
  await admin.route('**/api/reports/production-log/operations',async route => { await route.fetch(); await route.abort('failed'); },{times:1});
  await admin.locator('#saveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','unconfirmed');
  await update(); await admin.locator('#serverUpdateCancel').click(); await expect(admin.locator('#tonInput')).toHaveValue('222');
  const count = hub.store.get('production-log').data.entries.length;
  await admin.locator('#retrySaveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
  assert.equal(hub.store.get('production-log').data.entries.length,count);
  await Promise.all([admin.waitForEvent('load'),admin.locator('#serverUpdate').click()]);
  await expect(admin.locator('#serverUpdateDialog')).toHaveCount(0);
  console.log('PASS safe version updates preserve editor drafts and attachments; pending/unconfirmed writes are guarded');
}
module.exports = {exerciseVersionUpdate};
