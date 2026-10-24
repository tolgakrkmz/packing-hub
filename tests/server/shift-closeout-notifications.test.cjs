const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openStore,shiftSchedule:schedule}=require('../../server/store.cjs');
const {accounts}=require('../../server/accounts.cjs');
const {createTasks}=require('../../server/tasks.cjs');
const {createNotifications}=require('../../server/notifications.cjs');
const {types}=require('../../js/notification-model.js');
async function setup(t,{date='2026-10-05',team,code=1,activation}={}) {
  team??=schedule.teamFor(schedule.parseDate(date),code);
  const interval=schedule.shiftInterval(team,date), target=[date,team,code].join('/');
  let clock=activation??interval.start, store,auth,inbox;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-closeout-demo-')),filename=path.join(dir,'demo.sqlite');
  function reopen(){store=openStore(filename);auth=accounts(store);createTasks(store,{now:()=>clock});inbox=createNotifications(store,{now:()=>clock,taskNow:()=>clock});}
  reopen();
  const admin=await auth.create('demo-close-admin','Fictional-password-123','admin');
  const chief=await auth.create('demo-close-chief','Fictional-password-123','operator',admin,{},()=>{},{taskSupervisor:true,taskTeam:team});
  t.after(async()=>{await inbox.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const notices=(type='shiftCloseout%',user=chief)=>store.db.prepare('SELECT * FROM notifications WHERE user_id=? AND target=? AND type LIKE ? ORDER BY at').all(user.id,target,type);
  const seed=(kind,data)=>store.db.prepare('UPDATE documents SET data=? WHERE kind=?').run(JSON.stringify(data),kind);
  return {interval,target,chief,admin,date,team,code,notices,seed,time:at=>{clock=at;},get inbox(){return inbox;},get auth(){return auth;},get store(){return store;},restart:async()=>{await inbox.close();store.close();reopen();}};
}
test('two combined phases have exact thresholds and durable per-recipient deduplication',async t=>{
  const s=await setup(t);
  assert.equal(types.shiftCloseoutDue.module,'shift-closeout');
  s.seed('pair-targets',{module:'pair-targets',schemaVersion:1,entries:[1,2].map(n=>({id:'demo-pair-'+n,date:s.date,team:s.team,shiftCode:1,members:[{id:'demo-packer-'+n,name:'Demo Packer '+n}]}))});
  s.time(s.interval.end-600001);s.inbox.sync();assert.equal(s.notices().length,0);
  s.time(s.interval.end-600000);s.inbox.sync();s.inbox.sync();assert.equal(s.notices().length,1);
  assert.equal(s.inbox.list(s.chief).items[0].href,'/shift-closeout?'+new URLSearchParams({target:s.target}));
  await s.restart();s.inbox.sync();assert.equal(s.notices().length,1);
  s.time(s.interval.end+599999);s.inbox.sync();assert.equal(s.notices().length,1);
  s.time(s.interval.end+600000);s.inbox.sync();s.inbox.sync();assert.deepEqual(s.notices().map(n=>n.type),['shiftCloseoutDue','shiftCloseoutOverdue']);
  s.time(s.interval.end+100*86400000);s.inbox.sync();s.time(s.interval.end+600000);s.inbox.sync();assert.equal(s.notices().length,0);
});
test('late zero tonnage and cancelled pairs remove the obligation without creating task records',async t=>{
  const s=await setup(t);s.time(s.interval.end-600000);s.inbox.sync();
  s.seed('production-log',{entries:[{id:'demo-zero',date:s.date,shift:s.team,tonnage:0,brak:0}],goalTons:3000});
  s.seed('pair-targets',{module:'pair-targets',schemaVersion:1,entries:[{id:'demo-cancel',date:s.date,team:s.team,shiftCode:1,members:[],cancellation:{reasonKey:'cleaning',reasonText:''}}]});
  s.time(s.interval.end+600000);s.inbox.sync();assert.equal(s.notices().length,1);
  assert.equal(s.store.db.prepare('SELECT count(*) n FROM task_items').get().n,0);
  s.seed('production-log',{entries:[],goalTons:3000});s.inbox.sync();assert.equal(s.notices().length,2);s.inbox.sync();assert.equal(s.notices().length,2);
});
test('activation and catch-up windows skip old history; pre-end never catches up after end',async t=>{
  const s=await setup(t,{activation:Date.parse('2026-10-05T14:00:00+03:00')});
  s.inbox.sync();assert.equal(s.notices().length,0);
  s.time(s.interval.end+600000);s.inbox.sync();assert.deepEqual(s.notices().map(n=>n.type),['shiftCloseoutOverdue']);
  const other=await setup(t);other.time(other.interval.end+86400001);other.inbox.sync();assert.equal(other.notices().length,0);
  await s.restart();s.inbox.sync();assert.equal(s.notices().length,1);
});
test('current team and module rights govern inbox counts; opt-out and inactive users stop reminders',async t=>{
  const s=await setup(t);s.inbox.updatePreferences({shiftCloseoutDue:false,shiftPairsMissing:false},s.chief);
  s.time(s.interval.end-600000);s.inbox.sync();assert.equal(s.notices().length,0);
  s.time(s.interval.end+600000);s.inbox.sync();assert.equal(s.inbox.summary(s.chief).count,1);
  let user=await s.auth.update(s.chief.id,{permissions:{canViewProduction:false,canViewPairs:false}},s.admin);
  assert.equal(s.inbox.summary(user).count,0);assert.equal(s.inbox.list(user).count,0);
  user=await s.auth.update(s.chief.id,{permissions:{},taskTeam:s.team==='А'?'Б':'А',taskSupervisor:true},s.admin);
  assert.equal(s.inbox.summary(user).count,0);
  await s.auth.update(s.chief.id,{active:false},s.admin);s.inbox.sync();assert.equal(s.notices().length,1);
});
test('hidden production alone cannot trigger a reminder and explicit closeout denial wins',async t=>{
  const s=await setup(t);
  await s.auth.update(s.chief.id,{permissions:{canViewProduction:false}},s.admin);
  s.time(s.interval.end-600000);s.inbox.sync();assert.equal(s.notices().length,0);
  await s.auth.update(s.chief.id,{permissions:{canViewShiftCloseout:false}},s.admin);
  s.time(s.interval.end+600000);s.inbox.sync();assert.equal(s.notices().length,0);
});
for(const options of [{date:'2026-10-24',code:3},{date:'2026-10-05',team:'СТИКЕРИ'}])test('night and Stickers use their actual shift end '+JSON.stringify(options),async t=>{
  const s=await setup(t,options);s.time(s.interval.end-600000);s.inbox.sync();assert.equal(s.notices().length,1);
  s.time(s.interval.end+600000);s.inbox.sync();assert.equal(s.notices().length,2);
});
test('missing pairs remind only the shift lead once, from 15 minutes after the start',async t=>{
  const s=await setup(t), pairs=()=>s.notices('shiftPairsMissing');
  s.time(s.interval.start+899999);s.inbox.sync();assert.equal(pairs().length,0);
  s.time(s.interval.start+900000);s.inbox.sync();s.inbox.sync();assert.equal(pairs().length,1);
  assert.equal(s.notices('shiftPairsMissing',s.admin).length,0);
  await s.restart();s.time(s.interval.start+3600000);s.inbox.sync();assert.equal(pairs().length,1);
  const planned=await setup(t);
  planned.seed('pair-targets',{module:'pair-targets',schemaVersion:1,entries:[{id:'demo-cancel',date:planned.date,team:planned.team,shiftCode:1,members:[],cancellation:{reasonKey:'cleaning',reasonText:''}}]});
  planned.time(planned.interval.start+900000);planned.inbox.sync();assert.equal(planned.notices('shiftPairsMissing').length,0);
  const late=await setup(t);late.time(late.interval.end);late.inbox.sync();assert.equal(late.notices('shiftPairsMissing').length,0);
  const off=await setup(t);off.inbox.updatePreferences({shiftPairsMissing:false},off.chief);
  off.time(off.interval.start+900000);off.inbox.sync();assert.equal(off.notices('shiftPairsMissing').length,0);
});
