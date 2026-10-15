const assert=require('node:assert/strict');
const {shiftSchedule:schedule}=require('../../server/store.cjs');
async function exerciseShiftCloseout({admin,hub,base,device,expect,setTime}) {
  const date='2026-10-04',team=schedule.teamFor(schedule.parseDate(date),3);
  const query=new URLSearchParams({date,team,shiftCode:3});
  for(const at of ['2026-10-05T05:30:00+03:00','2026-10-05T08:30:00+03:00']) {
    setTime(at);await admin.clock.setFixedTime(new Date(at));
    await admin.goto(base+'/production-log?'+query);
    await expect(admin.locator('#dateInput')).toHaveValue(date);
    await expect(admin.locator('.shift-btn[data-shift="'+team+'"]').first()).toHaveClass(new RegExp('sel-'+team));
  }
  await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
  await admin.locator('#tonInput').fill('0');await admin.locator('#saveBtn').click();
  await expect(admin.locator('#msg')).toContainText('Записано');
  assert.ok(hub.store.get('production-log').data.entries.some(e=>e.date===date&&e.shift===team&&e.tonnage===0));
  const employees=[1,2].map(n=>({id:'demo-close-packer-'+n,name:'Demo Close Packer '+n,category:'manual',team,role:'Опаковчик',active:true,note:''}));
  const entry={id:'demo-close-pair',date,team,shiftCode:3,members:employees.map(({id,name,category,role})=>({id,name,category,role})),areas:['manual'],targetKg:100,targetCrates:1,result:null,createdAt:'2026-10-04T19:00:00Z',updatedAt:'2026-10-04T19:00:00Z'};
  hub.store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify({employees}), 'personnel');
  hub.store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify({module:'pair-targets',schemaVersion:1,entries:[entry]}),'pair-targets');
  await admin.route('**/api/data/pair-targets',async route=>{await new Promise(r=>setTimeout(r,100));await route.continue();});
  await admin.goto(base+'/pair-targets?'+query+'&target='+entry.id);
  await expect(admin.locator('#contextDate')).toHaveValue(date);await expect(admin.locator('#contextTeam')).toHaveValue(team);
  await expect(admin.locator('#pairsList [data-action=report]')).toBeEnabled();
  await admin.locator('#pairsList [data-action=report]').click();
  await admin.locator('#actualKg').fill('100');await admin.locator('#actualCrates').fill('1');
  await admin.locator('#pairForm button[type=submit]').click();await expect(admin.locator('#pairDialog')).not.toBeVisible();
  assert.equal(hub.store.get('pair-targets').data.entries[0].result.kg,100);
  await admin.unroute('**/api/data/pair-targets');
  await admin.goto(base+'/production-log?date=bad&team='+team+'&shiftCode=3');
  await expect(admin.locator('#msg')).toContainText('Невалидна');await expect(admin.locator('#saveBtn')).toBeDisabled();
  await admin.goto(base+'/pair-targets?'+new URLSearchParams({date:'2026-10-03',team,shiftCode:3,target:entry.id}));
  await expect(admin.locator('#pageError')).toContainText('Невалидна');
  await admin.locator('#contextDate').fill(date);await admin.locator('#contextDate').dispatchEvent('change');
  await expect(admin.locator('#pageError')).toBeEmpty();
  await admin.locator('#pairsList [data-action=report]').click();
  await expect(admin.locator('#pairDialog')).toBeVisible();await admin.locator('#cancelDialogBtn').click();
  await admin.locator('#connPanel .conn-panel-toggle').click();
  await admin.locator('#pairsRefreshBtn').click();
  await expect(admin.locator('#contextDate')).toHaveValue(date);
  await admin.locator('#pairsList [data-action=report]').click();
  await expect(admin.locator('#pairDialog')).toBeVisible();await admin.locator('#cancelDialogBtn').click();
  console.log('PASS explicit report scopes: night dates, zero production, delayed pair load, result save and invalid links');
  const seed=(kind,value)=>hub.store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(value),kind);
  const pairs={module:'pair-targets',schemaVersion:1,entries:[entry,{...entry,id:'demo-close-cancel',cancellation:{reasonKey:'cleaning',reasonText:'Demo cleaning reason',cancelledAt:'2026-10-04T20:00:00Z'},updatedAt:'2026-10-04T20:00:00Z'}]};
  seed('pair-targets',pairs);seed('production-log',{entries:[],goalTons:3000});
  await admin.goto(base+'/shift-closeout?'+query);
  await expect(admin.locator('#closeoutProductionStatus')).toHaveText('Липсва');
  await expect(admin.locator('#closeoutPending')).toHaveText('1');
  await expect(admin.locator('#closeoutCancelled')).toHaveText('1');
  await expect(admin.locator('#closeoutPairs')).toContainText('Demo cleaning reason');
  await expect(admin.locator('#closeoutProductionLink')).toHaveAttribute('href','/production-log?'+query);
  await expect(admin.locator('[data-closeout-pair="'+entry.id+'"] a')).toHaveAttribute('href','/pair-targets?'+query+'&target='+entry.id);
  await admin.locator('[data-hub-language=en]').click();await expect(admin.locator('h1')).toHaveText('Shift closeout');
  await expect(admin.locator('#closeoutProductionStatus')).toHaveText('Missing');
  for(const width of [320,390,1440]) {await admin.setViewportSize({width,height:900});await require('./responsive.cjs').assertResponsive(admin,'closeout '+width);}
  await admin.locator('[data-hub-language=bg]').click();
  await admin.route('**/api/shift-closeout?*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'}));
  await admin.locator('#closeoutRefresh').click();await expect(admin.locator('#closeoutMessage')).toContainText('не са актуални');
  await expect(admin.locator('#closeoutProductionStatus')).toHaveText('Липсва');
  await admin.unroute('**/api/shift-closeout?*');
  seed('production-log',{entries:[{id:'demo-late',date,shift:team,tonnage:0,brak:0}],goalTons:3000});
  await admin.locator('#closeoutRefresh').click();await expect(admin.locator('#closeoutProductionStatus')).toHaveText('Въведен');
  // A delayed response for an earlier date must not overwrite the newer filter.
  let release,started;const waiting=new Promise(r=>{started=r;});
  await admin.route('**/api/shift-closeout?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('date')==='2026-10-03') {
      const response=await route.fetch();started();await new Promise(r=>{release=r;});await route.fulfill({response});
    } else await route.continue();
  });
  await admin.locator('#closeoutDate').fill('2026-10-03');await admin.locator('#closeoutDate').dispatchEvent('change');await waiting;
  await admin.locator('#closeoutDate').fill(date);await admin.locator('#closeoutDate').dispatchEvent('change');
  await expect(admin.locator('#closeoutSummary')).toHaveAttribute('data-date',date);release();
  await admin.unroute('**/api/shift-closeout?*',{behavior:'wait'});
  await expect(admin.locator('#closeoutDate')).toHaveValue(date);
  const actor=hub.auth.list()[0];
  await hub.auth.create('demo-close-chief','Fictional-password-123','operator',actor,{},()=>{},{taskSupervisor:true,taskTeam:team});
  const chief=await device('demo-close-chief',true);
  await chief.goto(base+'/shift-closeout?'+query);await expect(chief.locator('#closeoutTeam option')).toHaveCount(1);
  assert.equal(await chief.evaluate(async()=> (await fetch('/api/shift-closeout?team='+encodeURIComponent('СТИКЕРИ'))).status),403);
  await hub.auth.create('demo-close-limited','Fictional-password-123','operator',actor,{canViewProduction:false},()=>{},{taskSupervisor:true,taskTeam:team});
  const limited=await device('demo-close-limited');await limited.goto(base+'/shift-closeout?'+query);
  await expect(limited.locator('#closeoutProductionStatus')).toHaveText('Нямате достъп');await expect(limited.locator('#closeoutProductionLink')).toBeHidden();
  await hub.auth.create('demo-close-ordinary','Fictional-password-123','operator',actor);
  const ordinary=await device('demo-close-ordinary');assert.equal(await ordinary.evaluate(async()=> (await fetch('/shift-closeout')).status),403);
  await ordinary.context().close();await limited.context().close();await chief.context().close();
  await admin.goto(base+'/shift-closeout?target='+encodeURIComponent(date+'/'+team+'/3'));
  await expect(admin.locator('#closeoutDate')).toHaveValue(date);
  // UTC devices still resolve the Sofia overnight production date, including DST.
  const utc=await admin.context().browser().newContext({timezoneId:'UTC'});
  await utc.addCookies(await admin.context().cookies());const page=await utc.newPage();
  setTime('2026-10-25T04:00:00+02:00');await page.goto(base+'/shift-closeout');
  await expect(page.locator('#closeoutDate')).toHaveValue('2026-10-24');
  await expect(page.locator('#closeoutShift')).toHaveValue('3');await utc.close();
  await admin.goto(base+'/shift-closeout?date=invalid');await expect(admin.locator('#closeoutMessage')).toContainText('заредят');await expect(admin.locator('#closeoutSummary')).toBeHidden();
  console.log('PASS closeout screen: scope, permissions, pending/cancelled pairs, late report, stale errors, filter race, BG/EN, mobile, notification and UTC/DST');
}
module.exports={exerciseShiftCloseout};
