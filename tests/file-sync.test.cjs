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
  async click() { for(const callback of this.listeners.click || []) await callback(); }
}
function environment(options = {}) {
  let accepted = null, payload = {entries:[]}, writing = 0, polling = null;
  const store = new Map();
  const permissions = [];
  const handle = {
    name:'example.json',text:'{"entries":[]}',
    async getFile() { const text = this.text; return {text:async () => text}; },
    async createWritable() { writing++; return {write:async () => {},close:async () => {}}; },
    async queryPermission(input) { permissions.push(input.mode); return 'granted'; },
    async requestPermission(input) { permissions.push(input.mode); return 'granted'; }
  };
  const elements = Object.fromEntries(['connDot','connText','openFileBtn','createFileBtn','reconnectBtn','refreshBtn','connRow','connNote','importFallback'].map(key => [key,new Control()]));
  const sandbox = vm.createContext({
    window:{showOpenFilePicker:async () => [handle]},
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
  vm.runInContext(source,sandbox);
  const cfg = {
    dbName:'test',suggestedFileName:'example.json',localStorageKey:'test',
    defaultData:() => ({entries:[]}),onConnect(value) { accepted = value; },onRefresh(value) { accepted = value; },
    getData:() => payload,render() {},elements,...options
  };
  const sync = sandbox.createFileSync(cfg);
  return {sync,handle,elements,store,permissions,get accepted() { return accepted; },get writes() { return writing; },poll:() => polling(),setPayload(value) { payload = value; }};
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
test('older refresh responses cannot replace a newer refresh',async () => {
  const env = environment({strictJson:true});
  await env.elements.openFileBtn.click();
  let release;
  env.handle.getFile = async () => ({text:() => new Promise(resolve => { release = resolve; })});
  const stale = env.sync.refreshFromDisk();
  await Promise.resolve();
  env.handle.getFile = async () => ({text:async () => '{"entries":["latest"]}'});
  await env.sync.refreshFromDisk();
  release('{"entries":["stale"]}');
  await stale;
  assert.equal(env.accepted.entries[0],'latest');
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
  env.setPayload({entries:['new plan']});
  await env.sync.commitData();
  const accepted = env.accepted;
  release('{"entries":["stale"]}');
  await stale;
  assert.equal(env.accepted,accepted);
  assert.equal(env.writes,1);
});
