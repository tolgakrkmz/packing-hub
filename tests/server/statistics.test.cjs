const test = require('node:test');
const assert = require('node:assert/strict');
const {openStore} = require('../../server/store.cjs');
const {createStatisticsReads} = require('../../server/statistics.cjs');
const {createHubServer} = require('../../server/server.cjs');
const {statisticsFixture} = require('../browser/statistics-period.cjs');
function seed(store, data = statisticsFixture()) {
  for (const [kind,value] of Object.entries(data)) store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(value),kind);
}
test('monthly projections omit other reports, retain every year and exact annual kg/shift totals',t => {
  const store = openStore(':memory:'); t.after(() => store.close()); seed(store);
  const reads = createStatisticsReads(store), result = reads.read('production-log','2026-10');
  assert.deepEqual(Object.keys(result).sort(),['data','revision']);
  assert.equal(result.data.entries.length,2); assert.equal(result.data.goalTons,10);
  assert.deepEqual(result.data.summary.availableYears,['2025','2026']);
  assert.deepEqual(result.data.summary.years.map(row => [row.key,row.tonnage,row.brak,row.byShift.А,row.byShift.Б]),
    [['2025',5000,900,5000,0],['2026',4000,150,3000,1000]]);
  assert.deepEqual(result.data.summary.months.map(row => [row.key,row.tonnage,row.brak]),
    [['2025-10',5000,900],['2026-09',1000,0],['2026-10',3000,150]]);
  assert.deepEqual(result.data.summary.months.map(row => row.count),[1,1,2]);
  assert.deepEqual(result.data.summary.years.map(row => row.count),[1,3]);
  assert.ok(!JSON.stringify(result).includes('demo-period-previous-october'));
  assert.equal(reads.read('production-log','2026-11').data.entries.length,0);
});
test('downtime detail scope follows the year/all selection; pair plans follow the month',t => {
  const store = openStore(':memory:'); t.after(() => store.close()); seed(store);
  const reads = createStatisticsReads(store);
  const annual = reads.read('line-downtime','2026-10');
  assert.equal(annual.data.entries.length,0);
  assert.deepEqual(annual.data.summary.years,[{key:'2024',durationMin:30,count:1}]);
  assert.equal(reads.read('line-downtime','2024-12').data.entries.length,1);
  assert.equal(reads.read('line-downtime','2026-10','all').data.entries.length,1);
  const pairs = reads.read('pair-targets','2026-10');
  assert.deepEqual(pairs.data.availableYears,['2025','2026']);
  assert.deepEqual(pairs.data.entries.map(entry => entry.id),['demo-period-current']);
  assert.equal(reads.read('pair-targets','2025-12').data.entries[0].result.kg,800);
});
test('a revision change invalidates cached detail buckets, summaries and year metadata, including empty recovery',t => {
  const store = openStore(':memory:'); t.after(() => store.close()); const data = statisticsFixture(); seed(store,data);
  const reads = createStatisticsReads(store), first = reads.read('production-log','2026-10');
  assert.equal(reads.read('production-log','2026-09').data.summary,first.data.summary);
  data['production-log'].entries[0].tonnage = 4000; data['production-log'].goalTons = 20;
  seed(store,data); const changed = reads.read('production-log','2026-10');
  assert.notEqual(changed.data.summary,first.data.summary); assert.equal(changed.data.entries[0].tonnage,4000);
  assert.equal(changed.data.summary.years.find(row => row.key === '2026').tonnage,6000);
  assert.equal(changed.data.goalTons,20);
  seed(store,{'production-log':{entries:[],goalTons:20}});
  assert.deepEqual(reads.read('production-log','2026-10').data.summary.availableYears,[]);
  seed(store,data); assert.equal(reads.read('production-log','2026-10').data.entries.length,2);
});
test('line productivity covers every month and follows pair revisions',t => {
  const store = openStore(':memory:'); t.after(() => store.close()); const data = statisticsFixture();
  data['production-log'].entries = [{id:'demo-line-sep',date:'2026-09-02',shift:'В',tonnage:6000,brak:0,breakdown:{autoKg:4000,autoCrates:0,manKg:2000,manCrates:0}},
    {id:'demo-line-oct',date:'2026-10-02',shift:'В',tonnage:2000,brak:0,breakdown:{autoKg:2000,autoCrates:0,manKg:0,manCrates:0}}];
  const pair = (id, date, areas) => ({id,date,shiftCode:1,team:'В',members:[{id:id+'-1',name:'Demo One'},{id:id+'-2',name:'Demo Two'}],areas,targetKg:1000,targetCrates:40,result:null});
  data['pair-targets'].entries = [pair('demo-line-p1','2026-09-02',['auto','manual']),pair('demo-line-p2','2026-10-02',['auto'])];
  seed(store,data); const reads = createStatisticsReads(store);
  const october = reads.read('production-log','2026-10').data.lines;
  assert.equal(reads.read('production-log','2026-09').data.lines,october);
  assert.deepEqual(JSON.parse(JSON.stringify(october.auto)),{kg:6000,people:3,shifts:2,tonsPerPerson:2});
  assert.deepEqual(JSON.parse(JSON.stringify(october.manual)),{kg:2000,people:1,shifts:1,tonsPerPerson:2});
  data['pair-targets'].entries.pop(); seed(store,{'pair-targets':data['pair-targets']});
  assert.deepEqual(JSON.parse(JSON.stringify(reads.read('production-log','2026-10').data.lines.auto)),{kg:4000,people:1,shifts:1,tonsPerPerson:4});
});
test('invalid periods are rejected before reading any document',t => {
  const store = openStore(':memory:'); t.after(() => store.close()); const reads = createStatisticsReads(store);
  for (const month of [null,'','2026','2026-00','2026-13','2026-1','2026-10-01','2026-10 OR 1=1'])
    assert.throws(() => reads.read('production-log',month),error => error.status === 400 && error.code === 'INVALID_PERIOD');
  assert.throws(() => reads.read('production-log','2026-10','invalid'),error => error.status === 400);
});
test('period and counter endpoints enforce module access, reject invalid queries/methods and expose read-only data',async t => {
  const hub = createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true}); t.after(() => hub.close()); seed(hub.store);
  const password = 'Fictional-statistics-password-123';
  await hub.auth.create('demo-period-reader',password,'observer',null,{canViewStatistics:true,canViewProduction:false,canViewDowntime:false,canViewPairs:false});
  await hub.auth.create('demo-period-denied',password,'observer',null,{canViewStatistics:false,canViewNotifications:false});
  await new Promise(resolve => hub.server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:'+hub.server.address().port;
  const login = name => hub.auth.login(name,password), user = await login('demo-period-reader'), denied = await login('demo-period-denied');
  const request = (url,session = user,method = 'GET') => fetch(base+url,{method,headers:{Cookie:'hub-local-session='+session.token,Origin:base,'X-CSRF-Token':session.csrf}});
  for (const kind of ['production-log','line-downtime','pair-targets']) {
    const url = '/api/statistics/period/'+kind+'?month=2026-10';
    const response = await request(url); assert.equal(response.status,200);
    assert.equal((await response.json()).versions,undefined);
    assert.equal((await request('/api/data/'+kind)).status,403);
    assert.equal((await request(url,denied)).status,403);
    assert.equal((await request(url,user,'POST')).status,405);
  }
  for (const query of ['','month=2026-13','month=2026-10&scope=','month=2026-10&scope=invalid','month=2026-10&month=2025-10','month=2026-10&extra=true'])
    assert.equal((await request('/api/statistics/period/production-log?'+query)).status,400,query);
  const counter = await request('/api/notifications/summary'); assert.equal(counter.status,200);
  assert.deepEqual(await counter.json(),{count:0});
  assert.equal((await request('/api/notifications/summary',user,'POST')).status,405);
  assert.equal((await request('/api/notifications/summary',denied)).status,403);
});
test('a saved zero report remains a counted result in the production summary',t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  seed(store,{'production-log':{goalTons:10,entries:[{id:'demo-zero-result',date:'2026-10-04',shift:'А',tonnage:0,brak:0,breakdown:null}]}});
  const summary = createStatisticsReads(store).read('production-log','2026-10').data.summary;
  assert.deepEqual(summary.months.map(row => [row.key,row.tonnage,row.count]),[['2026-10',0,1]]);
  assert.deepEqual(summary.years.map(row => [row.key,row.tonnage,row.count]),[['2026',0,1]]);
});
