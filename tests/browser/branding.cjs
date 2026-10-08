/* Brand checks use only isolated fictional accounts; production records are never loaded. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');
const password = 'Fictional-password-123';
const pages = ['index', 'tasks', 'accounts', 'data-import', 'production-import', 'production-log', 'line-downtime', 'personnel', 'pair-targets', 'package-instructions', 'statistics'];

async function exerciseBranding({admin, hub, base, device, expect, screenshotDir}) {
  console.log('RUN branded login, error feedback and logout');
  await admin.goto(base + '/login.html');
  await expect(admin.locator('.hub-brand')).toHaveText('Package Hub');
  await expect(admin.locator('.hub-brand')).toHaveAttribute('translate', 'no');
  await expect(admin.locator('#username')).toHaveAttribute('autocomplete', 'username');
  await expect(admin.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
  await expect(admin.locator('#loginMessage')).toHaveAttribute('role', 'status');
  await expect(admin.locator('#loginMessage')).toHaveAttribute('aria-live', 'polite');
  await admin.locator('#username').fill('demo-admin');
  await admin.locator('#password').fill('Fictional-wrong-password');
  await admin.locator('#loginForm button').click();
  await expect(admin.locator('#loginMessage')).toHaveText('Невалидно потребителско име или парола.');
  await expect(admin).toHaveURL(base + '/login.html');
  await expect(admin.locator('#username')).toHaveValue('demo-admin');
  await expect(admin.locator('#loginForm button')).toBeEnabled();
  await admin.locator('[data-hub-language=en]').click();
  await expect(admin.locator('#loginMessage')).toHaveText('Invalid username or password.');
  await expect(admin.locator('#username')).toHaveValue('demo-admin');
  await admin.locator('#password').fill(password);
  await admin.locator('#loginForm button').click();
  await expect(admin).toHaveURL(base + '/index.html');
  await admin.locator('.server-logout').click();
  await expect(admin).toHaveURL(base + '/login.html');
  assert.equal(await admin.evaluate(async () => (await fetch('/api/session')).status), 401);

  const assertMark = async () => {
    const image = admin.locator('.hub-brand:visible img');
    await expect(image).toHaveCount(1);
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    await expect(image).toHaveAttribute('alt', '');
    const icon = admin.locator('link[rel=icon]');
    await expect(icon).toHaveAttribute('type', 'image/svg+xml');
    await expect(icon).toHaveAttribute('href', /assets\/package-hub-mark\.svg$/);
  };
  await assertMark();
  const iconResponse = await admin.request.get(base + '/assets/package-hub-mark.svg');
  assert.equal(iconResponse.status(), 200);
  assert.match(iconResponse.headers()['content-type'], /^image\/svg\+xml/);

  console.log('RUN login and authenticated modules in BG/EN at 320–1440 px');
  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({width, height: 900});
    for (const language of ['en', 'bg']) {
      await admin.locator(`[data-hub-language=${language}]`).click();
      await expect(admin.locator('.hub-brand')).toHaveText('Package Hub');
      await assertResponsive(admin, `Brand login/${language} at ${width}px`);
    }
  }
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true});
    await admin.screenshot({path: path.join(screenshotDir, 'hub-brand-login.png')});
  }
  await admin.locator('#username').fill('demo-admin');
  await admin.locator('#password').fill(password);
  await admin.locator('#loginForm button').click();
  await expect(admin).toHaveURL(base + '/index.html');

  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({width, height: 900});
    for (const name of pages) {
      await admin.goto(`${base}/${name}.html`);
      await expect(admin.locator('.server-bar')).toBeVisible();
      await expect(admin.locator('.hub-brand:visible')).toHaveCount(1);
      await expect(admin.locator('.server-bar .hub-brand')).toHaveAttribute('href', '/index.html');
      await assertMark();
      await expect(admin.locator('.server-bar .hub-language')).toHaveCount(1);
      if (['system-status', 'accounts', 'data-import'].includes(name)) {
        await expect(admin.locator(`.server-links a[href="/${name}.html"]`)).toHaveAttribute('aria-current', 'page');
      } else await expect(admin.locator('.server-links [aria-current=page]')).toHaveCount(0);
      for (const language of ['en', 'bg']) {
        await admin.locator(`[data-hub-language=${language}]`).click();
        await expect(admin.locator('.server-bar .hub-brand')).toHaveText('Package Hub');
        await assertResponsive(admin, `Brand ${name}/${language} at ${width}px`);
        const smallLinks = await admin.locator('.server-bar a').evaluateAll(elements => elements.filter(element => element.checkVisibility() && (element.getBoundingClientRect().width < 44 || element.getBoundingClientRect().height < 44)).map(element => element.className || element.id));
        assert.deepEqual(smallLinks, [], `Brand ${name}/${language}: toolbar touch targets`);
      }
    }
  }

  console.log('RUN toolbar task badges, report selection and permission boundaries');
  await admin.goto(base + '/index.html');
  await expect(admin.locator('a[href="tasks.html"] .task-count')).toHaveCount(1);
  await expect(admin.locator('a[href="tasks.html"] .task-count')).toBeHidden();
  // Exercise live count rendering without creating or modifying task records.
  await admin.route('**/api/tasks/summary', route => route.fulfill({json: {count: 3}}));
  await admin.reload();
  await expect(admin.locator('a[href="tasks.html"] .task-count')).toHaveText('3');
  await expect(admin.locator('a[href="tasks.html"] .task-count')).toBeVisible();
  await expect(admin.locator('a[href="tasks.html"] .task-count')).toHaveAttribute('aria-label', 'Задачи за проверка: 3');
  await admin.unroute('**/api/tasks/summary');
  await admin.reload();
  await expect(admin.locator('a[href="tasks.html"] .task-count')).toBeHidden();

  for (const kind of ['production-log', 'line-downtime', 'pair-targets']) {
    await admin.goto(`${base}/${kind}.html`);
    await expect(admin.locator('#reportExportKind')).toHaveValue(kind);
    await expect(admin.locator('#reportExport')).toHaveAttribute('href', '/api/export/' + kind);
    await expect(admin.locator('#reportExport')).toHaveAttribute('download', kind + '.json');
  }
  await admin.locator('#reportExportKind').selectOption('line-downtime');
  await expect(admin.locator('#reportExport')).toHaveAttribute('href', '/api/export/line-downtime');
  const downloadPromise = admin.waitForEvent('download');
  await admin.locator('#reportExport').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'line-downtime.json');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), hub.store.get('line-downtime').data);

  for (const role of ['operator', 'observer']) {
    const username = 'demo-brand-' + role;
    await hub.auth.create(username, password, role);
    const page = await device(username, true);
    await expect(page.locator('.server-links a[href="/accounts.html"]')).toHaveCount(0);
    await expect(page.locator('.server-links a[href="/data-import.html"]')).toHaveCount(0);
    await expect(page.locator('.server-links a[href="/tasks.html"]')).toHaveCount(0);
    await expect(page.locator('#reportExportKind')).toBeVisible();
    await expect(page.locator('.server-user')).toHaveText(username);
    assert.equal(await page.evaluate(async () => (await fetch('/accounts.html')).status), 403);
    assert.equal(await page.evaluate(async () => (await fetch('/data-import.html')).status), 403);
    for (const language of ['en', 'bg']) {
      await page.locator(`[data-hub-language=${language}]`).click();
      await assertResponsive(page, `Brand ${role}/${language} at 390px`);
    }
    await page.context().close();
  }
  await admin.goto(base + '/index.html');
  await admin.setViewportSize({width: 1440, height: 900});
  await admin.locator('[data-hub-language=bg]').click();
  if (screenshotDir) await admin.screenshot({path: path.join(screenshotDir, 'hub-brand-header.png')});
  console.log('PASS brand assets, login/logout, toolbar navigation/badges/exports, BG/EN and role permissions');
}

module.exports = {exerciseBranding};
