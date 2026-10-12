/* Login checks use a disposable demo account; credentials never reach logs. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');

async function exerciseLoginUsability({admin: page, base, expect}) {
  await page.goto(base + '/login');
  const password = page.locator('#password'), toggle = page.locator('#togglePassword');
  const submit = page.locator('#loginForm button[type=submit]');
  await page.locator('#username').fill('demo-admin');
  await password.fill('Fictional-password-123');
  await expect(toggle).toBeVisible();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(toggle).toHaveAttribute('aria-controls', 'password');
  let requests = 0;
  const count = request => { if (new URL(request.url()).pathname === '/api/login') requests++; };
  page.on('request', count);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    for (const language of ['bg', 'en']) {
      await page.locator(`[data-hub-language=${language}]`).click();
      await toggle.click();
      await expect(password).toHaveAttribute('type', 'text');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(toggle).toHaveAccessibleName(language === 'bg' ? 'Скрий паролата' : 'Hide password');
      await expect(password).toHaveValue('Fictional-password-123');
      await toggle.press('Space');
      await expect(password).toHaveAttribute('type', 'password');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await assertResponsive(page, `Login visibility ${language}/${width}`);
    }
  }
  assert.equal(requests, 0, 'Visibility toggle never submits the login form');
  await page.locator('[data-hub-language=bg]').click();
  await password.fill('Fictional-wrong-password');
  await toggle.click();
  await password.press('Enter');
  await expect(page.locator('#loginMessage')).toHaveText('Невалидно потребителско име или парола.');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(submit).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const cases = [
    {status: 503, text: 'Входът временно не е достъпен. Опитай отново.'},
    {status: 429, text: 'Твърде много опити. Опитай отново след 15 минути.'},
    {status: 0, text: 'Няма връзка със сървъра. Опитай отново.'}
  ];
  for (const scenario of cases) {
    const handler = route => scenario.status ? route.fulfill({status: scenario.status, json: {error: 'FICTIONAL_UNAVAILABLE'}}) : route.abort();
    await page.route('**/api/login', handler);
    await submit.click();
    await expect(page.locator('#loginMessage')).toHaveText(scenario.text);
    await expect(submit).toBeEnabled();
    await expect(password).toHaveValue('Fictional-wrong-password');
    await page.unroute('**/api/login', handler);
  }
  await page.locator('[data-hub-language=en]').click();
  await expect(page.locator('#loginMessage')).toHaveText('Server unavailable. Try again.');
  await password.fill('Fictional-password-123');
  await password.press('Enter');
  await expect(page).toHaveURL(base + '/');
  page.off('request', count);
  console.log('PASS password toggle, keyboard, error feedback, BG/EN and 320–1440 px');
}

module.exports = {exerciseLoginUsability};
