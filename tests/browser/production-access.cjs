const assert=require('node:assert/strict');
async function exerciseProductionAccess({admin,hub,base,device,expect,setTime}) {
  const actor=hub.auth.list()[0];
  await hub.auth.create('demo-window-operator','Fictional-password-123','operator',actor,{},()=>{},{taskTeam:'СТИКЕРИ'});
  const operator=await device('demo-window-operator',true);
  const query=new URLSearchParams({date:'2026-10-17',team:'СТИКЕРИ',shiftCode:1});
  setTime('2026-10-17T12:00:00+03:00');
  await operator.goto(base+'/production-log?'+query);
  // Stickers report on any day and at any time; the page shows no deadline.
  await expect(operator.locator('#productionAccessMessage')).toContainText('няма срок');
  await operator.locator('#tonInput').fill('1234');
  await expect(operator.locator('#saveBtn')).toBeEnabled();
  await operator.locator('#saveBtn').click();
  await expect(operator.locator('#msg')).toHaveAttribute('data-state','success');
  assert.equal(hub.store.get('production-log').data.entries.at(-1).tonnage,1234);
  await expect(operator.locator('#saveBtn')).toBeDisabled();
  await operator.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();
  await expect(operator.locator('#productionAccessMessage')).toContainText('вече е въведен');
  const first=hub.store.get('production-log');
  hub.store.reportOperation('production-log',{operationId:require('node:crypto').randomUUID(),action:'delete',entryId:first.data.entries[0].id,reason:'Fictional exception setup'},first.versions[first.data.entries[0].id],actor);
  // Explicit administrative exception for a team outside the account, with a visible reason.
  const exceptions=hub.store.db.prepare("SELECT count(*) n FROM audit WHERE action='production-exception'").get().n;
  await admin.goto(base+'/production-log?'+query);
  await admin.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();
  await admin.locator('#tonInput').fill('3333');await admin.locator('#saveBtn').click();
  await expect(admin.locator('#reportCorrectionDialog')).toBeVisible();
  await expect(admin.locator('#reportCorrectionDialog h2')).toContainText('Административно изключение');
  await admin.locator('#reportCorrectionReason').fill('Fictional administrative report');
  await admin.locator('#reportCorrectionConfirm').click();await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
  assert.equal(hub.store.db.prepare("SELECT count(*) n FROM audit WHERE action='production-exception'").get().n,exceptions+1);
  await operator.locator('[data-hub-language=en]').click();
  await operator.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(operator.locator('#productionAccessMessage')).toContainText('already');
  for(const width of [320,390,1440]) {await admin.setViewportSize({width,height:900});await require('./responsive.cjs').assertResponsive(admin,'production access '+width);}
  await operator.context().close();
  setTime('2026-10-16T06:30:00+03:00');
  await hub.auth.create('demo-window-day','Fictional-password-123','operator',actor,{},()=>{},{taskTeam:'Г'});
  const day=await device('demo-window-day');await day.clock.setFixedTime(new Date('2026-10-16T06:30:00+03:00'));
  await day.goto(base+'/production-log');
  await expect(day.locator('#dateInput')).toHaveValue('2026-10-16');
  await day.locator('#dateInput').fill('2026-10-15');await expect(day.locator('#saveBtn')).toBeDisabled();
  await day.locator('#dateInput').fill('2026-10-16');await expect(day.locator('#saveBtn')).toBeEnabled();
  await expect(admin.locator('#productionLateAccess')).toHaveCount(0);
  for(let n=0;n<1;n++) {
    await day.locator('.shift-btn[data-shift="Г"]').click();
    await expect(day.locator('#dateInput')).toHaveValue('2026-10-16');
    await day.locator('#tonInput').fill(String(444+n));await day.locator('#saveBtn').click();
    await expect(day.locator('#msg')).toHaveAttribute('data-state','success');
  }
  await expect(day.locator('#saveBtn')).toBeDisabled();
  const morning=hub.store.get('production-log'),morningRow=morning.data.entries.find(e=>e.shift==='Г');
  hub.store.reportOperation('production-log',{operationId:require('node:crypto').randomUUID(),action:'delete',entryId:morningRow.id,reason:'Fictional connection setup'},morning.versions[morningRow.id],actor);
  await day.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await day.locator('.shift-btn[data-shift="Г"]').click();await day.locator('#tonInput').fill('555');
  await day.route('**/api/production-access?*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'}));
  await day.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(day.locator('#productionAccessMessage')).toContainText('Не може да се провери');
  await expect(day.locator('#saveBtn')).toBeDisabled();await expect(day.locator('#tonInput')).toHaveValue('555');
  await day.unroute('**/api/production-access?*');await day.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(day.locator('#saveBtn')).toBeEnabled();await expect(day.locator('#tonInput')).toHaveValue('555');
  await day.context().close();
  setTime('2026-10-16T19:00:00+03:00');
  const people=[1,2,3,4].map(n=>({id:'demo-grace-browser-'+n,name:'Demo Grace Browser '+n,category:'stickers',team:'1 смяна',role:'Опаковчик',active:true}));
  const personnel=hub.store.get('personnel');
  hub.store.put('personnel',{...personnel.data,employees:people},personnel.revision,actor);
  await hub.auth.update(hub.auth.list().find(u=>u.username==='demo-window-operator').id,{permissions:{canViewProduction:false}},actor);
  const pairs=await device('demo-window-operator');
  await pairs.clock.setFixedTime(new Date('2026-10-16T19:00:00+03:00'));
  await pairs.goto(base+'/pair-targets');
  await expect(pairs.locator('#contextTeam')).toHaveValue('СТИКЕРИ');
  await expect(pairs.locator('#pairAccessMessage')).toContainText('няма срок');
  async function plan(first,second) {
    await pairs.locator('#addPairBtn').click();
    await pairs.locator('#memberOne').selectOption(people[first].id);await pairs.locator('#memberTwo').selectOption(people[second].id);
    await pairs.locator('#targetKg').fill('100');await pairs.locator('#targetCrates').fill('1');await pairs.locator('#areaManual').check();
  }
  await plan(0,1);await pairs.locator('#savePairBtn').click();await expect(pairs.locator('#pairDialog')).not.toBeVisible();
  await pairs.locator('#pairsList [data-action=report]').click();
  await pairs.locator('#actualKg').fill('100');await pairs.locator('#actualCrates').fill('1');
  setTime('2026-10-16T23:30:00+03:00');
  await pairs.locator('#savePairBtn').click();await expect(pairs.locator('#pairDialog')).not.toBeVisible();
  assert.equal(hub.store.get('pair-targets').data.entries.at(-1).result.kg,100);
  // Stickers keep planning after the regular end; there is no reporting deadline.
  await plan(2,3);await pairs.locator('#savePairBtn').click();await expect(pairs.locator('#pairDialog')).not.toBeVisible();
  assert.equal(hub.store.get('pair-targets').data.entries.length,2);
  setTime('2026-10-19T10:00:00+03:00');
  await pairs.clock.setFixedTime(new Date('2026-10-19T10:00:00+03:00'));
  await pairs.locator('#contextDate').fill('2026-10-19');await pairs.locator('#contextDate').dispatchEvent('change');
  await expect(pairs.locator('#addPairBtn')).toBeEnabled();await pairs.locator('#addPairBtn').click();
  await expect(pairs.locator('#savePairBtn')).toBeEnabled();
  await pairs.locator('#cancelDialogBtn').click();
  await pairs.context().close();
  console.log('PASS four-hour deadline for rotation teams, Stickers without a deadline, pair-only permissions, exceptions and responsive BG/EN');
}
module.exports={exerciseProductionAccess};
