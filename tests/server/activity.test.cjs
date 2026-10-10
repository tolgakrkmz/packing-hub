const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHubServer} = require('../../server/server.cjs');
const {openStore} = require('../../server/store.cjs');
const {createActivity} = require('../../server/activity.cjs');
const password = 'Fictional-password-123';
async function setup(t) {
  const hub = createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true});
  for (const role of ['admin','operator','observer']) await hub.auth.create('demo-'+role,password,role);
  await new Promise(resolve => hub.server.listen(0,'127.0.0.1',resolve));
  t.after(() => hub.close());
  const base = 'http://127.0.0.1:'+hub.server.address().port;
  const request = (route,user,method='GET',data,extra={}) => fetch(base+route,{method,redirect:'manual',headers:{Origin:base,...(user ? {Cookie:user.cookie,'X-CSRF-Token':user.csrf} : {}),...(data === undefined ? {} : {'Content-Type':'application/json'}),...extra},...(data === undefined ? {} : {body:JSON.stringify(data)})});
  const login = async role => {
    const response = await request('/api/login',null,'POST',{username:'demo-'+role,password});
    assert.equal(response.status,200);
    return {...await response.json(),cookie:response.headers.get('set-cookie').split(';')[0]};
  };
  return {hub,request,login};
}
test('activity page and API are administrator-only, including direct access, revoked sessions and spoofed filters',async t => {
  const {hub,request,login} = await setup(t);
  for (const method of ['GET','HEAD']) for (const page of ['admin-panel','activity-log']) assert.equal((await request('/'+page+'.html',null,method)).status,302);
  assert.equal((await request('/api/admin/activity')).status,401);
  const admin = await login('admin');
  for (const role of ['operator','observer']) {
    const user = await login(role);
    for (const method of ['GET','HEAD']) for (const page of ['admin-panel','activity-log']) assert.equal((await request('/'+page+'.html',user,method)).status,403);
    assert.equal((await request('/api/admin/activity?userId='+user.user.id,user)).status,403);
    assert.equal((await request('/api/admin/activity',user,'POST',{})).status,403);
  }
  assert.equal((await request('/activity-log.html',admin)).status,200);
  for (const method of ['GET','HEAD']) assert.equal((await request('/admin-panel.html',admin,method)).status,200);
  assert.equal((await request('/api/admin/activity',admin,'POST',{})).status,405);
  for (const query of ['userId=0','userId=1%20OR%201=1','limit=101','limit=-1','from=2&to=1','before=0','action=made-up','userId=1&userId=2','token=fictional']) assert.equal((await request('/api/admin/activity?'+query,admin)).status,400);
  await hub.auth.create('demo-second-admin',password,'admin');
  const another = hub.auth.list().find(user => user.username === 'demo-second-admin');
  await hub.auth.update(admin.user.id,{role:'observer'},another);
  assert.equal((await request('/api/admin/activity',admin)).status,401);
});
test('successful navigation and logout are logged; polling, assets, denied pages, failed writes and HEAD are excluded',async t => {
  const {hub,request,login} = await setup(t), admin = await login('admin'), operator = await login('operator');
  assert.equal((await request('/production-log.html',operator)).status,200);
  const visit = hub.store.db.prepare("SELECT * FROM audit WHERE user_id=? AND action='visit'").get(operator.user.id);
  assert.equal(visit.module,'production-log');
  for (const route of ['/api/session','/api/data/production-log','/api/tasks/summary','/js/production-log.js','/server-session.js']) await request(route,operator);
  await request('/production-log.html',operator,'HEAD');
  await request('/personnel.html',operator);
  await request('/missing.html',operator);
  await request('/api/data/production-log',operator,'PUT',{entries:[],goalTons:1},{'If-Match':'"1"'});
  assert.equal(hub.store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE user_id=? AND action='visit'").get(operator.user.id).n,1);
  assert.equal(hub.store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE user_id=? AND action='write'").get(operator.user.id).n,0);
  const report = {id:'demo-activity-report',date:'2026-10-10',shift:'А',tonnage:10,brak:0,breakdown:null};
  assert.equal((await request('/api/data/production-log',operator,'PUT',{entries:[report],goalTons:3000},{'If-Match':'"1"'})).status,200);
  assert.equal((await request('/api/export/production-log',operator)).status,200);
  const response = await request('/api/admin/activity?userId='+operator.user.id,admin), result = await response.json();
  assert.equal(result.users.find(user => user.id === operator.user.id).lastVisitAt,visit.at);
  assert.deepEqual(result.events.map(event => event.action),['export','write','visit','login']);
  assert.deepEqual(Object.keys(result.events[0]).sort(),['action','active','at','deletedAt','id','module','userId','username']);
  assert.doesNotMatch(JSON.stringify(result),/Fictional-password|csrf|hash|tonnage|demo-activity-report/);
  assert.equal((await request('/api/logout',operator,'POST',{})).status,200);
  const loggedOut = await (await request('/api/admin/activity?userId='+operator.user.id,admin)).json();
  assert.equal(loggedOut.events[0].action,'logout');
  assert.equal(loggedOut.users.find(user => user.id === operator.user.id).lastVisitAt,visit.at);
  assert.equal((await request('/api/admin/activity',operator)).status,401);
});
test('filters and cursor pagination preserve history and last visits across account removal and database reopen',async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hub-activity-demo-')), filename = path.join(dir,'demo.sqlite');
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  let store = openStore(filename);
  const adminId = Number(store.db.prepare("INSERT INTO users(username,hash,role) VALUES('demo-admin','fictional-disabled-hash','admin')").run().lastInsertRowid);
  const id = Number(store.db.prepare("INSERT INTO users(username,hash,role) VALUES('demo-history','fictional-disabled-hash','operator')").run().lastInsertRowid);
  const admin = {id:adminId,role:'admin'};
  createActivity(store);
  const insert = store.db.prepare('INSERT INTO audit(at,user_id,action,module) VALUES(?,?,?,?)');
  insert.run(1000,id,'login','accounts'); insert.run(2000,id,'visit','statistics');
  for (let i=0;i<106;i++) insert.run(3000+i,id,'export','production-log');
  store.db.prepare('UPDATE users SET active=0,deleted_at=5000 WHERE id=?').run(id);
  store.close(); store = openStore(filename);
  t.after(() => store.close());
  const activity = createActivity(store), read = query => activity.list(new URLSearchParams(query),admin);
  assert.throws(() => activity.list(new URLSearchParams(),{role:'observer'}),{code:'FORBIDDEN'});
  const seen = [], first = read('userId='+id+'&limit=40');
  let page = first;
  while (true) {
    seen.push(...page.events.map(event => event.id));
    if (page.nextBefore === null) break;
    // Concurrent newer events never shift the next page or create duplicates.
    store.audit(admin,'write','personnel');
    page = read('userId='+id+'&limit=40&before='+page.nextBefore);
  }
  assert.equal(seen.length,108); assert.equal(new Set(seen).size,108);
  assert.equal(first.users.find(user => user.id === id).lastVisitAt,2000);
  assert.equal(first.users.find(user => user.id === id).deletedAt,5000);
  assert.equal(first.users.find(user => user.id === id).username,'demo-history');
  assert.equal(read('userId='+id+'&from=2000&to=3001').events.length,2);
  assert.equal(read('userId='+id+'&action=visit').events[0].module,'statistics');
  assert.equal(read('userId='+id+'&action=changes&limit=100').events.length,100);
  assert.equal(read('userId='+id+'&from=99999').events.length,0);
  assert.equal(read('userId='+id+'&from=99999').users.find(user => user.id === id).lastVisitAt,2000);
  assert.equal(read('userId=999999').nextBefore,null);
});
