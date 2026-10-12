/* Shared offline/server flow using only fictional, temporary reports. */
const assert = require('node:assert/strict');
async function exerciseProductionQuantities({page, expect, read}) {
  const before = (await read()).entries.length;
  await page.locator('[data-shift="СТИКЕРИ"]').click();
  await page.locator('#tonInput').fill('1e3');
  await page.locator('#brakInput').fill('2e1');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#msg')).toHaveAttribute('data-state', 'success');
  await expect.poll(async () => (await read()).entries.length).toBe(before + 1);
  const saved = (await read()).entries.at(-1);
  assert.equal(saved.tonnage, 1000); assert.equal(saved.brak, 20);

  await page.locator('[data-shift="СТИКЕРИ"]').click();
  for (const value of ['1.5', '-1', '9007199254740992']) {
    await page.locator('#tonInput').fill(value); await page.locator('#saveBtn').click();
    await expect(page.locator('#msg')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#tonInput')).toHaveValue(value);
    assert.equal((await read()).entries.length, before + 1);
  }
  await page.locator('[data-hub-language=en]').first().click();
  await expect(page.locator('#msg')).toContainText('non-negative whole numbers');
  await page.locator('[data-hub-language=bg]').first().click();

  await page.locator('#tonInput').fill('1e3');
  const increment = page.locator('.stepper button[data-target="tonInput"]').filter({hasText: '+'}).first();
  const step = Number(await increment.getAttribute('data-step'));
  await increment.click(); await expect(page.locator('#tonInput')).toHaveValue(String(1000 + step));
  await page.locator('#tonInput').fill('1.5'); await increment.click();
  await expect(page.locator('#tonInput')).toHaveValue('1.5');

  await page.locator('#breakdownToggle').check();
  for (const [id, value] of Object.entries({autoKgInput:'1e3', manKgInput:'2e3', autoCrateInput:'1e2', manCrateInput:'2e2'})) await page.locator('#' + id).fill(value);
  await expect(page.locator('#totalReadout')).toHaveText((3000).toLocaleString('bg-BG') + ' кг');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#msg')).toHaveAttribute('data-state', 'success');
  await expect.poll(async () => (await read()).entries.length).toBe(before + 2);
  assert.equal((await read()).entries.at(-1).tonnage, 3000);
  console.log('PASS exact production quantities, invalid drafts, stepper, breakdown and BG/EN');
}
module.exports = {exerciseProductionQuantities};
