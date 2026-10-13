/* Isolated fictional content; never execute markup or contact an external host. */
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {installStorage} = require('./storage.cjs');
const {href} = require('../../js/notification-model.js');
const text = '<b data-client-demo>Fictional text</b> & "quoted"';
const id = 'fictional" data-client-demo="inert<marker>&';
const folder = 'Demo "quoted" & inert<marker> - 990101';
const attachment = 'demo "quoted" & inert<marker>.txt';
const instructions = () => ({demo:{number:'990101" data-client-demo="inert & <marker>',name:text,client:text,folderName:folder,category:'standard',images:[attachment]}});
const documents = () => ({
  'production-log': {entries:[{id,date:'2026-10-05',shift:'А',tonnage:123,brak:2}],goalTons:5000},
  'line-downtime': {entries:[{id,date:'2026-10-05',shift:'А',start:'08:00',end:'08:10',durationMin:10,reason:text,reasonNote:text,note:text}],reasons:[text,'Друго']},
  'package-instructions': instructions()
});
async function noMarkup(page, expect) { await expect(page.locator('[data-client-demo]')).toHaveCount(0); }
async function languagePreserves(page, expect, locator, value) {
  for (const language of ['en','bg']) {
    await page.locator('[data-hub-language='+language+']').click();
    await expect(page.locator(locator)).toHaveText(value);
    await noMarkup(page, expect);
  }
}
async function checkReports(page, base, expect, online, connect) {
  await page.goto(base + (online ? href('productionAdded', id) : '/production-log.html?target='+encodeURIComponent(id)));
  if (connect) await connect('production-log');
  await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await expect(page.locator('#historyWrap [data-notification-target]')).toHaveAttribute('data-notification-target',id);
  await expect(page.locator('#historyWrap .del-btn')).toHaveAttribute('data-id',id);
  await noMarkup(page, expect);
  await page.goto(base + (online ? href('downtimeAdded', id) : '/line-downtime.html?target='+encodeURIComponent(id)));
  if (connect) await connect('line-downtime');
  await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await expect(page.locator('#historyWrap [data-notification-target]')).toHaveAttribute('data-notification-target',id);
  await expect(page.locator('#reasonSelect option').first()).toHaveAttribute('value',text);
  await expect(page.locator('#historyWrap')).toContainText(text);
  await expect(page.locator('#reasonBars .lab')).toHaveAttribute('title',text);
  await expect(page.locator('#reasonsList button[data-reason]').first()).toHaveAttribute('data-reason',text);
  await languagePreserves(page,expect,'#reasonSelect option:first-child',text);
}
async function checkInstructions(page,base,expect,online,connect) {
  await page.goto(base+(online ? href('instructions',folder) : '/package-instructions.html?target='+encodeURIComponent(folder)));
  if (connect) await connect();
  await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await expect(page.locator('.result-card')).toHaveAttribute('data-folder',folder);
  if (!online) await page.locator('.result-head').click();
  await expect(page.locator('.result-text')).toHaveText(text);
  await expect(page.locator('.cat-select')).toHaveAttribute('data-number',instructions().demo.number);
  await expect(page.locator('.file-tile')).toHaveAttribute('download',attachment);
  const url = new URL(await page.locator('.file-tile').getAttribute('href'));
  assert.equal(url.protocol,'blob:'); assert.equal(url.origin,base);
  await languagePreserves(page,expect,'.result-name',text);
  await expect(page.locator('.result-client')).toHaveText(text);
  const event = page.waitForEvent('download', {timeout: 15000});
  await page.locator('.file-tile').click();
  const download = await event;
  // Chrome replaces characters forbidden in a filename; content remains literal.
  assert.ok(download.suggestedFilename().startsWith('demo'));
  await noMarkup(page,expect);
}
async function exerciseOfflineClientSecurity({browser,base,expect}) {
  const context = await browser.newContext({timezoneId:'Europe/Sofia'});
  const errors=[],external=[];
  try {
    await context.route('**/*',route => { if(new URL(route.request().url()).origin===base) return route.continue(); external.push('external request'); return route.abort(); });
    await context.addInitScript(installStorage,{});
    const page = await context.newPage(); page.on('pageerror',()=>errors.push('page error'));
    await page.clock.setFixedTime(new Date('2026-10-05T08:30:00+03:00'));
    await page.goto(base+'/index.html');
    await page.evaluate(async ({documents,folder,attachment,text}) => {
      await window.__browserTest.ready;
      for(const [kind,value] of Object.entries(documents)) await window.__browserTest.write(kind==='package-instructions'?'packing/data/'+kind+'.json':kind+'.json',value);
      await window.__browserTest.write('packing/data/profiles/'+folder+'/instruction.txt',text);
      await window.__browserTest.write('packing/data/profiles/'+folder+'/'+attachment,text);
    },{documents:documents(),folder,attachment,text});
    const connect = async kind => {
      await page.evaluate(kind => { window.__browserTest.nextFile=kind+'.json'; },kind);
      await page.locator('#openFileBtn').click();
    };
    await checkReports(page,base,expect,false,connect);
    await checkInstructions(page,base,expect,false,async () => { await page.locator('#openFileBtn').click(); });
    const read = await page.evaluate(async () => ({production:await window.__browserTest.read('production-log.json'),downtime:await window.__browserTest.read('line-downtime.json'),instructions:await window.__browserTest.read('packing/data/package-instructions.json')}));
    assert.deepEqual(read,{production:documents()['production-log'],downtime:documents()['line-downtime'],instructions:instructions()});
    const isolated=await browser.newContext();
    try {
      await isolated.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
      const other=await isolated.newPage();await other.goto(base+'/production-log.html');
      await expect(other.locator('#historyWrap [data-notification-target]')).toHaveCount(0);
      assert.equal(await other.evaluate(()=>localStorage.getItem('portfolio-tonnage-fallback')),null);
    } finally { await isolated.close(); }
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    console.log('PASS offline client security: report attributes, downtime text/attributes, instruction metadata/text/blob/download, BG/EN preservation, unchanged files and separate profile storage; no external requests');
  } finally { await context.close(); }
}
async function exerciseServerClientSecurity({admin,hub,base,device,expect,setTime}) {
  const actor=hub.auth.list().find(user=>user.username==='demo-admin'),external=[];
  admin.on('request',request=>{if(new URL(request.url()).origin!==base)external.push('external request');});
  for(const [kind,data] of Object.entries(documents())) hub.store.put(kind,data,hub.store.get(kind).revision,actor);
  hub.store.createNode('data/profiles/'+folder,'directory',actor);
  for(const name of ['instruction.txt',attachment]) {
    const target='data/profiles/'+folder+'/'+name;
    const node=hub.store.createNode(target,'file',actor);
    hub.store.writeFile(target,Buffer.from(text),'text/plain',node.revision,actor);
  }
  await checkReports(admin,base,expect,true);
  await checkInstructions(admin,base,expect,true);
  for(const [kind,data] of Object.entries(documents())) assert.deepEqual(hub.store.get(kind).data,data);
  console.log('PASS server client render security: report/downtime attributes, instruction text/blob/download, unchanged authorized data and BG/EN preservation');

  setTime('2026-10-05T08:30:00+03:00');
  const chief=await hub.auth.create('demo-client-chief','Fictional-password-123','operator',actor,{},()=>{},{taskSupervisor:true,taskTeam:'А'});
  const task=hub.tasks.create({requestId:randomUUID(),title:text,description:text,priority:'normal',requiresPhotos:false,assigneeId:chief.id,participantIds:[],kind:'global',dueDate:'2026-10-06',dueTime:'17:00'},actor);
  hub.tasks.change(task.id,{action:'progress',note:text},1,chief);
  await admin.goto(base+href('taskChanged',task.id));
  await expect(admin.locator('.task-card h2')).toHaveText(text);
  await expect(admin.locator('.task-card')).toContainText(text);
  await admin.locator('.task-card').getByRole('button',{name:'История',exact:true}).click();
  await expect(admin.locator('#historyContent')).toContainText(text);
  await noMarkup(admin,expect);
  await admin.locator('[data-close=taskHistory]').click();
  await languagePreserves(admin,expect,'.task-card h2',text);
  assert.equal(hub.tasks.list(actor).items.find(item=>item.id===task.id).title,text);
  console.log('PASS task title/description/progress/snapshot rendering and BG/EN preservation');

  await admin.goto(base+'/accounts');
  await expect(admin.locator('#accountList')).toContainText(chief.username);
  await assert.rejects(hub.auth.create(text,'Fictional-password-123','observer',actor),{code:'INVALID_ACCOUNT'});
  const accountStatus=await admin.evaluate(async username=>{try{await HubServer.send('/api/accounts','POST',{username,password:'Fictional-password-123',role:'observer'});return 200;}catch(error){return error.status;}},text);
  assert.equal(accountStatus,400);
  await admin.goto(base+'/activity-log');
  await expect(admin.locator('#activityUsers')).toContainText(chief.username);
  await noMarkup(admin,expect);

  const current=hub.store.get('line-downtime');
  hub.store.put('line-downtime',{...current.data,entries:current.data.entries.map(row=>({...row,note:text+' changed'}))},current.revision,actor,'report',false,{action:'update',reason:text});
  await admin.goto(base+'/report-history?module=line-downtime&entryId='+encodeURIComponent(id));
  await expect(admin.locator('#historyDetail')).toContainText(text);
  await admin.locator('.history-event details summary').first().click();
  await expect(admin.locator('#historyDetail')).toContainText(text);
  await noMarkup(admin,expect);
  console.log('PASS report-history text/snapshots, account schema rejection and account/activity identity rendering');

  hub.notifications.sync(); await admin.goto(base+'/notifications');
  await expect(admin.locator('.notification-open')).not.toHaveCount(0);
  const links=await admin.locator('.notification-open').evaluateAll(nodes=>nodes.map(node=>node.href));
  for(const link of links){const url=new URL(link);assert.equal(url.origin,base);assert.match(url.pathname,/^\/(production-log|line-downtime|package-instructions|tasks)$/);}
  await noMarkup(admin,expect);
  const response=await admin.goto(base+'/production-log');
  assert.equal(response.headers()['cache-control'],'no-store');
  assert.match(response.headers()['content-security-policy'],/script-src 'self'/);
  assert.equal(response.headers()['x-content-type-options'],'nosniff');
  const cookie=(await admin.context().cookies(base)).find(item=>item.name==='hub-local-session');
  assert.equal(cookie.httpOnly,true); assert.equal(cookie.sameSite,'Strict');
  assert.equal(cookie.secure,false); // Explicit test-only loopback HTTP mode.
  await admin.evaluate(async()=>{await navigator.serviceWorker.register('/js/notification-worker.js',{scope:'/'});await navigator.serviceWorker.ready;});
  assert.deepEqual(await admin.evaluate(()=>caches.keys()),[]);
  const persisted=await admin.evaluate(async()=>({local:JSON.stringify({...localStorage}),session:JSON.stringify({...sessionStorage}),databases:(await indexedDB.databases()).map(value=>value.name)}));
  assert.equal(persisted.local.includes('Fictional text'),false);assert.equal(persisted.session.includes('Fictional text'),false);
  assert.deepEqual(persisted.databases,[]);
  console.log('PASS notification routes, CSP-compatible renderers/worker, HttpOnly/Strict loopback session, no protected browser storage/cache');

  const reader=await hub.auth.create('demo-client-reader','Fictional-password-123','observer',actor);
  const page=await device(reader.username);
  try {
    const sibling=await page.context().newPage();
    await page.goto(base+'/production-log');await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
    await expect(page.locator('#reportEntryPanel')).toBeHidden();
    const deniedBefore=hub.store.get('production-log');
    const status=await page.evaluate(async()=>{
      const entryId='demo-denied-browser-write';
      try {
        await HubServer.send('/api/reports/production-log/operations','POST',{
          operationId:crypto.randomUUID(),action:'create',entryId,
          entry:{id:entryId,date:'2026-10-05',shift:'А',tonnage:1,brak:0}
        });
        return 200;
      } catch(error) {return error.status;}
    });
    assert.equal(status,403);
    assert.deepEqual(hub.store.get('production-log'),deniedBefore);
    await sibling.goto(base+'/production-log');await expect(sibling.locator('#serverState')).toHaveAttribute('data-connection','ready');
    await page.locator('.server-logout').click();await expect(page).toHaveURL(base+'/login');
    await sibling.evaluate(async()=>{try{await HubServer.json('/api/data/production-log');}catch{}});
    await expect(sibling).toHaveURL(base+'/login');
    await sibling.goBack();await expect(sibling).toHaveURL(base+'/login');
    const denied=await page.context().request.get(base+'/api/data/production-log');assert.equal(denied.status(),401);
    assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
  } finally {await page.context().close();}
  const revoked=await device(reader.username);
  try {
    await revoked.goto(base+'/production-log');await expect(revoked.locator('#serverState')).toHaveAttribute('data-connection','ready');
    await admin.goto(base+'/accounts');
    // The real account route revokes the session and broadcasts to connected pages.
    await admin.evaluate(id=>HubServer.send('/api/accounts/'+id,'PATCH',{permissions:{canViewProduction:false}}),reader.id);
    await expect(revoked).toHaveURL(base+'/login');
    await revoked.goBack();await expect(revoked).toHaveURL(base+'/login');
    assert.equal((await revoked.context().request.get(base+'/api/data/production-log')).status(),401);
  } finally {await revoked.context().close();}
  assert.deepEqual(external,[]);
  console.log('PASS permission UI plus server denial, logout in sibling tab, browser back after logout/revocation, protected API rejection and empty Cache Storage; no external requests');
}
module.exports={exerciseOfflineClientSecurity,exerciseServerClientSecurity};
