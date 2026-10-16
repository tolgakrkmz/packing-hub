/* Assigned-shift reporting policy; all inputs and SQLite databases are fictional. */
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {openStore}=require('../../server/store.cjs');
const user={id:2,role:'operator',taskTeam:'СТИКЕРИ'},admin={id:1,role:'admin'};
const entry=(id,date='2026-10-16')=>({id,date,shift:'СТИКЕРИ',tonnage:1000,brak:0});
const create=value=>({operationId:randomUUID(),action:'create',entryId:value.id,entry:value});
test('the selected report must belong to the current shift and writes stop at its four-hour deadline',t=>{
  let now=Date.parse('2026-10-16T12:00:00+03:00');
  const store=openStore(':memory:',{productionNow:()=>now});t.after(()=>store.close());
  for(const date of ['2026-10-15','2026-10-19'])assert.throws(()=>store.reportOperation('production-log',create(entry('demo-other-'+date,date)),undefined,user),{code:'PRODUCTION_WINDOW_CLOSED'});
  store.reportOperation('production-log',create(entry('demo-current')),undefined,user);
  now=Date.parse('2026-10-16T21:30:00+03:00');
  const before=store.get('production-log');
  assert.throws(()=>store.reportOperation('production-log',create(entry('demo-shift-ended')),undefined,user),{code:'PRODUCTION_WINDOW_CLOSED'});
  assert.deepEqual(store.get('production-log'),before);
});
test('a previously stored temporary unlock cannot authorize an off-shift write',t=>{
  const store=openStore(':memory:',{productionNow:()=>Date.parse('2026-10-16T22:05:00+03:00')});t.after(()=>store.close());
  // Simulate an earlier app version without deleting its local authorization data.
  store.db.exec(`CREATE TABLE IF NOT EXISTS production_reporting_extensions(
    date TEXT NOT NULL,team TEXT NOT NULL,starts_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
    enabled INTEGER NOT NULL,reason TEXT NOT NULL,user_id INTEGER,at INTEGER NOT NULL,PRIMARY KEY(date,team))`);
  const start=Date.parse('2026-10-16T22:00:00+03:00');
  store.db.prepare('INSERT INTO production_reporting_extensions VALUES(?,?,?,?,?,?,?,?)').run('2026-10-16','СТИКЕРИ',start,start+1800000,1,'Fictional obsolete approval',1,start);
  assert.throws(()=>store.reportOperation('production-log',create(entry('demo-obsolete-unlock')),undefined,user),{code:'PRODUCTION_WINDOW_CLOSED'});
});
test('the removed late-unlock command is rejected even for administrators',t=>{
  const store=openStore(':memory:',{productionNow:()=>Date.parse('2026-10-16T22:00:00+03:00')});t.after(()=>store.close());
  assert.throws(()=>store.productionAccess.configure({mode:'late',date:'2026-10-16',team:'СТИКЕРИ',enabled:true,reason:'Fictional removed command'},admin),{status:400});
});
