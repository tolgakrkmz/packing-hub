const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {uploadPhoto} = require('../server/task-photo-fixture.cjs');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseTaskPhotos({admin, hub, base, device, expect, setTime, screenshotDir}) {
  setTime('2026-12-01T15:00:00+02:00');
  const owner = await hub.auth.create('demo-photo-browser-chief', 'Fictional-password-123', 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'В'});
  const chief = await device(owner.username, true);
  await admin.goto(base + '/tasks.html'); await admin.locator('#newTask').click();
  await admin.locator('#taskTitle').fill('Fictional photo browser problem'); await admin.locator('#taskOwner').selectOption(String(owner.id));
  await admin.locator('#taskKind').selectOption('global'); await admin.locator('#taskDueDate').fill('2026-12-03'); await admin.locator('#taskDueTime').fill('17:00');
  await admin.locator('#saveTask').click(); await expect(admin.locator('#editorFeedback')).toHaveText('Добави снимка преди запис.');
  await admin.locator('#problemPhoto').setInputFiles({name: 'fictional.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional invalid image')});
  await expect(admin.locator('#problemPhotoInfo')).toContainText('Избери снимка до 20 MB');
  const png = await admin.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2560; canvas.height = 1600;
    const context = canvas.getContext('2d'); context.fillStyle = '#238d77'; context.fillRect(0, 0, 2560, 1600);
    context.fillStyle = '#f3c66c'; context.fillRect(300, 300, 500, 500); return canvas.toDataURL('image/png').split(',')[1];
  });
  await admin.locator('#problemCamera').setInputFiles({name: 'fictional-camera.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
  await expect(admin.locator('#problemPhotoInfo')).toHaveText('Снимката е готова за запис.');
  assert.equal(await admin.locator('#problemPhotoPreview img').evaluate(img => img.naturalWidth), 1280);
  // The server accepts the creation, but the response is lost; the same draft retries once.
  await admin.route('**/api/tasks', async route => { if (route.request().method() === 'POST') { await route.fetch(); await route.abort(); } else await route.continue(); });
  await admin.locator('#saveTask').click(); await expect(admin.locator('#editorFeedback')).toContainText('прекъсната');
  await expect(admin.locator('#problemPhotoPreview img')).toBeVisible();
  await admin.unroute('**/api/tasks'); await admin.locator('#saveTask').click(); await expect(admin.locator('#taskEditor')).not.toBeVisible();
  const items = hub.tasks.list(owner).items; assert.equal(items.length, 1);
  const item = items[0]; assert.equal(item.problemPhoto.width, 1280); assert.ok(item.problemPhoto.bytes <= 300 * 1024);
  await chief.goto(base + '/tasks.html'); await chief.locator('[data-view=global]').click();
  const card = chief.locator('.task-card').filter({hasText: 'Fictional photo browser problem'});
  await card.getByRole('button', {name: 'Отвори снимката'}).click();
  await expect(chief.locator('#taskPhotoViewer')).toBeVisible();
  await expect(chief.locator('#photoViewerImage')).toBeVisible();
  assert.equal(await chief.locator('#photoViewerImage').evaluate(img => img.naturalWidth), 1280);
  await chief.locator('[data-close=taskPhotoViewer]').click();
  await card.getByRole('button', {name: 'Отчети', exact: true}).click(); await chief.locator('#reportStatus').selectOption('review'); await chief.locator('#actionNote').fill('Fictional photographed resolution');
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#actionFeedback')).toHaveText('Добави снимка преди запис.');
  await uploadPhoto(chief, 'solution', expect);
  await chief.route('**/api/tasks/items/**', async route => route.fulfill({status: 507, contentType: 'application/json', body: JSON.stringify({error: 'TASK_PHOTO_STORAGE'})}));
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#actionFeedback')).toContainText('Няма достатъчно място');
  await expect(chief.locator('#actionNote')).toHaveValue('Fictional photographed resolution'); await expect(chief.locator('#solutionPhotoPreview img')).toBeVisible();
  await chief.unroute('**/api/tasks/items/**');
  await chief.route('**/api/tasks/items/**', async route => { if (route.request().method() === 'PATCH') { await route.fetch(); await route.abort(); } else await route.continue(); });
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#actionFeedback')).toContainText('прекъсната');
  await chief.unroute('**/api/tasks/items/**'); await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#taskAction')).not.toBeVisible();
  const reported = hub.tasks.list(owner).items[0]; assert.equal(reported.events.filter(event => event.action === 'report').length, 1);
  await expect(card.locator('.task-photos figure')).toHaveCount(2);
  await card.getByRole('button', {name: 'История', exact: true}).click(); await expect(chief.locator('#historyContent .task-photo')).toHaveCount(2);
  await chief.locator('[data-close=taskHistory]').click();
  await admin.locator('#refreshTasks').click(); await admin.locator('[data-view=global]').click();
  const adminCard = admin.locator('.task-card').filter({hasText: 'Fictional photo browser problem'});
  await adminCard.getByRole('button', {name: 'Потвърди приключване', exact: true}).click(); await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible();
  await chief.locator('[data-view=history]').click();
  await chief.locator('#statsFrom').fill('2026-12-01'); await chief.locator('#statsUntil').fill('2026-12-03');
  await expect(card).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await chief.setViewportSize({width, height: 900});
    for (const language of ['bg', 'en']) { await chief.locator('[data-hub-language=' + language + ']').click(); await expect(chief.locator('#photoPolicy')).toContainText(language === 'en' ? 'Photos:' : 'Снимки:'); await assertResponsive(chief, 'Photo task ' + width + '/' + language); }
  }
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true}); await chief.setViewportSize({width: 390, height: 900});
    await chief.locator('[data-hub-language=bg]').click(); await chief.screenshot({path: path.join(screenshotDir, 'task-photos-mobile.png'), fullPage: true});
  }
  setTime('2027-06-02T15:00:00+02:00'); hub.tasks.maintain();
  await chief.locator('#refreshTasks').click(); await chief.locator('#statsFrom').fill('2026-12-01'); await chief.locator('#statsUntil').fill('2026-12-03');
  await expect(card).toContainText('Снимката е изтрита след срока за съхранение.'); await expect(card).toContainText('Изпълнена');
  assert.equal((await chief.request.get(base + '/api/tasks/items/' + item.id + '/photos/' + item.problemPhoto.id)).status(), 410);
  console.log('PASS required problem/solution photos, camera selection, compression, viewer, quota errors, lost-response retries, history, retention and mobile BG/EN');
}
module.exports = {exerciseTaskPhotos};
