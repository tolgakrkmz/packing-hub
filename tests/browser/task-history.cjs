/* Fictional task history in the browser runner's temporary SQLite database. */
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');

async function exerciseTaskHistory({admin, hub, base, device, expect, setTime, screenshotDir}) {
  setTime('2026-12-01T10:00:00+02:00');
  const manager = hub.auth.list().find(user => user.username === 'demo-admin');
  const owner = await hub.auth.create('demo-history-chief', 'Fictional-password-123', 'operator', manager, {}, () => {}, {taskSupervisor: true, taskTeam: 'СТИКЕРИ'});
  const other = await hub.auth.create('demo-history-other', 'Fictional-password-123', 'operator', manager, {}, () => {}, {taskSupervisor: true, taskTeam: 'СТИКЕРИ'});
  const ids = {};
  function create(key, extra) {
    ids[key] = hub.tasks.create({requestId: randomUUID(), title: 'Fictional history ' + key, description: 'Fictional history detail', priority: 'normal', requiresPhotos: false,
      assigneeId: owner.id, participantIds: [], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', ...extra}, manager).id;
  }
  function change(key, action, user = manager, status) {
    const item = hub.tasks.list(manager).items.find(item => item.id === ids[key]);
    hub.tasks.change(item.id, {action, status, note: 'Fictional history reason'}, item.revision, user);
  }
  create('approved', {dueDate: '2026-12-01', dueTime: '11:00'});
  create('completed', {kind: 'shift', repeat: 'once', from: '2026-12-01'});
  setTime('2026-12-01T10:01:00+02:00');
  create('not-applicable', {kind: 'shift', repeat: 'once', from: '2026-12-01'});
  create('not-done', {kind: 'shift', repeat: 'once', from: '2026-12-02'});
  create('blocked', {});
  create('review', {dueDate: '2026-12-02', dueTime: '18:00'});
  create('pending-global', {dueTime: '18:00'});
  create('pending-shift', {kind: 'shift', repeat: 'once', from: '2026-12-02'});
  create('cancelled', {dueTime: '16:00'});
  create('other-owner', {assigneeId: other.id});
  change('approved', 'report', owner, 'review'); change('approved', 'approve');
  for (const status of ['completed', 'not-applicable']) change(status, 'report', owner, status);
  change('blocked', 'report', owner, 'blocked'); change('review', 'report', owner, 'review');
  change('cancelled', 'cancel');
  setTime('2026-12-02T18:31:00+02:00');
  change('not-done', 'report', owner, 'not-done');

  const group = (page, key) => page.locator(`[data-history-group=${key}]`);
  const titles = (page, key) => group(page, key).locator('.task-card h2');
  const count = (page, key) => group(page, key).locator('.task-history-heading .task-badge');
  async function open(page) {
    await page.goto(base + '/tasks'); await page.locator('[data-hub-language=bg]').click();
    await page.locator('[data-view=history]').click();
    await page.locator('#statsFrom').fill('2026-12-01'); await page.locator('#statsUntil').fill('2026-12-03');
  }
  await open(admin); await admin.locator('#ownerFilter').selectOption(String(owner.id));
  await expect(titles(admin, 'reported')).toHaveText(['blocked', 'review', 'not-done', 'not-applicable', 'completed', 'approved'].map(key => 'Fictional history ' + key));
  await expect(titles(admin, 'unreported')).toHaveText(['pending-global', 'cancelled', 'pending-shift'].map(key => 'Fictional history ' + key));
  await expect(count(admin, 'reported')).toHaveText('6'); await expect(count(admin, 'unreported')).toHaveText('3');
  await expect(group(admin, 'unreported')).toContainText('Неотчетена'); await expect(group(admin, 'unreported')).toContainText('Отменена');
  const chief = await device(owner.username, true); await open(chief);
  await expect(count(chief, 'reported')).toHaveText('6'); await expect(count(chief, 'unreported')).toHaveText('3');
  await expect(chief.locator('#taskContent')).not.toContainText('Fictional history other-owner');

  for (const width of [320, 390, 1440]) {
    await admin.setViewportSize({width, height: 900});
    for (const language of ['en', 'bg']) {
      await admin.locator(`[data-hub-language=${language}]`).click();
      await expect(group(admin, 'reported').locator('.task-history-heading span').first()).toHaveText(language === 'en' ? 'Reported' : 'Отчетени');
      await expect(group(admin, 'unreported').locator('.task-history-heading span').first()).toHaveText(language === 'en' ? 'Unreported' : 'Неотчетени');
      await assertResponsive(admin, `Task history ${language} at ${width}px`);
    }
  }
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true});
    await admin.screenshot({path: path.join(screenshotDir, 'tasks-history-desktop.png'), fullPage: true});
    await chief.screenshot({path: path.join(screenshotDir, 'tasks-history-mobile.png'), fullPage: true});
  }
  await admin.locator('#taskSearch').fill('Fictional history blocked');
  await expect(count(admin, 'reported')).toHaveText('1'); await expect(count(admin, 'unreported')).toHaveText('0');
  await expect(group(admin, 'unreported')).toContainText('Няма неотчетени задачи по тези критерии.');
  await admin.locator('[data-hub-language=en]').click();
  await expect(group(admin, 'unreported')).toContainText('No unreported tasks match these filters.');
  await admin.locator('[data-hub-language=bg]').click(); await admin.locator('#taskSearch').fill('');
  await admin.locator('#ownerFilter').selectOption(String(other.id));
  await expect(count(admin, 'reported')).toHaveText('0'); await expect(count(admin, 'unreported')).toHaveText('1');
  await expect(group(admin, 'reported')).toContainText('Няма отчетени задачи по тези критерии.');
  await admin.locator('#ownerFilter').selectOption(String(owner.id)); await admin.locator('#statsUntil').fill('2026-12-02');
  await expect(count(admin, 'reported')).toHaveText('5'); await expect(count(admin, 'unreported')).toHaveText('1');
  await admin.locator('#statsFrom').fill('2026-12-03'); await expect(admin.locator('#taskContent')).toHaveText('Избери валиден период.');
  await admin.locator('#statsFrom').fill('2026-12-01'); await admin.locator('#statsUntil').fill('2026-12-03');

  await group(admin, 'reported').locator('.task-card').filter({hasText: 'Fictional history review'}).getByRole('button', {name: 'Върни за работа', exact: true}).click();
  await admin.locator('#actionNote').fill('Fictional history return reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(count(admin, 'reported')).toHaveText('5'); await expect(count(admin, 'unreported')).toHaveText('4');
  await expect(group(admin, 'unreported')).toContainText('Fictional history review');
  await group(admin, 'reported').locator('.task-card').filter({hasText: 'Fictional history completed'}).getByRole('button', {name: 'Отвори отново', exact: true}).click();
  await admin.locator('#actionNote').fill('Fictional history reopen reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(count(admin, 'reported')).toHaveText('4'); await expect(count(admin, 'unreported')).toHaveText('5');
  await chief.locator('#refreshTasks').click();
  await expect(group(chief, 'unreported')).toContainText('Fictional history completed');
  await group(chief, 'unreported').locator('.task-card').filter({hasText: 'Fictional history completed'}).getByRole('button', {name: 'Отчети', exact: true}).click();
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#taskAction')).not.toBeVisible();
  await expect(count(chief, 'reported')).toHaveText('5'); await expect(count(chief, 'unreported')).toHaveText('4');
  await chief.context().close();
  console.log('PASS task history groups, newest order, filters, report transitions and BG/EN layouts');
}
module.exports = {exerciseTaskHistory};
