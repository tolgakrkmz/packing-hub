/* Isolated fictional records only; no production data or credentials. */
const test = require('node:test'), assert = require('node:assert/strict'), {randomUUID} = require('node:crypto');
const {openStore} = require('../../server/store.cjs');
const {createHubServer} = require('../../server/server.cjs');
const admin = {id:1,username:'demo-page-admin',role:'admin'};
const row = id => ({id,date:'2026-10-05',shift:'А',tonnage:1000,brak:10});
test('bounded history pages include legacy and deleted rows, stable ties and date filters without snapshots', t => {
  const store=openStore(':memory:');t.after(()=>store.close());
  const entries=Array.from({length:62},(_,i)=>row('demo-page-'+String(i).padStart(3,'0')));
  store.db.prepare('UPDATE documents SET data=?,revision=77 WHERE kind=?').run(JSON.stringify({entries,goalTons:3000}),'production-log');
  const changed={...entries[0],date:'2026-10-06'};
  store.reportOperation('production-log',{operationId:randomUUID(),action:'update',entryId:changed.id,entry:changed,reason:'Fictional date correction'},77,admin);
  store.reportOperation('production-log',{operationId:randomUUID(),action:'delete',entryId:changed.id,reason:'Fictional deletion'},78,admin);
  let cursor, found=[];
  do { const result=store.reportHistoryList('production-log',admin,{cursor});assert.ok(result.entries.length<=25); found.push(...result.entries);cursor=result.nextCursor; } while(cursor);
  assert.equal(found.length,62);assert.equal(new Set(found.map(r=>r.entryId)).size,62);
  assert.equal(found[0].deleted,true);assert.equal(found[0].date,'2026-10-06');
  assert.deepEqual(store.reportHistoryList('production-log',admin,{date:'2026-10-06'}).entries,[found[0]]);
  assert.equal(store.reportHistoryList('production-log',admin,{date:'2026-10-07'}).entries.length,0);
  assert.equal(store.reportHistoryList('production-log',admin,{limit:999}).entries.length,50);
  assert.equal(JSON.stringify(found).includes('tonnage'),false);
  for(const options of [{date:'2026-02-30'},{cursor:'invalid'},{limit:'-1'}]) assert.throws(()=>store.reportHistoryList('production-log',admin,options),{code:'INVALID_HISTORY_FILTER'});
});
test('HTTP version summaries are bounded and snapshots are fetched separately with module permissions',async t => {
  const hub=createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true});t.after(()=>hub.close());
  await hub.auth.create('demo-page-admin','Fictional-password-123','admin');await hub.auth.create('demo-page-observer','Fictional-password-123','observer');
  const actor=hub.auth.list()[0], entry=row('demo-page-version');
  let version;
  for(let i=0;i<43;i++) { const result=hub.store.reportOperation('production-log',{operationId:randomUUID(),action:i?'update':'create',entryId:entry.id,entry:{...entry,tonnage:1000+i},reason:'Fictional historical entry '+i},version,actor);version=result.versions[entry.id]; }
  await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+hub.server.address().port;
  const session=await hub.auth.login('demo-page-admin','Fictional-password-123'),headers={Cookie:'hub-local-session='+session.token};
  const url=base+'/api/reports/production-log/history?entryId='+entry.id;
  let before, versions=[];
  do { const response=await fetch(url+'&metadata=1'+(before?'&beforeVersion='+before:''),{headers});assert.equal(response.status,200);const result=await response.json();assert.ok(result.events.length<=20);for(const event of result.events){assert.equal(Object.hasOwn(event,'before'),false);assert.equal(Object.hasOwn(event,'after'),false);}versions.push(...result.events.map(e=>e.version));before=result.nextVersion; } while(before);
  assert.equal(versions.length,43);assert.equal(new Set(versions).size,43);
  const snapshot=await (await fetch(url+'&version='+version,{headers})).json();assert.equal(snapshot.before.tonnage,1041);assert.equal(snapshot.after.tonnage,1042);
  assert.equal((await fetch(url+'&beforeVersion=bad',{headers})).status,400);
  assert.equal((await fetch(url+'&version=999',{headers})).status,404);
  const observer=await hub.auth.login('demo-page-observer','Fictional-password-123');
  assert.equal((await fetch(url+'&version='+version,{headers:{Cookie:'hub-local-session='+observer.token}})).status,403);
  hub.auth.update(actor.id,{permissions:{canEditProduction:false}},actor);
  assert.equal((await fetch(url+'&version='+version,{headers})).status,401);
});
