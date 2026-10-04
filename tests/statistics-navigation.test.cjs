const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/statistics-navigation.js'), 'utf8');
function environment({saved, storageFailure = false} = {}) {
  class Control {
    constructor(dataset = {}) { this.dataset = dataset; this.attributes = {}; this.listeners = {}; this.style = {}; this.hidden = false; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    focus() { this.focused = true; }
    click() { this.listeners.click(); }
  }
  const names = ['overview', 'production', 'pairs', 'downtime', 'workforce'];
  const tabs = names.map(statsTab => new Control({statsTab}));
  const panels = names.map(statsPanel => new Control({statsPanel}));
  const controls = Object.fromEntries(['statsBreakdownControls','connPanel','statsFilesBtn','monthlyConnectBtn','openFileBtn','statsFilesStatus'].map(id => [id, new Control()]));
  const body = new Control(), toggle = new Control();
  body.hidden = true;
  const dots = Array.from({length:4}, () => ({connected:false, classList:{contains() { return this.dot.connected; }}}));
  dots.forEach(dot => { dot.classList.dot = dot; });
  controls.connPanel.querySelector = selector => selector === '.conn-panel-body' ? body : toggle;
  controls.connPanel.querySelectorAll = () => dots;
  controls.statsFilesStatus.classList = {toggle(key, value) { this[key] = value; }};
  let updates = 0, observer, stored = saved;
  const sandbox = vm.createContext({
    document:{getElementById:id => controls[id], querySelectorAll:selector => selector === '[data-stats-tab]' ? tabs : panels},
    localStorage:{getItem() { if(storageFailure) throw new Error('Unavailable'); return stored; }, setItem(key, value) { if(storageFailure) throw new Error('Unavailable'); stored = value; }},
    MutationObserver:class { constructor(callback) { observer = callback; } observe() {} }
  });
  vm.runInContext(source, sandbox);
  const navigation = sandbox.createStatisticsNavigation({storageKey:'demo-navigation',onChange() { updates++; }});
  return {navigation,tabs,panels,controls,body,toggle,dots,observe:() => observer(),get updates() { return updates; },get stored() { return stored; }};
}
test('navigation defaults to overview and shows exactly one requested panel', () => {
  const env = environment();
  assert.deepEqual(env.panels.filter(panel => !panel.hidden).map(panel => panel.dataset.statsPanel), ['overview']);
  for (const tab of env.tabs) {
    tab.click();
    assert.deepEqual(env.panels.filter(panel => !panel.hidden).map(panel => panel.dataset.statsPanel), [tab.dataset.statsTab]);
    assert.equal(tab.attributes['aria-selected'], 'true');
    assert.equal(env.tabs.filter(button => button.tabIndex === 0).length, 1);
    assert.equal(env.controls.statsBreakdownControls.hidden, !['production','downtime'].includes(tab.dataset.statsTab));
    assert.equal(env.stored, tab.dataset.statsTab);
  }
  assert.equal(env.updates, 5);
});
test('last section restores; invalid or unavailable storage falls back safely', () => {
  assert.equal(environment({saved:'pairs'}).panels[2].hidden, false);
  for (const options of [{saved:'unknown'}, {saved:'pairs',storageFailure:true}]) {
    const env = environment(options);
    assert.equal(env.panels[0].hidden, false);
    env.tabs[3].click();
    assert.equal(env.panels[3].hidden, false);
  }
});
test('keyboard navigation wraps and supports Home and End with one tab stop', () => {
  const env = environment();
  function key(index, key, expected) {
    let prevented = false;
    env.tabs[index].listeners.keydown({key,preventDefault() { prevented = true; }});
    assert.equal(prevented, true);
    assert.equal(env.tabs[expected].focused, true);
    assert.equal(env.panels[expected].hidden, false);
    assert.equal(env.tabs[expected].tabIndex, 0);
  }
  key(0,'ArrowLeft',4); key(4,'ArrowRight',0); key(0,'End',4); key(4,'Home',0);
});
test('files stay closed until requested; logout closes them and connecting focuses the picker', () => {
  const env = environment();
  env.navigation.setAdmin(true);
  assert.equal(env.controls.connPanel.style.display, 'none');
  env.controls.statsFilesBtn.click();
  assert.equal(env.controls.connPanel.style.display, 'block');
  assert.equal(env.controls.statsFilesBtn.attributes['aria-expanded'], 'true');
  assert.equal(env.body.hidden, false);
  assert.equal(env.toggle.attributes['aria-expanded'], 'true');
  env.navigation.setAdmin(false);
  assert.equal(env.controls.connPanel.style.display, 'none');
  assert.equal(env.controls.statsFilesBtn.hidden, true);
  env.navigation.setAdmin(true);
  assert.equal(env.controls.connPanel.style.display, 'none');
  env.controls.monthlyConnectBtn.click();
  assert.equal(env.controls.connPanel.style.display, 'block');
  assert.equal(env.controls.openFileBtn.focused, true);
});
test('connection status distinguishes optional disconnected files without exposing their contents', () => {
  const env = environment();
  assert.equal(env.controls.statsFilesStatus.textContent, '0/4 свързани');
  env.dots[0].connected = true; env.observe();
  assert.equal(env.controls.statsFilesStatus.textContent, '1/4 свързани');
  assert.equal(env.controls.statsFilesStatus.classList.ready, false);
  env.dots.forEach(dot => { dot.connected = true; }); env.observe();
  assert.equal(env.controls.statsFilesStatus.classList.ready, true);
});
