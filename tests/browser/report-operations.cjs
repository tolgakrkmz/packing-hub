/* Two independent browser contexts, real controls and interrupted committed responses. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
const employees = [1,2,3,4].map(id => ({id:'demo-browser-operation-person-'+id,name:'Demo Browser Operation Person '+id,category:'stickers',team:'1 смяна',role:'Опаковчик',active:true}));
async function exerciseReportOperations({admin,hub,base,device,expect}) {
  const second = await device('demo-admin');
  const pages = [admin,second];
  const current = kind => hub.store.get(kind);
  async function simultaneously(kind,actions) {
    let arrived = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const handlers = pages.map(() => async route => { arrived++; await gate; await route.continue(); });
    const url = '**/api/reports/'+kind+'/operations';
    for(const [i,page] of pages.entries()) await page.route(url,handlers[i]);
    try {
      const clicks = Promise.all(actions.map(action => action()));
      await expect.poll(() => arrived).toBe(2); release(); await clicks;
      await expect.poll(() => hub.store.db.prepare('SELECT count(*) AS n FROM report_operations WHERE kind=?').get(kind).n).toBeGreaterThan(0);
    } finally {
      release();
      for(const [i,page] of pages.entries()) await page.unroute(url,handlers[i]);
    }
  }
  async function loseResponse(page,kind) {
    const url = '**/api/reports/'+kind+'/operations';
    const handler = async route => {
      const response = await route.fetch(); assert.equal(response.status(),200);
      await route.abort('failed'); await page.unroute(url,handler);
    };
    await page.route(url,handler);
  }
  async function draft(page,kind,amount) {
    await page.locator('[data-shift="СТИКЕРИ"]').click(); await page.locator('#dateInput').fill('2026-10-05');
    if(kind === 'production-log') {
      await page.locator('#tonInput').fill(String(amount)); await page.locator('#brakInput').fill('10');
    } else {
      await page.locator('#startInput').fill('09:00'); await page.locator('#endInput').fill('09:30');
      await page.locator('#otherReasonInput').fill('Fictional operation downtime'); await page.locator('#noteInput').fill('Fictional draft '+amount);
    }
  }
  for(const kind of ['production-log','line-downtime']) {
    console.log('RUN two browsers: '+kind+' independent saves, conflicts and retry after commit');
    for(const page of pages) { await page.goto(base+'/'+kind); await expect(page.locator('#connDot')).toHaveClass(/\bon\b/); }
    await draft(admin,kind,1000); await draft(second,kind,2000);
    await simultaneously(kind,pages.map(page => () => page.locator('#saveBtn').click()));
    await expect.poll(() => current(kind).data.entries.length).toBe(2);
    for(const page of pages) await expect(page.locator('#msg')).toHaveAttribute('data-state','success');
    const id = current(kind).data.entries[0].id;
    const control = kind === 'production-log' ? '#tonInput' : '#noteInput';
    for(const page of pages) {
      await page.locator('.edit-report-btn[data-id="'+id+'"]').click();
      await page.locator(control).fill(page === admin ? kind === 'production-log' ? '1500' : 'Fictional edit A' : kind === 'production-log' ? '1600' : 'Fictional edit B');
    }
    await simultaneously(kind,pages.map(page => () => page.locator('#saveBtn').click()));
    await expect.poll(async () => (await Promise.all(pages.map(page => page.locator('#msg').getAttribute('data-state')))).sort()).toEqual(['conflict','success']);
    const states = await Promise.all(pages.map(page => page.locator('#msg').getAttribute('data-state')));
    const loser = pages[states.indexOf('conflict')];
    const kept = await loser.locator(control).inputValue();
    await expect(loser.locator(control)).toHaveValue(kept);
    await expect(loser.locator('#retrySaveBtn')).toBeHidden();
    await loser.getByRole('button',{name:'Прегледай актуалния запис',exact:true}).click();
    await expect(loser.locator('.report-review')).toBeVisible();
    for(const language of ['en','bg']) {
      // Language preference is changed outside the modal through the app API.
      await loser.evaluate(lang => HubI18n.setLanguage(lang),language);
      for(const width of [320,390,1440]) { await loser.setViewportSize({width,height:900}); await assertResponsive(loser,'Report conflict '+kind+' '+language+' '+width); }
    }
    await loser.locator('.report-review button').first().click();
    await expect(loser.locator(control)).toHaveValue(kept);
    await loser.locator('#retrySaveBtn').click(); await expect(loser.locator('#msg')).toHaveAttribute('data-state','success');
    const confirmed = current(kind).data.entries.find(entry => entry.id === id);
    assert.equal(kind === 'production-log' ? String(confirmed.tonnage) : confirmed.note,kept);

    // An edit and a deletion race on the same version. Exactly one wins.
    for(const page of pages) { await page.reload(); await expect(page.locator('#connDot')).toHaveClass(/\bon\b/); }
    await admin.locator('.edit-report-btn[data-id="'+id+'"]').click();
    await admin.locator(control).fill(kind === 'production-log' ? '1700' : 'Fictional edit versus deletion');
    const beforeRace = current(kind).revision;
    await simultaneously(kind,[() => admin.locator('#saveBtn').click(),() => second.locator('.del-btn[data-id="'+id+'"]').click()]);
    await expect.poll(async () => (await Promise.all(pages.map(page => page.locator('#msg').getAttribute('data-state')))).sort()).toEqual(['conflict','success']);
    assert.equal(current(kind).revision,beforeRace+1);
    assert.equal(current(kind).data.entries.length >= 1,true);

    // A new create commits, but its HTTP response is deliberately dropped.
    await admin.goto(base+'/'+kind); await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
    const before = current(kind).data.entries.length;
    await draft(admin,kind,3000); const form = await admin.locator(control).inputValue();
    await loseResponse(admin,kind); await admin.locator('#saveBtn').click();
    await expect(admin.locator('#msg')).toHaveAttribute('data-state','unconfirmed');
    await expect(admin.locator(control)).toHaveValue(form);
    assert.equal(current(kind).data.entries.length,before+1);
    const revision = current(kind).revision;
    await admin.locator('#retrySaveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
    assert.equal(current(kind).data.entries.length,before+1); assert.equal(current(kind).revision,revision);
    const savedId = current(kind).data.entries.at(-1).id;
    await admin.locator('.edit-report-btn[data-id="'+savedId+'"]').click();
    await admin.locator(control).fill(kind === 'production-log' ? '3100' : 'Fictional interrupted correction');
    await loseResponse(admin,kind); await admin.locator('#saveBtn').click();
    await expect(admin.locator('#msg')).toHaveAttribute('data-state','unconfirmed');
    const updatedRevision = current(kind).revision;
    await admin.locator('#saveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
    assert.equal(current(kind).revision,updatedRevision);
    await loseResponse(admin,kind); await admin.locator('.del-btn[data-id="'+savedId+'"]').click();
    await expect(admin.locator('#msg')).toHaveAttribute('data-state','unconfirmed');
    const deletedRevision = current(kind).revision;
    await admin.locator('#retrySaveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
    assert.equal(current(kind).revision,deletedRevision);

    // Changing an unconfirmed draft keeps its identity and requires review,
    // instead of creating a second report when the first response was lost.
    await draft(admin,kind,4000); const beforeChangedDraft = current(kind).data.entries.length;
    await loseResponse(admin,kind); await admin.locator('#saveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','unconfirmed');
    await admin.locator(control).fill(kind === 'production-log' ? '4100' : 'Fictional revised unconfirmed draft');
    await admin.locator('#saveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','conflict');
    assert.equal(current(kind).data.entries.length,beforeChangedDraft+1);
    await admin.getByRole('button',{name:'Прегледай актуалния запис',exact:true}).click(); await admin.locator('.report-review button').first().click();
    await admin.locator('#retrySaveBtn').click(); await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
    assert.equal(current(kind).data.entries.length,beforeChangedDraft+1);
    const revised = current(kind).data.entries.at(-1);
    assert.equal(kind === 'production-log' ? revised.tonnage : revised.note,kind === 'production-log' ? 4100 : 'Fictional revised unconfirmed draft');
    console.log('PASS '+kind+' concurrent create/edit/delete, retained drafts, explicit review and idempotent retries');
  }
  console.log('RUN two browsers: pair planning, reporting, cancellation and interrupted responses');
  const personData = current('personnel'); hub.store.put('personnel',{...personData.data,employees},personData.revision,hub.auth.list()[0]);
  for(const page of pages) { await page.goto(base+'/pair-targets'); await expect(page.locator('#rosterConnDot')).toHaveClass(/\bon\b/); await page.locator('#stickersShiftBtn').click(); }
  async function pairDraft(page,group) {
    await page.locator('#addPairBtn').click(); await page.locator('#memberOne').selectOption(employees[group*2].id); await page.locator('#memberTwo').selectOption(employees[group*2+1].id);
    await page.locator('#targetKg').fill('1000'); await page.locator('#targetCrates').fill('40'); await page.locator('#areaManual').check();
  }
  await pairDraft(admin,0); await pairDraft(second,1);
  await simultaneously('pair-targets',pages.map(page => () => page.locator('#savePairBtn').click()));
  await expect.poll(() => current('pair-targets').data.entries.length).toBe(2);
  for(const page of pages) await expect(page.locator('#pairDialog')).not.toBeVisible();
  const pairId = current('pair-targets').data.entries[0].id;
  for(const [index,page] of pages.entries()) {
    await page.locator('[data-action=report][data-id="'+pairId+'"]').click(); await page.locator('#actualKg').fill(String(1100+index*100)); await page.locator('#actualCrates').fill('44');
  }
  await simultaneously('pair-targets',pages.map(page => () => page.locator('#savePairBtn').click()));
  await expect.poll(async () => Promise.all(pages.map(page => page.locator('#dialogError').getAttribute('data-state')))).toContain('conflict');
  const pairStates = await Promise.all(pages.map(page => page.locator('#dialogError').getAttribute('data-state')));
  const loser = pages[pairStates.indexOf('conflict')], kg = await loser.locator('#actualKg').inputValue();
  await loser.locator('#reviewPairBtn').click(); await loser.locator('.report-review button').first().click();
  await expect(loser.locator('#actualKg')).toHaveValue(kg);
  await loseResponse(loser,'pair-targets'); await loser.locator('#savePairBtn').click();
  await expect(loser.locator('#dialogError')).toHaveAttribute('data-state','unconfirmed');
  const revision = current('pair-targets').revision;
  await loser.locator('#savePairBtn').click(); await expect(loser.locator('#pairDialog')).not.toBeVisible();
  assert.equal(current('pair-targets').revision,revision); assert.equal(current('pair-targets').data.entries.find(entry => entry.id === pairId).result.kg,Number(kg));
  const otherId = current('pair-targets').data.entries.find(entry => entry.id !== pairId).id;
  await admin.locator('[data-action=cancel][data-id="'+otherId+'"]').click(); await admin.locator('#cancellationReason').selectOption('cleaning');
  await loseResponse(admin,'pair-targets'); await admin.locator('#savePairBtn').click(); await expect(admin.locator('#dialogError')).toHaveAttribute('data-state','unconfirmed');
  const cancelledRevision = current('pair-targets').revision;
  await admin.locator('#savePairBtn').click(); await expect(admin.locator('#pairDialog')).not.toBeVisible(); assert.equal(current('pair-targets').revision,cancelledRevision);
  await pairDraft(admin,1); const before = current('pair-targets').data.entries.length;
  await loseResponse(admin,'pair-targets'); await admin.locator('#savePairBtn').click(); await expect(admin.locator('#dialogError')).toHaveAttribute('data-state','unconfirmed');
  const planRevision = current('pair-targets').revision;
  await admin.locator('#savePairBtn').click(); await expect(admin.locator('#pairDialog')).not.toBeVisible();
  assert.equal(current('pair-targets').data.entries.length,before+1); assert.equal(current('pair-targets').revision,planRevision);
  const pendingId = current('pair-targets').data.entries.at(-1).id;
  await admin.locator('[data-action=cancel][data-id="'+pendingId+'"]').click(); await admin.locator('#cancellationReason').selectOption('cleaning');
  await admin.locator('#savePairBtn').click(); await expect(admin.locator('#pairDialog')).not.toBeVisible();
  await pairDraft(admin,1); const beforeRevisedPlan = current('pair-targets').data.entries.length;
  await loseResponse(admin,'pair-targets'); await admin.locator('#savePairBtn').click(); await expect(admin.locator('#dialogError')).toHaveAttribute('data-state','unconfirmed');
  await admin.locator('#targetKg').fill('1300'); await admin.locator('#savePairBtn').click(); await expect(admin.locator('#dialogError')).toHaveAttribute('data-state','conflict');
  await admin.locator('#reviewPairBtn').click(); await admin.locator('.report-review button').first().click();
  await expect(admin.locator('#targetKg')).toHaveValue('1300'); await admin.locator('#savePairBtn').click(); await expect(admin.locator('#pairDialog')).not.toBeVisible();
  assert.equal(current('pair-targets').data.entries.length,beforeRevisedPlan+1); assert.equal(current('pair-targets').data.entries.at(-1).targetKg,1300);
  console.log('PASS pair independent plans, conflicting reports, reviewed retry and interrupted create/report/cancel');
  await hub.auth.create('demo-operation-editor','Fictional-password-123','observer',hub.auth.list()[0],{canCreateReports:false,canEditReports:true});
  const editor = await device('demo-operation-editor');
  for(const kind of ['production-log','line-downtime']) {
    await editor.goto(base+'/'+kind); await expect(editor.locator('#connDot')).toHaveClass(/\bon\b/); await expect(editor.locator('#saveBtn')).toBeHidden();
    await editor.locator('.edit-report-btn').first().click(); await expect(editor.locator('#saveBtn')).toBeVisible();
    await editor.locator(kind === 'production-log' ? '#tonInput' : '#noteInput').fill(kind === 'production-log' ? '4200' : 'Fictional delegated correction');
    await editor.locator('#saveBtn').click(); await expect(editor.locator('#msg')).toHaveAttribute('data-state','success'); await expect(editor.locator('#saveBtn')).toBeHidden();
  }
  await editor.context().close(); console.log('PASS delegated correction without report-creation permission');
  await second.context().close();
}
module.exports = {exerciseReportOperations};
