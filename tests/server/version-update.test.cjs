/* Exercise the real update lifecycle using fictional versions and drafts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function client({pathname = '/production-log'} = {}) {
  const nodes = [], events = new Map(), assigned = []; let stream, reloads = 0, fetcher = async () => ({ok:true,json:async () => ({})});
  const listen = (name,fn) => { if (!events.has(name)) events.set(name,[]); events.get(name).push(fn); };
  function element(tag = 'div') {
    const callbacks = new Map(), attributes = new Map();
    const node = {tagName:tag.toUpperCase(), hidden:false, open:false, children:[], textContent:'',
      append(...children) { this.children.push(...children); }, prepend(...children) { this.children.unshift(...children); },
      setAttribute:(key,value) => attributes.set(key,String(value)), getAttribute:key => attributes.get(key),
      addEventListener:(name,fn) => callbacks.set(name,fn), classList:{add() {}},
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
      click() { (this.onclick || callbacks.get('click'))?.({preventDefault() {}}); },
      cancel() { callbacks.get('cancel')?.({preventDefault() {}}); }};
    node.dispatch = (name,event = {}) => callbacks.get(name)?.(event);
    node.querySelectorAll = () => [];
    nodes.push(node); return node;
  }
  const document = {hidden:false, body:element(), activeElement:element('input'),
    addEventListener:listen,
    createElement:element, querySelector:() => null, querySelectorAll:() => [], getElementById:id => nodes.find(node => node.id === id) || null};
  const context = vm.createContext({URLSearchParams, HubPermissions:require('../../js/permission-model.js'), document,
    window:{HUB_SERVER_BOOT:{user:{username:'demo-observer',role:'observer',permissions:require('../../server/permissions.cjs').defaults.observer},csrf:'fictional-csrf',version:'demo-current'},addEventListener:listen},
    location:{pathname,href:'http://localhost'+pathname,origin:'http://localhost',assign:value => assigned.push(value),reload() { reloads++; }}, URL, MutationObserver:class { observe() {} },
    EventSource:class { constructor() { stream = this; this.events = new Map(); } addEventListener(name,fn) { this.events.set(name,fn); } },
    fetch:(...args) => fetcher(...args), setTimeout:() => 1, clearTimeout() {}, setInterval:() => 1});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/server-shell.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/server-connection.js'),'utf8'),context);
  for (const callback of events.get('DOMContentLoaded')) callback();
  return {hub:vm.runInContext('HubServer',context), node:id => document.getElementById(id), get reloads() { return reloads; },
    assigned, unload() { const event = {prevented:false,preventDefault() { this.prevented = true; }}; for(const fn of events.get('beforeunload') || []) fn(event); return event; },
    restore() { for(const fn of events.get('pageshow') || []) fn({persisted:true}); },
    get inert() { return document.body.inert === true; },
    fetching:fn => { fetcher = fn; }, open:() => stream.onopen(), fail:() => stream.onerror(), version:value => stream.events.get('version')({data:JSON.stringify({version:value})})};
}
test('the update notice shows both versions, tracks the latest version and reloads a clean page', () => {
  const c = client(); c.version('demo-current'); assert.equal(c.node('serverUpdate'),null);
  c.version('demo-next'); assert.equal(c.node('serverCurrentVersion').textContent,'demo-current');
  assert.equal(c.node('serverAvailableVersion').textContent,'demo-next');
  c.version('demo-latest'); assert.equal(c.node('serverAvailableVersion').textContent,'demo-latest');
  c.node('serverUpdate').click(); assert.equal(c.reloads,1);
});
test('version details stay available and an unconfirmed server version is never shown as current', () => {
  const c = client(), status = () => c.node('serverVersionStatus').getAttribute('data-update-state');
  assert.equal(c.node('serverClientVersion').textContent,'demo-current');
  assert.equal(status(),'checking'); assert.equal(c.node('serverConfirmedVersion').textContent,'Не е потвърдена');
  assert.equal(c.node('serverVersionChecked').textContent,'Още няма'); assert.equal(c.node('serverVersionUpdate').hidden,true);
  c.open(); assert.equal(status(),'checking');
  c.version('demo-current'); assert.equal(status(),'current'); assert.equal(c.node('serverVersionStatus').textContent,'Актуална версия');
  assert.equal(c.node('serverConfirmedVersion').textContent,'demo-current'); assert.match(c.node('serverVersionChecked').textContent,/^\d\d\.\d\d \d\d:\d\d$/);
  assert.equal(c.node('serverVersionUpdate').hidden,true); assert.equal(c.node('serverVersionHint').hidden,true);
});
test('a lost connection keeps the last confirmed version and reconnect checks again before reporting current', () => {
  const c = client(), status = () => c.node('serverVersionStatus').getAttribute('data-update-state');
  c.fail(); assert.equal(status(),'offline'); assert.equal(c.node('serverConfirmedVersion').textContent,'Не е потвърдена');
  c.open(); c.version('demo-current'); const checked = c.node('serverVersionChecked').textContent;
  c.fail(); assert.equal(status(),'offline'); assert.equal(c.node('serverVersionHint').hidden,false);
  assert.equal(c.node('serverConfirmedVersion').textContent,'demo-current'); assert.equal(c.node('serverVersionChecked').textContent,checked);
  c.open(); assert.equal(status(),'checking'); c.version('demo-current'); assert.equal(status(),'current');
  c.fail(); c.open(); c.version('demo-next'); assert.equal(status(),'update'); assert.equal(c.node('serverConfirmedVersion').textContent,'demo-next');
  c.fail(); assert.equal(status(),'offline'); assert.equal(c.node('serverVersionUpdate').hidden,true);
});
test('the menu update reuses the guarded flow without reloading on its own', () => {
  const c = client(); let draft = 'Fictional menu draft', busy = false;
  c.hub.guardUpdate({hasDraft:() => !!draft,isBusy:() => busy}); c.open(); c.version('demo-next');
  assert.equal(c.reloads,0); assert.equal(c.node('serverVersionStatus').textContent,'Има нова версия'); assert.equal(c.node('serverVersionUpdate').hidden,false);
  busy = true; c.node('serverVersionUpdate').click(); assert.equal(c.reloads,0); assert.match(c.node('serverUpdateFeedback').textContent,/Изчакай/);
  busy = false; c.node('serverVersionUpdate').click(); assert.equal(c.node('serverUpdateDialog').open,true); assert.equal(c.reloads,0);
  c.node('serverUpdateCancel').click(); assert.equal(draft,'Fictional menu draft'); assert.equal(c.reloads,0);
  draft = ''; c.node('serverVersionUpdate').click(); assert.equal(c.reloads,1);
});
test('report history states that it has no automatic version check', () => {
  const c = client({pathname:'/report-history'});
  assert.equal(c.node('serverVersionStatus').getAttribute('data-update-state'),'manual');
  assert.equal(c.node('serverVersionHint').hidden,false); assert.equal(c.node('serverVersionUpdate').hidden,true);
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

test('module navigation keeps the original selection and draft until explicit discard', async () => {
  const c = client(); let draft = 'Fictional navigation note'; c.hub.guardUpdate({hasDraft:() => !!draft});
  c.node('serverModuleSelect').value = '/tasks'; c.node('serverModuleSelect').dispatch('change');
  assert.deepEqual(c.assigned,[]); assert.equal(c.node('serverModuleSelect').value,'/production-log');
  c.node('serverLeaveCancel').click(); await tick(); assert.equal(draft,'Fictional navigation note');
  assert.equal(c.unload().prevented,true);
  c.node('serverModuleSelect').value = '/tasks'; c.node('serverModuleSelect').dispatch('change');
  c.node('serverLeaveConfirm').click(); await tick(); assert.deepEqual(c.assigned,['/tasks']);
  assert.equal(c.unload().prevented,false);
});

test('browser unload warns for pending writes and stops warning after confirmed completion', async () => {
  const c = client(); let release;
  assert.equal(c.unload().prevented,false);
  c.fetching(async () => ({ok:true,json:() => new Promise(resolve => { release = resolve; })}));
  const save = c.hub.send('/api/demo','POST',{}); await tick();
  assert.equal(c.unload().prevented,true); release({}); await save;
  assert.equal(c.unload().prevented,false);
});

test('navigation rechecks pending writes at confirmation and can recover after completion', async () => {
  const c = client(); let busy = false; c.hub.guardUpdate({hasDraft:() => true,isBusy:() => busy});
  c.node('serverModuleSelect').value = '/tasks'; c.node('serverModuleSelect').dispatch('change');
  busy = true; c.node('serverLeaveConfirm').click(); await tick(); assert.deepEqual(c.assigned,[]);
  assert.equal(c.node('serverLeaveDialog').open,true);
  busy = false; c.node('serverLeaveConfirm').click(); await tick(); assert.deepEqual(c.assigned,['/tasks']);
});

test('busy module navigation stays in the current module without opening a discard dialog', () => {
  const c = client(); c.hub.guardUpdate({isBusy:() => true});
  c.node('serverModuleSelect').value = '/tasks'; c.node('serverModuleSelect').dispatch('change');
  assert.deepEqual(c.assigned,[]); assert.equal(c.node('serverModuleSelect').value,'/production-log');
  assert.equal(c.node('serverLeaveDialog'),null);
});

test('form drafts ignore pristine editors, restored fields and accepted saves while retaining attachment changes', () => {
  const c=client(), text={type:'text',value:'',checked:false}, file={type:'file',value:'',files:[]}; let open=true, extra=[];
  const root={querySelectorAll:()=>[text,file]};
  const draft=c.hub.formDraft(root,{isOpen:()=>open,extra:()=>extra});
  assert.equal(draft.hasDraft(),false);
  text.value='Fictional draft'; assert.equal(draft.hasDraft(),true);
  text.value=''; assert.equal(draft.hasDraft(),false);
  file.files=[{name:'demo.txt',size:3}]; assert.equal(draft.hasDraft(),true);
  draft.accept(); assert.equal(draft.hasDraft(),false);
  file.files=[{name:'demo.txt',size:3}]; assert.equal(draft.hasDraft(),true);
  file.files=[]; extra=['fictional-photo']; draft.accept(); assert.equal(draft.hasDraft(),false);
  extra=[]; assert.equal(draft.hasDraft(),true);
  open=false; assert.equal(draft.hasDraft(),false);
});

test('returning through the back-forward cache restores protection after an approved departure', () => {
  const c=client(); c.hub.guardUpdate({hasDraft:() => true});
  c.node('serverModuleSelect').value='/tasks'; c.node('serverModuleSelect').dispatch('change');
  c.node('serverLeaveConfirm').click(); assert.equal(c.unload().prevented,false);
  c.restore(); assert.equal(c.unload().prevented,true);
});

test('async departure protects drafts until navigation and waits for other writes', async () => {
  const c=client(); let release,busy=false;
  c.hub.guardUpdate({hasDraft:() => true,isBusy:() => busy});
  c.hub.navigate('/tasks',null,()=>new Promise(resolve=>{release=resolve;}));
  c.node('serverLeaveConfirm').click(); assert.equal(c.unload().prevented,true); assert.equal(c.inert,true);
  busy=true; release(); await tick(); assert.deepEqual(c.assigned,[]); assert.equal(c.inert,false); assert.equal(c.unload().prevented,true);
  busy=false; c.hub.navigate('/tasks',null,async()=>{}); c.node('serverLeaveConfirm').click(); await tick();
  assert.deepEqual(c.assigned,['/tasks']); assert.equal(c.unload().prevented,false);
});
