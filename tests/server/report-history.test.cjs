/* Every report and account in these tests is fictional. */
const test=require('node:test'), assert=require('node:assert/strict'), {randomUUID}=require('node:crypto');
const {openStore}=require('../../server/store.cjs');
const productionClock={productionNow:()=>Date.parse('2026-10-05T10:00:00+03:00')};
const {createHubServer}=require('../../server/server.cjs');
const admin={id:1,username:'demo-history-admin',role:'admin',taskTeam:'В'}, editor={id:2,username:'demo-history-editor',role:'observer',taskTeam:'В',permissions:{canEditProduction:true}}, observer={id:3,role:'observer'};
const entry={id:'demo-history-report',date:'2026-10-05',shift:'В',tonnage:1000,brak:10};
const operation=(action,extra={})=>({operationId:randomUUID(),action,entryId:entry.id,...(['create','update'].includes(action)?{entry}:{}),...extra});
test('edit → delete → restore preserves snapshots, actors, reasons, versions and counts without leaking to audit',t=>{
 const store=openStore(':memory:',productionClock);t.after(()=>store.close());
 const first=store.reportOperation('production-log',operation('create'),undefined,admin);
 const edited=store.reportOperation('production-log',operation('update',{entry:{...entry,tonnage:1200},reason:'Fictional correction'}),first.versions[entry.id],editor);
 const removed=store.reportOperation('production-log',operation('delete',{reason:'Fictional deletion'}),edited.versions[entry.id],editor);
 assert.equal(removed.data.entries.length,0);
 assert.equal(store.reportHistoryList('production-log',editor).entries[0].date,entry.date);
 const deleted=store.reportHistory('production-log',entry.id,editor);
 const restore=operation('restore',{sourceVersion:deleted.version,reason:'Fictional restore'});
 const result=store.reportOperation('production-log',restore,deleted.version,editor);
 assert.equal(result.data.entries.length,1);assert.equal(result.data.entries[0].tonnage,1200);
 assert.equal(store.reportOperation('production-log',restore,deleted.version,editor).replayed,true);
 assert.equal(store.get('production-log').data.entries.reduce((sum,row)=>sum+row.tonnage,0),1200);
 const history=store.reportHistory('production-log',entry.id,admin);assert.deepEqual(history.events.map(row=>row.action),['restore','delete','update','create']);
 assert.equal(history.events[2].before.tonnage,1000);assert.equal(history.events[2].after.tonnage,1200);assert.equal(history.events[2].account,editor.username);
 for(const row of store.db.prepare('SELECT detail FROM audit').all()) assert.doesNotMatch(row.detail,/tonnage|Fictional|demo-history-report/);
 assert.throws(()=>store.reportHistory('production-log',entry.id,observer),{code:'FORBIDDEN'});
 assert.throws(()=>store.reportHistoryList('production-log',observer),{code:'FORBIDDEN'});
 assert.throws(()=>store.reportOperation('production-log',operation('restore',{sourceVersion:deleted.version,reason:'Fictional stale restore'}),deleted.version,editor),{code:'REPORT_CONFLICT'});
});
test('reasons, stale edits, deleted identity reuse, rollback and legacy PUT cannot bypass history',t=>{
 const store=openStore(':memory:',productionClock);t.after(()=>store.close());const created=store.reportOperation('production-log',operation('create'),undefined,admin),version=created.versions[entry.id];
 assert.throws(()=>store.reportOperation('production-log',operation('update'),version,admin),{code:'CORRECTION_REASON_REQUIRED'});
 assert.throws(()=>store.put('production-log',{...created.data,entries:[]},created.revision,admin),{code:'CORRECTION_REASON_REQUIRED'});
 store.db.exec("CREATE TRIGGER deny_demo_history BEFORE INSERT ON report_history BEGIN SELECT RAISE(ABORT,'Fictional failure'); END");
 assert.throws(()=>store.reportOperation('production-log',operation('delete',{reason:'Fictional deletion'}),version,admin));assert.deepEqual(store.get('production-log'),created.data?{data:created.data,revision:created.revision,versions:created.versions}:created);
 store.db.exec('DROP TRIGGER deny_demo_history');store.reportOperation('production-log',operation('delete',{reason:'Fictional deletion'}),version,admin);
 assert.throws(()=>store.reportOperation('production-log',operation('create'),undefined,admin),{code:'REPORT_CONFLICT'});
 const deleted=store.get('production-log');assert.throws(()=>store.put('production-log',{...deleted.data,entries:[entry]},deleted.revision,admin),{code:'REPORT_CONFLICT'});
});
test('HTTP denies history and admin HTML to ordinary observers while preserving export',async t=>{
 const hub=createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true,...productionClock});t.after(()=>hub.close());
 await hub.auth.create('demo-history-admin','Fictional-password-123','admin');await hub.auth.create('demo-history-observer','Fictional-password-123','observer');
 await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+hub.server.address().port;
 const session=await hub.auth.login('demo-history-observer','Fictional-password-123');const headers={Cookie:'hub-local-session='+session.token};
 for(const path of ['/report-history','/api/reports/production-log/history','/api/reports/production-log/history?entryId=demo-history-report']) assert.equal((await fetch(base+path,{headers})).status,403);
 for(const path of ['/admin-panel','/admin-panel.html','/admin-panel/']) {const response=await fetch(base+path,{headers});assert.equal(response.status,403);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(await response.text(),/Тази зона е за администратори/);}
 assert.equal((await fetch(base+'/api/export/production-log',{headers})).status,200);
});

