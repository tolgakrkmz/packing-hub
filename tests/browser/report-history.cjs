/* Only isolated fictional records and accounts enter these browser scenarios. */
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseReportHistory({admin,hub,base,device,expect,screenshotDir}) {
  const actor = hub.auth.list()[0];
  const row = {id:'demo-browser-history',date:'2026-10-05',shift:'СТИКЕРИ',tonnage:1000,brak:10};
  const current = () => hub.store.get('production-log');
  const operate = (action, extra = {}) => hub.store.reportOperation('production-log',{
    operationId:randomUUID(),action,entryId:row.id,reason:'Fictional historical report',...extra
  },action === 'create' ? undefined : current().versions[row.id],actor);
  async function reason(page, text) {
    await expect(page.locator('#reportCorrectionDialog')).toBeVisible();
    await page.locator('#reportCorrectionReason').fill(text);
    await page.locator('#reportCorrectionConfirm').click();
  }
  async function loseResponse() {
    const url = '**/api/reports/production-log/operations';
    await admin.route(url,async route => {
      const response = await route.fetch(); assert.equal(response.status(),200);
      await route.abort('failed'); await admin.unroute(url);
    },{times:1});
  }
  async function openHistory() {
    await admin.goto(base+'/report-history?module=production-log&entryId='+row.id);
    await expect(admin.locator('#historyDetail')).toContainText(row.id);
  }
  operate('create',{entry:row});
  const requests = [], recordRequest = request => {
    const url=new URL(request.url());
    if(url.pathname.startsWith('/api/') && new URL(request.frame().url()).pathname === '/report-history') requests.push(url);
  };
  admin.on('request',recordRequest);
  await admin.goto(base+'/report-history');
  await expect(admin.locator('#historyKind')).toHaveValue('production-log');
  await admin.clock.runFor(65000);
  await admin.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.deepEqual(requests,[]); // No history, SSE, badges, notification polling or preferences.
  await admin.locator('#historyKind').selectOption('line-downtime');
  await admin.locator('#historyKind').selectOption('production-log');
  await admin.locator('#historyDate').fill('2026-10-05');
  assert.equal(requests.length,0);
  await admin.locator('#historyRefresh').click();
  await expect(admin.locator('#historyRecords button')).toHaveCount(1);
  assert.equal(requests.length,1); assert.equal(requests[0].searchParams.get('date'),'2026-10-05');
  await admin.locator('[data-entry-id="'+row.id+'"]').click();
  await expect(admin.locator('#historyDetail .history-event')).toHaveCount(1);
  assert.equal(requests.length,2);assert.equal(requests[1].searchParams.get('metadata'),'1');
  await expect(admin.locator('.history-snapshot')).toHaveCount(0);
  const fold=admin.locator('.history-event details').nth(1);
  await fold.locator('summary').click();await expect(fold).toContainText('1000');
  assert.equal(requests.length,3);assert.ok(requests[2].searchParams.has('version'));
  await fold.locator('summary').click();await fold.locator('summary').click();
  await expect(fold).toContainText('1000');assert.equal(requests.length,3);
  admin.off('request',recordRequest);
  await admin.goto(base+'/production-log');
  await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
  await admin.locator('.edit-report-btn').first().click();
  await admin.locator('#tonInput').fill('1200'); await admin.locator('#saveBtn').click();
  await expect(admin.locator('#reportCorrectionDialog')).toBeVisible();
  await admin.locator('#reportCorrectionConfirm').click();
  await expect(admin.locator('#reportCorrectionDialog')).toBeVisible();
  for (const language of ['bg','en']) {
    await admin.evaluate(lang=>HubI18n.setLanguage(lang),language);
    await expect(admin.locator('#reportCorrectionTitle')).toHaveText(language === 'en' ? 'Reason for the change' : 'Причина за промяната');
    await expect(admin.locator('#reportCorrectionConfirm')).toHaveText(language === 'en' ? 'Confirm' : 'Потвърди');
    for (const width of [320,390,1440]) {
      await admin.setViewportSize({width,height:1000});await assertResponsive(admin,'Reason '+language+' '+width);
      if(screenshotDir && width === 390) { fs.mkdirSync(screenshotDir,{recursive:true}); await admin.screenshot({path:path.join(screenshotDir,'correction-reason-'+language+'-'+width+'.png'),fullPage:true}); }
    }
  }
  await admin.evaluate(()=>HubI18n.setLanguage('bg'));
  await admin.locator('#reportCorrectionCancel').click();
  assert.equal(current().data.entries[0].tonnage,1000);
  await expect(admin.locator('#tonInput')).toHaveValue('1200');
  await loseResponse(); await admin.locator('#saveBtn').click();
  await reason(admin,'Fictional browser correction');
  await expect(admin.locator('#msg')).toHaveAttribute('data-state','unconfirmed');
  const editedRevision = current().revision;
  await admin.locator('#saveBtn').click();
  await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
  await expect(admin.locator('#reportCorrectionDialog')).toHaveCount(0);
  assert.equal(current().revision,editedRevision); // The original reason and operation ID survive.
  admin.once('dialog',dialog=>dialog.accept());
  await admin.locator('.del-btn').first().click(); await reason(admin,'Fictional browser deletion');
  await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
  await openHistory();
  await expect(admin.locator('#historyDetail')).toContainText('Fictional browser correction');
  await admin.locator('#historyRestore').click(); await reason(admin,'Fictional browser restore');
  await expect(admin.locator('#historyMessage')).toHaveAttribute('data-state','success');
  assert.equal(current().data.entries.filter(item=>item.id===row.id).length,1);
  assert.equal(current().data.entries[0].tonnage,1200);

  for (const language of ['bg','en']) {
    await admin.locator('[data-hub-language='+language+']').click();
    await expect(admin.locator('h1')).toHaveText(language === 'en' ? 'Report history' : 'История на отчетите');
    if(language === 'en') {
      const presentation = await admin.evaluate(() => {
        const walker=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT);
        const texts=[];while(walker.nextNode()) if(!walker.currentNode.parentElement.closest('[translate=no]')) texts.push(walker.currentNode.textContent);
        return texts.join(' ');
      });
      assert.doesNotMatch(presentation,/[А-Яа-я]/);
    }
    for (const width of [320,390,768,1440]) {
      await admin.setViewportSize({width,height:1000});await assertResponsive(admin,'History '+language+' '+width);
      if(screenshotDir && [390,1440].includes(width)) {
        fs.mkdirSync(screenshotDir,{recursive:true});
        await admin.screenshot({path:path.join(screenshotDir,'report-history-'+language+'-'+width+'.png'),fullPage:true});
      }
    }
  }
  await admin.locator('[data-hub-language=bg]').click();
  operate('delete',{reason:'Fictional retry deletion'}); await openHistory();
  await loseResponse(); await admin.locator('#historyRestore').click(); await reason(admin,'Fictional interrupted restore');
  await expect(admin.locator('#historyMessage')).toHaveAttribute('data-state','unconfirmed');
  const restoredRevision=current().revision;
  await admin.locator('#historyRestore').click();
  await expect(admin.locator('#historyMessage')).toHaveAttribute('data-state','success');
  assert.equal(current().revision,restoredRevision);
  assert.equal(hub.store.reportHistory('production-log',row.id,actor).events.filter(event=>event.reason==='Fictional interrupted restore').length,1);

  operate('delete',{reason:'Fictional conflict deletion'});await openHistory();
  const deleted=hub.store.reportHistory('production-log',row.id,actor);
  hub.store.reportOperation('production-log',{operationId:randomUUID(),action:'restore',entryId:row.id,sourceVersion:deleted.version,reason:'Fictional other-device restore'},deleted.version,actor);
  operate('update',{entry:{...row,tonnage:1500},reason:'Fictional newer correction'});
  await admin.locator('#historyRestore').click();await reason(admin,'Fictional stale restore');
  await expect(admin.locator('#historyMessage')).toHaveAttribute('data-state','conflict');
  await expect(admin.locator('#historyRestore')).toBeDisabled();
  assert.equal(current().data.entries[0].tonnage,1500);
  await admin.locator('#historyRefresh').click();
  await admin.locator('[data-entry-id="'+row.id+'"]').click();
  await expect(admin.locator('#historyDetail')).toContainText('Fictional newer correction');
  await expect(admin.locator('#historyRestore')).toHaveCount(0);

  await hub.auth.create('demo-history-browser-editor','Fictional-password-123','observer',actor,{canEditDowntime:true});
  const editor=await device('demo-history-browser-editor');await editor.goto(base+'/report-history');
  await expect(editor.locator('#historyKind option')).toHaveCount(1);
  await expect(editor.locator('#historyKind')).toHaveValue('line-downtime');
  assert.equal((await editor.request.get(base+'/api/reports/production-log/history?entryId='+row.id)).status(),403);
  await editor.context().close();
  await hub.auth.create('demo-history-browser-observer','Fictional-password-123','observer');
  const observer=await device('demo-history-browser-observer');await observer.goto(base+'/admin-panel');
  await expect(observer.locator('h1')).toHaveText('Тази зона е за администратори');
  await expect(observer.locator('#adminModules')).toHaveCount(0);
  assert.equal((await observer.request.get(base+'/report-history')).status(),403);
  for (const language of ['bg','en']) {
    await observer.locator('[data-hub-language='+language+']').click();
    for (const width of [320,390,1440]) {
      await observer.setViewportSize({width,height:1000});await assertResponsive(observer,'Denied '+language+' '+width);
      if(screenshotDir && [390,1440].includes(width)) await observer.screenshot({path:path.join(screenshotDir,'admin-denied-'+language+'-'+width+'.png'),fullPage:true});
    }
  }
  await observer.context().close();
  const latest=current();
  hub.store.put('production-log',{...latest.data,entries:[...latest.data.entries,...Array.from({length:30},(_,i)=>({...row,id:'demo-demand-page-'+String(i).padStart(2,'0')}))]},latest.revision,actor,'report',false,{reason:'Fictional history fixture'});
  await admin.goto(base+'/report-history');await admin.locator('#historyRefresh').click();
  await expect(admin.locator('#historyRecords button')).toHaveCount(25);
  await admin.locator('#historyRecords button').first().click();
  await expect(admin.locator('#historyDetail')).toContainText('demo-demand-page-00');
  await admin.locator('#historyMore').click();await expect(admin.locator('#historyRecords button')).toHaveCount(31);
  await expect(admin.locator('#historyMore')).toBeHidden();
  const retained=admin.locator('.history-event details').nth(1);
  await retained.locator('summary').click();await expect(retained).toContainText('1000');
  for(const language of ['bg','en']) {
    await admin.locator('[data-hub-language='+language+']').click();
    for(const width of [320,390,768,1440]) {
      await admin.setViewportSize({width,height:1000});await assertResponsive(admin,'Demand history '+language+' '+width);
      if(screenshotDir && language==='bg' && [390,1440].includes(width)) await admin.screenshot({path:path.join(screenshotDir,'history-demand-'+width+'.png'),fullPage:true});
    }
  }
  console.log('PASS zero idle API requests, manual filters, lazy cached snapshots, bounded list pages and retained selection');
  console.log('PASS reason cancel/required/retry, history edit/delete/restore, interrupted restore, newer-version conflict, delegated access, BG/EN responsive layouts and friendly admin denial');
}
module.exports = {exerciseReportHistory};
