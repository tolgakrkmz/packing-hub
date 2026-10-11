/* Reviewed app assets only; loopback HTTP, isolated Chrome and fictional login. */
const http = require('node:http');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {chromium} = require('playwright');
const {createHubServer} = require('../server/server.cjs');
const samples = 5;
const median = values => Number([...values].sort((a,b) => a-b)[Math.floor(values.length/2)].toFixed(2));
const isAsset = name => /^\/(?:js|css|assets)\//.test(name) || name === '/manifest.webmanifest';
function read(url,headers = {}) {
  return new Promise((resolve,reject) => {
    const start = performance.now();
    http.get(url,{headers},response => {
      const chunks = []; response.on('data',chunk => chunks.push(chunk));
      response.on('end',() => resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks),ms:performance.now()-start}));
      response.on('error',reject);
    }).on('error',reject);
  });
}
async function main() {
  const hub = createHubServer({filename:':memory:',publicOrigin:'http://127.0.0.1:0',allowHttp:true}); let browser;
  try {
    await hub.auth.create('demo-static-admin','Fictional-static-benchmark-123','admin');
    const session = await hub.auth.login('demo-static-admin','Fictional-static-benchmark-123');
    await new Promise(resolve => hub.server.listen(0,'127.0.0.1',resolve));
    const base = 'http://127.0.0.1:'+hub.server.address().port;
    const pageResponse = await read(base+'/statistics',{Cookie:'hub-local-session='+session.token}); assert.equal(pageResponse.status,200);
    const paths = [...new Set([...pageResponse.body.toString().matchAll(/(?:src|href)="([^"]+)"/g)].map(match => new URL(match[1],base+'/statistics')).filter(url => url.origin === base && isAsset(url.pathname)).map(url => url.pathname+url.search))];
    console.log(JSON.stringify({metadata:{node:process.version,baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:__dirname}).toString().trim(),
      trackedChanges:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:__dirname}).length>0,samples,fixtures:'reviewed source and fictional account',
      network:'loopback, no throttling',timing:'five-sample median of sequential static requests; body bytes exclude HTTP headers',
      limitations:'no live installation, concurrent clients or physical phone; browser cache run uses a fresh isolated context and no routing'}}));
    for (const encoding of ['identity','gzip','br']) {
      const times = []; let bytes = 0, encoded = 0, validators = new Map();
      for (let sample=0;sample<=samples;sample++) {
        const start = performance.now(); bytes = 0; encoded = 0; validators = new Map();
        for (const name of paths) {
          const response = await read(base+name,{'Accept-Encoding':encoding}); assert.equal(response.status,200);
          bytes += response.body.length; if (response.headers['content-encoding']) encoded++;
          if (response.headers.etag) validators.set(name,response.headers.etag);
        }
        if (sample) times.push(performance.now()-start);
      }
      let repeatBytes = 0, notModified = 0;
      for (const name of paths) {
        const response = await read(base+name,{'Accept-Encoding':encoding,...(validators.has(name)?{'If-None-Match':validators.get(name)}:{})});
        assert.ok([200,304].includes(response.status)); repeatBytes += response.body.length; if (response.status === 304) notModified++;
      }
      console.log(JSON.stringify({scope:'statistics-static-http',encoding,assets:paths.length,encoded,bodyBytes:bytes,medianMs:median(times),conditionalRepeat:{bodyBytes:repeatBytes,notModified}}));
    }
    browser = await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
    const context = await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Europe/Sofia'});
    await context.addCookies([{name:'hub-local-session',value:session.token,url:base}]);
    const page = await context.newPage(); const errors = [];
    page.on('pageerror',() => errors.push('page error'));
    page.on('request',request => { if (new URL(request.url()).origin !== base) errors.push('non-loopback request'); });
    let hits = 0;
    const count = request => { if (isAsset(new URL(request.url,base).pathname)) hits++; };
    hub.server.on('request',count);
    for (const load of ['first','repeat']) {
      hits = 0; await page.goto(base+'/statistics'); await page.waitForFunction(() => document.getElementById('statsFilesStatus').textContent === '4/4 свързани');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const resources = await page.evaluate(() => performance.getEntriesByType('resource').filter(row => /^\/(?:js|css|assets)\//.test(new URL(row.name).pathname) || new URL(row.name).pathname === '/manifest.webmanifest').map(row => ({transfer:row.transferSize,decoded:row.decodedBodySize})));
      console.log(JSON.stringify({scope:'statistics-browser-cache',browser:browser.version(),load,staticRequestsAtServer:hits,resources:resources.length,transferBytes:resources.reduce((sum,row) => sum+row.transfer,0),cached:resources.filter(row => row.transfer === 0 && row.decoded > 0).length}));
      await page.goto('about:blank');
    }
    hub.server.off('request',count); assert.deepEqual(errors,[]); await context.close();
  } finally { if (browser) await browser.close(); await hub.close(); }
}
main().catch(() => { console.error('Static asset benchmark failed; no page or session contents logged.'); process.exitCode = 1; });
