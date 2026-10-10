/* Assignment checks use only fictional accounts and tasks in a temporary server. */
const assert = require('node:assert/strict');
const {photo, uploadPhoto} = require('../server/task-photo-fixture.cjs');
const {assertResponsive} = require('./responsive.cjs');
const password = 'Fictional-password-123';
async function exerciseTaskAssignment({admin, hub, base, device, expect, setTime, screenshotDir}) {
  setTime('2026-12-01T15:00:00+02:00');
  const owner = await hub.auth.create('demo-assignment-owner', password, 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'В'});
  await admin.goto(base + '/accounts.html');
  await admin.locator('[data-hub-language=bg]').click();
  await admin.locator('#newAccountButton').click();
  await admin.locator('#accountUsername').fill('demo-task-assigner'); await admin.locator('#accountPassword').fill(password);
  await admin.locator('#accountRole').selectOption('observer');
  const flags = admin.locator('#accountForm');
  await expect(flags.locator('[data-permission=canAssignTasks]')).toBeEnabled();
  await expect(flags.locator('[data-permission=canAssignTasks]')).not.toBeChecked();
  await flags.locator('[data-permission=canAssignTasks]').check();
  await expect(flags.locator('[data-permission=canViewTasks]')).toBeChecked();
  await expect(flags).toContainText('Включено с действието');
  await flags.locator('[data-permission=canViewTasks]').uncheck();
  await expect(flags).toContainText('Изисква включен преглед на модула');
  await flags.getByRole('button', {name: 'Върни правата по роля', exact: true}).click();
  await expect(flags.locator('[data-permission=canAssignTasks]')).not.toBeChecked();
  await expect(flags.locator('[data-permission=canViewTasks]')).not.toBeChecked();
  await admin.locator('#accountRole').selectOption('operator');
  await flags.locator('[data-permission=canAssignTasks]').check();
  for (const language of ['bg', 'en']) {
    await admin.locator('[data-hub-language=' + language + ']').click();
    await expect(flags.locator('[data-permission=canAssignTasks]').locator('..')).toContainText(language === 'en' ? 'Can assign tasks' : 'Може да възлага задачи');
    for (const width of [320, 390, 1440]) { await admin.setViewportSize({width, height: 1000}); await assertResponsive(admin, 'Assignment account flag ' + language + '/' + width); }
  }
  await admin.locator('[data-hub-language=bg]').click();
  await flags.locator('button[type=submit]').click(); await expect(admin.locator('#accountList')).toContainText('demo-task-assigner');
  const user = hub.auth.list().find(user => user.username === 'demo-task-assigner');
  assert.deepEqual(user.permissionOverrides, {canAssignTasks: true});
  const assigner = await device(user.username, true);
  await expect(assigner.locator('a[href="tasks.html"]')).toBeVisible();
  await expect(assigner.getByRole('link', {name: 'Админ панел', exact: true})).toHaveCount(1);
  await assigner.goto(base + '/tasks.html'); await expect(assigner.locator('#newTask')).toBeVisible();
  async function assign(page, kind, title) {
    const language = kind === 'global' ? 'en' : 'bg';
    await page.locator('[data-hub-language=' + language + ']').click();
    await page.locator('#newTask').click(); await page.locator('#taskTitle').fill(title);
    await page.locator('#taskOwner').selectOption(String(owner.id));
    if (kind === 'global') { await page.locator('#taskKind').selectOption('global'); await page.locator('#taskDueDate').fill('2026-12-03'); await page.locator('#taskDueTime').fill('17:00'); }
    else {
      await expect(page.locator('#shiftPreview')).toContainText('смяна');
      if (kind === 'recurring') { await page.locator('#taskRepeat').selectOption('every-shift'); await page.locator('#taskUntil').fill('2026-12-05'); }
    }
    await assertResponsive(page, 'Delegated task editor ' + kind + '/' + language);
    await uploadPhoto(page, 'problem', expect); await page.locator('#saveTask').click(); await expect(page.locator('#taskEditor')).not.toBeVisible();
    await page.locator('[data-hub-language=bg]').click();
    await page.locator('[data-view=' + (kind === 'recurring' ? 'schedules' : kind) + ']').click();
    await expect(page.locator('#taskContent')).toContainText(title);
  }
  for (const kind of ['shift', 'global', 'recurring']) await assign(assigner, kind, 'Fictional delegated ' + kind + ' task');
  await expect(assigner.getByRole('button', {name: 'Спри повторението', exact: true})).toHaveCount(0);
  await assigner.locator('[data-view=global]').click();
  const global = hub.tasks.list(user).items.find(item => item.title === 'Fictional delegated global task');
  assert.equal(global.events[0].actor.id, user.id);
  hub.tasks.change(global.id, {solutionPhoto: photo, action: 'report', status: 'review', note: 'Fictional solution for review'}, 1, owner);
  await assigner.locator('#refreshTasks').click(); await expect(assigner.locator('#taskContent')).toContainText('Готова за проверка');
  for (const name of ['Промени', 'Отмени', 'Отчети', 'Добави напредък', 'Потвърди приключване', 'Върни за работа']) await expect(assigner.getByRole('button', {name, exact: true})).toHaveCount(0);
  const chief = await hub.auth.create('demo-assignment-chief', password, 'operator', null, {canAssignTasks: true}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const chiefPage = await device(chief.username, true); await chiefPage.goto(base + '/tasks.html');
  await assign(chiefPage, 'global', 'Fictional supervisor delegated task');
  await expect(chiefPage.locator('#ownerFilterLabel')).toBeVisible();
  await expect(chiefPage.getByRole('button', {name: 'Добави напредък', exact: true})).toHaveCount(0);
  await expect(chiefPage.locator('.task-count:visible')).toHaveCount(0);
  if (screenshotDir) {
    const fs = require('node:fs'), path = require('node:path'); fs.mkdirSync(screenshotDir, {recursive: true});
    await assigner.screenshot({path: path.join(screenshotDir, 'delegated-task-assignment-mobile.png'), fullPage: true});
    const entry = admin.locator('.account-entry').filter({hasText: user.username}); await entry.locator('summary').first().click();
    await entry.screenshot({path: path.join(screenshotDir, 'task-assignment-account.png')});
  }
  const entry = admin.locator('.account-entry').filter({hasText: user.username});
  if (!await entry.locator('form').isVisible()) await entry.locator('summary').first().click();
  const edit = entry.locator('form');
  await edit.locator('[data-permission=canViewTasks]').uncheck(); await edit.locator('[data-permission=canViewTasks]').check();
  await edit.locator('[data-permission=canAssignTasks]').uncheck(); await edit.locator('button[type=submit]').click();
  await expect(assigner).toHaveURL(base + '/login.html');
  await assigner.locator('#username').fill(user.username); await assigner.locator('#password').fill(password); await assigner.locator('#loginForm button').click();
  await expect(assigner).toHaveURL(base + '/index.html'); await assigner.goto(base + '/tasks.html');
  await expect(assigner.locator('#newTask')).toBeHidden();
  assert.equal((await assigner.request.get(base + '/api/tasks/preview?date=2026-12-01&assigneeId=' + owner.id)).status(), 403);
  await expect(assigner.locator('#taskContent')).toContainText('Fictional delegated shift task');
  console.log('PASS assignment flag, inherited viewing, BG/EN, shift/global/recurring creation, supervisor boundaries and revocation');
}
module.exports = {exerciseTaskAssignment};
