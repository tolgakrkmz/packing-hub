/* Fictional legacy history exercises the real renderer without data files. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/personnel.js'), 'utf8');
const model = source.split('const sync = createFileSync')[0];
const renderer = source.slice(source.indexOf('function renderLog(){'), source.indexOf('function showToast('));
const personnelModel = fs.readFileSync(path.join(__dirname, '../js/personnel-model.js'), 'utf8');
const shiftSchedule = fs.readFileSync(path.join(__dirname, '../js/shift-schedule.js'), 'utf8');
function render(fixture) {
  const log = {innerHTML: ''};
  const context = vm.createContext({fixture, document: {getElementById: () => log}});
  vm.runInContext(personnelModel + shiftSchedule, context);
  vm.runInContext(model + renderer + '; moveLog = fixture; renderLog();', context);
  return log.innerHTML;
}
for (const type of ['migration', 'settings', 'create', 'update', undefined]) {
  test('legacy history date is displayed as text for ' + (type || 'untyped') + ' entries', () => {
    const date = '<b data-demo>Fictional date</b>';
    const html = render([{type, date, name: 'Demo history', detail: 'Fictional detail'}]);
    assert.ok(html.includes('&lt;b data-demo&gt;Fictional date&lt;/b&gt;'));
    assert.doesNotMatch(html, /<b data-demo>/);
  });
}
test('history preserves normal date formatting, missing dates and escaped human text', () => {
  const html = render([{type: 'create', date: '2026-10-12', name: '<Demo>', to: 'Demo team'}, {type: 'update', name: 'Demo history'}]);
  assert.match(html, /12\.10\.2026/);
  assert.match(html, /&lt;Demo&gt;/);
  assert.match(html, /class="log-date">—<\/span>/);
});