const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const {createStatisticsReads} = require('../../server/statistics.cjs');
const sandbox = vm.createContext({});
for (const name of ['shift-schedule','pair-targets-model']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/'+name+'.js'),'utf8'),sandbox);
const model = vm.runInContext('PairTargets',sandbox);
const people = [1,2].map(id => ({id:'demo-history-person-'+id,name:'Demo History Person '+id,category:'stickers',team:'1 смяна',role:'Опаковчик',active:true}));
const scope = {date:'2026-10-05',shiftCode:1,team:'СТИКЕРИ'};
function pair(id, cancelled = false) {
  const planned = model.plan({data:model.emptyData(),employees:people,context:scope,memberIds:people.map(person => person.id),targetKg:1000,targetCrates:40,workAreas:['manual'],id,now:'2026-10-05T06:00:00.000Z'});
  return JSON.parse(JSON.stringify(cancelled ? model.cancel(planned,{context:scope,reasonKey:'cleaning',now:'2026-10-05T06:30:00.000Z'}) : model.report(planned,{context:scope,kg:1000,crates:40,workAreas:['manual'],now:'2026-10-05T06:30:00.000Z'})));
}
const op = (action, value, extra = {}) => ({operationId:randomUUID(),action,entryId:typeof value === 'string' ? value : value.id,...(['create','update'].includes(action) ? {entry:value} : {}),...extra});
for (const kind of ['line-downtime','pair-targets']) {
  test(kind+': history, delete/restore and repeat receipts keep statistics exact',t => {
    const store=openStore(':memory:',productionClock);t.after(()=>store.close());
    store.put('personnel',{...store.get('personnel').data,employees:people},1,admin);
    const value=kind === 'pair-targets' ? pair('demo-history-pair') : {id:'demo-history-downtime',date:scope.date,shift:'СТИКЕРИ',start:'09:00',end:'09:30',durationMin:30,reason:'Друго',reasonNote:'Fictional downtime',note:''};
    const first=store.reportOperation(kind,op('create',value),undefined,admin);
    const changed=kind === 'pair-targets' ? {...value,result:{...value.result,kg:1200}} : {...value,note:'Fictional downtime correction'};
    const edited=store.reportOperation(kind,op('update',changed,{reason:'Fictional correction'}),first.versions[value.id],admin);
    const reads=createStatisticsReads(store);assert.equal(reads.read(kind,'2026-10').data.entries.length,1);
    store.reportOperation(kind,op('delete',value.id,{reason:'Fictional deletion'}),edited.versions[value.id],admin);
    assert.equal(reads.read(kind,'2026-10').data.entries.length,0);
    if(kind === 'pair-targets') store.put('personnel',{...store.get('personnel').data,employees:people.map(person=>({...person,name:person.name+' retired',active:false}))},store.get('personnel').revision,admin);
    const history=store.reportHistory(kind,value.id,admin), restore=op('restore',value.id,{sourceVersion:history.version,reason:'Fictional restore'});
    const saved=store.reportOperation(kind,restore,history.version,admin);
    assert.deepEqual(saved.data.entries,[changed]);
    assert.equal(store.reportOperation(kind,restore,history.version,admin).replayed,true);
    const statistics=reads.read(kind,'2026-10').data;assert.equal(statistics.entries.length,1);
    if(kind === 'line-downtime') assert.deepEqual(statistics.summary.months,[{key:'2026-10',durationMin:30,count:1}]);
    else assert.equal(statistics.entries.reduce((sum,item)=>sum+item.result.kg,0),1200);
    assert.deepEqual(store.reportHistory(kind,value.id,admin).events.map(event=>event.action),['restore','delete','update','create']);
  });
}
test('cancelled pair snapshots restore after roster changes; occupied active scope refuses restore atomically',t => {
  const store=openStore(':memory:',productionClock);t.after(()=>store.close());
  const value=pair('demo-history-cancelled',true);
  require('../../server/store.cjs').validateData('pair-targets',{...store.get('pair-targets').data,entries:[value]});
  store.updateDocument('pair-targets',{...store.get('pair-targets').data,entries:[value]},admin);
  let history=store.reportHistory('pair-targets',value.id,admin);
  store.reportOperation('pair-targets',op('delete',value.id,{reason:'Fictional deletion'}),history.version,admin);
  history=store.reportHistory('pair-targets',value.id,admin);
  store.reportOperation('pair-targets',op('restore',value.id,{sourceVersion:history.version,reason:'Fictional restore'}),history.version,admin);
  assert.deepEqual(store.get('pair-targets').data.entries,[value]);
  assert.deepEqual(store.get('personnel').data.employees,[]);
  const active=pair('demo-history-active');
  store.updateDocument('pair-targets',{...store.get('pair-targets').data,entries:[value,active]},admin);
  history=store.reportHistory('pair-targets',active.id,admin);
  store.reportOperation('pair-targets',op('delete',active.id,{reason:'Fictional deletion'}),history.version,admin);
  const tombstone=store.reportHistory('pair-targets',active.id,admin);
  const current=store.get('pair-targets');store.updateDocument('pair-targets',{...current.data,entries:[...current.data.entries,{...active,id:'demo-history-replacement'}]},admin);
  const before=store.get('pair-targets'), count=store.db.prepare('SELECT count(*) AS n FROM report_history').get().n;
  assert.throws(()=>store.reportOperation('pair-targets',op('restore',active.id,{sourceVersion:tombstone.version,reason:'Fictional conflicting restore'}),tombstone.version,admin),{code:'REPORT_CONFLICT'});
  assert.deepEqual(store.get('pair-targets'),before);assert.equal(store.db.prepare('SELECT count(*) AS n FROM report_history').get().n,count);
});
test('legacy rows without materialized versions remain readable; first correction captures the prior snapshot',t => {
  const store=openStore(':memory:',productionClock);t.after(()=>store.close());
  store.db.prepare('UPDATE documents SET data=?,revision=77 WHERE kind=?').run(JSON.stringify({entries:[entry],goalTons:3000}),'production-log');
  assert.equal(store.reportHistoryList('production-log',admin).entries[0].version,77);
  const old=store.reportHistory('production-log',entry.id,admin);assert.equal(old.version,77);assert.deepEqual(old.current,entry);assert.deepEqual(old.events,[]);
  store.reportOperation('production-log',operation('update',{entry:{...entry,tonnage:1200},reason:'Fictional legacy correction'}),77,admin);
  assert.deepEqual(store.reportHistory('production-log',entry.id,admin).events[0].before,entry);
  assert.throws(()=>store.reportOperation('production-log',operation('delete',{reason:'Fictional stale delete'}),77,admin),{code:'REPORT_CONFLICT'});
});
test('private history, deleted snapshots and restore receipts survive restart and a verified database backup',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hub-history-persistence-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const filename=path.join(directory,'demo.sqlite');let store=openStore(filename,productionClock);
  require('../../server/tasks.cjs').createTasks(store);
  const created=store.reportOperation('production-log',operation('create'),undefined,admin);
  store.reportOperation('production-log',operation('delete',{reason:'Fictional durable deletion'}),created.versions[entry.id],admin);
  const expected=store.reportHistory('production-log',entry.id,admin);store.close();store=openStore(filename,productionClock);t.after(()=>store.close());
  assert.deepEqual(store.reportHistory('production-log',entry.id,admin),expected);
  const archive=path.join(directory,'demo-snapshot.sqlite');require('../../server/backups.cjs').snapshot(filename,archive);
  assert.equal(fs.statSync(archive).mode & 0o777,0o600);
  const recovered=openStore(archive,productionClock);try {
    assert.deepEqual(recovered.reportHistory('production-log',entry.id,admin),expected);
    const restore=operation('restore',{sourceVersion:expected.version,reason:'Fictional archived restore'});
    const restored=recovered.reportOperation('production-log',restore,expected.version,admin);
    assert.deepEqual(restored.data.entries,[entry]);assert.equal(recovered.reportOperation('production-log',restore,expected.version,admin).replayed,true);
  } finally {recovered.close();}
});

