const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {randomUUID} = require('node:crypto');
const {gunzipSync,brotliDecompressSync} = require('node:zlib');
const {createStaticAssets,selectEncoding} = require('../../server/static-assets.cjs');
const {createHubServer} = require('../../server/server.cjs');
function fixtures(text = 'first') {
  return new Map([
    ['/index.html',Buffer.from('<head><script src="/server-session.js"></script><script src="js/demo.js"></script><link href="css/demo.css" rel="stylesheet"><link href="manifest.webmanifest" rel="manifest"></head><a href="index.html">Home</a>')],
    ['/js/demo.js',Buffer.from(`window.demo = '${text}';\n`+'/* Fictional static source. */\n'.repeat(100))],
    ['/css/demo.css',Buffer.from('body { background: url(../assets/demo.svg); }\n'.repeat(50))],
    ['/assets/demo.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['/assets/demo.png',Buffer.from('Fictional image bytes')],
    ['/manifest.webmanifest',Buffer.from(JSON.stringify({start_url:'/',icons:[{src:'/assets/demo.svg'}]}))],
    ['/js/notification-worker.js',Buffer.from('/* Fictional worker source */'.repeat(50))]
  ]);
}
function response(delivery,name,headers = {},method = 'GET',url = name) {
  const result = {};
  delivery.send(name,{url,method,headers},{writeHead:(status,headers) => { result.status = status; result.headers = headers; },end:body => { result.body = body || Buffer.alloc(0); }});
  return result;
}
function request(url,headers = {},method = 'GET') {
  return new Promise((resolve,reject) => {
    const req = http.request(url,{method,headers},res => {
      const chunks = []; res.on('data',chunk => chunks.push(chunk));
      res.on('end',() => resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)})); res.on('error',reject);
    }); req.on('error',reject); req.end();
  });
}
test('negotiation honors quality, explicit exclusions, wildcard, identity fallback and absent headers',() => {
  const variants = new Map(['identity','gzip','br'].map(name => [name,Buffer.alloc(1)]));
  for (const [header,expected] of [[undefined,'identity'],['','identity'],['br, gzip','br'],['gzip;q=1, br;q=0.5','gzip'],['BR;q=0, gzip;q=0','identity'],
    ['br;q=0.3, identity;q=0.9','identity'],['*;q=0.5,br;q=0','gzip'],['identity;q=0,*;q=0',undefined],['gzip;q=bad,br;q=2','identity'],['deflate','identity'],['gzip;q=0,gzip;q=1','identity']])
    assert.equal(selectEncoding(header,variants),expected,header);
  assert.equal(selectEncoding('gzip,identity;q=0',new Map([['identity',Buffer.alloc(1)]])),undefined);
});
test('delivered HTML/CSS/manifest link only known public assets to a deterministic source version',() => {
  const sources = fixtures(), delivery = createStaticAssets(sources), reordered = createStaticAssets(new Map([...sources].reverse()));
  assert.equal(delivery.version,reordered.version);
  const html = response(delivery,'/index.html').body.toString();
  assert.ok(html.includes('/js/demo.js?v='+delivery.version)); assert.ok(html.includes('/css/demo.css?v='+delivery.version));
  assert.ok(html.includes('src="/server-session.js"')); assert.ok(html.includes('href="manifest.webmanifest"')); assert.ok(html.includes('href="index.html"'));
  assert.ok(response(delivery,'/css/demo.css').body.toString().includes('/assets/demo.svg?v='+delivery.version));
  const manifest = JSON.parse(response(delivery,'/manifest.webmanifest').body);
  assert.equal(manifest.start_url,'/'); assert.equal(manifest.icons[0].src,'/assets/demo.svg?v='+delivery.version);
  assert.equal(delivery.assetURL('https://example.test/demo.js'),'https://example.test/demo.js');
  assert.equal(delivery.assetURL('/api/data/personnel'),'/api/data/personnel');
  assert.equal(delivery.assetURL('/js/notification-worker.js'),'/js/notification-worker.js');
});
test('compression is prepared once, lossless, has representation-specific validators and correct GET/HEAD lengths',() => {
  const sources = fixtures(), delivery = createStaticAssets(sources);
  const identity = response(delivery,'/js/demo.js');
  for (const [encoding,decode] of [['gzip',gunzipSync],['br',brotliDecompressSync]]) {
    const encoded = response(delivery,'/js/demo.js',{'accept-encoding':encoding});
    assert.equal(encoded.headers['Content-Encoding'],encoding); assert.deepEqual(decode(encoded.body),sources.get('/js/demo.js'));
    assert.ok(encoded.body.length < identity.body.length); assert.notEqual(encoded.headers.ETag,identity.headers.ETag);
    assert.equal(encoded.headers['Content-Length'],encoded.body.length); assert.equal(encoded.headers.Vary,'Accept-Encoding');
    const head = response(delivery,'/js/demo.js',{'accept-encoding':encoding},'HEAD');
    assert.deepEqual(head.headers,encoded.headers); assert.equal(head.body.length,0);
    assert.equal(response(delivery,'/js/demo.js',{'accept-encoding':encoding,'if-none-match':identity.headers.ETag}).status,200);
    const notModified = response(delivery,'/js/demo.js',{'accept-encoding':encoding,'if-none-match':'"other", W/'+encoded.headers.ETag});
    assert.equal(notModified.status,304); assert.equal(notModified.body.length,0); assert.equal(notModified.headers.ETag,encoded.headers.ETag);
  }
  sources.set('/js/demo.js',Buffer.from('Fictional change after startup'));
  assert.deepEqual(response(delivery,'/js/demo.js').body,identity.body);
  assert.equal(response(delivery,'/assets/demo.png',{'accept-encoding':'gzip,br'}).headers['Content-Encoding'],undefined);
  assert.throws(() => response(delivery,'/assets/demo.png',{'accept-encoding':'identity;q=0,gzip'}),error => error.status === 406);
});
test('only the exact current version is immutable; plain, stale and ambiguous URLs revalidate; HTML stays no-store',() => {
  const delivery = createStaticAssets(fixtures()), name = '/js/demo.js';
  assert.match(response(delivery,name,{},'GET',name+'?v='+delivery.version).headers['Cache-Control'],/max-age=31536000, immutable/);
  for (const suffix of ['', '?v=old','?v='+delivery.version+'&v='+delivery.version,'?v='+delivery.version+'&extra=true'])
    assert.equal(response(delivery,name,{},'GET',name+suffix).headers['Cache-Control'],'public, no-cache');
  for (const name of ['/manifest.webmanifest','/js/notification-worker.js']) {
    const result = response(delivery,name,{},'GET',name+'?v='+delivery.version);
    assert.equal(result.headers['Cache-Control'],'public, no-cache'); assert.ok(result.headers.ETag);
  }
  assert.equal(response(delivery,'/js/notification-worker.js').headers['Service-Worker-Allowed'],'/');
  const html = response(delivery,'/index.html',{'if-none-match':'*'},'GET','/index.html?v='+delivery.version);
  assert.equal(html.status,200); assert.equal(html.headers['Cache-Control'],'no-store'); assert.equal(html.headers.ETag,undefined);
  const next = createStaticAssets(fixtures('next')); assert.notEqual(next.version,delivery.version);
  assert.notEqual(response(next,name).headers.ETag,response(delivery,name).headers.ETag);
  assert.equal(response(next,name,{},'GET',name+'?v='+delivery.version).headers['Cache-Control'],'public, no-cache');
  assert.ok(response(next,'/index.html').body.toString().includes('?v='+next.version));
});
test('HTTP static delivery preserves login/module gates and keeps sessions, API data, photos, attachments and errors no-store',async t => {
  const hub = createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true,taskNow:() => Date.parse('2026-10-05T08:30:00+03:00')}); t.after(() => hub.close());
  const password = 'Fictional-static-test-123';
  const admin = await hub.auth.create('demo-static-admin',password,'admin');
  const chief = await hub.auth.create('demo-static-chief',password,'operator',admin,{},()=>{},{taskSupervisor:true,taskTeam:'А'});
  await hub.auth.create('demo-static-denied',password,'observer',admin,{canViewStatistics:false});
  const session = await hub.auth.login(admin.username,password), denied = await hub.auth.login('demo-static-denied',password);
  await new Promise(resolve => hub.server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:'+hub.server.address().port, headers = {Cookie:'hub-local-session='+session.token,'Accept-Encoding':'identity'};
  const page = await request(base+'/statistics',headers), version = JSON.parse((await request(base+'/api/session',headers)).body).version;
  assert.equal(page.status,200); assert.equal(page.headers['cache-control'],'no-store'); assert.ok(page.body.toString().includes('/js/server-connection.js?v='+version));
  const file = '/js/statistics.js?v='+version;
  const asset = await request(base+file,{'Accept-Encoding':'br'}); assert.equal(asset.status,200); assert.equal(asset.headers['content-encoding'],'br');
  assert.match(asset.headers['cache-control'],/immutable/); assert.equal(asset.headers.vary,'Accept-Encoding');
  assert.equal((await request(base+file,{'Accept-Encoding':'br','If-None-Match':asset.headers.etag})).status,304);
  const head = await request(base+file,{'Accept-Encoding':'br'},'HEAD'); assert.equal(head.body.length,0); assert.equal(Number(head.headers['content-length']),asset.body.length);
  const taskId = hub.tasks.create({requestId:randomUUID(),title:'Fictional cache check',description:'',priority:'normal',kind:'global',requiresPhotos:true,
    problemPhoto:require('./task-photo-fixture.cjs').photo,assigneeId:chief.id,participantIds:[],dueDate:'2026-10-06',dueTime:'17:00'},admin).id;
  const task = hub.tasks.list(admin).items.find(item => item.id === taskId);
  const photoURL = `/api/tasks/items/${taskId}/photos/${task.problemPhotos[0].id}`;
  hub.store.createNode('data/profiles/demo-static-note.txt','file',admin);
  hub.store.writeFile('data/profiles/demo-static-note.txt',Buffer.from('Fictional cache test attachment'),'text/plain',1,admin);
  for (const name of [photoURL,'/api/files?path=data%2Fprofiles%2Fdemo-static-note.txt']) {
    const result = await request(base+name,{...headers,'Accept-Encoding':'br','If-None-Match':'*'});
    assert.equal(result.status,200); assert.ok(result.body.length > 0);
    assert.equal(result.headers['cache-control'],'no-store'); assert.equal(result.headers['content-encoding'],undefined);
  }
  for (const name of ['/server-session.js','/api/session','/api/data/personnel','/api/tasks/summary','/api/notifications/summary','/api/statistics/period/production-log?month=2026-10','/api/tasks/photos/demo-missing','/api/files?path=data%2Fdemo-missing.txt','/missing','/data/personnel.json']) {
    const result = await request(base+name,{...headers,'Accept-Encoding':'br','If-None-Match':'*'});
    assert.equal(result.headers['cache-control'],'no-store',name); assert.equal(result.headers['content-encoding'],undefined,name); assert.notEqual(result.status,304,name);
  }
  assert.equal((await request(base+'/statistics',{'If-None-Match':'*'})).status,302);
  const forbidden = await request(base+'/statistics',{'If-None-Match':'*',Cookie:'hub-local-session='+denied.token}); assert.equal(forbidden.status,403); assert.equal(forbidden.headers['cache-control'],'no-store');
  const rejected = await request(base+file,{'Accept-Encoding':'identity;q=0,br;q=0,gzip;q=0'});
  assert.equal(rejected.status,406); assert.equal(rejected.headers['cache-control'],'no-store');
  assert.deepEqual(JSON.parse(rejected.body),{error:'ENCODING_REJECTED'});
  await hub.auth.update(admin.id,{password:'Fictional-static-changed-123'},admin);
  assert.equal((await request(base+'/server-session.js',headers)).status,401); assert.equal((await request(base+'/statistics',headers)).status,302);
});
