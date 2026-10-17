/* All drafts and imports here are fictional and live in the temporary test database. */
const {openAccountMenu} = require('./account-menu.cjs');
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseUnsavedNavigation({admin, base, hub, expect}) {
  const picker = () => admin.locator('#serverModuleSelect');
  async function open(module) {
    const accept = dialog => dialog.accept(); admin.on('dialog',accept);
    try { await admin.goto(base+'/'+module); } finally { admin.off('dialog',accept); }
    await expect(admin.locator('#serverState')).toHaveAttribute('data-connection','ready');
    if(['personnel','package-instructions','production-log','line-downtime'].includes(module)) await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
  }
  async function tryLeave({modal=false}={}) {
    if(modal) await picker().evaluate(node => { node.value='/statistics'; node.dispatchEvent(new Event('change')); });
    else await picker().selectOption('/statistics');
  }
  async function keep(field,value,options) {
    const before=admin.url(), current=await picker().inputValue();
    await tryLeave(options); await expect(admin.locator('#serverLeaveDialog')).toBeVisible();
    await expect(picker()).toHaveValue(current); await admin.locator('#serverLeaveCancel').click();
    assert.equal(admin.url(),before); await expect(admin.locator(field)).toHaveValue(value);
  }
  await open('production-log'); await admin.locator('#tonInput').fill('418'); await admin.locator('#tonInput').fill('0');
  assert.equal(await admin.evaluate(() => !window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  await admin.locator('#tonInput').fill('418');
  await keep('#tonInput','418');
  await admin.locator('.server-bar .hub-brand').click(); await expect(admin.locator('#serverLeaveDialog')).toBeVisible();
  await admin.keyboard.press('Escape'); await expect(admin.locator('#tonInput')).toHaveValue('418');
  await admin.locator('[data-hub-language=en]').click(); await admin.setViewportSize({width:320,height:844}); await tryLeave();
  await expect(admin.locator('#serverLeaveTitle')).toHaveText('Leave with unsaved changes');
  await expect(admin.locator('#serverLeaveCancel')).toBeFocused(); await assertResponsive(admin,'Unsaved navigation EN/320');
  await admin.locator('#serverLeaveCancel').click(); await admin.locator('[data-hub-language=bg]').click(); await tryLeave();
  await expect(admin.locator('#serverLeaveTitle')).toHaveText('Напускане с незапазени промени');
  await assertResponsive(admin,'Unsaved navigation BG/320');
  await admin.locator('#serverLeaveConfirm').click(); await expect(admin).toHaveURL(base+'/statistics');
  await admin.setViewportSize({width:1280,height:800});

  await open('line-downtime'); await admin.locator('#noteInput').fill('Fictional navigation downtime');
  await keep('#noteInput','Fictional navigation downtime');
  const personnel=hub.store.get('personnel');
  hub.store.put('personnel',{...personnel.data,employees:[1,2].map(id=>({id:'demo-navigation-person-'+id,name:'Demo Navigation Person '+id,category:'stickers',team:'1 смяна',role:'Опаковчик',active:true}))},personnel.revision,hub.auth.list()[0]);
  await open('pair-targets'); await expect(admin.locator('#rosterConnDot')).toHaveClass(/\bon\b/);
  await admin.locator('#stickersShiftBtn').click(); await admin.locator('#addPairBtn').click();
  assert.equal(await admin.evaluate(() => !window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  await admin.locator('#targetKg').fill('1250'); await keep('#targetKg','1250',{modal:true});
  await admin.locator('#memberOne').selectOption('demo-navigation-person-1'); await admin.locator('#memberTwo').selectOption('demo-navigation-person-2');
  await admin.locator('#targetKg').fill('1000'); await admin.locator('#targetCrates').fill('40'); await admin.locator('#areaManual').check();
  await admin.locator('#savePairBtn').click(); await expect(admin.locator('#pairDialog')).not.toBeVisible();
  await admin.locator('#pairsList [data-action=edit]').first().click(); await admin.locator('#targetKg').fill('1100');
  await admin.route('**/api/reports/pair-targets/operations',async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await admin.locator('#savePairBtn').click(); await expect(admin.locator('#dialogError')).toHaveAttribute('data-state','unconfirmed');
  await admin.locator('#targetKg').fill('1000');
  assert.equal(hub.store.get('pair-targets').data.entries[0].targetKg,1100);
  assert.equal(await admin.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
  await keep('#targetKg','1000',{modal:true});

  await open('personnel'); await admin.locator('#addPersonBtn').click();
  // Opening a clean editor alone must not trigger the browser warning.
  assert.equal(await admin.evaluate(() => !window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  await admin.locator('#personName').fill('Demo Navigation Person'); await keep('#personName','Demo Navigation Person',{modal:true});
  await admin.keyboard.press('Escape'); await admin.locator('#settingsBtn').click(); await admin.locator('#stickersStage1').fill('8');
  await keep('#stickersStage1','8',{modal:true});
  await open('tasks'); await admin.locator('#newTask').click();
  assert.equal(await admin.evaluate(() => !window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  await admin.locator('#taskTitle').fill('Fictional navigation task'); await keep('#taskTitle','Fictional navigation task',{modal:true});
  await open('package-instructions'); await admin.locator('#addBtn').click();
  assert.equal(await admin.evaluate(() => !window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  await admin.locator('#nameInput').fill('Fictional navigation instruction');
  await admin.locator('#imageFileInput').setInputFiles({name:'demo-note.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional attachment')});
  await keep('#nameInput','Fictional navigation instruction'); await expect(admin.locator('#thumbGrid')).toContainText('demo-note.txt');

  await open('accounts'); await admin.locator('#newAccountButton').click(); await admin.locator('#accountUsername').fill('demo-navigation-draft');
  await keep('#accountUsername','demo-navigation-draft'); await admin.locator('#cancelCreate').click();
  await expect.poll(() => admin.evaluate(() => !window.dispatchEvent(new Event('beforeunload',{cancelable:true})))).toBe(false);
  await picker().selectOption('/statistics'); await expect(admin).toHaveURL(base+'/statistics');
  await open('accounts'); const account=admin.locator('.account-entry').first(); await account.locator('summary').first().click();
  const password=account.locator('input[type=password]'); await account.locator('.account-password summary').click();
  await password.fill('Fictional-navigation-password-123'); await tryLeave(); await expect(admin.locator('#serverLeaveDialog')).toBeVisible();
  await admin.locator('#serverLeaveCancel').click(); await expect(password).toHaveValue('Fictional-navigation-password-123');
  const actor=hub.auth.list()[0];
  hub.store.db.prepare('INSERT INTO notifications(id,user_id,type,target,at,event_key) VALUES(?,?,?,?,?,?)').run('demo-unsaved-notification',actor.id,'productionAdded','demo-unsaved-report',Date.now(),'demo-unsaved-event');
  await open('notifications'); await admin.locator('#notificationSettingsTab').click();
  const preference=admin.locator('#notificationPreferences input').first(); await preference.setChecked(!await preference.isChecked());
  await admin.locator('#notificationInboxTab').click();
  await expect(admin.locator('.notification-open').first()).toBeVisible();
  const declineNotification=dialog=>dialog.dismiss(); admin.on('dialog',declineNotification);
  try { await admin.locator('.notification-open').first().click(); await expect(admin.locator('#serverLeaveDialog')).toBeVisible(); }
  finally { admin.off('dialog',declineNotification); }
  await admin.locator('#serverLeaveCancel').click();
  assert.equal(hub.store.db.prepare('SELECT read_at FROM notifications WHERE id=?').get('demo-unsaved-notification').read_at,null);
  await admin.locator('#notificationSettingsTab').click();
  await tryLeave(); await expect(admin.locator('#serverLeaveDialog')).toBeVisible(); await admin.locator('#serverLeaveCancel').click();
  let releasePreferences,preferenceWrites=0; const preferenceGate=new Promise(resolve=>{releasePreferences=resolve;});
  const holdPreferences=async route=>{preferenceWrites++;await preferenceGate;await route.continue().catch(()=>{});};
  await admin.route('**/api/notifications/preferences',holdPreferences);
  try {
    await admin.locator('#notificationPreferences button[type=submit]').click(); await expect.poll(()=>preferenceWrites).toBe(1);
    await expect(preference).toBeDisabled(); releasePreferences();
    await expect(admin.locator('#notificationMessage')).toHaveText('Настройките са запазени.');
  } finally {releasePreferences();await admin.unroute('**/api/notifications/preferences',holdPreferences);}
  await expect.poll(() => admin.evaluate(() => !window.dispatchEvent(new Event('beforeunload',{cancelable:true})))).toBe(false);
  await picker().selectOption('/statistics'); await expect(admin).toHaveURL(base+'/statistics');
  await open('notifications');
  let releaseRead,reads=0; const readGate=new Promise(resolve=>{releaseRead=resolve;});
  const holdRead=async route=>{reads++;await readGate;await route.continue().catch(()=>{});};
  await admin.route('**/api/notifications/read',holdRead);
  try {
    await admin.locator('.notification-open').first().click(); await expect.poll(()=>reads).toBe(1);
    await expect(admin.locator('body')).toHaveAttribute('inert','');
    assert.equal(await admin.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
    releaseRead(); await expect(admin).toHaveURL(new RegExp('/production-log\\?'));
  } finally {releaseRead();await admin.unroute('**/api/notifications/read',holdRead);}
  await open('data-import'); await admin.locator('#moduleFiles').setInputFiles({name:'production-log.json',mimeType:'application/json',buffer:Buffer.from('{"entries":[],"goalTons":0}')});
  await tryLeave(); await expect(admin.locator('#serverLeaveDialog')).toBeVisible(); await admin.locator('#serverLeaveCancel').click();
  assert.equal(await admin.locator('#moduleFiles').evaluate(node=>node.files.length),1);
  await open('data-import'); await admin.locator('#importFile').setInputFiles({name:'demo-production.json',mimeType:'application/json',buffer:Buffer.from('{"entries":[],"goalTons":0}')});
  await tryLeave(); await expect(admin.locator('#serverLeaveDialog')).toBeVisible(); await admin.locator('#serverLeaveCancel').click();
  assert.equal(await admin.locator('#importFile').evaluate(node=>node.files.length),1);

  await open('production-log'); await admin.locator('#tonInput').fill('123');
  let dialogs=0; const decline=async dialog=>{dialogs++; assert.equal(dialog.type(),'beforeunload'); await dialog.dismiss();};
  admin.on('dialog',decline);
  try { await admin.reload({timeout:3000}).catch(()=>{}); } finally { admin.off('dialog',decline); }
  assert.equal(dialogs,1); await expect(admin.locator('#tonInput')).toHaveValue('123');
  // Logout cancellation must retain the authenticated session as well as the draft.
  await openAccountMenu(admin); await admin.locator('.server-logout').click(); await expect(admin.locator('#serverLeaveDialog')).toBeVisible();
  await admin.locator('#serverLeaveCancel').click();
  assert.equal(await admin.evaluate(async()=> (await fetch('/api/tasks/summary')).status),200);
  let release,writes=0; const gate=new Promise(resolve=>{release=resolve;});
  let cleaning=false;
  const hold=async route=>{writes++;await gate;await route.continue().catch(error=>{if(!cleaning) throw error;});};
  await admin.route('**/api/reports/production-log/operations',hold);
  try {
    await admin.locator('.shift-btn[data-shift="СТИКЕРИ"]').click(); await admin.locator('#saveBtn').click(); await expect.poll(()=>writes).toBe(1);
    await tryLeave({modal:true}); await expect(admin.locator('#serverLeaveFeedback')).toContainText('Изчакай текущия запис');
    await expect(admin.locator('#serverLeaveDialog')).not.toBeVisible(); await expect(admin.locator('#tonInput')).toHaveValue('123');
    release(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
    assert.equal(await admin.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
    await picker().selectOption('/statistics'); await expect(admin).toHaveURL(base+'/statistics');
  } finally {cleaning=true;release();await admin.unroute('**/api/reports/production-log/operations',hold);}
  for(const [status,state] of [[403,'rejected'],[409,'conflict'],[0,'unconfirmed']]) {
    await open('production-log'); await admin.locator('#tonInput').fill('222'); await admin.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();
    await admin.route('**/api/reports/production-log/operations',async route=>{
      if(status) await route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:status===409?'CONFLICT':'FORBIDDEN'})});
      else {await route.fetch();await route.abort('failed');}
    },{times:1});
    await admin.locator('#saveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state',state);
    await keep('#tonInput','222');
    if(state==='unconfirmed') {
      const count=hub.store.get('production-log').data.entries.length;
      await admin.locator('#retrySaveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
      assert.equal(hub.store.get('production-log').data.entries.length,count);
      assert.equal(await admin.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
    }
  }
  await open('production-log'); await admin.locator('#tonInput').fill('456');
  let releaseLogout,logouts=0; const logoutGate=new Promise(resolve=>{releaseLogout=resolve;});
  const holdLogout=async route=>{logouts++;await logoutGate;await route.continue().catch(()=>{});};
  await admin.route('**/api/logout',holdLogout);
  try {
    await openAccountMenu(admin); await admin.locator('.server-logout').click(); await admin.locator('#serverLeaveConfirm').click(); await expect.poll(()=>logouts).toBe(1);
    await expect(admin.locator('body')).toHaveAttribute('inert','');
    assert.equal(await admin.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
    releaseLogout(); await expect(admin).toHaveURL(base+'/login');
  } finally {releaseLogout();await admin.unroute('**/api/logout',holdLogout);}
  console.log('PASS unsaved navigation, clean editors, attachments, imports, logout, reload, pending writes, BG/EN and mobile');
}
module.exports={exerciseUnsavedNavigation};
