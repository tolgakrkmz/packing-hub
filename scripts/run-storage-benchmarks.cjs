/* Document-storage growth benchmark: generated fictional reports in a temporary SQLite file; no production data. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {validateData} = require('../server/store.cjs');
const {createHubServer} = require('../server/server.cjs');
const {snapshot} = require('../server/backups.cjs');
const sandbox = vm.createContext({});
for (const name of ['shift-schedule','pair-targets-model']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+name+'.js'),'utf8'),sandbox);
const PairTargets = vm.runInContext('PairTargets',sandbox);
// Assumed daily volumes are deliberately generous upper bounds for one site.
const perDay = {'production-log':5,'line-downtime':8,'pair-targets':12};
const samples = 5, years = process.argv.includes('--quick') ? [1] : [1,3,5];
const scope = {date:'2026-10-05',shiftCode:1,team:'СТИКЕРИ'};
const median = values => Number([...values].sort((a,b) => a-b)[Math.floor(values.length/2)].toFixed(2));
const shifts = ['А','Б','В','Г','СТИКЕРИ'];
function day(i) { return new Date(Date.UTC(2026,9,4)-i*86400000).toISOString().slice(0,10); }
function generated(kind, d, n) {
  const id = 'demo-storage-'+kind+'-'+d+'-'+n, date = day(d), at = date+'T06:00:00.000Z';
  if (kind === 'production-log') return {id,date,shift:shifts[n],tonnage:2332,brak:3,breakdown:{autoKg:1803,autoCrates:72,manKg:529,manCrates:26}};
  if (kind === 'line-downtime') return {id,date,shift:shifts[n%5],start:'10:00',end:'10:25',durationMin:25,reason:'Друго',reasonNote:'',note:'Fictional storage benchmark.'};
  return {id,date,shiftCode:1+n%3,team:shifts[n%4],members:[1,2].map(m => ({id:'demo-storage-person-'+n+'-'+m,name:'Demo Person '+n+'-'+m,category:'auto',role:'Опаковчик'})),
    areas:['auto'],targetKg:1000,targetCrates:40,result:{kg:1050,crates:42,reasonKey:'',reasonText:'',reportedAt:date+'T14:00:00.000Z'},createdAt:at,updatedAt:date+'T14:00:00.000Z'};
}
const employees = Array.from({length:2*samples+2},(_,i) => ({id:'demo-storage-roster-'+i,name:'Demo Roster '+i,category:'stickers',team:'1 смяна',role:'Опаковчик',active:true}));
function fresh(kind, i) {
  const id = 'demo-storage-new-'+kind+'-'+i;
  if (kind === 'production-log') return {id,date:scope.date,shift:'СТИКЕРИ',tonnage:1000,brak:10,breakdown:null};
  if (kind === 'line-downtime') return {id,date:scope.date,shift:'СТИКЕРИ',start:'09:00',end:'09:30',durationMin:30,reason:'Друго',reasonNote:'Fictional',note:''};
  return JSON.parse(JSON.stringify(PairTargets.plan({data:PairTargets.emptyData(),employees,context:scope,memberIds:[employees[2*i].id,employees[2*i+1].id],
    targetKg:1000,targetCrates:40,workAreas:['manual'],id,now:'2026-10-05T06:00:00.000Z'})));
}
function seed(store, kind, days) {
  const entries = [];
  for (let d=0;d<days;d++) for (let n=0;n<perDay[kind];n++) entries.push(generated(kind,d,n));
  const data = {...store.get(kind).data,entries};
  validateData(kind,data);
  // Mirror normal use: every saved report has a create row in its protected history.
  store.transaction(() => {
    store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(data),kind);
    const version = store.db.prepare('INSERT INTO report_versions VALUES(?,?,1)'), history = store.db.prepare("INSERT INTO report_history VALUES(?,?,1,'create',0,1,'demo-storage-admin','',NULL,?)");
    for (const entry of entries) { version.run(kind,entry.id); history.run(kind,entry.id,JSON.stringify(entry)); }
  });
  return {entries:entries.length,documentKiB:Number((Buffer.byteLength(JSON.stringify(data))/1024).toFixed(1))};
}
function timed(work) { const start = performance.now(); const result = work(); return {ms:performance.now()-start,result}; }
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'package-hub-storage-bench-'));
  try {
    console.log(JSON.stringify({metadata:{node:process.version,platform:process.platform+'-'+process.arch,baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:__dirname}).toString().trim(),
      samples,perDay,fixtures:'generated fictional records',database:'temporary SQLite file (WAL)',
      timing:'write = one reportOperation create (validation, permissions, history, full document rewrite, commit); backup = VACUUM INTO plus archive verification; median after one warm-up',
      limitations:'one local disk, no concurrent clients or Docker volume; history holds one create row per report; tasks, photos and instructions are empty'}}));
    for (const count of years) {
      const filename = path.join(directory,count+'y','hub.sqlite');
      // The full server creates every table that archive verification requires.
      const hub = createHubServer({filename,publicOrigin:'http://127.0.0.1:0',allowHttp:true,taskNow:() => Date.parse('2026-10-05T10:00:00+03:00')}), store = hub.store;
      try {
        const admin = await hub.auth.create('demo-storage-admin','Fictional-storage-123','admin');
        store.put('personnel',{...store.get('personnel').data,employees},store.get('personnel').revision,admin);
        const modules = {};
        for (const kind of Object.keys(perDay)) modules[kind] = seed(store,kind,365*count);
        for (const kind of Object.keys(perDay)) {
          const reads = [], writes = [];
          for (let i=0;i<=samples;i++) {
            const read = timed(() => store.get(kind));
            const write = timed(() => store.reportOperation(kind,{operationId:randomUUID(),action:'create',entryId:'demo-storage-new-'+kind+'-'+i,entry:fresh(kind,i),reason:'Fictional benchmark'},undefined,admin));
            assert.equal(write.result.receipt.status,'confirmed');
            if (i) { reads.push(read.ms); writes.push(write.ms); }
          }
          Object.assign(modules[kind],{readMs:median(reads),writeMs:median(writes)});
        }
        // Row-level lower bound: the same create as one indexed row plus its history row.
        store.db.exec('CREATE TABLE bench_rows(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))');
        const rowWrites = [];
        for (let i=0;i<=samples;i++) {
          const entry = fresh('production-log',i+samples+1);
          const write = timed(() => store.transaction(() => {
            store.db.prepare('INSERT INTO bench_rows VALUES(?,?,?)').run('production-log',entry.id,JSON.stringify(entry));
            store.db.prepare("INSERT INTO report_history VALUES(?,?,1,'create',0,1,'demo-storage-admin','',NULL,?)").run('production-log',entry.id,JSON.stringify(entry));
          }));
          if (i) rowWrites.push(write.ms);
        }
        store.db.exec('DROP TABLE bench_rows; PRAGMA wal_checkpoint(TRUNCATE)');
        const databaseMiB = Number((fs.statSync(filename).size/1048576).toFixed(2));
        const historyMiB = Number((store.db.prepare('SELECT sum(length(after_data)) AS bytes FROM report_history').get().bytes/1048576).toFixed(2));
        const backups = [];
        for (let i=0;i<=samples;i++) {
          const target = path.join(directory,count+'y','backup-'+i+'.sqlite');
          const backup = timed(() => snapshot(filename,target));
          if (i) backups.push(backup.ms);
          fs.rmSync(target);
        }
        console.log(JSON.stringify({years:count,databaseMiB,historyMiB,backupMs:median(backups),rowLevelWriteMs:median(rowWrites),modules}));
      } finally { await hub.close(); }
    }
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
}
main().catch(error => { console.error('Storage benchmark failed: '+(error.code || error.name)); process.exitCode = 1; });
