/* Authenticated loopback API timings; generated records, in-memory SQLite, no traces. */
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {createHubServer} = require('../server/server.cjs');
const samples = 5, now = Date.parse('2026-10-05T08:30:00+03:00');
const median = values => Number([...values].sort((a,b) => a-b)[Math.floor(values.length/2)].toFixed(2));
async function main() {
  const hub = createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true,taskNow:()=>now});
  try {
    const admin = await hub.auth.create('demo-read-admin','Fictional-read-benchmark-123','admin');
    const chief = await hub.auth.create('demo-read-chief','Fictional-read-benchmark-123','operator',admin,{},()=>{},{taskSupervisor:true,taskTeam:'А'});
    const session = await hub.auth.login(admin.username,'Fictional-read-benchmark-123');
    await new Promise(resolve => hub.server.listen(0,'127.0.0.1',resolve));
    const base = 'http://127.0.0.1:'+hub.server.address().port;
    async function request(route) {
      const start = performance.now(), response = await fetch(base+route,{headers:{Cookie:'hub-local-session='+session.token}});
      assert.equal(response.status,200);
      const body = await response.text(), result = JSON.parse(body);
      return {ms:performance.now()-start,bytes:Buffer.byteLength(body),result};
    }
    async function measure(route) {
      const cold = await request(route), rows = [];
      for (let i=0;i<samples;i++) rows.push(await request(route));
      return {coldMs:Number(cold.ms.toFixed(2)),medianMs:median(rows.map(row => row.ms)),bytes:rows[0].bytes,
        entries:rows[0].result.data?.entries.length,count:rows[0].result.count};
    }
    console.log(JSON.stringify({metadata:{node:process.version,baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:__dirname}).toString().trim(),samples,
      fixtures:'generated fictional records',database:'in-memory SQLite',network:'authenticated loopback HTTP; no throttling',
      timing:'response body plus client JSON parse; five-sample median after first request',
      limitations:'first-request timings are single samples; no live server, concurrent clients or physical phone; notification maintenance remains active'}}));
    for (const count of [200,2000]) {
      const entries = Array.from({length:count},(_,i) => ({id:'demo-read-report-'+i,date:new Date(Date.UTC(2026,9,5-Math.floor(i/5))).toISOString().slice(0,10),
        shift:['А','Б','В','Г','СТИКЕРИ'][i%5],tonnage:1000,brak:10,breakdown:{autoKg:600,autoCrates:24,manKg:400,manCrates:16}}));
      hub.store.db.prepare("UPDATE documents SET data=?,revision=revision+1 WHERE kind='production-log'").run(JSON.stringify({entries,goalTons:3000}));
      const full = await measure('/api/statistics/data/production-log'), period = await measure('/api/statistics/period/production-log?month=2026-10');
      const totals = (await request('/api/statistics/period/production-log?month=2026-10')).result.data.summary.years;
      assert.equal(totals.reduce((sum,row) => sum+row.tonnage,0),count*1000);
      console.log(JSON.stringify({scope:'production-period',count,full,period,reductionPercent:Number((100*(1-period.bytes/full.bytes)).toFixed(1))}));
      hub.store.db.prepare('DELETE FROM task_items').run();
      hub.store.transaction(() => {
        const insert = hub.store.db.prepare('INSERT INTO task_items(id,data) VALUES(?,?)');
        for (let i=0;i<count;i++) {
          const item = {id:'demo-read-task-'+i,kind:i%2?'shift':'global',status:['pending','in-progress','blocked','review','completed','cancelled'][i%6],
            owner:{id:i%3?chief.id:admin.id,username:'demo-read-owner',team:'А'},participants:[{id:chief.id,username:chief.username,team:'А'}],
            shift:{start:now+(i%4===1?86400000:-86400000)},due:now+86400000,events:[],createdAt:now,updatedAt:now};
          insert.run(item.id,JSON.stringify(item));
        }
      });
      for (const [role,user] of [['review',admin],['report',chief],['mixed',{...chief,permissionOverrides:{canReviewTasks:true}}]]) {
        hub.tasks.summary(user); const times = []; let result;
        for (let i=0;i<samples;i++) { const start = performance.now(); result = hub.tasks.summary(user); times.push(performance.now()-start); }
        console.log(JSON.stringify({scope:'task-counter',count,role,medianMs:median(times),resultCount:result.count}));
      }
      hub.store.db.prepare('DELETE FROM notifications').run();
      hub.store.transaction(() => {
        const insert = hub.store.db.prepare('INSERT INTO notifications(id,user_id,type,at,read_at,event_key) VALUES(?,?,?,?,?,?)');
        for (let i=0;i<count;i++) insert.run('demo-read-inbox-'+i,admin.id,'productionAdded',now-i,i%2?null:now,'demo-read-inbox-'+i);
      });
      const inbox = await measure('/api/notifications'), counter = await measure('/api/notifications/summary');
      assert.equal(counter.count,inbox.count);
      console.log(JSON.stringify({scope:'notification-counter',count,inbox,counter,reductionPercent:Number((100*(1-counter.bytes/inbox.bytes)).toFixed(1))}));
    }
  } finally { await hub.close(); }
}
main().catch(() => { console.error('Targeted read benchmark failed; no fixture contents logged.'); process.exitCode = 1; });
