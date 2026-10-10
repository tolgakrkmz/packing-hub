/* This workflow uses generated images and fictional task content only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {uploadPhoto} = require('../server/task-photo-fixture.cjs');
const {assertResponsive} = require('./responsive.cjs');

async function exerciseTaskPhotoOptions({admin, hub, base, device, expect, setTime, screenshotDir}) {
  setTime('2026-12-01T15:00:00+02:00');
  const owner = await hub.auth.create('demo-photo-option-chief', 'Fictional-password-123', 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'В'});
  const chief = await device(owner.username, true);
  await admin.goto(base + '/tasks.html'); await admin.locator('[data-hub-language=bg]').click();
  await admin.locator('#newTask').click();
  const check = admin.getByRole('checkbox', {name: 'Изисква снимки', exact: true});
  await expect(check).toBeChecked(); await expect(admin.locator('#problemPhotoFields')).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({width, height: 900});
    for (const language of ['bg', 'en']) {
      await admin.locator('[data-close=taskEditor]').first().click();
      await admin.locator('[data-hub-language=' + language + ']').click();
      await admin.locator('#newTask').click();
      await expect(admin.getByRole('checkbox', {name: language === 'bg' ? 'Изисква снимки' : 'Requires photos', exact: true})).toBeChecked();
      await assertResponsive(admin, 'Photo option form ' + width + '/' + language);
    }
  }
  await admin.locator('[data-close=taskEditor]').first().click(); await admin.locator('[data-hub-language=bg]').click();
  await admin.setViewportSize({width: 390, height: 900}); await admin.locator('#newTask').click();
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true});
    await admin.screenshot({path: path.join(screenshotDir, 'task-photo-option-mobile.png'), fullPage: true});
  }
  await admin.locator('#taskTitle').fill('Fictional optional-photo global'); await admin.locator('#taskOwner').selectOption(String(owner.id));
  await admin.locator('#taskKind').selectOption('global'); await admin.locator('#taskDueDate').fill('2026-12-03'); await admin.locator('#taskDueTime').fill('17:00');
  await admin.locator('#saveTask').click(); await expect(admin.locator('#editorFeedback')).toHaveText('Добави снимка преди запис.');
  await admin.locator('#problemPhoto').setInputFiles({name: 'fictional-invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional invalid image')});
  await expect(admin.locator('#problemPhotoInfo')).toContainText('Избери снимка до 20 MB');
  await check.uncheck(); await expect(admin.locator('#problemPhotoFields')).toBeHidden();
  await admin.locator('#saveTask').click(); await expect(admin.locator('#taskEditor')).not.toBeVisible();
  const task = () => hub.tasks.list(owner).items.find(item => item.title === 'Fictional optional-photo global');
  assert.equal(task().requiresPhotos, false); assert.equal(task().problemPhoto, null);
  await admin.locator('[data-view=global]').click();
  const adminCard = admin.locator('.task-card').filter({hasText: 'Fictional optional-photo global'});
  await adminCard.getByRole('button', {name: 'Промени', exact: true}).click();
  await expect(check).not.toBeChecked(); await check.check();
  await admin.locator('#editReason').fill('Fictional enable photographic evidence');
  await admin.locator('#saveTask').click(); await expect(admin.locator('#editorFeedback')).toHaveText('Добави снимка преди запис.');
  await uploadPhoto(admin, 'problem', expect);
  await admin.locator('#saveTask').click(); await expect(admin.locator('#taskEditor')).not.toBeVisible();
  assert.equal(task().requiresPhotos, true);
  await chief.goto(base + '/tasks.html'); await chief.locator('[data-view=global]').click();
  const card = chief.locator('.task-card').filter({hasText: 'Fictional optional-photo global'});
  await expect(card).toContainText('Изисква снимки');
  await card.getByRole('button', {name: 'Отчети', exact: true}).click();
  await expect(chief.locator('#solutionPhotoFields')).toBeVisible(); await chief.locator('#reportStatus').selectOption('review');
  await chief.locator('#actionNote').fill('Fictional result requiring evidence');
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#actionFeedback')).toHaveText('Добави снимка преди запис.');
  assert.equal(task().status, 'pending'); await chief.locator('[data-close=taskAction]').first().click();
  await adminCard.getByRole('button', {name: 'Промени', exact: true}).click(); await check.uncheck();
  await admin.locator('#editReason').fill('Fictional no-photo assignment'); await admin.locator('#saveTask').click(); await expect(admin.locator('#taskEditor')).not.toBeVisible();
  await chief.locator('#refreshTasks').click(); await expect(card).toContainText('Снимки не се изискват');
  await card.getByRole('button', {name: 'Отчети', exact: true}).click(); await expect(chief.locator('#solutionPhotoFields')).toBeHidden();
  await chief.locator('#reportStatus').selectOption('review'); await chief.locator('#actionNote').fill('Fictional text-only result');
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#taskAction')).not.toBeVisible();
  assert.equal(task().report.photo, null);
  await admin.locator('#refreshTasks').click(); await adminCard.getByRole('button', {name: 'Потвърди приключване', exact: true}).click();
  await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible(); assert.equal(task().status, 'completed');
  await admin.locator('#newTask').click(); await expect(check).toBeChecked();
  await admin.locator('#taskTitle').fill('Fictional optional-photo shift'); await admin.locator('#taskOwner').selectOption(String(owner.id));
  await admin.locator('#taskFrom').fill('2026-12-01'); await check.uncheck(); await admin.locator('#saveTask').click(); await expect(admin.locator('#taskEditor')).not.toBeVisible();
  await chief.locator('#refreshTasks').click(); await chief.locator('[data-view=shift]').click();
  const shiftCard = chief.locator('.task-card').filter({hasText: 'Fictional optional-photo shift'});
  await expect(shiftCard.locator('.task-photos')).toHaveCount(0);
  await shiftCard.getByRole('button', {name: 'Отчети', exact: true}).click(); await expect(chief.locator('#solutionPhotoFields')).toBeHidden();
  await chief.locator('#reportStatus').selectOption('completed'); await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#taskAction')).not.toBeVisible();
  assert.equal(hub.tasks.list(owner).items.find(item => item.title === 'Fictional optional-photo shift').status, 'completed');
  console.log('PASS default photo checkbox, opt-out, enabling evidence, required report, text-only completion, reviewed completion and mobile BG/EN');
}

module.exports = {exerciseTaskPhotoOptions};