test('HTTP restore uses current permissions, CSRF, origin and versions; two restorers cannot count the report twice',async t => {
  const hub=createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true,...productionClock});t.after(()=>hub.close());
  const account=await hub.auth.create('demo-restore-admin','Fictional-password-123','admin',null,{},()=>{},{taskTeam:'В'});
  const delegated=await hub.auth.create('demo-restore-editor','Fictional-password-123','observer',account,{canEditProduction:true},()=>{},{taskTeam:'В'});
  await hub.auth.create('demo-restore-observer','Fictional-password-123','observer',account);
  await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+hub.server.address().port;
  const login=username=>hub.auth.login(username,'Fictional-password-123');
  const session=await login(delegated.username), observer=await login('demo-restore-observer');
  const headers=actor=>({Cookie:'hub-local-session='+actor.token,Origin:base,'Content-Type':'application/json','X-CSRF-Token':actor.csrf});
  const post=(actor,input,version,extra={})=>fetch(base+'/api/reports/production-log/operations',{method:'POST',headers:{...headers(actor),...(version ? {'If-Match':'"'+version+'"'} : {}),...extra},body:JSON.stringify(input)});
  const created=hub.store.reportOperation('production-log',operation('create'),undefined,account);
  hub.store.reportOperation('production-log',operation('delete',{reason:'Fictional concurrent deletion'}),created.versions[entry.id],account);
  const deleted=hub.store.reportHistory('production-log',entry.id,account), restore=operation('restore',{sourceVersion:deleted.version,reason:'Fictional concurrent restore'});
  assert.equal((await post(observer,restore,deleted.version)).status,403);
  assert.equal((await post(session,restore)).status,428);
  assert.equal((await post(session,restore,deleted.version,{'X-CSRF-Token':''})).status,403);
  assert.equal((await post(session,restore,deleted.version,{Origin:'https://example.invalid'})).status,403);
  const attempts=[restore,{...restore,operationId:randomUUID()}];
  const responses=await Promise.all(attempts.map(input=>post(session,input,deleted.version)));
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
  assert.equal((await post(session,attempts[responses.findIndex(response=>response.status===200)],deleted.version)).status,200);
  assert.equal((await post(session,attempts[responses.findIndex(response=>response.status===409)],deleted.version)).status,409);
  assert.equal(hub.store.get('production-log').data.entries.length,1);
  assert.equal(hub.store.reportHistory('production-log',entry.id,account).events.length,3);
  const latest=hub.store.get('production-log');hub.store.reportOperation('production-log',operation('delete',{reason:'Fictional revoked deletion'}),latest.versions[entry.id],account);
  await hub.auth.update(delegated.id,{permissions:{canEditProduction:false}},account);
  assert.equal((await post(session,restore,deleted.version)).status,401);
  const revoked=await login(delegated.username);
  assert.equal((await fetch(base+'/api/reports/production-log/history?entryId='+entry.id,{headers:headers(revoked)})).status,403);
  const current=hub.store.reportHistory('production-log',entry.id,account);
  assert.equal((await post(revoked,{...restore,sourceVersion:current.version,operationId:randomUUID()},current.version)).status,403);
});

