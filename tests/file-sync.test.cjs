const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../js/file-sync.js'),'utf8');
class Control {
  constructor() { this.listeners = {}; this.style = {}; this.hidden = false; }
  closest() { return null; }
  addEventListener(type,callback) { (this.listeners[type] ||= []).push(callback); }
  appendChild() {}
  async click() { for(const callback of this.listeners.click || []) await callback(); }
}
function environment(options = {}) {
  let accepted = null, payload = {entries:[]}, writing = 0, polling = null, picked = null, reads = 0, renders = 0;
  const document = new Control(); document.createElement = () => new Control();
  const store = new Map();
  const local = new Map(options.savedFallback ? [['test',options.savedFallback]] : []);
  const permissions = [];
  const handle = {
    name:'example.json',text:'{"entries":[]}',
    async getFile() { reads++; const text = this.text; return {text:async () => text}; },
    async createWritable() { writing++; let pending; return {write:async value => { pending = value; },close:async () => { this.text = pending; }}; },
    async queryPermission(input) { permissions.push(input.mode); return 'granted'; },
    async requestPermission(input) { permissions.push(input.mode); return 'granted'; }
  };
  const elements = Object.fromEntries(['connDot','connText','openFileBtn','createFileBtn','reconnectBtn','refreshBtn','connRow','connNote','importFallback'].map(key => [key,new Control()]));
  const sandbox = vm.createContext({
    window:options.fallback ? {} : {showOpenFilePicker:async () => [picked || handle],showSaveFilePicker:async () => picked || handle},
    document,
    localStorage:{getItem:key => local.get(key),setItem:(key,value) => local.set(key,value)},
    indexedDB:{open() {
      const request = {result:{transaction:() => ({objectStore:() => ({
        get(key) { const result = {result:store.get(key)}; queueMicrotask(() => result.onsuccess()); return result; },
        put(value,key) { store.set(key,value); }
      })})}};
      queueMicrotask(() => request.onsuccess());
      return request;
    }},
    setInterval(callback) { polling = callback; return 1; },clearInterval() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/data-validation.js'),'utf8'),sandbox);
  vm.runInContext(source,sandbox);
  const cfg = {
    dbName:'test',suggestedFileName:'example.json',localStorageKey:'test',
    defaultData:() => ({entries:[]}),onConnect(value) { accepted = value; },onRefresh(value) { accepted = value; },
    getData:() => payload,render() { renders++; },elements,...options
  };
  const sync = sandbox.createFileSync(cfg);
  return {sync,handle,elements,store,local,permissions,document,get reads() { return reads; },get renders() { return renders; },get accepted() { return accepted; },get writes() { return writing; },poll:() => polling(),setPayload(value) { payload = value; },pick(value) { picked = value; },async import(text) { elements.importFallback.files=[{text:async()=>text}];for(const callback of elements.importFallback.listeners.change || []) await callback(); }};
}
test('Personnel connection asks only for read access and cannot write or create files',async () => {
  const env = environment({readOnly:true,strictJson:true});
  assert.equal(env.elements.createFileBtn.hidden,true);
  assert.equal(env.elements.createFileBtn.listeners.click,undefined);
  env.store.set('mainFile',env.handle);
  await env.sync.init();
  assert.deepEqual(env.permissions,['read']);
  await env.elements.reconnectBtn.click();
  assert.deepEqual(env.permissions,['read','read']);
  await assert.rejects(env.sync.commitData(),/само за четене/);
  assert.equal(env.writes,0);
});
for(const {name,kind,data} of require('./semantic-fixtures.cjs').rejected) {
  test('file refresh and writes preserve the last accepted snapshot for '+name,async () => {
    const env=environment({suggestedFileName:kind+'.json',strictJson:true});
    await env.elements.openFileBtn.click();
    const accepted=env.accepted, renders=env.renders;
    env.handle.text=JSON.stringify(data);
    await assert.rejects(env.sync.refreshFromDisk(),{code:'HUB_DATA'});
    assert.equal(env.accepted,accepted); assert.equal(env.renders,renders);
    env.handle.text='{"entries":[]}'; await env.elements.openFileBtn.click();
    env.setPayload(data);
    await assert.rejects(env.sync.commitData(),{code:'HUB_DATA'});
    assert.equal(env.writes,0); assert.equal(env.handle.text,'{"entries":[]}');
  });
}
test('strict files reject invalid or empty JSON without replacing accepted data',async () => {
  const env = environment({strictJson:true});
  await env.elements.openFileBtn.click();
  const accepted = env.accepted;
  for(const text of ['',' ','{bad']) {
    env.handle.text = text;
    await assert.rejects(env.sync.refreshFromDisk());
    assert.equal(env.accepted,accepted);
    assert.equal(env.elements.connDot.className,'conn-dot off');
    assert.equal(env.elements.openFileBtn.style.display,'inline-block');
  }
  assert.equal(env.writes,0);
  env.handle.text = '{"entries":["restored"]}';
  await env.sync.refreshFromDisk();
  assert.equal(env.accepted.entries[0],'restored');
});
test('a fresh operation read supersedes an older background refresh',async () => {
  const env = environment({strictJson:true});
  await env.elements.openFileBtn.click();
  let release;
  env.handle.getFile = async () => ({text:() => new Promise(resolve => { release = resolve; })});
  const stale = env.sync.refreshFromDisk();
  await Promise.resolve();
  env.handle.getFile = async () => ({text:async () => '{"entries":["latest"]}'});
  await env.sync.refreshFromDisk({fresh:true});
  release('{"entries":["stale"]}');
  await stale;
  assert.equal(env.accepted.entries[0],'latest');
});
test('unchanged bytes preserve the accepted snapshot and skip rendering; same-size edits are accepted',async () => {
  const env = environment(); await env.elements.openFileBtn.click();
  const accepted = env.accepted, renders = env.renders;
  await env.poll(); await env.elements.refreshBtn.click();
  assert.equal(env.accepted,accepted); assert.equal(env.renders,renders);
  env.handle.text = '{"entries":["first"]}'; await env.poll();
  const first = env.accepted;
  env.handle.text = '{"entries":["other"]}'; await env.poll();
  assert.notEqual(env.accepted,first); assert.equal(env.accepted.entries[0],'other');
  assert.equal(env.renders,renders+2);
});
test('overlapping manual and background reads share one read, acceptance and render',async () => {
  const env = environment(); await env.elements.openFileBtn.click();
  let release, reads = 0;
  env.handle.getFile = async () => { reads++; return {text:() => new Promise(resolve => { release = resolve; })}; };
  const renders = env.renders, first = env.sync.refreshFromDisk(), second = env.sync.refreshFromDisk();
  assert.equal(first,second); await new Promise(resolve => setImmediate(resolve));
  const poll = env.poll(), manual = env.elements.refreshBtn.click();
  release('{"entries":["latest"]}'); await Promise.all([first,second,poll,manual]);
  assert.equal(reads,1); assert.equal(env.renders,renders+1); assert.equal(env.accepted.entries[0],'latest');
});
test('hidden-page polls make no reads and returning visible catches up once',async () => {
  const env = environment(); await env.elements.openFileBtn.click();
  const reads = env.reads;
  env.document.hidden = true; env.handle.text = '{"entries":["visible"]}';
  await env.poll(); await env.poll(); assert.equal(env.reads,reads);
  env.document.hidden = false;
  for (const callback of env.document.listeners.visibilitychange) callback();
  await env.poll(); assert.equal(env.reads,reads+1); assert.equal(env.accepted.entries[0],'visible');
});
test('reconnecting invalidates a slow read from the previous file',async () => {
  const env = environment(); await env.elements.openFileBtn.click();
  let release;
  env.handle.getFile = async () => ({text:() => new Promise(resolve => { release = resolve; })});
  const stale = env.sync.refreshFromDisk(); await Promise.resolve();
  const next = {...env.handle, name:'next-demo.json', getFile:async () => ({text:async () => '{"entries":["new file"]}'})};
  env.pick(next); await env.elements.openFileBtn.click();
  release('{"entries":["stale"]}'); await stale;
  assert.equal(env.sync.fileHandle,next); assert.equal(env.accepted.entries[0],'new file');
});
test('commit invalidates pending refresh and polling pauses while saving',async () => {
  let busy = false;
  const env = environment({strictJson:true,isBusy:() => busy});
  await env.elements.openFileBtn.click();
  let release;
  env.handle.getFile = async () => ({text:() => new Promise(resolve => { release = resolve; })});
  const stale = env.sync.refreshFromDisk();
  await Promise.resolve();
  busy = true;
  await env.poll();
  env.handle.getFile = async () => ({text:async () => '{"entries":[]}'});
  env.setPayload({entries:['new plan']});
  await env.sync.commitData();
  const accepted = env.accepted;
  release('{"entries":["stale"]}');
  await stale;
  assert.equal(env.accepted,accepted);
  assert.equal(env.writes,1);
});

test('a save from another PC after loading is refused, not overwritten, and the connection stays usable',async () => {
  const env = environment(); await env.elements.openFileBtn.click();
  env.setPayload({entries:['mine']}); await env.sync.commitData();
  env.setPayload({entries:['mine','second']}); await env.sync.commitData();
  assert.equal(env.writes,2);
  env.handle.text = '{"entries":["other PC"]}';
  env.setPayload({entries:['mine','third']});
  await assert.rejects(env.sync.commitData(),{code:'REPORT_CONFLICT'});
  assert.equal(env.writes,2); assert.equal(env.handle.text,'{"entries":["other PC"]}'); assert.equal(env.sync.isReady,true);
  await env.sync.refreshFromDisk({fresh:true}); assert.equal(env.accepted.entries[0],'other PC');
  env.setPayload({entries:['other PC','third']}); await env.sync.commitData();
  assert.equal(env.writes,3); assert.match(env.handle.text,/third/);
});
test('rejected file selection retains accepted data and the remembered handle',async()=>{
  const env=environment({suggestedFileName:'production-log.json'});
  env.handle.name='old-name.json'; env.handle.text='{"entries":[],"goalTons":1000}';
  await env.elements.openFileBtn.click();
  const accepted=env.accepted;
  const invalid={...env.handle,name:'wrong.json',text:'{"employees":[]}'};
  env.pick(invalid); await env.elements.openFileBtn.click();
  assert.equal(env.accepted,accepted); assert.equal(env.sync.fileHandle,env.handle);
  assert.equal(env.store.get('mainFile'),env.handle);
  await assert.rejects(env.sync.commitData()); assert.equal(env.writes,0);
  env.pick(env.handle); await env.elements.openFileBtn.click(); assert.equal(env.sync.isReady,true);
});
test('a corrupted disk file blocks writing even before the next poll',async()=>{
  const env=environment({suggestedFileName:'production-log.json'});
  env.handle.text='{"entries":[],"goalTons":1000}'; await env.elements.openFileBtn.click();
  for(const input of ['', '{bad', '{"employees":[]}']) {
    const accepted=env.accepted;
    env.handle.text=input;
    await assert.rejects(env.sync.commitData()); assert.equal(env.writes,0);
    assert.equal(env.handle.text,input); assert.equal(env.accepted,accepted);
    env.handle.text='{"entries":[],"goalTons":1000}'; await env.sync.refreshFromDisk();
  }
});
test('explicit file creation cannot overwrite existing content, including invalid JSON',async()=>{
  const env=environment({suggestedFileName:'production-log.json'});
  for(const input of ['{"entries":[],"goalTons":1000}','{bad']) {
    env.handle.text=input; await env.elements.createFileBtn.click();
    assert.equal(env.writes,0); assert.equal(env.handle.text,input); assert.equal(env.accepted,null);
  }
  env.handle.text=''; await env.elements.createFileBtn.click();
  assert.equal(env.writes,1); assert.equal(env.sync.isReady,true);
  assert.equal(JSON.parse(env.handle.text).entries.length,0);
});
test('invalid outgoing data and unconnected saves are refused',async()=>{
  const env=environment({suggestedFileName:'production-log.json'});
  await assert.rejects(env.sync.commitData());
  await env.elements.openFileBtn.click();
  env.setPayload({employees:[]}); await assert.rejects(env.sync.commitData());
  assert.equal(env.writes,0); assert.equal(env.handle.text,'{"entries":[]}');
});
test('JSON parse failures are refused even without the previous strict flag',async()=>{
  const env=environment();env.handle.text='{bad';await env.elements.openFileBtn.click();
  assert.equal(env.accepted,null);assert.equal(env.store.has('mainFile'),false);
  await assert.rejects(env.sync.commitData());assert.equal(env.writes,0);
});

test('manual imports preserve accepted data and local storage when the next file is invalid',async()=>{
  const env=environment({suggestedFileName:'production-log.json',fallback:true});
  await env.sync.init();
  await env.import('{"entries":[],"goalTons":1000}');
  await env.sync.commitData();
  const accepted=env.accepted,saved=env.local.get('test');
  for(const input of ['', '{bad', '{"employees":[]}']) {
    await env.import(input);
    assert.equal(env.accepted,accepted);assert.equal(env.local.get('test'),saved);
    await assert.rejects(env.sync.commitData());assert.equal(env.local.get('test'),saved);
  }
});
test('invalid browser storage is retained and cannot be silently replaced',async()=>{
  const env=environment({suggestedFileName:'production-log.json',fallback:true,savedFallback:'{bad'});
  await env.sync.init();await Promise.resolve();
  assert.equal(env.accepted,null);assert.equal(env.sync.isReady,false);
  assert.equal(env.local.get('test'),'{bad');await assert.rejects(env.sync.commitData());
});

function directoryEnvironment(options = {}) {
  let picked=null,accepted=null,writes=0,creates=0,reads=0,exists=true,renders=0;
  const store=new Map();
  const file={name:'package-instructions.json',text:'{}',getFile:async()=>({text:async()=>file.text}),createWritable:async()=>{writes++;return {write:async value=>{file.text=value;},close:async()=>{}};}};
  const missing=()=>{const error=new Error('Missing');error.name='NotFoundError';return error;};
  const directory={name:'demo-root',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getDirectoryHandle:async(name,options)=>{if(options.create)creates++;return {getFileHandle:async(name,options)=>{reads++;if(options.create){creates++;exists=true;}if(!exists)throw missing();return file;}};}};
  const elements=Object.fromEntries(['connDot','connText','openFileBtn','createFileBtn','reconnectBtn','refreshBtn','connRow','connNote'].map(key=>[key,new Control()]));
  const sandbox=vm.createContext({window:{showDirectoryPicker:async()=>picked||directory},indexedDB:{open(){const request={result:{transaction:()=>({objectStore:()=>({get(key){const result={result:store.get(key)};queueMicrotask(()=>result.onsuccess());return result;},put(value,key){store.set(key,value);}})})}};queueMicrotask(()=>request.onsuccess());return request;}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/data-validation.js'),'utf8'),sandbox);vm.runInContext(source,sandbox);
  const sync=sandbox.createDirectorySync({dbName:'demo-dir',defaultData:()=>({}),onConnect:value=>{accepted=value;},onRefresh:value=>{accepted=value;},render(){renders++;},elements,...options});
  return {sync,file,directory,elements,store,get renders(){return renders;},get accepted(){return accepted;},get writes(){return writes;},get creates(){return creates;},get reads(){return reads;},setMissing(){exists=false;},pick(value){picked=value;}};
}
test('directory loading validates without creating files or replacing a good connection',async()=>{
  const env=directoryEnvironment();await env.elements.openFileBtn.click();
  const accepted=env.accepted;assert.equal(env.creates,0);assert.equal(env.writes,0);
  for(const input of ['', '{bad', '{"entries":[]}']){
    env.file.text=input;await env.elements.openFileBtn.click();
    assert.equal(env.accepted,accepted);assert.equal(env.creates,0);assert.equal(env.writes,0);
    assert.equal(env.store.get('mainDir'),env.directory);assert.equal(env.sync.dirHandle,env.directory);
  }
  env.setMissing();await env.elements.openFileBtn.click();assert.equal(env.creates,0);
});
test('new instruction indexes require an explicit action and cannot overwrite existing ones',async()=>{
  const env=directoryEnvironment();env.file.text='{bad';await env.elements.createFileBtn.click();
  assert.equal(env.writes,0);assert.equal(env.file.text,'{bad');
  env.setMissing();await env.elements.createFileBtn.click();
  assert.equal(env.writes,1);assert.equal(env.file.text,'{}');assert.ok(env.accepted);
});
test('directory refresh shares reads, skips unchanged indexes and explicitly reloads attachment caches',async()=>{
  const env=directoryEnvironment(); await env.elements.openFileBtn.click();
  const accepted=env.accepted, renders=env.renders;
  await env.sync.refreshFromDisk(); assert.equal(env.accepted,accepted); assert.equal(env.renders,renders);
  let release, reads=0;
  env.file.getFile=async()=>{reads++;return {text:()=>new Promise(resolve=>{release=resolve;})};};
  const first=env.sync.refreshFromDisk(),second=env.sync.refreshFromDisk({reloadAssets:true});
  assert.equal(first,second); await new Promise(resolve=>setImmediate(resolve)); release('{}'); await first;
  assert.equal(reads,1); assert.notEqual(env.accepted,accepted); assert.equal(env.renders,renders+1);
});
test('a directory read started before writing cannot replace the current index while busy',async()=>{
  let busy=false;
  const env=directoryEnvironment({isBusy:()=>busy}); await env.elements.openFileBtn.click();
  const accepted=env.accepted; let release;
  env.file.getFile=async()=>({text:()=>new Promise(resolve=>{release=resolve;})});
  const stale=env.sync.refreshFromDisk(); await new Promise(resolve=>setImmediate(resolve));
  busy=true; release('{"1":{"number":"1","name":"Fictional delayed profile","client":"Fictional customer","folderName":"Demo-1","category":"standard","images":[]}}');
  await stale; assert.equal(env.accepted,accepted);
});
