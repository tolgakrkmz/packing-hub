const assert=require('node:assert/strict');
const {shiftSchedule:schedule}=require('../../server/store.cjs');
async function exerciseShiftCloseout({admin,hub,base,expect,setTime}) {
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
  console.log('PASS explicit report scopes: night dates, zero production, delayed pair load, result save and invalid links');
}
module.exports={exerciseShiftCloseout};
