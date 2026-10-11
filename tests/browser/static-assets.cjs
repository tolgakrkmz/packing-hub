/* Real HTTP cache: no Playwright routing, screenshots or private browser profile. */
const assert = require('node:assert/strict');
const http = require('node:http');
const {createStaticAssets} = require('../../server/static-assets.cjs');
const isAsset = name => /^\/(?:js|css|assets)\//.test(name) && name !== '/js/notification-worker.js';
async function exerciseStaticAssets({browser,base,hub,expect}) {
  console.log('RUN browser cache reuse, fresh account bootstrap and notification worker');
  const session = await hub.auth.login('demo-admin','Fictional-password-123');
  const context = await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Europe/Sofia'});
  await context.addCookies([{name:'hub-local-session',value:session.token,url:base}]);
  const page = await context.newPage(), errors = []; let hits = [];
  page.on('pageerror',() => errors.push('page error'));
  page.on('request',request => { if (new URL(request.url()).origin !== base) errors.push('non-loopback request'); });
  const record = request => { if (isAsset(new URL(request.url,base).pathname)) hits.push(request.url); };
  hub.server.on('request',record);
  try {
    await page.goto(base+'/statistics'); await expect(page.locator('#statsFilesStatus')).toHaveText('4/4 свързани');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const first = hits.length; assert.ok(first > 10); assert.deepEqual(hits.filter(url => !/[?&]v=[a-f0-9]{12}/.test(url)),[]);
    await page.goto('about:blank'); hits = [];
    await page.goto(base+'/statistics'); await expect(page.locator('#statsFilesStatus')).toHaveText('4/4 свързани');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(hits,[]);
    assert.equal(await page.evaluate(() => HubServer.user.username),'demo-admin');
    await page.evaluate(async () => { await navigator.serviceWorker.register('/js/notification-worker.js',{scope:'/'}); await navigator.serviceWorker.ready; });
    assert.deepEqual(await page.evaluate(() => caches.keys()),[]);
    const worker = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/')).active.scriptURL);
    assert.equal(new URL(worker).pathname,'/js/notification-worker.js');
    const reader = await hub.auth.create('demo-cache-reader','Fictional-password-123','observer',session.user);
    const readerSession = await hub.auth.login(reader.username,'Fictional-password-123');
    await context.addCookies([{name:'hub-local-session',value:readerSession.token,url:base}]);
    await page.goto(base+'/statistics'); await expect(page.locator('#statsFilesStatus')).toHaveText('4/4 свързани');
    assert.equal(await page.evaluate(() => HubServer.user.username),reader.username);
    assert.equal(await page.evaluate(() => HubServer.canViewModule('personnel')),false);
    await hub.auth.update(reader.id,{permissions:{canViewStatistics:false}},session.user);
    await page.goto(base+'/statistics'); await expect(page).toHaveURL(base+'/login');
    const boot = await page.evaluate(async () => { const response = await fetch('/server-session.js',{cache:'default'}); return {status:response.status,cache:response.headers.get('cache-control')}; });
    assert.deepEqual(boot,{status:401,cache:'no-store'});
    assert.deepEqual(errors,[]);
    console.log('PASS no repeated JS/CSS/image requests, fresh per-account bootstrap, revoked session and worker without Cache Storage');
  } finally { hub.server.off('request',record); await context.close(); }

  console.log('RUN a changed release loads new code at the same origin with a warm cache');
  const sources = value => new Map([
    ['/index.html',Buffer.from('<head><script src="js/demo.js"></script><link rel="stylesheet" href="css/demo.css"></head><p>Fictional cache fixture</p>')],
    ['/js/demo.js',Buffer.from(`window.demoCacheVersion = '${value}';\n`+'/* Fictional source only. */\n'.repeat(100))],
    ['/css/demo.css',Buffer.from('p { color: #123456; }\n'.repeat(100))]
  ]);
  let delivery = createStaticAssets(sources('first')), scriptReads = 0;
  const fixtureServer = http.createServer((request,response) => {
    const name = new URL(request.url,'http://static.invalid').pathname;
    if (name === '/js/demo.js') scriptReads++;
    try { delivery.send(name === '/' ? '/index.html' : name,request,response); }
    catch { response.writeHead(404,{'Cache-Control':'no-store'}); response.end(); }
  });
  await new Promise(resolve => fixtureServer.listen(0,'127.0.0.1',resolve));
  const fixtureBase = 'http://127.0.0.1:'+fixtureServer.address().port;
  const updateContext = await browser.newContext(), updatePage = await updateContext.newPage();
  try {
    for (const expected of ['first','first','next']) {
      if (expected === 'next') delivery = createStaticAssets(sources('next'));
      const prior = scriptReads; await updatePage.goto(fixtureBase+'/');
      assert.equal(await updatePage.evaluate(() => window.demoCacheVersion),expected);
      if (expected === 'next') assert.equal(scriptReads-prior,1);
      else assert.equal(scriptReads-prior,prior === 0 ? 1 : 0);
      await updatePage.goto('about:blank');
    }
    console.log('PASS same-origin next release gets new asset URLs and fresh code without clearing the browser cache');
  } finally { await updateContext.close(); fixtureServer.closeIdleConnections(); await new Promise(resolve => fixtureServer.close(resolve)); }
}
module.exports = {exerciseStaticAssets};
