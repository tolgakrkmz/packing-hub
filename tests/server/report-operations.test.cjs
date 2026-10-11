/* Isolated SQLite and HTTP tests. All accounts, people and reports are fictional. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createHubServer} = require('../../server/server.cjs');
const {openStore} = require('../../server/store.cjs');
const vm = require('node:vm');
const sandbox = vm.createContext({});
for(const name of ['shift-schedule','pair-targets-model']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/'+name+'.js'),'utf8'),sandbox);
const model = vm.runInContext('PairTargets',sandbox);
const PairTargets = Object.fromEntries(['plan','report','emptyData'].map(name => [name,(...args) => JSON.parse(JSON.stringify(model[name](...args)))]));
const {reports} = require('../../server/permissions.cjs');
const password = 'Fictional-report-123';
const employees = [1,2,3,4].map(id => ({id:'demo-operation-person-'+id,name:'Demo Operation Person '+id,category:'stickers',team:'1 смяна',role:'Опаковчик',active:true}));
const scope = {date:'2026-10-05',shiftCode:1,team:'СТИКЕРИ'};
function entry(kind, id, group = 0) {
  if(kind === 'production-log') return {id,date:scope.date,shift:'СТИКЕРИ',tonnage:1000,brak:10,breakdown:null};
  if(kind === 'line-downtime') return {id,date:scope.date,shift:'СТИКЕРИ',start:'09:00',end:'09:30',durationMin:30,reason:'Друго',reasonNote:'Fictional downtime',note:''};
  return PairTargets.plan({data:PairTargets.emptyData(),employees,context:scope,memberIds:employees.slice(group*2,group*2+2).map(person => person.id),targetKg:1000,targetCrates:40,workAreas:['manual'],id,now:'2026-10-05T06:00:00.000Z'});
}
const create = value => ({operationId:randomUUID(),action:'create',entryId:value.id,entry:value});
const update = value => ({...create(value),action:'update'});
const remove = id => ({operationId:randomUUID(),action:'delete',entryId:id});
async function setup(t) {
  const hub = createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true});
  const admin = await hub.auth.create('demo-reports-admin',password,'admin');
  await hub.auth.create('demo-reports-operator',password,'operator',admin);
  await hub.auth.create('demo-reports-observer',password,'observer',admin);
  hub.store.put('personnel',{...hub.store.get('personnel').data,employees},1,admin);
  await new Promise(resolve => hub.server.listen(0,'127.0.0.1',resolve)); t.after(() => hub.close());
  const base = 'http://127.0.0.1:'+hub.server.address().port;
  const login = async username => {
    const session = await hub.auth.login(username,password);
    return {...session,cookie:'hub-local-session='+session.token};
  };
  const request = (kind,session,input,version,options = {}) => fetch(base+'/api/reports/'+kind+'/operations',{
    method:'POST',...options,headers:{Origin:base,'Content-Type':'application/json',...(session ? {Cookie:session.cookie,'X-CSRF-Token':session.csrf} : {}),...(version ? {'If-Match':'"'+version+'"'} : {}),...options.headers},body:JSON.stringify(input)
  });
  return {hub,admin,login,request};
}
for(const kind of Object.keys(reports)) {
  test(kind+': simultaneous independent creates and updates retain both reports without a module refresh',async t => {
    const {hub,login,request} = await setup(t);
    const sessions = await Promise.all([login('demo-reports-operator'),login('demo-reports-operator')]);
    const inputs = [create(entry(kind,'demo-operation-a')),create(entry(kind,'demo-operation-b',1))];
    const responses = await Promise.all(inputs.map((input,i) => request(kind,sessions[i],input)));
    assert.deepEqual(responses.map(response => response.status),[200,200]);
    const current = hub.store.get(kind), versions = current.versions;
    assert.equal(current.data.entries.length,2);
    const changed = current.data.entries.map(value => kind === 'production-log' ? {...value,tonnage:1200} : kind === 'line-downtime' ? {...value,note:'Fictional correction'} : {...value,targetKg:1200,updatedAt:'2026-10-05T06:01:00.000Z'});
    const actor = kind === 'pair-targets' ? sessions[0] : await login('demo-reports-admin');
    const edits = await Promise.all(changed.map(value => request(kind,actor,update(value),versions[value.id])));
    assert.deepEqual(edits.map(response => response.status),[200,200]);
    assert.deepEqual(hub.store.get(kind).data.entries,changed);
    for(const [i,input] of inputs.entries()) {
      const replay = await request(kind,sessions[i],input);
      assert.equal(replay.status,200); const result = await replay.json();
      assert.equal(result.replayed,true); assert.equal(result.receipt.status,'confirmed');
      assert.deepEqual(result.data.entries,changed); // No rollback to the original receipt snapshot.
    }
    assert.equal(hub.store.get(kind).revision,5);
  });
  test(kind+': competing edits conflict and failed changes leave no receipt or partial data',async t => {
    const {hub,login,request} = await setup(t), session = await login('demo-reports-admin');
    const value = entry(kind,'demo-contested');
    const accepted = await (await request(kind,session,create(value))).json();
    const a = kind === 'production-log' ? {...value,tonnage:1500} : kind === 'line-downtime' ? {...value,note:'Fictional edit A'} : {...value,targetKg:1500};
    const b = kind === 'production-log' ? {...value,tonnage:1600} : kind === 'line-downtime' ? {...value,note:'Fictional edit B'} : {...value,targetKg:1600};
    const ops = [update(a),update(b)];
    const responses = await Promise.all(ops.map(input => request(kind,session,input,accepted.versions[value.id])));
    assert.deepEqual(responses.map(response => response.status).sort(),[200,409]);
    const rejected = responses.find(response => response.status === 409);
    assert.deepEqual(await rejected.json(),{error:'REPORT_CONFLICT'});
    assert.equal(hub.store.db.prepare('SELECT count(*) AS n FROM report_operations').get().n,2);
    const latest = hub.store.get(kind);
    if(kind !== 'pair-targets') {
      const deletion = remove(value.id);
      assert.equal((await request(kind,session,deletion,accepted.versions[value.id])).status,409);
      const deleted = await request(kind,session,deletion,latest.versions[value.id]); assert.equal(deleted.status,200);
      const receipt = (await deleted.json()).receipt;
      assert.deepEqual((await (await request(kind,session,deletion,latest.versions[value.id])).json()).receipt,receipt);
      assert.equal((await request(kind,session,update(a),latest.versions[value.id])).status,409);
      await request(kind,session,create(value));
      assert.equal((await request(kind,session,update(b),accepted.versions[value.id])).status,409);
    }
  });
  test(kind+': a response lost after commit retries exactly once with the same receipt',async t => {
    const {hub,login,request} = await setup(t), session = await login('demo-reports-admin');
    const controller = new AbortController(), original = hub.store.reportOperation;
    const input = create(entry(kind,'demo-interrupted'));
    hub.store.reportOperation = (...args) => { const result = original(...args); controller.abort(); return result; };
    await assert.rejects(request(kind,session,input,undefined,{signal:controller.signal}),{name:'AbortError'});
    hub.store.reportOperation = original;
    assert.equal(hub.store.get(kind).data.entries.length,1);
    const revision = hub.store.get(kind).revision, auditCount = hub.store.db.prepare("SELECT count(*) AS n FROM audit WHERE action='write' AND module=?").get(kind).n;
    const retries = await Promise.all([request(kind,session,input),request(kind,session,input)]);
    const results = await Promise.all(retries.map(response => response.json()));
    assert.ok(results.every(result => result.replayed && result.receipt.status === 'confirmed'));
    assert.deepEqual(results[0].receipt,results[1].receipt);
    assert.equal(hub.store.get(kind).revision,revision);
    assert.equal(hub.store.db.prepare("SELECT count(*) AS n FROM audit WHERE action='write' AND module=?").get(kind).n,auditCount);
    const reused = await request(kind,session,{...input,entryId:'demo-other',entry:{...input.entry,id:'demo-other'}});
    assert.equal(reused.status,409); assert.deepEqual(await reused.json(),{error:'OPERATION_REUSED'});
  });
  test(kind+': operation API checks module flags, origin, CSRF, schemas and required record versions',async t => {
    const {hub,admin,login,request} = await setup(t);
    const operator = await login('demo-reports-operator'), observer = await login('demo-reports-observer'), manager = await login('demo-reports-admin');
    const input = create(entry(kind,'demo-rights'));
    for(const [session,status,options] of [[null,401,{}],[observer,403,{}],[operator,403,{headers:{Origin:'https://example.invalid'}}],[operator,403,{headers:{'X-CSRF-Token':''}}]]) assert.equal((await request(kind,session,input,undefined,options)).status,status);
    assert.equal((await request(kind,operator,{...input,goalTons:5})).status,400);
    assert.equal((await request(kind,operator,{...input,entry:{id:input.entryId}})).status,400);
    const accepted = await (await request(kind,operator,input)).json();
    assert.equal((await request(kind,operator,update(input.entry))).status,428);
    const version = accepted.versions[input.entryId];
    assert.equal((await request(kind,observer,update(input.entry),version)).status,403);
    assert.equal((await request(kind,operator,remove(input.entryId),version)).status,403);
    await hub.auth.create('demo-reports-editor',password,'observer',admin,{[reports[kind].edit]:true});
    const editor = await login('demo-reports-editor');
    assert.equal((await request(kind,editor,create(entry(kind,'demo-editor-new',1)))).status,403);
    if(kind === 'pair-targets') {
      const reported = PairTargets.report(input.entry,{context:scope,kg:1000,crates:40,workAreas:['manual'],now:'2026-10-05T06:02:00.000Z'});
      assert.equal((await request(kind,editor,update(reported),version)).status,403);
      const result = await request(kind,operator,update(reported),version); assert.equal(result.status,200);
      const reportVersion = (await result.json()).versions[input.entryId];
      assert.equal((await request(kind,operator,update({...reported,result:{...reported.result,kg:1100}}),reportVersion)).status,403);
      assert.equal((await request(kind,editor,update({...reported,result:{...reported.result,kg:1100}}),reportVersion)).status,200);
      assert.equal((await request(kind,manager,remove(input.entryId),reportVersion)).status,409);
    } else {
      assert.equal((await request(kind,operator,update(input.entry),version)).status,403);
      assert.equal((await request(kind,editor,update(input.entry),version)).status,200);
    }
    // Revoked permission is checked even for a previously committed operation.
    await hub.auth.update(operator.user.id,{permissions:{[reports[kind].create]:false}},admin);
    const revoked = await login('demo-reports-operator');
    assert.equal((await request(kind,revoked,input)).status,403);
    await hub.auth.create('demo-reports-hidden',password,'admin',admin,{[{'production-log':'canViewProduction','line-downtime':'canViewDowntime','pair-targets':'canViewPairs'}[kind]]:false});
    assert.equal((await request(kind,await login('demo-reports-hidden'),create(entry(kind,'demo-hidden',1)))).status,403);
  });
}
test('record versions and receipts survive restart, legacy replacement and additive migration',t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'hub-report-operations-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const filename = path.join(directory,'demo.sqlite'), user = {id:1,role:'admin'};
  let store = openStore(filename);
  const input = create(entry('production-log','demo-durable'));
  const first = store.reportOperation('production-log',input,undefined,user); store.close();
  store = openStore(filename);
  const receipt = store.reportOperation('production-log',input,undefined,user);
  assert.deepEqual(receipt.receipt,first.receipt); assert.equal(receipt.replayed,true);
  store.put('production-log',{...receipt.data,goalTons:10},receipt.revision,user);
  assert.equal(store.get('production-log').versions[input.entryId],first.versions[input.entryId]);
  const current = store.get('production-log');
  store.put('production-log',{...current.data,entries:[{...input.entry,tonnage:1200}]},current.revision,user);
  assert.throws(() => store.reportOperation('production-log',update(input.entry),first.versions[input.entryId],user),{code:'REPORT_CONFLICT'});
  const legacyVersion = store.get('production-log').revision;
  store.db.exec('DROP TABLE report_versions; DROP TABLE report_operations'); store.close();
  store = openStore(filename);
  assert.equal(store.get('production-log').versions[input.entryId],legacyVersion);
  store.close();
});
test('receipt failure rolls back the report, version and audit; snapshots retain replay protection',t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'hub-report-receipt-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const store = openStore(path.join(directory,'demo.sqlite')), user = {id:1,role:'admin'};
  t.after(() => store.close());
  const before = store.get('production-log'), input = create(entry('production-log','demo-receipt-atomic'));
  store.db.exec("CREATE TRIGGER deny_demo_receipt BEFORE INSERT ON report_operations BEGIN SELECT RAISE(ABORT,'Fictional receipt failure'); END");
  assert.throws(() => store.reportOperation('production-log',input,undefined,user));
  assert.deepEqual(store.get('production-log'),before);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM report_versions').get().n,0);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM audit').get().n,0);
  store.db.exec('DROP TRIGGER deny_demo_receipt');
  const saved = store.reportOperation('production-log',input,undefined,user);
  const archive = path.join(directory,'demo-snapshot.sqlite'); store.db.prepare('VACUUM INTO ?').run(archive);
  const recovered = openStore(archive);
  try {
    const replay = recovered.reportOperation('production-log',input,undefined,user);
    assert.deepEqual(replay.receipt,saved.receipt); assert.equal(replay.replayed,true); assert.equal(replay.revision,saved.revision);
  } finally { recovered.close(); }
});
