/* Local Chrome timings with generated fictional records; no production files, profiles or traces. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {chromium} = require('playwright');
const {inspect, privateTokens} = require('./check-publication.cjs');
const {installStorage} = require('../tests/browser/storage.cjs');
const {statisticsFixture} = require('../tests/browser/statistics-period.cjs');
const {createHubServer} = require('../server/server.cjs');
const root = path.resolve(__dirname, '..');
const samples = 5;
function median(values) { return Number([...values].sort((a,b) => a-b)[Math.floor(values.length/2)].toFixed(1)); }
function documents(count) {
  const data = statisticsFixture();
  data['production-log'].entries = Array.from({length:count}, (_,i) => ({id:'demo-perf-report-'+i,
    date:new Date(Date.UTC(2026,9,5-Math.floor(i/5))).toISOString().slice(0,10), shift:['А','Б','В','Г','СТИКЕРИ'][i%5],
    tonnage:1000, brak:10, breakdown:{autoKg:600,autoCrates:24,manKg:400,manCrates:16}}));
  return data;
}
function instrument() {
  // Timers are measured explicitly, preventing unrelated polling from contaminating samples.
  window.setInterval = () => 0;
  window.__perf = {observerMs:[], observerCalls:0};
  const Original = window.MutationObserver;
  window.MutationObserver = class extends Original {
    constructor(callback) { super((records,observer) => {
      const start = performance.now(); callback(records,observer);
      window.__perf.observerMs.push(performance.now()-start); window.__perf.observerCalls++;
    }); }
  };
}
async function action(page, name, value) {
  return page.evaluate(async ({name,value}) => {
    const metrics = window.__perf; metrics.observerMs = []; metrics.observerCalls = 0;
    const start = performance.now();
    // Wait for actual results, including any search debounce, before measuring presentation.
    let resultsReady;
    if (name === 'search') resultsReady = new Promise(resolve => {
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(document.getElementById('taskContent'), {childList:true});
    });
    if (name === 'month') { const select = document.getElementById('dashboardMonthSelect'); select.value = value; select.dispatchEvent(new Event('change',{bubbles:true})); }
    if (name === 'section') document.querySelector(`[data-stats-tab="${value}"]`).click();
    if (name === 'calculate') for (let i=0;i<10;i++) {
      aggregateByMonth(selectedYear); aggregateByYear(); getMonthlyDashboardData();
      aggregateWorkforceMonth(getPersonnelSnapshot()); aggregateAvByMonth(selectedYear); aggregateAvByYear();
    }
    if (name === 'history') render();
    if (name === 'refresh') { await sync.refreshFromDisk(); renderAll(); }
    if (name === 'language') HubI18n.setLanguage(value);
    if (name === 'tiny-change') document.getElementById('connText').textContent = value;
    if (name === 'search') { const input = document.getElementById('taskSearch'); input.value = value; input.dispatchEvent(new Event('input',{bubbles:true})); }
    const scriptMs = performance.now()-start;
    if (resultsReady) await resultsReady;
    const resultsMs = performance.now()-start;
    // Flush mutation callbacks and two frames; includes presentation work, not Playwright IPC.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {scriptMs,resultsMs,settledMs:performance.now()-start,observerMs:metrics.observerMs.reduce((a,b)=>a+b,0),observerCalls:metrics.observerCalls,
      renderedCards:document.querySelectorAll('.task-card').length, renderedRows:document.querySelectorAll('.history-month tbody tr:not(.bd-detail)').length};
  },{name,value});
}
async function measure(page, scope, count, cpu, language, name, values = ['']) {
  await action(page,name,values[0]);
  const results = [];
  for (let i=0;i<samples;i++) results.push(await action(page,name,values[i%values.length]));
  const row = {scope,count,cpu,language,action:name,samples,
    scriptMs:median(results.map(r=>r.scriptMs)),settledMs:median(results.map(r=>r.settledMs)),
    resultsMs:median(results.map(r=>r.resultsMs)),renderedCards:results.map(r=>r.renderedCards),renderedRows:results.map(r=>r.renderedRows),
    observerMs:median(results.map(r=>r.observerMs)),observerCalls:median(results.map(r=>r.observerCalls))};
  console.log(JSON.stringify(row)); return row;
}
async function main() {
  const tokens = privateTokens(process.env.PACKAGE_HUB_PRIVATE_SOURCE || path.resolve(root,'../..'));
  const assets = new Map();
  for (const file of execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0')) {
    if (file !== 'assets/package-hub-mark.svg' && !/^[a-z-]+\.html$|^(?:js|css)\/[a-z0-9/-]+\.(?:js|css)$/.test(file)) continue;
    const content = fs.readFileSync(path.join(root,file)); inspect(file,content,tokens); assets.set('/'+file,content);
  }
  const offline = http.createServer((request,response) => {
    const file = request.url, content = assets.get(file);
    response.writeHead(content?200:404,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html','Cache-Control':'no-store'});
    response.end(content || 'Not found');
  });
  const now = Date.parse('2026-10-05T08:30:00+03:00');
  const hub = createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true,taskNow:()=>now});
  let browser;
  const errors = [];
  try {
    await new Promise(resolve=>offline.listen(0,'127.0.0.1',resolve));
    await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
    const offlineBase = 'http://127.0.0.1:'+offline.address().port, onlineBase = 'http://127.0.0.1:'+hub.server.address().port;
    await hub.auth.create('demo-perf-admin','Fictional-performance-123','admin');
    browser = await chromium.launch({channel:'chrome',headless:true});
    console.log(JSON.stringify({metadata:{browser:browser.version(),node:process.version,baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),trackedChanges:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root}).length>0,samples,viewport:'1440x900',network:'loopback; no network throttling',fixtures:'generated fictional records',timing:'median; script, actual search results (including debounce), and two animation frames; observer included in settled time',limitations:'CPU 4x is a simulation, not a phone; no live server or production data'}}));
    const counts = process.argv.includes('--quick') ? [2000] : [200,2000];
    const cpus = process.argv.includes('--quick') ? [4] : [1,4];
    for (const count of counts) for (const cpu of cpus) {
      console.log(JSON.stringify({progress:'offline',count,cpu}));
      const context = await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Europe/Sofia'});
      await context.route('**/*',route=>new URL(route.request().url()).origin===offlineBase?route.continue():route.abort());
      await context.addInitScript(installStorage,{}); await context.addInitScript(instrument);
      const page = await context.newPage(); page.on('pageerror',()=>errors.push('offline page error'));
      const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
      await page.goto(offlineBase+'/statistics.html'); await page.evaluate(()=>window.__browserTest.ready);
      await page.evaluate(async data=>{for(const [kind,value] of Object.entries(data)) await window.__browserTest.write(kind+'.json',value);},documents(count));
      await page.locator('#statsFilesBtn').click();
      for(const [button,kind,dot] of [['pairStatsOpenFileBtn','pair-targets','pairStatsConnDot'],['openFileBtn','production-log','connDot'],['avOpenFileBtn','line-downtime','avConnDot'],['personnelOpenFileBtn','personnel','personnelConnDot']]) {
        await page.evaluate(kind=>{window.__browserTest.nextFile=kind+'.json';},kind); await page.locator('#'+button).click();
        await page.waitForFunction(dot=>document.getElementById(dot).classList.contains('on'),dot);
      }
      await page.locator('#statsFilesBtn').click();
      for(const language of ['bg','en']) {
        await action(page,'language',language);
        await measure(page,'statistics',count,cpu,language,'month',['09','10']);
        await measure(page,'statistics',count,cpu,language,'refresh');
        await measure(page,'statistics',count,cpu,language,'section',['production','overview']);
        await measure(page,'statistics',count,cpu,language,'calculate');
        await measure(page,'statistics',count,cpu,language,'tiny-change',['Свързване…','Опресняване…']);
      }
      console.log(JSON.stringify({progress:'production history',count,cpu}));
      // Statistics and production share the saved file handle; init reconnects it automatically.
      await page.goto(offlineBase+'/production-log.html');
      await page.waitForFunction(()=>document.getElementById('connDot').classList.contains('on'));
      for(const language of ['bg','en']) {
        await action(page,'language',language);
        await measure(page,'production-history',count,cpu,language,'history');
        await measure(page,'production-history',count,cpu,language,'tiny-change',['Свързване…','Опресняване…']);
      }
      await measure(page,'production-history',count,cpu,'roundtrip','language',['bg','en']);
      await context.close();
      // API costs use the same data; JSON documents remain in an in-memory SQLite database.
      for(const [kind,value] of Object.entries(documents(count))) hub.store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(value),kind);
      const timings=[]; for(let i=0;i<samples+1;i++){const start=performance.now(); const result=JSON.stringify(hub.store.get('production-log')); if(i)timings.push(performance.now()-start); if(i===samples) console.log(JSON.stringify({scope:'server-document',count,cpu:'host',samples,scriptMs:median(timings),responseKiB:Number((Buffer.byteLength(result)/1024).toFixed(1))}));}
      hub.store.db.prepare('DELETE FROM task_items').run();
      hub.store.transaction(()=>{for(let i=0;i<count;i++) hub.store.db.prepare('INSERT INTO task_items(id,data) VALUES(?,?)').run('demo-perf-task-'+i,JSON.stringify({id:'demo-perf-task-'+i,kind:'global',title:'Fictional task '+i,description:'Fictional benchmark',priority:'normal',requiresPhotos:false,owner:{id:1,username:'demo-perf-admin',team:'А'},participants:[],status:'pending',due:now+86400000,createdAt:now,updatedAt:now,events:[],problemPhotos:[]}));});
      const taskTimes=[]; for(let i=0;i<samples+1;i++){const start=performance.now(); hub.tasks.summary({id:1,role:'admin'}); if(i)taskTimes.push(performance.now()-start);} console.log(JSON.stringify({scope:'server-task-summary',count,cpu:'host',samples,scriptMs:median(taskTimes)}));
      console.log(JSON.stringify({progress:'online tasks',count,cpu}));
      const online = await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Europe/Sofia'});
      await online.route('**/*',route=>new URL(route.request().url()).origin===onlineBase?route.continue():route.abort());
      await online.addInitScript(instrument);
      const taskPage = await online.newPage(); taskPage.on('pageerror',()=>errors.push('online page error'));
      const taskCDP=await online.newCDPSession(taskPage); await taskCDP.send('Emulation.setCPUThrottlingRate',{rate:cpu});
      await taskPage.goto(onlineBase+'/login'); await taskPage.locator('#username').fill('demo-perf-admin'); await taskPage.locator('#password').fill('Fictional-performance-123'); await taskPage.locator('button[type=submit]').click(); await taskPage.waitForURL(onlineBase+'/');
      await taskPage.goto(onlineBase+'/tasks'); await taskPage.locator('[data-view=global]').click(); await taskPage.waitForFunction(()=>document.querySelectorAll('.task-card').length>0);
      for(const language of ['bg','en']) {await action(taskPage,'language',language); await measure(taskPage,'tasks-search',count,cpu,language,'search',['Fictional','Fictional task 1']);}
      await online.close();
    }
    assert.deepEqual(errors,[]); console.log(JSON.stringify({complete:true,pageErrors:0}));
  } finally {
    if(browser)await browser.close(); await hub.close(); await new Promise(resolve=>offline.close(resolve));
  }
}
main().catch(()=>{console.error('Performance benchmark failed; no private inputs are logged.'); process.exitCode=1;});
