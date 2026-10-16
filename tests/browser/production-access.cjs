const assert=require('node:assert/strict');
async function exerciseProductionAccess({admin,hub,base,device,expect,setTime}) {
  const actor=hub.auth.list()[0];
  await hub.auth.create('demo-window-operator','Fictional-password-123','operator',actor,{},()=>{},{taskTeam:'СТИКЕРИ'});
  const operator=await device('demo-window-operator',true);
  const query=new URLSearchParams({date:'2026-10-17',team:'СТИКЕРИ',shiftCode:1});
  setTime('2026-10-17T12:00:00+03:00');
  await operator.goto(base+'/production-log?'+query);
  await expect(operator.locator('#productionAccessMessage')).toContainText('Няма разрешена смяна');
  await operator.locator('#tonInput').fill('1234');
  await expect(operator.locator('#saveBtn')).toBeDisabled();
  await admin.goto(base+'/production-log?'+query);
  await admin.locator('#productionExtraShift summary').click();
  await admin.locator('#productionExtraReason').fill('Fictional Saturday approval');
  await admin.locator('#productionExtraAllow').click();
  await expect(admin.locator('#productionExtraMessage')).toContainText('Разрешението е записано');
  await expect(operator.locator('#saveBtn')).toBeEnabled();
  await expect(operator.locator('#tonInput')).toHaveValue('1234');
  await operator.locator('#saveBtn').click();
  await expect(operator.locator('#msg')).toHaveAttribute('data-state','success');
  assert.equal(hub.store.get('production-log').data.entries.at(-1).tonnage,1234);
  // A deadline can pass between the preflight and the write. The server rejects
  // the write, and both the draft and its operation identity remain recoverable.
  await operator.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();
  await expect(operator.locator('#saveBtn')).toBeEnabled();await operator.locator('#tonInput').fill('2222');
  setTime('2026-10-17T18:30:00.001+03:00');
  await operator.locator('#saveBtn').click();
  await expect(operator.locator('#msg')).toHaveAttribute('data-state','rejected');
  await expect(operator.locator('#msg')).toContainText('Черновата остава');
  await expect(operator.locator('#tonInput')).toHaveValue('2222');
  assert.equal(hub.store.get('production-log').data.entries.length,1);
  // Explicit administrative exception for a late report, with a visible reason.
  await admin.reload();await admin.locator('#tonInput').fill('3333');await admin.locator('#saveBtn').click();
  await expect(admin.locator('#reportCorrectionDialog')).toBeVisible();
  await expect(admin.locator('#reportCorrectionDialog h2')).toContainText('Административно изключение');
  await admin.locator('#reportCorrectionReason').fill('Fictional late report exception');
  await admin.locator('#reportCorrectionConfirm').click();await expect(admin.locator('#msg')).toHaveAttribute('data-state','success');
  assert.equal(hub.store.db.prepare("SELECT count(*) n FROM audit WHERE action='production-exception'").get().n,1);
  await admin.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();
  await admin.locator('#productionExtraShift summary').click();
  await admin.locator('#productionExtraReason').fill('Fictional overtime cancellation');
  await admin.locator('#productionExtraRevoke').click();
  await expect(admin.locator('#productionExtraMessage')).toContainText('Разрешението е отменено');
  await operator.locator('[data-hub-language=en]').click();
  await expect(operator.locator('#productionAccessMessage')).toContainText('No authorized shift');
  for(const width of [320,390,1440]) {await admin.setViewportSize({width,height:900});await require('./responsive.cjs').assertResponsive(admin,'production access '+width);}
  await operator.context().close();
  setTime('2026-10-16T06:30:00+03:00');
  await hub.auth.create('demo-window-day','Fictional-password-123','operator',actor,{},()=>{},{taskTeam:'Г'});
  const day=await device('demo-window-day');await day.clock.setFixedTime(new Date('2026-10-16T06:30:00+03:00'));
  await day.goto(base+'/production-log');
  await expect(day.locator('#dateInput')).toHaveValue('2026-10-16');
  for(let n=0;n<2;n++) {
    await day.locator('.shift-btn[data-shift="Г"]').click();
    await expect(day.locator('#dateInput')).toHaveValue('2026-10-16');
    await day.locator('#tonInput').fill(String(444+n));await day.locator('#saveBtn').click();
    await expect(day.locator('#msg')).toHaveAttribute('data-state','success');
  }
  await day.locator('.shift-btn[data-shift="Г"]').click();await day.locator('#tonInput').fill('555');
  await day.route('**/api/production-access?*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'}));
  await day.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(day.locator('#productionAccessMessage')).toContainText('Не може да се провери');
  await expect(day.locator('#saveBtn')).toBeDisabled();await expect(day.locator('#tonInput')).toHaveValue('555');
  await day.unroute('**/api/production-access?*');await day.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(day.locator('#saveBtn')).toBeEnabled();await expect(day.locator('#tonInput')).toHaveValue('555');
  await day.context().close();
  setTime('2026-10-16T19:00:00+03:00');
  await hub.auth.create('demo-window-late-chief','Fictional-password-123','operator',actor,{},()=>{},{taskSupervisor:true,taskTeam:'СТИКЕРИ'});
  const chief=await device('demo-window-late-chief',true),lateQuery=new URLSearchParams({date:'2026-10-16',team:'СТИКЕРИ',shiftCode:1});
  await chief.goto(base+'/production-log?'+lateQuery);await chief.locator('#tonInput').fill('888');await expect(chief.locator('#saveBtn')).toBeDisabled();
  await admin.goto(base+'/production-log?'+lateQuery);await admin.locator('#productionLateAccess summary').click();
  await admin.locator('#productionLateReason').fill('Fictional delayed shift approval');await admin.locator('#productionLateAllow').click();
  await expect(admin.locator('#productionLateMessage')).toContainText('Отключено за 30 минути');
  await expect(chief.locator('#productionAccessMessage')).toContainText('Временно разрешено');await expect(chief.locator('#saveBtn')).toBeEnabled();
  await expect(chief.locator('#tonInput')).toHaveValue('888');await chief.locator('#saveBtn').click();await expect(chief.locator('#msg')).toHaveAttribute('data-state','success');
  await chief.locator('.shift-btn[data-shift="СТИКЕРИ"]').click();await chief.locator('#tonInput').fill('999');
  await admin.locator('#productionLateReason').fill('Fictional early cancellation');await admin.locator('#productionLateRevoke').click();
  await expect(chief.locator('#saveBtn')).toBeDisabled();await expect(chief.locator('#tonInput')).toHaveValue('999');
  await admin.locator('#productionLateReason').fill('Fictional renewed approval');await admin.locator('#productionLateAllow').click();await expect(chief.locator('#saveBtn')).toBeEnabled();
  setTime('2026-10-16T19:30:00+03:00');await chief.locator('#saveBtn').click();await expect(chief.locator('#msg')).toHaveAttribute('data-state','rejected');await expect(chief.locator('#tonInput')).toHaveValue('999');
  await chief.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(chief.locator('#saveBtn')).toBeDisabled();
  await admin.locator('[data-hub-language=en]').click();await expect(admin.locator('#productionLateAccess summary')).toHaveText('Temporary access for a late report');
  for(const width of [320,390]){await admin.setViewportSize({width,height:900});await require('./responsive.cjs').assertResponsive(admin,'late unlock '+width);}
  await chief.context().close();console.log('PASS dated overtime, late unlock/expiry/revocation, retained draft, explicit exception, morning dates, read failure and responsive BG/EN');
}
module.exports={exerciseProductionAccess};
