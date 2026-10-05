/* Real module and file-sync scripts with fictional files held entirely in memory. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const copy = value => JSON.parse(JSON.stringify(value));
async function environment(module,{fallback = false} = {}) {
  class Control {
    constructor(tagName = 'BUTTON',dataset = {}) {
      this.tagName = tagName; this.dataset = dataset; this.value = ''; this.checked = false;
      this.disabled = false; this.hidden = false; this.style = {}; this.listeners = {};
      this.textContent = ''; this.innerHTML = ''; this.classList = {add() {},remove() {},toggle() {}};
    }
    closest(selector) { return selector === '#connPanel' ? null : this; }
    addEventListener(type,callback) { (this.listeners[type] ||= []).push(callback); }
    async dispatch(type,event = {}) { for(const callback of this.listeners[type] || []) await callback(event); }
    querySelectorAll() { return []; }
    appendChild() {}
    setAttribute() {}
  }
  const html = fs.readFileSync(path.join(root,module+'.html'),'utf8');
  const controls = Object.fromEntries([...html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"/g)].map(match => [match[2],new Control(match[1].toUpperCase())]));
  const shifts = [...html.matchAll(/\bdata-shift="([^"]+)"/g)].map(match => new Control('BUTTON',{shift:match[1]}));
  const store = new Map(), local = new Map();
  let failure = null, reads = 0, writes = 0, aborts = 0, polling, ready, admin = true, hold = null;
  const fail = phase => {
    if(failure?.phase !== phase || phase === 'read' && reads !== failure.at) return;
    const error = new Error('Synthetic failure details'); error.name = failure.name;
    failure = null; throw error;
  };
  const initial = module === 'production-log' ? {entries:[],goalTons:3000} : {entries:[],reasons:['Механична повреда','Друго']};
  const handle = {
    name:'demo-report.json',text:JSON.stringify(initial),
    async getFile() { reads++; fail('read'); const text = this.text; return {text:async () => text}; },
    async createWritable() {
      fail('permission'); writes++; let pending;
      return {
        write:async value => { pending = value; fail('write'); if(hold) await hold.promise; },
        close:async () => { if(failure?.phase === 'close-applied') { this.text = pending; fail('close-applied'); } fail('close'); this.text = pending; },
        abort:async () => { aborts++; }
      };
    },
    queryPermission:async () => 'granted',requestPermission:async () => 'granted'
  };
  let sync;
  const sandbox = vm.createContext({
    Date,URLSearchParams,location:{search:''},confirm:() => true,prompt:() => null,alert() {},
    document:{
      getElementById(id) { assert.ok(controls[id],'Missing control: '+id); return controls[id]; },
      querySelector:() => new Control(),createElement:() => new Control(),
      querySelectorAll(selector) {
        if(selector === '.shift-btn') return shifts;
        if(selector === 'input, select, textarea, button, .shift-btn') return [...Object.values(controls).filter(control => ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(control.tagName)),...shifts];
        return [];
      }
    },
    window:fallback ? {} : {showOpenFilePicker:async () => [handle],showSaveFilePicker:async () => handle},
    localStorage:{getItem:key => local.get(key),setItem(key,value) { fail('storage'); local.set(key,value); }},
    sessionStorage:{getItem:() => admin ? 'true' : null,setItem() { admin = true; },removeItem() { admin = false; }},
    indexedDB:{open() {
      const request = {result:{transaction:() => ({objectStore:() => ({
        get(key) { const request = {result:store.get(key)}; queueMicrotask(() => request.onsuccess()); return request; },
        put(value,key) { store.set(key,value); }
      })})}};
      queueMicrotask(() => request.onsuccess()); return request;
    }},
    setInterval(callback) { polling = callback; return 1; },clearInterval() {}
  });
  for(const name of ['data-validation','file-sync','report-date-selection','report-writer']) vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),sandbox);
  const factory = sandbox.createFileSync;
  sandbox.createFileSync = options => {
    sync = factory(options); const init = sync.init;
    sync.init = () => { ready = init(); return ready; }; return sync;
  };
  vm.runInContext(fs.readFileSync(path.join(root,'js',module+'.js'),'utf8'),sandbox);
  await ready;
  if(fallback) {
    controls.importFallback.files = [{text:async () => JSON.stringify(initial)}];
    await controls.importFallback.dispatch('change');
  } else await controls.openFileBtn.dispatch('click');
  const formIds = module === 'production-log' ? ['dateInput','tonInput','brakInput','breakdownToggle','autoKgInput','autoCrateInput','manKgInput','manCrateInput'] : ['dateInput','startInput','endInput','reasonSelect','otherReasonInput','noteInput'];
  return {
    controls,handle,sync,local,sandbox,
    get data() { return copy(vm.runInContext(module === 'production-log' ? '({entries,goalTons})' : '({entries,reasons})',sandbox)); },
    get writes() { return writes; },get aborts() { return aborts; },get reads() { return reads; },
    form() { return Object.fromEntries(formIds.map(id => [id,{value:String(controls[id].value),checked:controls[id].checked}])); },
    async draft() {
      controls.dateInput.value = '2026-10-05'; await controls.dateInput.dispatch('change');
      controls.tonInput && (controls.tonInput.value = '125'); controls.brakInput && (controls.brakInput.value = '3');
      if(controls.startInput) { controls.startInput.value = '23:50'; controls.endInput.value = '00:10'; controls.reasonSelect.value = 'Друго'; controls.otherReasonInput.value = 'Demo cause'; controls.noteInput.value = 'Demo note'; await controls.startInput.dispatch('input'); }
      await this.select('СТИКЕРИ');
    },
    async select(team) { await controls.shiftGrid.dispatch('click',{target:shifts.find(button => button.dataset.shift === team)}); },
    save:() => controls.saveBtn.dispatch('click'), retry:() => controls.retrySaveBtn.dispatch('click'),poll:() => polling(),
    remove:id => { sandbox.demoRemoveId = id; return vm.runInContext('deleteEntry(demoRemoveId)',sandbox); },
    fail(phase,name = 'UnknownError',offset = 1) { failure = {phase,name,at:reads+offset}; },
    hold() { let release; const promise = new Promise(resolve => { release = resolve; }); hold = {promise}; return () => { hold = null; release(); }; }
  };
}
module.exports = {environment};
