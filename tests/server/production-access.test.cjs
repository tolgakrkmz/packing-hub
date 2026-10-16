/* Fictional accounts and reports in isolated SQLite; never production inputs. */
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {openStore,shiftSchedule:schedule}=require('../../server/store.cjs');
const actor={id:1,role:'admin'}, operator={id:2,role:'operator',taskTeam:'СТИКЕРИ'};
const row=(id='demo-shift-report',date='2026-10-16',shift='СТИКЕРИ')=>({id,date,shift,tonnage:1000,brak:0});
const op=entry=>({operationId:randomUUID(),action:'create',entryId:entry.id,entry});
function fixture(t,at='2026-10-16T12:00:00+03:00') {
  let time=Date.parse(at);
  const store=openStore(':memory:',{productionNow:()=>time});t.after(()=>store.close());
  return {store,setTime:at=>{time=Date.parse(at);}};
}
test('tonnage rejects writes before the shift and after the inclusive one-hour deadline atomically',t=>{
  const {store,setTime}=fixture(t);
  for(const [time,allowed] of [['08:59:59.999',false],['09:00:00.000',true],['17:30:00.000',true],['18:30:00.000',true],['18:30:00.001',false]]) {
    setTime('2026-10-16T'+time+'+03:00');const input=op(row('demo-boundary-'+time));
    const before=store.get('production-log');
    if(allowed)store.reportOperation('production-log',input,undefined,operator);
    else {assert.throws(()=>store.reportOperation('production-log',input,undefined,operator),{code:'PRODUCTION_WINDOW_CLOSED'});assert.deepEqual(store.get('production-log'),before);}
  }
});
test('the legacy API enforces assignment for every changed source and target scope',t=>{
  const {store}=fixture(t), input=op(row());
  for(const user of [{...operator,taskTeam:''},{...operator,taskTeam:'А'}])assert.throws(()=>store.reportOperation('production-log',input,undefined,user),{status:403});
  const saved=store.reportOperation('production-log',input,undefined,operator);
  const editor={...operator,permissionOverrides:{canEditProduction:true}};
  for(const entry of [{...input.entry,date:'2026-10-15'},{...input.entry,shift:'А'}])assert.throws(()=>store.put('production-log',{...saved.data,entries:[entry]},saved.revision,editor,'report',false,{reason:'Fictional correction'}),{status:403});
  const before=store.get('production-log');
  assert.throws(()=>store.put('production-log',{...before.data,entries:[...before.data.entries,row('demo-foreign','2026-10-15')]},before.revision,operator),{status:403});
  assert.deepEqual(store.get('production-log'),before);
});
test('night shifts keep the production date across midnight, DST and the grace period',t=>{
  const {store,setTime}=fixture(t);
  for(const [date,end] of [['2026-10-24','2026-10-25T06:00:00+02:00'],['2026-03-28','2026-03-29T06:00:00+03:00']]) {
    const team=schedule.teamFor(schedule.parseDate(date),3), user={...operator,taskTeam:team};
    setTime(end);store.reportOperation('production-log',op(row('demo-night-'+date,date,team)),undefined,user);
    setTime(end.replace('T06:','T07:'));const input=op(row('demo-grace-'+date,date,team));
    store.reportOperation('production-log',input,undefined,user);
    setTime(end.replace('T06:00:00','T07:00:00.001'));
    assert.throws(()=>store.reportOperation('production-log',op(row('demo-expired-'+date,date,team)),undefined,user),{code:'PRODUCTION_WINDOW_CLOSED'});
    // A lost success can be confirmed after the window, without writing twice.
    assert.equal(store.reportOperation('production-log',input,undefined,user).replayed,true);
  }
});
test('Saturday Stickers needs an explicit dated administrator authorization and respects revocation',t=>{
  const {store}=fixture(t,'2026-10-17T12:00:00+03:00'), entry=row('demo-saturday','2026-10-17');
  assert.throws(()=>store.reportOperation('production-log',op(entry),undefined,operator),{code:'PRODUCTION_WINDOW_CLOSED'});
  const config={date:entry.date,start:'09:00',end:'17:30',enabled:true,reason:'Fictional overtime approval'};
  assert.throws(()=>store.productionAccess.configure(config,operator),{status:403});
  assert.throws(()=>store.productionAccess.configure({...config,reason:''},actor),{status:400});
  store.productionAccess.configure(config,actor);
  assert.equal(store.productionAccess.read({date:entry.date,team:'СТИКЕРИ'},operator).allowed,true);
  store.reportOperation('production-log',op(entry),undefined,operator);
  store.productionAccess.configure({...config,enabled:false,reason:'Fictional cancellation'},actor);
  assert.throws(()=>store.reportOperation('production-log',op({...entry,id:'demo-revoked'}),undefined,operator),{code:'PRODUCTION_WINDOW_CLOSED'});
  assert.equal(store.db.prepare("SELECT count(*) n FROM audit WHERE action='production-shift-authorize'").get().n,2);
});
test('an administrator exception requires a reason, preserves permissions and records the exception',t=>{
  const {store}=fixture(t), input=op(row('demo-late','2026-10-15'));
  assert.throws(()=>store.reportOperation('production-log',input,undefined,actor),{code:'PRODUCTION_EXCEPTION_REASON_REQUIRED'});
  const saved=store.reportOperation('production-log',{...input,reason:'Fictional late report'},undefined,actor);
  assert.equal(saved.data.entries.length,1);
  assert.equal(store.db.prepare("SELECT count(*) n FROM audit WHERE action='production-exception'").get().n,1);
  assert.equal(store.reportHistory('production-log',input.entryId,actor).events[0].reason,'Fictional late report');
  assert.throws(()=>store.reportOperation('production-log',{...op(row('demo-hidden')),reason:'Fictional override'},undefined,{...actor,permissionOverrides:{canCreateProduction:false}}),{code:'FORBIDDEN'});
  assert.throws(()=>store.productionAccess.configure({date:'2026-10-17',start:'09:00',end:'17:30',enabled:true,reason:'Fictional approval'},{...actor,permissionOverrides:{canManageProductionSettings:false}}),{code:'FORBIDDEN'});
});
test('corrections, deletion and restore do not reopen an expired reporting window',t=>{
  const {store,setTime}=fixture(t), input=op(row()), editor={...operator,permissionOverrides:{canEditProduction:true}};
  const saved=store.reportOperation('production-log',input,undefined,operator), version=saved.versions[input.entryId];
  setTime('2026-10-16T18:30:00.001+03:00');
  for(const action of ['update','delete']) {
    const change={operationId:randomUUID(),action,entryId:input.entryId,reason:'Fictional correction',...(action==='update'?{entry:{...input.entry,tonnage:2000}}:{})};
    assert.throws(()=>store.reportOperation('production-log',change,version,editor),{code:'PRODUCTION_WINDOW_CLOSED'});
  }
  const deleted=store.reportOperation('production-log',{operationId:randomUUID(),action:'delete',entryId:input.entryId,reason:'Fictional deletion'},version,actor);
  assert.throws(()=>store.reportOperation('production-log',{operationId:randomUUID(),action:'restore',entryId:input.entryId,sourceVersion:version,reason:'Fictional restore'},deleted.revision,editor),{code:'PRODUCTION_WINDOW_CLOSED'});
});
test('assignment works for operators without granting responsibility for tasks',async t=>{
  const {store}=fixture(t), {accounts}=require('../../server/accounts.cjs'), auth=accounts(store);
  const user=await auth.create('demo-shift-operator','Fictional-password-123','operator',null,{},()=>{},{taskTeam:'СТИКЕРИ'});
  assert.equal(user.taskTeam,'СТИКЕРИ');assert.equal(user.taskSupervisor,false);assert.equal(user.permissions.canReportTasks,false);
  store.reportOperation('production-log',op(row()),undefined,user);
});
test('HTTP policy and grants require current permissions, CSRF and valid scopes',async t=>{
  const {createHubServer}=require('../../server/server.cjs');
  let now=Date.parse('2026-10-17T12:00:00+03:00');
  const hub=createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true,taskNow:()=>now});
  t.after(()=>hub.close());await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
  const admin=await hub.auth.create('demo-window-admin','Fictional-password-123','admin');
  const chief=await hub.auth.create('demo-window-chief','Fictional-password-123','operator',admin,{},()=>{},{taskSupervisor:true,taskTeam:'СТИКЕРИ'});
  const base='http://127.0.0.1:'+hub.server.address().port;
  const login=async user=>{const session=await hub.auth.login(user.username,'Fictional-password-123');return {Origin:base,Cookie:'hub-local-session='+session.token,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'};};
  const ah=await login(admin),oh=await login(chief);
  const config={date:'2026-10-17',start:'08:00',end:'16:00',enabled:true,reason:'Fictional Saturday shift'};
  const post=(headers,input=config)=>fetch(base+'/api/production-access',{method:'POST',headers,body:JSON.stringify(input)});
  assert.equal((await fetch(base+'/api/production-access')).status,401);
  assert.equal((await post(oh)).status,403);
  assert.equal((await post({...ah,'X-CSRF-Token':''})).status,403);
  for(const bad of [{...config,date:'2026-02-30'},{...config,date:'2026-10-16'},{...config,end:'07:00'},{...config,start:'25:00'},{...config,start:['09:00']},{...config,team:'А'}])assert.equal((await post(ah,bad)).status,400);
  assert.equal((await post(ah)).status,200);
  const closeout=await (await fetch(base+'/api/shift-closeout?date=2026-10-17',{headers:oh})).json();
  assert.equal(closeout.interval.start,Date.parse('2026-10-17T08:00:00+03:00'));
  assert.equal(closeout.canReportProduction,true);
  now=Date.parse('2026-10-17T17:00:00.001+03:00');
  const late=await (await fetch(base+'/api/shift-closeout?date=2026-10-17',{headers:oh})).json();
  assert.equal(late.canReportProduction,false);assert.equal(late.productionAccess.code,'PRODUCTION_WINDOW_CLOSED');
  const reopen={mode:'late',date:'2026-10-17',team:'СТИКЕРИ',enabled:true,reason:'Fictional late API authorization'};
  assert.equal((await post(oh,reopen)).status,403);assert.equal((await post({...ah,'X-CSRF-Token':''},reopen)).status,403);
  assert.equal((await post(ah,{...reopen,minutes:600})).status,400);
  assert.equal((await post(ah,reopen)).status,200);
  const reopened=await (await fetch(base+'/api/shift-closeout?date=2026-10-17',{headers:oh})).json();
  assert.equal(reopened.canReportProduction,true);assert.equal(reopened.productionAccess.reopened,true);
  now+=30*60000;
  assert.equal((await (await fetch(base+'/api/shift-closeout?date=2026-10-17',{headers:oh})).json()).canReportProduction,false);
  for(const query of ['date=bad','date=2026-10-17&date=2026-10-18','team=bad','clock=0'])assert.equal((await fetch(base+'/api/production-access?'+query,{headers:oh})).status,400);
  await hub.auth.update(admin.id,{permissions:{canManageProductionSettings:false}},admin);
  assert.equal((await post(await login(admin))).status,403);
});
test('closeout keeps the previous production date during the night-shift grace period',t=>{
  const {store}=fixture(t,'2026-10-25T06:30:00+02:00');
  const user={...operator,taskTeam:'В',taskSupervisor:true};
  const closeout=require('../../server/shift-closeout.cjs').createShiftCloseout(store,{now:()=>Date.parse('2026-10-25T06:30:00+02:00')});
  const value=closeout.read({},user);
  assert.equal(value.scope.date,'2026-10-24');assert.equal(value.scope.shiftCode,3);assert.equal(value.canReportProduction,true);
});
test('overtime rejects nonexistent local times during the spring DST jump',t=>{
  const {store}=fixture(t);
  assert.throws(()=>store.productionAccess.configure({date:'2026-03-29',start:'03:30',end:'04:00',enabled:true,reason:'Fictional invalid local time'},actor),{code:'INVALID_PRODUCTION_AUTHORIZATION'});
});
test('dated overtime survives SQLite reopen and never authorizes another day or a revoked account',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-shift-authorization-demo-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'demo.sqlite'),clock={productionNow:()=>Date.parse('2026-10-17T12:00:00+03:00')};
  let store=openStore(filename,clock);
  store.productionAccess.configure({date:'2026-10-17',start:'10:00',end:'18:00',enabled:true,reason:'Fictional Saturday assignment'},actor);store.close();
  store=openStore(filename,clock);t.after(()=>store.close());
  const state=store.productionAccess.read({date:'2026-10-17',team:'СТИКЕРИ'},operator);
  assert.equal(state.allowed,true);assert.equal(state.interval.start,Date.parse('2026-10-17T10:00:00+03:00'));assert.equal(state.deadline,Date.parse('2026-10-17T19:00:00+03:00'));
  assert.equal(store.productionAccess.read({date:'2026-10-18',team:'СТИКЕРИ'},operator).allowed,false);
  const input=op(row('demo-persistent-grant','2026-10-17'));
  assert.throws(()=>store.reportOperation('production-log',input,undefined,{...operator,permissionOverrides:{canCreateProduction:false}}),{code:'FORBIDDEN'});
  store.reportOperation('production-log',input,undefined,operator);
});
test('an explicit late unlock lasts thirty minutes for only its date and assigned team',t=>{
  const {store,setTime}=fixture(t,'2026-10-16T19:00:00+03:00');
  const grant={mode:'late',date:'2026-10-16',team:'СТИКЕРИ',enabled:true,reason:'Fictional delayed shift report'};
  store.productionAccess.configure(grant,actor);
  const state=store.productionAccess.read({date:grant.date,team:grant.team},operator);
  assert.equal(state.allowed,true);assert.equal(state.reopened,true);assert.equal(state.deadline,Date.parse('2026-10-16T19:30:00+03:00'));
  const first=op(row('demo-late-unlock'));
  store.reportOperation('production-log',first,undefined,operator);
  assert.throws(()=>store.reportOperation('production-log',op(row('demo-other-date','2026-10-15')),undefined,operator),{code:'PRODUCTION_WINDOW_CLOSED'});
  assert.throws(()=>store.reportOperation('production-log',op(row('demo-other-team','2026-10-16','А')),undefined,operator),{code:'PRODUCTION_TEAM_MISMATCH'});
  setTime('2026-10-16T19:29:59.999+03:00');
  const current=store.get('production-log');store.put('production-log',{...current.data,entries:[...current.data.entries,row('demo-late-legacy')]},current.revision,operator);
  setTime('2026-10-16T19:30:00+03:00');
  const before=store.get('production-log');
  assert.throws(()=>store.reportOperation('production-log',op(row('demo-late-expired')),undefined,operator),{code:'PRODUCTION_WINDOW_CLOSED'});
  assert.deepEqual(store.get('production-log'),before);
  assert.equal(store.reportOperation('production-log',first,undefined,operator).replayed,true);
  assert.equal(store.db.prepare("SELECT count(*) n FROM audit WHERE action='production-window-reopen'").get().n,1);
});
test('late unlocks cannot grant module rights, bypass an unscheduled shift, or start before the ordinary deadline',t=>{
  const {store,setTime}=fixture(t,'2026-10-16T19:00:00+03:00');
  const grant={mode:'late',date:'2026-10-16',team:'СТИКЕРИ',enabled:true,reason:'Fictional late approval'};
  for(const user of [operator,{...actor,permissionOverrides:{canManageProductionSettings:false}}])assert.throws(()=>store.productionAccess.configure(grant,user),{code:'FORBIDDEN'});
  for(const bad of [{...grant,reason:''},{...grant,expiresAt:Date.now()+99999999},{...grant,date:'2026-10-17'},{...grant,date:'2026-02-30'},{...grant,team:'unknown'}])assert.throws(()=>store.productionAccess.configure(bad,actor),{status:400});
  setTime('2026-10-16T18:30:00+03:00');assert.throws(()=>store.productionAccess.configure(grant,actor),{code:'INVALID_PRODUCTION_REOPEN'});
  setTime('2026-10-16T19:00:00+03:00');store.productionAccess.configure(grant,actor);
  assert.throws(()=>store.reportOperation('production-log',op(row('demo-late-denied')),undefined,{...operator,permissionOverrides:{canCreateProduction:false}}),{code:'FORBIDDEN'});
  const input=op(row('demo-late-correction'));const saved=store.reportOperation('production-log',input,undefined,operator);
  assert.throws(()=>store.reportOperation('production-log',{...op({...input.entry,tonnage:2000}),action:'update',reason:'Fictional correction'},saved.versions[input.entryId],operator),{code:'FORBIDDEN'});
  store.productionAccess.configure({...grant,enabled:false,reason:'Fictional revocation'},actor);
  assert.equal(store.productionAccess.read({date:grant.date,team:grant.team},operator).allowed,false);
});
test('a late unlock preserves its original expiration through SQLite reopen',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-late-unlock-demo-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'demo.sqlite');let time=Date.parse('2026-10-16T19:00:00+03:00');
  let store=openStore(filename,{productionNow:()=>time});
  store.productionAccess.configure({mode:'late',date:'2026-10-16',team:'СТИКЕРИ',enabled:true,reason:'Fictional persistent late approval'},actor);store.close();
  time=Date.parse('2026-10-16T19:25:00+03:00');store=openStore(filename,{productionNow:()=>time});t.after(()=>store.close());
  const state=store.productionAccess.read({date:'2026-10-16',team:'СТИКЕРИ'},operator);
  assert.equal(state.allowed,true);assert.equal(state.deadline,Date.parse('2026-10-16T19:30:00+03:00'));
  time=Date.parse('2026-10-16T19:30:00+03:00');assert.equal(store.productionAccess.read({date:'2026-10-16',team:'СТИКЕРИ'},operator).allowed,false);
});
