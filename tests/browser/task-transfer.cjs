/* All accounts, task content and images are fictional. */
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {photo} = require('../server/task-photo-fixture.cjs');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseTaskTransfer({admin, hub, base, device, expect, setTime}) {
  setTime('2026-12-01T23:00:00+02:00');
  const actor = hub.auth.list().find(user => user.username === 'demo-admin');
  const owner = await hub.auth.create('demo-handover-owner', 'Fictional-password-123', 'operator', actor, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const next = await hub.auth.create('demo-handover-next', 'Fictional-password-123', 'operator', actor, {}, () => {}, {taskSupervisor: true, taskTeam: 'Б'});
  const manager = await hub.auth.create('demo-handover-manager', 'Fictional-password-123', 'operator', actor, {canViewTasks: true, canManageTasks: true});
  const id = hub.tasks.create({requestId: randomUUID(), title: 'Fictional task handover', description: '', priority: 'normal', assigneeId: owner.id, participantIds: [next.id], problemPhotos: [photo], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00'}, actor).id;
  hub.tasks.change(id, {action: 'report', status: 'review', note: 'Fictional previous report', solutionPhotos: [photo]}, 1, owner);
  const before = hub.tasks.list(actor).items.find(item => item.id === id);
  const chief = await device(owner.username, true), recipient = await device(next.username, true), delegate = await device(manager.username, false);
  for (const page of [chief, delegate]) {
    await page.goto(base + '/tasks'); await page.locator('[data-view=global]').click();
    await expect(page.getByRole('button', {name: 'Прехвърли задача', exact: true})).toHaveCount(0);
  }
  await delegate.locator('.task-card').filter({hasText: 'Fictional task handover'}).getByRole('button', {name: 'Промени', exact: true}).click();
  await expect(delegate.locator('#taskOwner')).toBeDisabled(); await delegate.locator('[data-close=taskEditor]').first().click();
  await admin.goto(base + '/tasks'); await admin.locator('[data-hub-language=bg]').click(); await admin.locator('[data-view=global]').click();
  const card = admin.locator('.task-card').filter({hasText: 'Fictional task handover'});
  await card.getByRole('button', {name: 'Прехвърли задача', exact: true}).click();
  await expect(admin.locator('#transferOwnerLabel')).toBeVisible(); await expect(admin.locator('#reportStatusLabel')).toBeHidden();
  await expect(admin.locator('#solutionPhotoFields')).toBeHidden();
  await expect(admin.locator('#transferOwner option[value="' + owner.id + '"]')).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({width, height: 900});
    await assertResponsive(admin, 'Task transfer BG ' + width);
  }
  await admin.locator('#transferOwner').selectOption(String(next.id));
  await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).toBeVisible();
  assert.equal(hub.tasks.list(actor).items.find(item => item.id === id).owner.id, owner.id);
  await admin.locator('#actionNote').fill('Fictional handover reason');
  await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible();
  const changed = hub.tasks.list(actor).items.find(item => item.id === id);
  assert.equal(changed.owner.id, next.id); assert.equal(changed.due, before.due); assert.equal(changed.report, null);
  assert.equal(changed.events[1].photos[0].id, before.report.photo.id);
  await chief.locator('#refreshTasks').click(); await expect(chief.locator('#taskContent')).not.toContainText('Fictional task handover');
  await recipient.goto(base + '/tasks'); await recipient.locator('[data-view=global]').click();
  const recipientCard = recipient.locator('.task-card').filter({hasText: 'Fictional task handover'});
  await expect(recipientCard.getByRole('button', {name: 'Отчети', exact: true})).toBeVisible();
  await card.getByRole('button', {name: 'История', exact: true}).click();
  await expect(admin.locator('#historyContent')).toContainText('Прехвърлена');
  await expect(admin.locator('#historyContent')).toContainText(owner.username + ' → ' + next.username);
  await expect(admin.locator('#historyContent')).toContainText('Fictional previous report');
  await admin.locator('[data-close=taskHistory]').click();

  await admin.locator('[data-hub-language=en]').click();
  await card.getByRole('button', {name: 'Transfer task', exact: true}).click();
  await expect(admin.locator('#transferOwnerLabel')).toContainText('New owner');
  await expect(admin.locator('#transferHelp')).toContainText('Only this task');
  await admin.setViewportSize({width: 390, height: 900}); await assertResponsive(admin, 'Task transfer EN mobile');
  await admin.locator('#transferOwner').selectOption(String(owner.id)); await admin.locator('#actionNote').fill('Fictional return responsibility');
  await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible();
  assert.equal(hub.tasks.list(actor).items.find(item => item.id === id).owner.id, owner.id);
  await admin.locator('[data-hub-language=bg]').click();
  console.log('PASS admin handover, manager restrictions, owner change, previous report/photos, required reason, history, BG/EN and responsive form');
}
module.exports = {exerciseTaskTransfer};
