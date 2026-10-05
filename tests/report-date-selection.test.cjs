const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.env.TZ = 'Europe/Sofia';
const root = path.resolve(__dirname,'..');

function environment(module, at, search = '') {
  let clock = new Date(at).getTime();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  class Control {
    constructor(dataset = {}) {
      this.dataset = dataset; this.value = ''; this.textContent = ''; this.style = {};
      this.listeners = {}; this.classList = {add() {},remove() {},toggle() {}};
    }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    dispatch(type, event = {}) { return Promise.all((this.listeners[type] || []).map(callback => callback(event))); }
    querySelectorAll() { return []; }
    closest() { return this; }
  }
  const html = fs.readFileSync(path.join(root,module+'.html'),'utf8');
  const controls = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1],new Control()]));
  const shifts = [...html.matchAll(/\bdata-shift="([^"]+)"/g)].map(match => new Control({shift:match[1]}));
  const saved = [];
  const sandbox = vm.createContext({
    Date:ClockDate,URLSearchParams,location:{search},setTimeout:callback => callback(),
    document:{
      getElementById(id) { assert.ok(controls[id],'Missing control: '+id); return controls[id]; },
      querySelector() { return new Control(); },
      querySelectorAll(selector) { return selector === '.shift-btn' ? shifts : []; }
    },
    wireAdminToggle() {},
    createFileSync(options) {
      return {
        fileHandle:{},
        init() { options.onConnect(options.defaultData()); },
        async refreshFromDisk() {},
        async commitData() {
          const data = options.getData();
          vm.runInContext('HubDataValidation',sandbox).validate(module,data);
          saved.push(JSON.parse(JSON.stringify(data)));
        }
      };
    }
  });
  for(const name of ['data-validation','report-date-selection','report-writer',module]) {
    vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),sandbox);
  }
  return {
    controls,saved,
    setNow(value) { clock = new Date(value).getTime(); },
    async select(team) { await controls.shiftGrid.dispatch('click',{target:shifts.find(button => button.dataset.shift === team)}); },
    async save() {
      controls.tonInput && (controls.tonInput.value = '100');
      if(controls.startInput) { controls.startInput.value = '23:50'; controls.endInput.value = '00:10'; controls.reasonSelect.value = 'Механична повреда'; }
      await controls.saveBtn.dispatch('click');
      return saved.at(-1).entries.at(-1);
    }
  };
}

for(const module of ['production-log','line-downtime']) {
  test(module+': one date field and the shared controller loads before module logic',() => {
    const html = fs.readFileSync(path.join(root,module+'.html'),'utf8');
    assert.equal([...html.matchAll(/\bid="dateInput"/g)].length,1);
    assert.ok(html.indexOf('js/report-date-selection.js') < html.indexOf('js/'+module+'.js'));
  });
  test(module+': morning Stickers reports save today and update the day total',async () => {
    const env = environment(module,'2026-11-01T08:00:00');
    assert.equal(env.controls.dateInput.value,'2026-10-31');
    await env.select('СТИКЕРИ');
    assert.equal(env.controls.dateInput.value,'2026-11-01');
    assert.equal(env.controls.dateHint.textContent,'');
    assert.equal(env.controls.dayLabel.textContent,'днес');
    const entry = await env.save();
    assert.equal(entry.date,'2026-11-01');
    assert.equal(entry.shift,'СТИКЕРИ');
    assert.match(env.controls.dayVal.textContent,module === 'production-log' ? /100/ : /20/);
  });
  test(module+': automatic dates follow team choice and the 10:00 boundary',async () => {
    for(const [at,expected] of [['2026-11-01T00:30:00','2026-10-31'],['2027-01-01T09:59:59','2026-12-31'],['2027-01-01T10:00:00','2027-01-01']]) {
      const env = environment(module,at);
      await env.select('СТИКЕРИ');
      await env.select('А');
      assert.equal(env.controls.dateInput.value,expected);
      assert.equal((await env.save()).date,expected);
    }
  });
  test(module+': manual input and change preserve the actual saved date across teams',async () => {
    for(const event of ['input','change']) {
      const env = environment(module,'2026-11-01T08:00:00');
      env.controls.dateInput.value = '2026-09-30';
      await env.controls.dateInput.dispatch(event);
      for(const team of ['А','СТИКЕРИ','Б']) {
        await env.select(team);
        assert.equal(env.controls.dateInput.value,'2026-09-30');
      }
      assert.equal(env.controls.dateHint.textContent,'');
      assert.equal((await env.save()).date,'2026-09-30');
    }
  });
  test(module+': Yesterday is an explicit choice preserved when switching to Stickers',async () => {
    const env = environment(module,'2027-01-01T14:00:00');
    await env.controls.yesterdayBtn.dispatch('click');
    await env.select('СТИКЕРИ');
    assert.equal((await env.save()).date,'2026-12-31');
  });
  test(module+': an open page recomputes automatic dates and Yesterday after midnight',async () => {
    const env = environment(module,'2026-10-31T23:59:00');
    env.setNow('2026-11-01T08:00:00');
    await env.select('СТИКЕРИ');
    assert.equal(env.controls.dateInput.value,'2026-11-01');
    assert.equal(env.controls.dayLabel.textContent,'днес');
    await env.controls.yesterdayBtn.dispatch('click');
    assert.equal(env.controls.dateInput.value,'2026-10-31');
  });
  test(module+': the hour override retains its boundary behavior and rejects invalid hours',async () => {
    for(const [search,expected] of [['?testHour=9','2026-10-31'],['?testHour=10','2026-11-01'],['?testHour=-1','2026-11-01'],['?testHour=invalid','2026-11-01']]) {
      const env = environment(module,'2026-11-01T14:00:00',search);
      await env.select('А');
      assert.equal(env.controls.dateInput.value,expected);
      await env.select('СТИКЕРИ');
      assert.equal(env.controls.dateInput.value,'2026-11-01');
    }
  });
}
