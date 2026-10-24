/* Fictional accounts and reports in isolated SQLite; never production inputs. */
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {openStore,shiftSchedule:schedule}=require('../../server/store.cjs');
// Team Г works 06:00–14:00 on 2026-10-16; its reporting closes at 18:00.
const actor={id:1,role:'admin'}, operator={id:2,role:'operator',taskTeam:'Г'}, stickers={id:3,role:'operator',taskTeam:'СТИКЕРИ'};
const row=(id='demo-shift-report',date='2026-10-16',shift='Г')=>({id,date,shift,tonnage:1000,brak:0});
const op=entry=>({operationId:randomUUID(),action:'create',entryId:entry.id,entry});
function fixture(t,at='2026-10-16T12:00:00+03:00') {
  let time=Date.parse(at);
  const store=openStore(':memory:',{productionNow:()=>time});t.after(()=>store.close());
  return {store,setTime:at=>{time=Date.parse(at);}};
}
test('tonnage accepts the shift interval plus four hours, with an exclusive end boundary',t=>{
  const {store,setTime}=fixture(t);
  for(const [time,allowed] of [['05:59:59.999',false],['06:00:00.000',true],['13:59:59.999',true],['14:00:00.000',true],['17:59:59.999',true],['18:00:00.000',false]]) {
    setTime('2026-10-16T'+time+'+03:00');const input=op(row('demo-boundary-'+time));
    const before=store.get('production-log');
    if(allowed) {
      const saved=store.reportOperation('production-log',input,undefined,operator);
      store.reportOperation('production-log',{operationId:randomUUID(),action:'delete',entryId:input.entryId,reason:'Fictional boundary cleanup'},saved.versions[input.entryId],actor);
    }
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
test('night shifts keep their start date across midnight and DST, then stop four hours after shift end',t=>{
  const {store,setTime}=fixture(t);
  for(const [date,end] of [['2026-10-24','2026-10-25T06:00:00+02:00'],['2026-03-28','2026-03-29T06:00:00+03:00']]) {
    const team=schedule.teamFor(schedule.parseDate(date),3), user={...operator,taskTeam:team};
    setTime(new Date(Date.parse(end)-1).toISOString());const input=op(row('demo-night-'+date,date,team));
    store.reportOperation('production-log',input,undefined,user);
    setTime(new Date(Date.parse(end)+4*3600000).toISOString());
    assert.throws(()=>store.reportOperation('production-log',op(row('demo-expired-'+date,date,team)),undefined,user),{code:'PRODUCTION_WINDOW_CLOSED'});
    // A lost success can be confirmed after the window, without writing twice.
    assert.equal(store.reportOperation('production-log',input,undefined,user).replayed,true);
  }
});
test('Stickers report on any day and at any time; only the team assignment applies',t=>{
  const {store,setTime}=fixture(t,'2026-10-17T03:00:00+03:00');
  const state=store.productionAccess.read({date:'2026-10-17',team:'СТИКЕРИ'},stickers);
  assert.equal(state.allowed,true);assert.equal(state.deadline,null);
  store.reportOperation('production-log',op(row('demo-saturday','2026-10-17','СТИКЕРИ')),undefined,stickers);
  setTime('2026-10-20T23:30:00+03:00');
  store.reportOperation('production-log',op(row('demo-old-weekday','2026-10-14','СТИКЕРИ')),undefined,stickers);
  assert.throws(()=>store.reportOperation('production-log',op(row('demo-foreign','2026-10-18','СТИКЕРИ')),undefined,operator),{code:'PRODUCTION_TEAM_MISMATCH'});
  assert.throws(()=>store.reportOperation('production-log',op(row('demo-duplicate','2026-10-17','СТИКЕРИ')),undefined,stickers),{code:'PRODUCTION_ALREADY_REPORTED'});
});
test('an administrator exception requires a reason, preserves permissions and records the exception',t=>{
  const {store}=fixture(t), input=op(row('demo-late','2026-10-15'));
  assert.throws(()=>store.reportOperation('production-log',input,undefined,actor),{code:'PRODUCTION_EXCEPTION_REASON_REQUIRED'});
  const saved=store.reportOperation('production-log',{...input,reason:'Fictional late report'},undefined,actor);
  assert.equal(saved.data.entries.length,1);
  assert.equal(store.db.prepare("SELECT count(*) n FROM audit WHERE action='production-exception'").get().n,1);
  assert.equal(store.reportHistory('production-log',input.entryId,actor).events[0].reason,'Fictional late report');
  assert.throws(()=>store.reportOperation('production-log',{...op(row('demo-hidden')),reason:'Fictional override'},undefined,{...actor,permissionOverrides:{canCreateProduction:false}}),{code:'FORBIDDEN'});
});
test('corrections, deletion and restore do not reopen an expired reporting window',t=>{
  const {store,setTime}=fixture(t), input=op(row()), editor={...operator,permissionOverrides:{canEditProduction:true}};
  const saved=store.reportOperation('production-log',input,undefined,operator), version=saved.versions[input.entryId];
  setTime('2026-10-16T18:00:00+03:00');
  for(const action of ['update','delete']) {
    const change={operationId:randomUUID(),action,entryId:input.entryId,reason:'Fictional correction',...(action==='update'?{entry:{...input.entry,tonnage:2000}}:{})};
    assert.throws(()=>store.reportOperation('production-log',change,version,editor),{code:'PRODUCTION_WINDOW_CLOSED'});
  }
  const deleted=store.reportOperation('production-log',{operationId:randomUUID(),action:'delete',entryId:input.entryId,reason:'Fictional deletion'},version,actor);
  assert.throws(()=>store.reportOperation('production-log',{operationId:randomUUID(),action:'restore',entryId:input.entryId,sourceVersion:version,reason:'Fictional restore'},deleted.revision,editor),{code:'PRODUCTION_WINDOW_CLOSED'});
});
test('assignment works for operators without granting responsibility for tasks',async t=>{
  const {store}=fixture(t), {accounts}=require('../../server/accounts.cjs'), auth=accounts(store);
  const user=await auth.create('demo-shift-operator','Fictional-password-123','operator',null,{},()=>{},{taskTeam:'Г'});
  assert.equal(user.taskTeam,'Г');assert.equal(user.taskSupervisor,false);assert.equal(user.permissions.canReportTasks,false);
  store.reportOperation('production-log',op(row()),undefined,user);
});
test('HTTP policy is read-only and Stickers closeout has no deadline',async t=>{
  const {createHubServer}=require('../../server/server.cjs');
  let now=Date.parse('2026-10-17T12:00:00+03:00');
  const hub=createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true,taskNow:()=>now});
  t.after(()=>hub.close());await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
  const admin=await hub.auth.create('demo-window-admin','Fictional-password-123','admin');
  const chief=await hub.auth.create('demo-window-chief','Fictional-password-123','operator',admin,{},()=>{},{taskSupervisor:true,taskTeam:'СТИКЕРИ'});
  const base='http://127.0.0.1:'+hub.server.address().port;
  const login=async user=>{const session=await hub.auth.login(user.username,'Fictional-password-123');return {Origin:base,Cookie:'hub-local-session='+session.token,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'};};
  const ah=await login(admin),oh=await login(chief);
  assert.equal((await fetch(base+'/api/production-access')).status,401);
  // Shift authorizations were removed; the policy endpoint is read-only.
  assert.equal((await fetch(base+'/api/production-access',{method:'POST',headers:ah,body:'{}'})).status,405);
  for(const at of ['2026-10-17T12:00:00+03:00','2026-10-17T23:00:00+03:00']) {
    now=Date.parse(at);
    const closeout=await (await fetch(base+'/api/shift-closeout?date=2026-10-17',{headers:oh})).json();
    assert.equal(closeout.canReportProduction,true);assert.equal(closeout.productionAccess.deadline,null);
  }
  for(const query of ['date=bad','date=2026-10-17&date=2026-10-18','team=bad','clock=0'])assert.equal((await fetch(base+'/api/production-access?'+query,{headers:oh})).status,400);
});
test('closeout uses the previous production date through the night reporting deadline',t=>{
  let at=Date.parse('2026-10-25T05:59:59.999+02:00');
  const {store}=fixture(t,'2026-10-25T05:59:59.999+02:00');
  const user={...operator,taskTeam:'В',taskSupervisor:true};
  const closeout=require('../../server/shift-closeout.cjs').createShiftCloseout(store,{now:()=>at});
  const value=closeout.read({},user);
  assert.equal(value.scope.date,'2026-10-24');assert.equal(value.scope.shiftCode,3);assert.equal(value.canReportProduction,true);
  at=Date.parse('2026-10-25T10:00:00+02:00');
  assert.equal(closeout.read({},user).scope.date,'2026-10-25');
  assert.equal(closeout.read({date:'2026-10-24',team:'В',shiftCode:3},user).canReportProduction,false);
});
