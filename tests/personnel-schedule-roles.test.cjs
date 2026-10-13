const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({Date});
for (const file of ['shift-schedule','personnel-model','pair-targets-model','data-validation']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),sandbox);
}
const schedule = vm.runInContext('ShiftSchedule',sandbox);
const personnel = vm.runInContext('PersonnelModel',sandbox);
const validation = vm.runInContext('HubDataValidation',sandbox);
const plain = value => JSON.parse(JSON.stringify(value));

test('Stickers work Monday through Friday and keep their own shift hours', () => {
  for (const [date,working] of [['2026-10-05',true],['2026-10-09',true],['2026-10-10',false],['2026-10-11',false]]) {
    assert.equal(schedule.isScheduled({date,shiftCode:1,team:'СТИКЕРИ'}),working,date);
    assert.equal(schedule.shiftCodeFor('СТИКЕРИ',schedule.parseDate(date)),working ? 1 : 'Н');
  }
  assert.equal(schedule.hoursFor({team:'СТИКЕРИ',shiftCode:1}),'09:00–17:30');
  assert.equal(schedule.hoursFor({team:'А',shiftCode:1}),'06:00–14:00');
  assert.throws(() => schedule.isScheduled({date:'2026-02-30',shiftCode:1,team:'СТИКЕРИ'}));
});
test('Stickers current status follows the weekday and exact 09:00–17:30 boundaries', () => {
  for (const [hour,minute,working] of [[8,59,false],[9,0,true],[14,0,true],[17,29,true],[17,30,false]]) {
    assert.equal(schedule.isCurrent({date:'2026-10-05',shiftCode:1,team:'СТИКЕРИ'},new Date(2026,9,5,hour,minute)),working);
  }
  assert.equal(schedule.isCurrent({date:'2026-10-10',shiftCode:1,team:'СТИКЕРИ'},new Date(2026,9,10,10)),false);
});
test('every category retains the same standard and custom personnel roles', () => {
  const roles = ['Началник смяна','Оператор пулт 1','Оператор пулт 2','Чемберовач','Кранист/чемберовач','Обслужващ','Опаковчик','Demo custom role'];
  for (const category of ['auto','manual','stickers']) for (const role of roles) {
    assert.equal(personnel.normalizeEmployee({id:'demo-role-person',name:'Demo Role Person',category,role}).role,role);
  }
  assert.equal(personnel.normalizeRole('stickers',''),'Опаковчик');
});
test('the shared role catalogue deduplicates names and retains roles from existing people', () => {
  const settings = personnel.normalizeSettings({customRoles:[' Demo Custom Role ','demo custom role','']});
  assert.deepEqual(plain(settings.customRoles),['Demo Custom Role']);
  const roles = plain(personnel.roles(settings,[{role:'Demo legacy role'},{role:' demo custom role '} ]));
  assert.ok(roles.includes('Demo legacy role'));
  assert.equal(roles.filter(role => role.toLowerCase() === 'demo custom role').length,1);
});
test('legacy roles remain in the catalogue after the final person changes role', () => {
  const people=[{role:'Demo Legacy Role'},{role:'Опаковчик'}];
  const settings=personnel.normalizeSettings({},people);
  people[0].role='Опаковчик';
  assert.ok(personnel.roles(personnel.normalizeSettings(plain(settings)),people).includes('Demo Legacy Role'));
  assert.equal(personnel.roles(settings,people).filter(role=>role==='Опаковчик').length,1);
});
test('personnel validation accepts a shared role catalogue and rejects malformed catalogues', () => {
  const base = {schemaVersion:3,employees:[],settings:{stickersStage1:1,stickersStage2:2,customRoles:['Demo Role']}};
  assert.equal(validation.validate('personnel',base),base);
  for (const customRoles of [null,'Demo Role',[4],[''],[' '.repeat(3)]]) {
    assert.throws(() => validation.validate('personnel',{...base,settings:{...base.settings,customRoles}}));
  }
});
test('valid long legacy roles can be preserved in personnel settings and saved', () => {
  const people=[{id:'demo-long-role',name:'Demo Long Role Person',role:'Demo '+ 'long '.repeat(30),category:'stickers'}];
  const data={schemaVersion:3,employees:people,settings:{stickersStage1:1,stickersStage2:2}};
  assert.equal(validation.validate('personnel',data),data);
  data.settings=personnel.normalizeSettings(data.settings,people);
  assert.equal(validation.validate('personnel',data),data);
  assert.equal(data.settings.customRoles[0],people[0].role.trim());
});
