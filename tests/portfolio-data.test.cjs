const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const json = name => JSON.parse(read(name));

test('all bundled personnel and pair members are fictional demo operators',() => {
  const personnel = json('data/personnel.json');
  assert.ok(personnel.employees.every(person => /^Demo /.test(person.name) && person.id.startsWith('demo-') && !person.note));
  assert.equal(personnel.moveLog.length,0);
  const sandbox = vm.createContext({});
  vm.runInContext(read('js/employees-seed.js'),sandbox);
  const seed = vm.runInContext('DEFAULT_EMPLOYEES',sandbox);
  assert.ok(seed.every(person => /^Demo /.test(person.name) && person.id.startsWith('demo-')));
  for(const entry of json('data/pair-targets.json').entries) {
    assert.ok(entry.id.startsWith('demo-'));
    assert.ok(entry.members.every(person => /^Demo /.test(person.name) && person.id.startsWith('demo-')));
  }
});
test('production fixtures contain only demo record identifiers',() => {
  for(const name of ['production-log','line-downtime']) {
    assert.ok(json('data/'+name+'.json').entries.every(entry => entry.id.startsWith('demo-')));
  }
  assert.equal(json('data/archive/leave-management.json').entries.length,0);
});
test('only a fictional customer and packing instruction are bundled',() => {
  const profiles = json('data/package-instructions.json');
  assert.deepEqual(Object.keys(profiles),['DEMO-001']);
  assert.equal(profiles['DEMO-001'].client,'Demo Customer');
  assert.equal(profiles['DEMO-001'].images.length,0);
  assert.deepEqual(fs.readdirSync(path.join(root,'data/profiles')).filter(name => !name.startsWith('.')),['demo-profile-001']);
  assert.deepEqual(fs.readdirSync(path.join(root,'data/profiles/demo-profile-001')).filter(name => !name.startsWith('.')),['instruction.txt']);
});
test('demo credentials and file storage cannot reuse production connections',() => {
  const sync = read('js/file-sync.js');
  assert.match(sync,/const ADMIN_PASSWORD = 'demo-admin';/);
  assert.match(sync,/const SHIFT_PASSWORDS = \{\};/);
  assert.match(sync,/const ADMIN_STORAGE_KEY = 'portfolioHubAdminMode';/);
  for(const file of fs.readdirSync(path.join(root,'js')).filter(name => name.endsWith('.js'))) {
    const source = read('js/'+file);
    const names = [...source.matchAll(/(?:dbName|localStorageKey)\s*:\s*['"]([^'"]+)['"]/g)];
    assert.ok(names.every(match => match[1].startsWith('portfolio-')),file+' must use demo browser storage');
  }
});
test('bundled pair examples satisfy the application schema',() => {
  const sandbox = vm.createContext({});
  vm.runInContext(read('js/shift-schedule.js'),sandbox);
  vm.runInContext(read('js/pair-targets-model.js'),sandbox);
  const model = vm.runInContext('PairTargets',sandbox);
  assert.equal(model.validateData(json('data/pair-targets.json')).entries.length,18);
});
