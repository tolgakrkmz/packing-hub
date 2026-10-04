const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function environment(saved = null, brokenStorage = false) {
  const writes = [];
  const sandbox = vm.createContext({localStorage:{
    getItem() { if (brokenStorage) throw new Error('Unavailable'); return saved; },
    setItem(key, value) { if (brokenStorage) throw new Error('Unavailable'); writes.push({key,value}); }
  }});
  for (const name of ['i18n-en','i18n']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',name+'.js'),'utf8'),sandbox);
  return {i18n:vm.runInContext('HubI18n',sandbox), writes};
}
test('Bulgarian is the default; only valid language choices are stored', () => {
  const {i18n,writes} = environment('unknown');
  assert.equal(i18n.language,'bg');
  assert.equal(i18n.t('Месечен резултат'),'Месечен резултат');
  i18n.setLanguage('fr');
  assert.equal(writes.length,0);
  i18n.setLanguage('en');
  assert.equal(i18n.t('Месечен резултат'),'Monthly Result');
  assert.equal(writes[0].value,'en');
  i18n.setLanguage('bg');
  assert.equal(i18n.t('Месечен резултат'),'Месечен резултат');
});
test('English preferences restore and blocked storage does not prevent switching', () => {
  assert.equal(environment('en').i18n.language,'en');
  const {i18n} = environment(null,true);
  i18n.setLanguage('en');
  assert.equal(i18n.language,'en');
  assert.equal(i18n.t('Тонаж и брак'),'Production & Scrap');
});
test('dynamic quantities, shift labels and errors translate without changing numbers', () => {
  const {i18n} = environment('en');
  assert.equal(i18n.t('Цел: 500 кг и 20 каси'),'Target: 500 kg and 20 crates');
  assert.equal(i18n.t('12ч 30мин'),'12h 30min');
  assert.equal(i18n.t('Екип В · 1-ва смяна'),'Team C · First shift');
  assert.equal(i18n.t('октомври 2026 г.').trim(),'October 2026');
  assert.equal(i18n.t('Целта в килограми трябва да е положително число.'),'Target kilograms must be a positive number.');
});
test('exact translation preserves custom values and avoids inherited object keys', () => {
  const {i18n} = environment('en');
  assert.equal(i18n.t('Материал от Демо зона',true),'Материал от Демо зона');
  assert.equal(i18n.t('constructor',true),'constructor');
  assert.equal(i18n.t('Механична повреда',true),'Mechanical fault');
});
test('every page loads the translator with a demo-specific preference key', () => {
  const root = path.resolve(__dirname,'..');
  for (const file of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root,file),'utf8');
    assert.match(html,/src="js\/i18n-en.js"/);
    assert.match(html,/src="js\/i18n.js" data-storage-key="portfolio-hub-language"/);
  }
});
