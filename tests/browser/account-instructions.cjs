const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createAccountInstructions} = require('../../server/account-instructions.cjs');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseAccountInstructions({admin, hub, base, device, expect, dir}) {
  console.log('RUN private instruction workspace, real downloads, account isolation and deletion');
  const source = path.join(dir, 'demo-instruction-bundle');
  const pdf = Buffer.from('%PDF-1.4\n% Fictional browser attachment\n%%EOF\n');
  const data = {
    '4826':{number:'4826', name:'4826', client:'Demo Client One', category:'standard', folderName:'Demo Client One/4826', images:['message.pdf'], timestamp:0},
    '7754':{number:'7754', name:'7754', client:'Demo Client Two', category:'special', folderName:'Demo Client Two/7754', images:['message.pdf'], timestamp:0}
  };
  for (const profile of Object.values(data)) {
    const folder = path.join(source, 'data/profiles', profile.folderName);
    fs.mkdirSync(folder, {recursive:true});
    fs.writeFileSync(path.join(folder, 'message.pdf'), pdf);
    fs.writeFileSync(path.join(folder, 'instruction.txt'), 'Fictional private instruction message');
  }
  fs.writeFileSync(path.join(source, 'data/package-instructions.json'), JSON.stringify(data));
  const owner = await hub.auth.create('demo-private-instructions', 'Fictional-password-123', 'observer');
  createAccountInstructions(hub.store).install(owner.username, source);
  const page = await device(owner.username, true);
  await page.goto(base + '/package-instructions');
  await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await expect(page.locator('.result-card')).toHaveCount(2);
  await expect(page.locator('#addBtn')).toBeHidden();
  await expect(page.locator('#bulkBtn')).toBeHidden();
  await page.locator('#searchInput').fill('Demo Client Two');
  await expect(page.locator('.result-card')).toHaveCount(1);
  await expect(page.locator('.result-client')).toHaveText('Demo Client Two');
  await page.locator('.result-head').click();
  await expect(page.locator('.result-number-inline')).toHaveText('№ 7754');
  await expect(page.locator('.result-text')).toHaveText('Fictional private instruction message');
  await expect(page.locator('.cat-select')).toBeHidden();
  const pending = page.waitForEvent('download');
  await page.locator('.file-tile').click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), 'message.pdf');
  assert.deepEqual(fs.readFileSync(await download.path()), pdf);
  await assertResponsive(page, 'Private instruction profile on mobile');
  await page.locator('#searchInput').fill('4826');
  await expect(page.locator('.result-card')).toHaveCount(1);
  await expect(page.locator('.result-client')).toHaveText('Demo Client One');
  await admin.goto(base + '/package-instructions');
  await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
  await expect(admin.locator('.result-card')).toHaveCount(0);
  const fileURL = '/api/files?path=' + encodeURIComponent('data/profiles/Demo Client Two/7754/message.pdf');
  assert.equal((await admin.request.get(base + fileURL)).status(), 404);
  const csrf = await admin.evaluate(() => window.HUB_SERVER_BOOT.csrf);
  assert.equal((await admin.request.delete(base + '/api/accounts/' + owner.id, {headers:{Origin:base, 'X-CSRF-Token':csrf}, data:{}})).status(), 200);
  assert.equal((await page.request.get(base + fileURL)).status(), 401);
  assert.equal(hub.store.db.prepare('SELECT COUNT(*) AS n FROM account_instruction_files WHERE user_id=?').get(owner.id).n, 0);
  await page.context().close();
  console.log('PASS private client search, four-digit profiles, PDF download, mobile layout, shared isolation and deletion');
}
module.exports = {exerciseAccountInstructions};