test('pair plan corrections require a reason; first reports and cancellation retain their existing reporting permissions',t => {
  const store=openStore(':memory:',productionClock);t.after(()=>store.close());store.put('personnel',{...store.get('personnel').data,employees:people},1,admin);
  const planned=pair('demo-plan-reason');planned.result=null;planned.updatedAt=planned.createdAt;
  const reporter={id:5,username:'demo-history-reporter',role:'operator',taskTeam:scope.team};
  const saved=store.reportOperation('pair-targets',op('create',planned),undefined,reporter);
  assert.throws(()=>store.reportOperation('pair-targets',op('update',{...planned,targetKg:1100}),saved.versions[planned.id],reporter),{code:'CORRECTION_REASON_REQUIRED'});
  const corrected=store.reportOperation('pair-targets',op('update',{...planned,targetKg:1100},{reason:'Fictional plan correction'}),saved.versions[planned.id],reporter);
  const report=JSON.parse(JSON.stringify(model.report(corrected.data.entries[0],{context:scope,kg:1200,crates:40,workAreas:['manual'],now:'2026-10-05T07:00:00.000Z'})));
  store.reportOperation('pair-targets',op('update',report),corrected.versions[planned.id],reporter);
  const current=store.get('pair-targets');store.reportOperation('pair-targets',op('delete',planned.id,{reason:'Fictional removal'}),current.versions[planned.id],admin);
  const other={...planned,id:'demo-cancel-reason'};
  const created=store.reportOperation('pair-targets',op('create',other),undefined,reporter);
  const cancelled=JSON.parse(JSON.stringify(model.cancel(other,{context:scope,reasonKey:'cleaning',now:'2026-10-05T07:00:00.000Z'})));
  store.reportOperation('pair-targets',op('update',cancelled),created.versions[other.id],reporter);
  assert.equal(store.reportHistory('pair-targets',other.id,admin).events[0].reason,'Чистене');
});
