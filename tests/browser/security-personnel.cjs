/* Harmless markup marker: no script, external request or real personnel. */
const assert = require('node:assert/strict');
const {installStorage} = require('./storage.cjs');
const marker = '<b data-demo>Fictional date</b>';
const fixture = () => ({schemaVersion: 3, employees: [], settings: {stickersStage1: 1, stickersStage2: 2}, moveLog: [
  ...['migration', 'settings', 'create', 'update', undefined].map(type => ({...(type ? {type} : {}), date: marker, name: 'Demo history', detail: 'Fictional detail'})),
  {type: 'create', date: '2026-10-12', name: 'Demo history'}
]});
async function check(page, expect) {
  await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await expect(page.locator('#logList .log-date')).toHaveCount(6);
  await expect(page.locator('#logList [data-demo]')).toHaveCount(0);
  for (let index = 0; index < 5; index++) await expect(page.locator('#logList .log-date').nth(index)).toHaveText(marker);
  await expect(page.locator('#logList .log-date').last()).toHaveText('12.10.2026');
}
async function exerciseServerSecurity({admin, hub, base, expect}) {
  const data = fixture();
  hub.store.put('personnel', data, hub.store.get('personnel').revision, hub.auth.list()[0]);
  await admin.goto(base + '/personnel');
  await check(admin, expect);
  assert.deepEqual(hub.store.get('personnel').data, data);
  console.log('PASS server personnel history renders every legacy date as text without changing data');
}
async function exerciseOfflineSecurity({browser, base, expect}) {
  const context = await browser.newContext({timezoneId: 'Europe/Sofia'});
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await context.addInitScript(installStorage, {});
    const page = await context.newPage();
    await page.goto(base + '/personnel.html');
    await page.evaluate(async data => {
      await window.__browserTest.ready;
      await window.__browserTest.write('personnel.json', data);
      window.__browserTest.nextFile = 'personnel.json';
    }, fixture());
    await page.locator('#openFileBtn').click();
    await check(page, expect);
    assert.deepEqual(await page.evaluate(() => window.__browserTest.read('personnel.json')), fixture());
    console.log('PASS offline personnel history renders every legacy date as text without changing data');
  } finally { await context.close(); }
}
module.exports = {exerciseServerSecurity, exerciseOfflineSecurity};
