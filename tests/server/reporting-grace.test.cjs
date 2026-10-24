/* Fictional reports exercise the shared reporting deadline, never live data. */
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {openStore,shiftSchedule:schedule}=require('../../server/store.cjs');
// Team Г works 06:00–14:00 on 2026-10-16; Stickers have no reporting window.
const admin={id:1,role:'admin'},user={id:2,role:'operator',taskTeam:'Г'},stickers={id:3,role:'operator',taskTeam:'СТИКЕРИ'};
const people=[1,2,3,4].map(n=>({id:'demo-grace-person-'+n,name:'Demo Grace Person '+n,category:n<3?'manual':'stickers',team:n<3?'Г':'1 смяна',role:'Опаковчик',active:true}));
const pair=(id,date='2026-10-16',team='Г',shiftCode=1)=>({id,date,team,shiftCode,members:people.filter(person=>(person.category==='stickers')===(team==='СТИКЕРИ')).map(({id,name,category,role})=>({id,name,category,role})),areas:['manual'],targetKg:100,targetCrates:1,result:null,createdAt:'2026-10-16T06:00:00Z',updatedAt:'2026-10-16T06:00:00Z'});
const create=entry=>({operationId:randomUUID(),action:'create',entryId:entry.id,entry});
function fixture(t,time='2026-10-16T12:00:00+03:00') {
  let now=Date.parse(time);const store=openStore(':memory:',{productionNow:()=>now});t.after(()=>store.close());
  store.put('personnel',{...store.get('personnel').data,employees:people},1,admin);
  return {store,setTime:value=>{now=Date.parse(value);}};
}
test('tonnage remains writable for four elapsed hours after shift end, then stops exactly',t=>{
  const {store,setTime}=fixture(t);
  for(const [time,allowed] of [['05:59:59.999',false],['06:00:00',true],['14:00:00',true],['17:59:59.999',true],['18:00:00',false]]) {
    setTime('2026-10-16T'+time+'+03:00');
    const op=create({id:'demo-grace-'+time,date:'2026-10-16',shift:'Г',tonnage:100,brak:0});
    if(allowed) {
      const saved=store.reportOperation('production-log',op,undefined,user);
      store.reportOperation('production-log',{operationId:randomUUID(),action:'delete',entryId:op.entryId,reason:'Fictional boundary cleanup'},saved.versions[op.entryId],admin);
    }
    else assert.throws(()=>store.reportOperation('production-log',op,undefined,user),{code:'PRODUCTION_WINDOW_CLOSED'});
  }
});
test('pair planning, target changes and first results share the four-hour deadline',t=>{
  const {store,setTime}=fixture(t),entry=pair('demo-grace-pair');
  store.reportOperation('production-log',create({id:'demo-grace-tonnage',date:entry.date,shift:entry.team,tonnage:100,brak:0}),undefined,user);
  let saved=store.reportOperation('pair-targets',create(entry),undefined,user);
  const target={...entry,targetKg:200,updatedAt:'2026-10-16T12:01:00Z'};
  saved=store.reportOperation('pair-targets',{...create(target),action:'update',reason:'Fictional target correction'},saved.versions[entry.id],user);
  setTime('2026-10-16T17:59:59.999+03:00');
  const result={...target,result:{kg:200,crates:1,reasonKey:'',reasonText:'',reportedAt:'2026-10-16T14:59:59.999Z'},updatedAt:'2026-10-16T14:59:59.999Z'};
  saved=store.reportOperation('pair-targets',{...create(result),action:'update'},saved.versions[entry.id],user);
  setTime('2026-10-16T18:00:00+03:00');
  const before=store.get('pair-targets');
  assert.throws(()=>store.put('pair-targets',{...before.data,entries:[{...result,targetKg:150}]},before.revision,{...user,permissionOverrides:{canEditPairs:true}},'report',false,{reason:'Fictional expired correction'}),{code:'PAIR_WINDOW_CLOSED'});
  assert.deepEqual(store.get('pair-targets'),before);
});
test('one tonnage report per assigned shift blocks a second operation and legacy batch, but permits a safe retry',t=>{
  const {store}=fixture(t),entry={id:'demo-single-tonnage',date:'2026-10-16',shift:'Г',tonnage:100,brak:0};
  const op=create(entry),saved=store.reportOperation('production-log',op,undefined,user),before=store.get('production-log');
  assert.equal(store.reportOperation('production-log',op,undefined,user).replayed,true);
  assert.equal(store.productionAccess.read({date:entry.date,team:entry.shift},user).canCreate,false);
  assert.throws(()=>store.reportOperation('production-log',create({...entry,id:'demo-duplicate'}),undefined,user),{code:'PRODUCTION_ALREADY_REPORTED'});
  assert.throws(()=>store.put('production-log',{...saved.data,entries:[entry,{...entry,id:'demo-legacy-duplicate'}]},saved.revision,user),{code:'PRODUCTION_ALREADY_REPORTED'});
  assert.deepEqual(store.get('production-log'),before);
});
test('pair writes cannot use a different day, foreign team or a missing account assignment',t=>{
  const {store}=fixture(t);
  for(const [entry,actor,code] of [[pair('demo-old','2026-10-14'),user,'PAIR_WINDOW_CLOSED'],[pair('demo-foreign','2026-10-16','А'),user,'PAIR_TEAM_MISMATCH'],[pair('demo-no-team'),{...user,taskTeam:''},'PAIR_TEAM_REQUIRED']]) {
    assert.throws(()=>store.reportOperation('pair-targets',create(entry),undefined,actor),{code});
  }
});
test('night-shift reporting keeps the starting date through 10:00 across both DST transitions',t=>{
  const {store,setTime}=fixture(t);
  for(const [date,offset] of [['2026-10-24','+02:00'],['2026-03-28','+03:00']]) {
    const next=date==='2026-10-24'?'2026-10-25':'2026-03-29';
    const team=schedule.teamFor(schedule.parseDate(date),3),actor={...user,taskTeam:team};
    setTime(next+'T09:59:59.999'+offset);
    assert.deepEqual(store.productionAccess.currentScope(actor),{date,team});
    store.reportOperation('production-log',create({id:'demo-night-grace-'+date,date,shift:team,tonnage:1,brak:0}),undefined,actor);
    setTime(next+'T10:00:00'+offset);
    assert.equal(store.productionAccess.status(date,team,actor).allowed,false);
  }
});
test('afternoon and night reporting opens at shift start and keeps its date across the four-hour deadline',t=>{
  const {store,setTime}=fixture(t);
  for(const [code,start,deadline] of [[2,'2026-10-05T14:00:00+03:00','2026-10-06T02:00:00+03:00'],[3,'2026-10-05T22:00:00+03:00','2026-10-06T10:00:00+03:00']]) {
    const date='2026-10-05',team=schedule.teamFor(schedule.parseDate(date),code),actor={...user,taskTeam:team};
    for(const [at,allowed] of [[Date.parse(start)-1,false],[Date.parse(start),true],[Date.parse(deadline)-1,true],[Date.parse(deadline),false]]) {
      setTime(new Date(at).toISOString());
      for(const kind of ['production-log','pair-targets'])assert.equal(store.productionAccess.status(date,team,actor,at,kind,code).allowed,allowed);
      if(allowed)assert.deepEqual(store.productionAccess.currentScope(actor),{date,team});
    }
  }
});
test('pair-only users can read their deadline without production permission',t=>{
  const {store}=fixture(t),actor={...user,permissionOverrides:{canViewProduction:false}};
  const state=store.productionAccess.read({date:'2026-10-16',team:'Г',shiftCode:'1'},actor,'pair-targets');
  assert.equal(state.canCreate,true);assert.equal(state.deadline,Date.parse('2026-10-16T18:00:00+03:00'));
  assert.throws(()=>store.productionAccess.read({}, {...actor,permissionOverrides:{canViewPairs:false}},'pair-targets'),{code:'FORBIDDEN'});
});
test('Stickers plan, correct and report pairs on any day and at any time',t=>{
  const {store,setTime}=fixture(t,'2026-10-17T03:00:00+03:00'),entry=pair('demo-weekend-pair','2026-10-17','СТИКЕРИ');
  const saved=store.reportOperation('pair-targets',create(entry),undefined,stickers);
  setTime('2026-10-19T23:30:00+03:00');
  store.reportOperation('pair-targets',{...create({...entry,targetKg:200}),action:'update',reason:'Fictional late target'},saved.versions[entry.id],stickers);
  assert.equal(store.productionAccess.read({date:entry.date,team:'СТИКЕРИ',shiftCode:'1'},stickers,'pair-targets').deadline,null);
  assert.throws(()=>store.reportOperation('pair-targets',create(pair('demo-weekend-foreign','2026-10-18','СТИКЕРИ')),undefined,user),{code:'PAIR_TEAM_MISMATCH'});
});
test('HTTP pair policy respects pair-only permissions and simultaneous tonnage creates cannot duplicate',async t=>{
  const {createHubServer}=require('../../server/server.cjs');
  const hub=createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true,taskNow:()=>Date.parse('2026-10-16T19:00:00+03:00')});
  t.after(()=>hub.close());await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
  const actor=await hub.auth.create('demo-grace-admin','Fictional-grace-123','admin');
  const chief=await hub.auth.create('demo-grace-chief','Fictional-grace-123','operator',actor,{},()=>{},{taskTeam:'СТИКЕРИ'});
  const session=await hub.auth.login(chief.username,'Fictional-grace-123'),base='http://127.0.0.1:'+hub.server.address().port;
  const headers={Origin:base,Cookie:'hub-local-session='+session.token,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'};
  const inputs=[1,2].map(n=>create({id:'demo-concurrent-tonnage-'+n,date:'2026-10-16',shift:'СТИКЕРИ',tonnage:100,brak:0}));
  const responses=await Promise.all(inputs.map(input=>fetch(base+'/api/reports/production-log/operations',{method:'POST',headers,body:JSON.stringify(input)})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,403]);
  assert.equal((await responses.find(r=>r.status===403).json()).error,'PRODUCTION_ALREADY_REPORTED');
  assert.equal(hub.store.get('production-log').data.entries.length,1);
  assert.equal((await fetch(base+'/api/pair-access')).status,401);
  for(const query of ['shiftCode=4','shiftCode=01','date=bad','team=bad','date=2026-10-16&date=2026-10-17'])assert.equal((await fetch(base+'/api/pair-access?'+query,{headers})).status,400);
  await hub.auth.update(chief.id,{permissions:{canViewProduction:false}},actor);
  const next=await hub.auth.login(chief.username,'Fictional-grace-123');headers.Cookie='hub-local-session='+next.token;headers['X-CSRF-Token']=next.csrf;
  const policy=await fetch(base+'/api/pair-access',{headers});assert.equal(policy.status,200);
  const state=await policy.json();assert.equal(state.canCreate,true);assert.equal(state.deadline,null);
  assert.equal((await fetch(base+'/api/production-access',{headers})).status,403);
  await hub.auth.update(chief.id,{permissions:{canViewPairs:false}},actor);
  const revoked=await hub.auth.login(chief.username,'Fictional-grace-123');
  assert.equal((await fetch(base+'/api/pair-access',{headers:{Cookie:'hub-local-session='+revoked.token}})).status,403);
});
