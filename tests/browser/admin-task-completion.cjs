/* Fictional assignments and generated JPEGs in an isolated test server. */
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {photo, uploadPhoto} = require('../server/task-photo-fixture.cjs');
const {assertResponsive} = require('./responsive.cjs');

async function exerciseAdminTaskCompletion({admin, hub, base, device, expect, setTime}) {
  setTime('2026-12-01T23:00:00+02:00');
  const actor = hub.auth.list().find(user => user.role === 'admin');
  const owner = await hub.auth.create('demo-complete-chief', 'Fictional-password-123', 'operator', actor, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const manager = await hub.auth.create('demo-complete-manager', 'Fictional-password-123', 'operator', actor, {canViewTasks: true, canManageTasks: true, canReviewTasks: true});
  const make = (title, extra = {}) => hub.tasks.create({requestId: randomUUID(), title, description: '', priority: 'normal', assigneeId: owner.id, participantIds: [], problemPhotos: [photo, photo], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', ...extra}, actor).id;
  const global = make('Fictional admin no-photo completion');
  const shift = make('Fictional admin photo completion', {kind: 'shift', repeat: 'once', from: '2026-12-01'});
  const chief = await device(owner.username, true), delegate = await device(manager.username, false);
  for (const page of [chief, delegate]) {
    await page.goto(base + '/tasks'); await page.locator('[data-view=global]').click();
    await expect(page.getByRole('button', {name: 'Завърши задача', exact: true})).toHaveCount(0);
  }
  await chief.locator('.task-card').filter({hasText: 'Fictional admin no-photo completion'}).getByRole('button', {name: 'Отчети', exact: true}).click();
  await chief.locator('#reportStatus').selectOption('review'); await chief.locator('#actionNote').fill('Fictional owner report');
  await chief.locator('#actionForm button[type=submit]').click();
  await expect(chief.locator('#actionFeedback')).toHaveText('Добави снимка преди запис.');
  await chief.locator('[data-close=taskAction]').first().click();

  await admin.goto(base + '/tasks'); await admin.locator('[data-hub-language=bg]').click();
  await admin.locator('[data-view=global]').click();
  await admin.locator('.task-card').filter({hasText: 'Fictional admin no-photo completion'}).getByRole('button', {name: 'Завърши задача', exact: true}).click();
  await expect(admin.locator('#reportStatusLabel')).toBeHidden(); await expect(admin.locator('#solutionPhotoFields')).toBeVisible();
  await expect(admin.locator('#solutionPhotoFields')).toContainText('Снимките са незадължителни');
  await expect(admin.locator('#solutionPhotoCount')).not.toContainText('задължителни');
  for (const width of [320, 390, 768, 1440]) { await admin.setViewportSize({width, height: 900}); await assertResponsive(admin, 'Admin completion ' + width); }
  await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible();
  const item = id => hub.tasks.list(actor).items.find(item => item.id === id);
  assert.equal(item(global).status, 'completed'); assert.equal(item(global).requiresPhotos, true); assert.equal(item(global).report.photos.length, 0);
  await admin.locator('[data-view=history]').click();
  await admin.locator('#statsFrom').fill('2026-12-01'); await admin.locator('#statsUntil').fill('2026-12-03');
  const history = admin.locator('.task-card').filter({hasText: 'Fictional admin no-photo completion'});
  await expect(history).toContainText('Завършена от администратор без снимки.');
  await expect(history).not.toContainText('Няма снимка от предишната версия.');
  await history.getByRole('button', {name: 'История', exact: true}).click();
  await expect(admin.locator('#historyContent')).toContainText('Завършена от администратор');
  await admin.locator('[data-close=taskHistory]').click();

  await admin.locator('[data-hub-language=en]').click(); await admin.locator('[data-view=shift]').click();
  await admin.locator('.task-card').filter({hasText: 'Fictional admin photo completion'}).getByRole('button', {name: 'Complete task', exact: true}).click();
  await expect(admin.locator('#solutionPhotoFields')).toContainText('Photos are optional');
  await admin.locator('#solutionPhoto').setInputFiles({name: 'fictional-invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional invalid upload')});
  await expect(admin.locator('#solutionPhotoInfo')).toContainText('Choose a photo');
  await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).toBeVisible();
  assert.equal(item(shift).status, 'pending');
  await uploadPhoto(admin, 'solution', expect);
  await admin.locator('#actionNote').fill('Fictional admin completion with photo');
  await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible();
  assert.equal(item(shift).status, 'completed'); assert.equal(item(shift).report.photos.length, 1);
  assert.equal(item(shift).report.actor.id, actor.id);
  await admin.locator('[data-hub-language=bg]').click();
  console.log('PASS admin completion with/without photos, owner requirement, delegated restrictions, history, BG/EN and responsive form');
}
module.exports = {exerciseAdminTaskCompletion};
