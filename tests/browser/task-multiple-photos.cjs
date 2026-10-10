/* Generated images and fictional task content only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {photo} = require('../server/task-photo-fixture.cjs');
const {assertResponsive} = require('./responsive.cjs');
const image = index => ({name: 'fictional-photo-' + index + '.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo, 'base64')});
const mismatch = 'Броят на снимките на решението трябва да е равен на броя на снимките на проблема.';
async function exerciseTaskMultiplePhotos({admin, hub, base, device, expect, setTime, screenshotDir}) {
  setTime('2026-12-01T15:00:00+02:00');
  const owner = await hub.auth.create('demo-multi-photo-chief', 'Fictional-password-123', 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'В'});
  const chief = await device(owner.username, true);
  await admin.goto(base + '/tasks.html'); await admin.locator('[data-hub-language=bg]').click(); await admin.locator('#newTask').click();
  await admin.locator('#taskTitle').fill('Fictional three-photo task'); await admin.locator('#taskOwner').selectOption(String(owner.id));
  await admin.locator('#taskKind').selectOption('global'); await admin.locator('#taskDueDate').fill('2026-12-03'); await admin.locator('#taskDueTime').fill('17:00');
  await admin.locator('#problemPhoto').setInputFiles([image(1), image(2)]); await expect(admin.locator('#problemPhotoInfo')).toHaveText('Снимките са готови за запис.');
  await admin.locator('#problemCamera').setInputFiles(image(3)); await expect(admin.locator('#problemPhotoCount')).toContainText('3 / 10');
  await admin.locator('#problemPhoto').setInputFiles(Array.from({length: 8}, (_, index) => image(index + 10)));
  await expect(admin.locator('#problemPhotoInfo')).toHaveText('Можеш да добавиш до 10 снимки.'); await expect(admin.locator('#problemPhotoCount')).toContainText('3 / 10');
  await admin.locator('#problemPhotoPreview').getByRole('button', {name: 'Премахни снимката', exact: true}).nth(1).click();
  await expect(admin.locator('#problemPhotoCount')).toContainText('2 / 10'); await admin.locator('#problemCamera').setInputFiles(image(4));
  await expect(admin.locator('#problemPhotoPreview img')).toHaveCount(3);
  await admin.locator('#saveTask').click(); await expect(admin.locator('#taskEditor')).not.toBeVisible();
  const task = () => hub.tasks.list(owner).items.find(item => item.title === 'Fictional three-photo task');
  assert.equal(task().problemPhotos.length, 3);
  await admin.locator('[data-view=global]').click();
  const adminCard = admin.locator('.task-card').filter({hasText: 'Fictional three-photo task'});
  await adminCard.getByRole('button', {name: 'Промени', exact: true}).click();
  await expect(admin.locator('#problemPhotoPreview img')).toHaveCount(3);
  await admin.locator('#problemPhotoPreview').getByRole('button', {name: 'Премахни снимката', exact: true}).first().click();
  await admin.locator('#problemPhoto').setInputFiles(image(5)); await expect(admin.locator('#problemPhotoInfo')).toHaveText('Снимките са готови за запис.');
  await admin.locator('#editReason').fill('Fictional revised three-photo set'); await admin.locator('#saveTask').click(); await expect(admin.locator('#taskEditor')).not.toBeVisible();
  assert.equal(task().problemPhotos.length, 3); assert.equal(task().events.at(-1).snapshot.problemPhotos.length, 3);
  await chief.goto(base + '/tasks.html'); await chief.locator('[data-view=global]').click();
  const card = chief.locator('.task-card').filter({hasText: 'Fictional three-photo task'});
  await expect(card.locator('.task-photo')).toHaveCount(3);
  await card.getByRole('button', {name: 'Отвори снимката'}).nth(2).click(); await expect(chief.locator('#photoViewerTitle')).toHaveText('Проблем 3');
  await chief.locator('[data-close=taskPhotoViewer]').click();
  await card.getByRole('button', {name: 'Отчети', exact: true}).click(); await chief.locator('#reportStatus').selectOption('review'); await chief.locator('#actionNote').fill('Fictional three-photo solution');
  await expect(chief.locator('#solutionPhotoCount')).toContainText('0 / 3');
  await chief.locator('#solutionPhoto').setInputFiles(image(1)); await expect(chief.locator('#solutionPhotoInfo')).toHaveText('Снимката е готова за запис.');
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#actionFeedback')).toHaveText(mismatch); assert.equal(task().status, 'pending');
  await chief.locator('#solutionPhoto').setInputFiles([image(2), {name: 'fictional-invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional invalid image')}]);
  await expect(chief.locator('#solutionPhotoInfo')).toContainText('Избери снимка до 20 MB'); await expect(chief.locator('#solutionPhotoPreview img')).toHaveCount(1);
  await chief.locator('#solutionPhoto').setInputFiles([image(2), image(3), image(4)]); await expect(chief.locator('#solutionPhotoCount')).toContainText('4 / 3');
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#actionFeedback')).toHaveText(mismatch); assert.equal(task().status, 'pending');
  await chief.locator('#solutionPhotoPreview').getByRole('button', {name: 'Премахни снимката', exact: true}).last().click(); await expect(chief.locator('#solutionPhotoCount')).toContainText('3 / 3');
  await expect(chief.locator('#actionFeedback')).toHaveText('');
  await chief.setViewportSize({width: 390, height: 900}); await assertResponsive(chief, 'Multi-photo report mobile');
  if (screenshotDir) { fs.mkdirSync(screenshotDir, {recursive: true}); await chief.locator('#taskAction').evaluate(dialog => { dialog.scrollTop = 0; }); await chief.screenshot({path: path.join(screenshotDir, 'task-multiple-photos-report-mobile.png')}); }
  await chief.route('**/api/tasks/items/**', async route => { if (route.request().method() === 'PATCH') { await route.fetch(); await route.abort(); } else await route.continue(); });
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#actionFeedback')).toContainText('прекъсната');
  await chief.unroute('**/api/tasks/items/**'); await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#taskAction')).not.toBeVisible();
  assert.equal(task().events.filter(event => event.action === 'report').length, 1); assert.equal(task().report.photos.length, 3); await expect(card.locator('.task-photo')).toHaveCount(6);
  await card.getByRole('button', {name: 'История', exact: true}).click(); await expect(chief.locator('#historyContent .task-photo')).toHaveCount(9); await chief.locator('[data-close=taskHistory]').click();
  await admin.locator('#refreshTasks').click(); await adminCard.getByRole('button', {name: 'Потвърди приключване', exact: true}).click();
  await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible(); assert.equal(task().status, 'completed');
  await chief.locator('[data-view=history]').click(); await chief.locator('#statsFrom').fill('2026-12-01'); await chief.locator('#statsUntil').fill('2026-12-03');
  for (const width of [320, 390, 768, 1440]) {
    await chief.setViewportSize({width, height: 900});
    for (const language of ['bg', 'en']) { await chief.locator('[data-hub-language=' + language + ']').click(); await expect(card).toContainText(language === 'bg' ? 'Решение 3' : 'Solution 3'); await assertResponsive(chief, 'Multi-photo card ' + width + '/' + language); }
  }
  await chief.locator('[data-hub-language=bg]').click();
  setTime('2027-06-02T15:00:00+02:00'); hub.tasks.maintain(); await chief.locator('#refreshTasks').click();
  await expect(card.locator('.task-photo')).toHaveCount(6); assert.ok(task().problemPhotos.every(value => !value.available)); assert.ok(task().report.photos.every(value => !value.available));
  console.log('PASS multiple file selection, repeated camera, removal, editing, exact count, atomic invalid selection, retry, every photo viewer/history, retention and mobile BG/EN');
}
module.exports = {exerciseTaskMultiplePhotos};
