/* Exercise the real update lifecycle using fictional versions and drafts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function client() {
  const nodes = [], events = new Map(); let stream, reloads = 0, fetcher;
  function element(tag = 'div') {
    const callbacks = new Map(), attributes = new Map();
    const node = {tagName:tag.toUpperCase(), hidden:false, open:false, children:[], textContent:'',
      append(...children) { this.children.push(...children); }, prepend(...children) { this.children.unshift(...children); },
      setAttribute:(key,value) => attributes.set(key,String(value)), getAttribute:key => attributes.get(key),
      addEventListener:(name,fn) => callbacks.set(name,fn), classList:{add() {}},
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
      click() { (this.onclick || callbacks.get('click'))?.({preventDefault() {}}); },
      cancel() { callbacks.get('cancel')?.({preventDefault() {}}); }};
    nodes.push(node); return node;
  }
  const document = {hidden:false, body:element(), activeElement:element('input'),
    addEventListener:(name,fn) => { if (!events.has(name)) events.set(name,[]); events.get(name).push(fn); },
    createElement:element, querySelector:() => null, querySelectorAll:() => [], getElementById:id => nodes.find(node => node.id === id) || null};
  const context = vm.createContext({URLSearchParams, HubPermissions:require('../../js/permission-model.js'), document,
    window:{HUB_SERVER_BOOT:{user:{username:'demo-observer',role:'observer',permissions:require('../../server/permissions.cjs').defaults.observer},csrf:'fictional-csrf',version:'demo-current'},addEventListener() {}},
    location:{pathname:'/production-log',reload() { reloads++; }}, MutationObserver:class { observe() {} },
    EventSource:class { constructor() { stream = this; this.events = new Map(); } addEventListener(name,fn) { this.events.set(name,fn); } },
    fetch:(...args) => fetcher(...args), setTimeout:() => 1, clearTimeout() {}, setInterval:() => 1});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/server-connection.js'),'utf8'),context);
  for (const callback of events.get('DOMContentLoaded')) callback();
  return {hub:vm.runInContext('HubServer',context), node:id => document.getElementById(id), get reloads() { return reloads; },
    fetching:fn => { fetcher = fn; }, version:value => stream.events.get('version')({data:JSON.stringify({version:value})})};
}
test('the update notice shows both versions, tracks the latest version and reloads a clean page', () => {
  const c = client(); c.version('demo-current'); assert.equal(c.node('serverUpdate'),null);
  c.version('demo-next'); assert.equal(c.node('serverCurrentVersion').textContent,'demo-current');
  assert.equal(c.node('serverAvailableVersion').textContent,'demo-next');
  c.version('demo-latest'); assert.equal(c.node('serverAvailableVersion').textContent,'demo-latest');
  c.node('serverUpdate').click(); assert.equal(c.reloads,1);
});
test('a withdrawn version notice cannot reload the page', () => {
  const c = client(); c.version('demo-next'); c.version('demo-current');
  assert.equal(c.node('serverUpdateNotice').hidden,true); c.node('serverUpdate').click(); assert.equal(c.reloads,0);
});
test('active saves block an update even if the form also has a draft', () => {
  const c = client(); c.hub.guardUpdate({isBusy:() => true,hasDraft:() => true}); c.version('demo-next');
  c.node('serverUpdate').click(); assert.equal(c.reloads,0); assert.equal(c.node('serverUpdateDialog'),null);
  assert.match(c.node('serverUpdateFeedback').textContent,/Изчакай/);
});
test('returning to the form keeps its draft and explicit discard reloads once', () => {
  const c = client(); let draft = 'Fictional unsaved note'; c.hub.guardUpdate({hasDraft:() => !!draft}); c.version('demo-next');
  c.node('serverUpdate').click(); assert.equal(c.node('serverUpdateDialog').open,true); assert.equal(c.reloads,0);
  c.node('serverUpdateCancel').click(); assert.equal(c.node('serverUpdateDialog').open,false); assert.equal(draft,'Fictional unsaved note');
  c.node('serverUpdate').click(); c.node('serverUpdateConfirm').click(); assert.equal(c.reloads,1); assert.equal(draft,'Fictional unsaved note');
});
test('Escape returns to the form and guards are evaluated again on each attempt', () => {
  const c = client(); let dirty = true; c.hub.guardUpdate({hasDraft:() => dirty}); c.version('demo-next');
  c.node('serverUpdate').click(); c.node('serverUpdateDialog').cancel(); assert.equal(c.reloads,0);
  dirty = false; c.node('serverUpdate').click(); assert.equal(c.reloads,1);
});
test('confirmation rechecks an active save that started while the dialog was open', () => {
  const c = client(); let busy = false; c.hub.guardUpdate({isBusy:() => busy,hasDraft:() => true}); c.version('demo-next');
  c.node('serverUpdate').click(); busy = true; c.node('serverUpdateConfirm').click(); assert.equal(c.reloads,0);
  assert.equal(c.node('serverUpdateDialog').open,true); assert.match(c.node('serverUpdateDialogFeedback').textContent,/Изчакай/);
  busy = false; c.node('serverUpdateConfirm').click(); assert.equal(c.reloads,1);
});
test('an unknown editor state fails closed rather than discarding the page', () => {
  const c = client(); c.hub.guardUpdate({hasDraft() { throw new Error('Fictional guard failure'); }}); c.version('demo-next');
  c.node('serverUpdate').click(); assert.equal(c.reloads,0); assert.match(c.node('serverUpdateFeedback').textContent,/Изчакай/);
});
test('a mutation remains busy through response decoding and unlocks after success or failure', async () => {
  const c = client(); let release; c.version('demo-next');
  c.fetching(async () => ({ok:true,json:() => new Promise(resolve => { release = resolve; })}));
  const save = c.hub.send('/api/demo','POST',{}); await tick();
  c.node('serverUpdate').click(); assert.equal(c.reloads,0); release({}); await save;
  c.node('serverUpdate').click(); assert.equal(c.reloads,1);
  c.fetching(async () => { throw new Error('Fictional network failure'); });
  await assert.rejects(c.hub.send('/api/demo','POST',{})); c.node('serverUpdate').click(); assert.equal(c.reloads,2);
});
