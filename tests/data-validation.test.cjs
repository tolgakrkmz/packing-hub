const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const sandbox = vm.createContext({Date});
for(const name of ['shift-schedule','pair-targets-model','data-validation']) vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),sandbox);
const validation = vm.runInContext('HubDataValidation',sandbox);
const production = {entries:[{id:'demo-record',date:'2026-10-04',shift:'СТИКЕРИ',tonnage:100,brak:0}],goalTons:1000};
const downtime = {entries:[{id:'demo-stop',date:'2026-10-04',shift:'А',start:'23:50',end:'00:10',durationMin:20,reason:'Demo reason'}],reasons:['Demo reason']};
const person = {id:'demo-person',name:'Demo Person',category:'auto',team:'А',role:'Опаковчик',active:false,note:'Demo note'};
const personnel = {schemaVersion:3,employees:[person],moveLog:[]};
const instructions = {'DEMO-001':{number:'DEMO-001',name:'Demo profile',folderName:'demo-profile',images:['demo.png'],client:'Demo customer',category:'standard'}};
const samples = {'production-log':production,'line-downtime':downtime,personnel,'package-instructions':instructions,'pair-targets':vm.runInContext('PairTargets.emptyData()',sandbox)};
const clone = value => JSON.parse(JSON.stringify(value));
test('module validation preserves accepted data and rejects files from other modules',()=>{
  for(const [kind,data] of Object.entries(samples)) {
    const before=JSON.stringify(data);
    assert.equal(validation.validate(kind,data),data);
    assert.equal(JSON.stringify(data),before);
    for(const [other,value] of Object.entries(samples)) if(kind!==other) assert.throws(()=>validation.validate(kind,value));
    for(const value of [null,[],false,'text',{}]) if(kind!=='package-instructions' || value === null || typeof value !== 'object' || Array.isArray(value)) assert.throws(()=>validation.validate(kind,value));
  }
});
test('malformed records, invalid dates, numbers and future schemas are rejected',()=>{
  for(const value of [-1,null,'100',Infinity,NaN]) {const data=clone(production);data.entries[0].tonnage=value;assert.throws(()=>validation.validate('production-log',data));}
  for(const value of ['2026-02-30','2026-13-01','wrong']) {const data=clone(production);data.entries[0].date=value;assert.throws(()=>validation.validate('production-log',data));}
  const duplicate=clone(production);duplicate.entries.push({...duplicate.entries[0]});assert.throws(()=>validation.validate('production-log',duplicate));
  const bad=clone(downtime);bad.entries[0].start='24:00';assert.throws(()=>validation.validate('line-downtime',bad));
  assert.throws(()=>validation.validate('personnel',{...personnel,schemaVersion:4}));
  assert.throws(()=>validation.validate('personnel',{employees:[{...person,id:''}]}));
  assert.throws(()=>validation.validate('personnel',{employees:[person,person]}));
  assert.throws(()=>validation.validate('package-instructions',{'DEMO':{...instructions['DEMO-001'],folderName:'../elsewhere'}}));
});
test('legacy schemas, empty datasets and optional legacy fields are supported',()=>{
  for(const schemaVersion of [undefined,1,2,3]) assert.equal(validation.validate('personnel',{schemaVersion,employees:[person]}).employees[0],person);
  for(const [kind,value] of [['production-log',{entries:[]}],['line-downtime',{entries:[]}],['personnel',{employees:[]}],['package-instructions',{}]]) assert.equal(validation.validate(kind,value),value);
  assert.equal(validation.validate('production-log',{entries:production.entries}).entries,production.entries);
});
test('parsing errors contain fixed messages without any file content',()=>{
  for(const input of ['', ' ', '{"DemoMarker":broken}', 'null', '[]']) {
    assert.throws(()=>validation.parse('production-log',input),error=>error.code==='HUB_DATA'&&!error.message.includes('DemoMarker'));
  }
});
test('personnel migration retains historical people and intentionally empty rosters',()=>{
  const source=fs.readFileSync(path.join(root,'js/personnel.js'),'utf8').split('const sync = createFileSync')[0];
  vm.runInContext('const DEFAULT_EMPLOYEES = [{id:"demo-seed",name:"Demo Seed"}];',sandbox);
  vm.runInContext(source,sandbox);
  assert.equal(vm.runInContext('employees.length',sandbox),0);
  assert.equal(vm.runInContext('createDefaultData().employees.length',sandbox),0);
  sandbox.legacy={schemaVersion:1,employees:[person],moveLog:[{type:'update',detail:'Demo history'}]};
  vm.runInContext('loadIncomingData(legacy,true)',sandbox);
  assert.equal(vm.runInContext('employees[0].id',sandbox),'demo-person');
  assert.equal(vm.runInContext('employees[0].name',sandbox),'Demo Person');
  assert.equal(vm.runInContext('employees[0].active',sandbox),false);
  assert.equal(vm.runInContext('moveLog.some(entry=>entry.detail==="Demo history")',sandbox),true);
  vm.runInContext('loadIncomingData({schemaVersion:3,employees:[]},true)',sandbox);
  assert.equal(vm.runInContext('employees.length',sandbox),0);
  assert.throws(()=>vm.runInContext('loadIncomingData({entries:[]},true)',sandbox));
  assert.equal(vm.runInContext('employees.length',sandbox),0);
});
