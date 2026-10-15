const assert=require('node:assert/strict');
const {shiftSchedule:schedule}=require('../../server/store.cjs');
const {assertResponsive}=require('./responsive.cjs');
async function exerciseCloseoutIndicator({admin,hub,base,device,expect,setTime}) {
  const date='2026-10-15',team=schedule.teamFor(schedule.parseDate(date),1),at=date+'T12:00:00+03:00';setTime(at);
  const actor=hub.auth.list()[0],password='Fictional-password-123';
  const user=await hub.auth.create('demo-indicator-chief',password,'operator',actor,{},()=>{},{taskSupervisor:true,taskTeam:team});
  const seed=(kind,data)=>hub.store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(data),kind);
  const pairs={module:'pair-targets',schemaVersion:1,entries:[1,2].map(n=>({id:'demo-indicator-pair-'+n,date,team,shiftCode:1,members:[{id:'demo-'+n,name:'Demo Packer '+n}],result:null}))};
  seed('pair-targets',pairs);seed('production-log',{entries:[],goalTons:3000});
  const page=await device(user.username);await page.clock.setFixedTime(new Date(at));
  const link=page.locator('#serverCloseoutLink'),status=page.locator('#serverCloseoutStatus');
  await expect(page.locator('.tiles a[href="/shift-closeout"]')).toHaveCount(0);
  await expect(link).toHaveAttribute('data-state','missing');await expect(status).toHaveText('3 липси');
  await expect(link).toHaveAttribute('href','/shift-closeout?'+new URLSearchParams({date,team,shiftCode:1}));
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});await expect(link).toBeVisible();await assertResponsive(page,'closeout indicator '+width);}
  await page.locator('[data-hub-language=en]').click();await expect(link).toContainText('Shift closeout');await expect(status).toHaveText('3 missing reports');
  await page.locator('[data-hub-language=bg]').click();await link.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(base+'/shift-closeout?'+new URLSearchParams({date,team,shiftCode:1}));
  await expect(link).toBeVisible();
  // A failed refresh must discard the previous successful colour.
  seed('production-log',{entries:[{id:'demo-entered',date,shift:team,tonnage:0,brak:0}],goalTons:3000});
  seed('pair-targets',{...pairs,entries:pairs.entries.map(e=>({...e,result:{kg:0,crates:0}}))});
  await page.goto(base+'/line-downtime');await expect(link).toHaveAttribute('data-state','complete');await expect(status).toHaveText('Всичко е отчетено');
  await page.route('**/api/shift-closeout',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'}));
  await page.clock.runFor(30000);await expect(link).toHaveAttribute('data-state','neutral');await expect(status).toHaveText('Проверката е недостъпна');
  await page.unroute('**/api/shift-closeout');await page.clock.runFor(30000);await expect(link).toHaveAttribute('data-state','complete');
  // The ordinary account receives neither the button nor an unauthorized read.
  await hub.auth.create('demo-indicator-ordinary',password,'operator',actor);const ordinary=await device('demo-indicator-ordinary');
  await expect(ordinary.locator('#serverCloseoutLink')).toHaveCount(0);
  assert.equal(await ordinary.evaluate(async()=> (await fetch('/api/shift-closeout')).status),403);
  await ordinary.context().close();
  seed('pair-targets',pairs);
  await hub.auth.update(user.id,{permissions:{canViewProduction:false}},actor);
  await page.goto(base+'/');await page.locator('#username').fill(user.username);await page.locator('#password').fill(password);await page.locator('#loginForm button[type=submit]').click();
  await expect(link).toHaveAttribute('data-state','neutral');await expect(status).toHaveText('Няма пълен достъп');
  await page.context().close();
  await admin.goto(base+'/');await expect(admin.locator('#serverCloseoutLink')).toBeVisible();
  console.log('PASS closeout toolbar: no home tile, missing/complete/error states, scope link, roles, BG/EN, keyboard and mobile');
}
module.exports={exerciseCloseoutIndicator};
