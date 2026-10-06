/* All tasks and accounts here are fictional and run against an isolated SQLite database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseTasks({admin, hub, base, device, expect, setTime, screenshotDir}) {
  setTime('2026-12-01T15:00:00+02:00');
  await admin.goto(base + '/accounts.html');
  for (const username of ['demo-task-chief', 'demo-task-participant']) {
    await admin.locator('#newAccountButton').click(); await admin.locator('#accountUsername').fill(username);
    await admin.locator('#accountPassword').fill('Fictional-password-123'); await admin.locator('#accountRole').selectOption('operator');
    await expect(admin.locator('#accountForm [data-permission=canViewTasks]')).not.toBeChecked();
    await admin.locator('#accountForm [data-task-supervisor]').check(); await admin.locator('#accountForm [data-task-team]').selectOption('В');
    await expect(admin.locator('#accountForm [data-permission=canViewTasks]')).toBeChecked();
    await admin.locator('#accountForm button[type=submit]').click(); await expect(admin.locator('#accountList')).toContainText(username);
  }
  const chiefUser = hub.auth.list().find(user => user.username === 'demo-task-chief'), participantUser = hub.auth.list().find(user => user.username === 'demo-task-participant');
  const chief = await device(chiefUser.username, true), participant = await device(participantUser.username, true);
  await expect(chief.locator('a[href="tasks.html"]')).toBeVisible();
  await admin.goto(base + '/tasks.html'); await expect(admin.locator('#newTask')).toBeVisible();
  async function assign(title, {global = false, repeat = false} = {}) {
    await admin.locator('#newTask').click(); await admin.locator('#taskTitle').fill(title); await admin.locator('#taskDescription').fill('Fictional packing task detail');
    await admin.locator('#taskOwner').selectOption(String(chiefUser.id));
    if (global) {
      await admin.locator('#taskKind').selectOption('global'); await admin.locator('#taskDueDate').fill('2026-12-03'); await admin.locator('#taskDueTime').fill('17:00');
      await admin.locator(`#participantOptions input[value="${participantUser.id}"]`).check();
    } else if (repeat) { await admin.locator('#taskRepeat').selectOption('every-shift'); await admin.locator('#taskUntil').fill('2026-12-05'); }
    await admin.locator('#saveTask').click(); await expect(admin.locator('#taskEditor')).not.toBeVisible();
  }
  await assign('Fictional <b>shift check</b>');
  await chief.goto(base + '/tasks.html'); await expect(chief.locator('#taskContent')).toContainText('Fictional <b>shift check</b>');
  await expect(chief.locator('#taskContent b')).toHaveCount(0); await expect(chief.locator('#newTask')).toBeHidden();
  const shiftCard = chief.locator('.task-card').filter({hasText: 'Fictional <b>shift check</b>'});
  await shiftCard.getByRole('button', {name: 'Отчети', exact: true}).click(); await chief.locator('#actionForm button[type=submit]').click();
  await expect(chief.locator('#taskAction')).not.toBeVisible();
  await chief.locator('[data-view=history]').click(); await expect(chief.locator('#taskContent')).toContainText('Изпълнена');
  await assign('Fictional recurring check one', {repeat: true}); await assign('Fictional recurring check two', {repeat: true});
  await assign('Fictional global packing problem', {global: true});
  await chief.locator('[data-view=global]').click(); await chief.locator('#refreshTasks').click();
  await expect(chief.locator('#taskContent')).toContainText('Fictional global packing problem');
  await participant.goto(base + '/tasks.html'); await participant.locator('[data-view=global]').click();
  await expect(participant.getByRole('button', {name: 'Отчети', exact: true})).toHaveCount(0);
  await participant.getByRole('button', {name: 'Добави напредък', exact: true}).click();
  await participant.locator('#actionNote').fill('Fictional handover note'); await participant.locator('#actionForm button[type=submit]').click();
  await expect(participant.locator('#taskAction')).not.toBeVisible();
  await chief.locator('#refreshTasks').click(); await expect(chief.locator('#taskContent')).toContainText('Fictional handover note');
  await chief.getByRole('button', {name: 'Отчети', exact: true}).click(); await chief.locator('#reportStatus').selectOption('review');
  await chief.locator('#actionNote').fill('Fictional solution ready'); await chief.locator('#actionForm button[type=submit]').click();
  await expect(chief.locator('#taskAction')).not.toBeVisible();
  await admin.locator('[data-view=global]').click(); await admin.locator('#refreshTasks').click(); await expect(admin.locator('#taskContent')).toContainText('Готова за проверка');
  await admin.getByRole('button', {name: 'Върни за работа', exact: true}).click(); await admin.locator('#actionNote').fill('Fictional remaining step'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await chief.locator('#refreshTasks').click(); await expect(chief.locator('#taskContent')).toContainText('Fictional remaining step');
  await chief.getByRole('button', {name: 'Отчети', exact: true}).click(); await chief.locator('#reportStatus').selectOption('review'); await chief.locator('#actionNote').fill('Fictional final solution'); await chief.locator('#actionForm button[type=submit]').click();
  await expect(chief.locator('#taskAction')).not.toBeVisible(); await admin.locator('#refreshTasks').click();
  await admin.getByRole('button', {name: 'Потвърди приключване', exact: true}).click(); await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible();
  setTime('2026-12-01T22:31:00+02:00'); await admin.locator('[data-view=stats]').click(); await admin.locator('#refreshTasks').click();
  await admin.locator('#statsFrom').fill('2026-12-01'); await admin.locator('#statsUntil').fill('2026-12-05');
  const statsRow = admin.locator('.task-table tbody tr').filter({hasText: chiefUser.username});
  await expect(statsRow.locator('td')).toHaveText([chiefUser.username, '3', '1', '0', '2', '1', '0']);
  await chief.locator('[data-view=shift]').click(); await chief.locator('#refreshTasks').click();
  const recurringCard = chief.locator('.task-card').filter({hasText: 'Fictional recurring check one'}); await expect(recurringCard).toContainText('Неотчетена');
  await recurringCard.getByRole('button', {name: 'Отчети', exact: true}).click(); await chief.locator('#reportStatus').selectOption('not-done'); await chief.locator('#actionNote').fill('Fictional blocker explanation');
  // A network failure preserves the draft; a retry is recorded once.
  await chief.route('**/api/tasks/items/**', route => route.abort()); await chief.locator('#actionForm button[type=submit]').click();
  await expect(chief.locator('#actionFeedback')).not.toBeEmpty(); await expect(chief.locator('#actionNote')).toHaveValue('Fictional blocker explanation');
  await chief.unroute('**/api/tasks/items/**'); await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#taskAction')).not.toBeVisible();
  await chief.locator('[data-view=history]').click(); await expect(chief.locator('#taskContent')).toContainText('Закъснял отчет');
  await chief.reload(); await expect(chief.locator('#taskOverview')).toContainText('Неотчетени');
  await admin.locator('[data-view=schedules]').click(); await expect(admin.locator('#taskContent')).toContainText('Fictional recurring check one');
  await admin.locator('.task-card').filter({hasText: 'Fictional recurring check one'}).getByRole('button', {name: 'Спри повторението'}).click();
  await admin.locator('#actionNote').fill('Fictional stop reason'); await admin.locator('#actionForm button[type=submit]').click(); await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(admin.locator('#taskContent')).toContainText('Повторението е спряно');
  // A separate viewing permission grants an overview, without supervisor powers.
  await admin.goto(base + '/accounts.html'); await admin.locator('#newAccountButton').click();
  await admin.locator('#accountUsername').fill('demo-task-reader'); await admin.locator('#accountPassword').fill('Fictional-password-123');
  await admin.locator('#accountRole').selectOption('observer');
  await expect(admin.locator('#accountForm [data-permission=canViewTasks]')).not.toBeChecked();
  await expect(admin.locator('#accountForm [data-permission=canViewTasks]')).toBeEnabled();
  await admin.locator('#accountForm [data-permission=canViewTasks]').check(); await admin.locator('#accountForm button[type=submit]').click();
  await expect(admin.locator('#accountList')).toContainText('demo-task-reader');
  const readerUser = hub.auth.list().find(user => user.username === 'demo-task-reader'), reader = await device(readerUser.username, true);
  await expect(reader.locator('a[href="tasks.html"]')).toBeVisible(); await reader.goto(base + '/tasks.html');
  await expect(reader.locator('#taskSubtitle')).toContainText('Преглед на всички задачи');
  await expect(reader.locator('#newTask')).toBeHidden(); await expect(reader.locator('#ownerFilterLabel')).toBeVisible();
  await expect(reader.getByRole('button', {name: 'Отчети', exact: true})).toHaveCount(0);
  await expect(reader.getByRole('button', {name: 'Добави напредък', exact: true})).toHaveCount(0);
  await expect(reader.locator('#taskContent')).toContainText('Fictional recurring check two');
  await reader.locator('[data-view=history]').click(); await reader.locator('#statsUntil').fill('2026-12-05');
  await expect(reader.locator('#taskContent')).toContainText('Fictional global packing problem');
  const readerForm = admin.locator(`.account-card[data-id="${readerUser.id}"]`);
  await readerForm.locator('..').locator('summary').first().click();
  await admin.locator('[data-hub-language=en]').click(); await expect(readerForm.locator('[data-permission=canViewTasks]').locator('..')).toContainText('View Tasks');
  await admin.locator('[data-hub-language=bg]').click();
  await readerForm.locator('[data-permission=canViewTasks]').uncheck(); await readerForm.locator('button[type=submit]').click();
  await expect(reader).toHaveURL(base + '/login.html');
  await reader.locator('#username').fill(readerUser.username); await reader.locator('#password').fill('Fictional-password-123'); await reader.locator('#loginForm button').click();
  await expect(reader).toHaveURL(base + '/index.html'); await expect(reader.locator('a[href="tasks.html"]')).toBeHidden();
  assert.equal(await reader.evaluate(async () => (await fetch('/tasks.html')).status), 403);
  const chiefForm = admin.locator(`.account-card[data-id="${chiefUser.id}"]`);
  await chiefForm.locator('..').locator('summary').first().click();
  await chiefForm.locator('[data-permission=canViewTasks]').uncheck();
  await chiefForm.locator('[data-task-supervisor]').uncheck(); await chiefForm.locator('[data-task-supervisor]').check();
  await expect(chiefForm.locator('[data-permission=canViewTasks]')).not.toBeChecked();
  await chiefForm.locator('button').filter({hasText: 'Върни правата по роля'}).click();
  await expect(chiefForm.locator('[data-permission=canViewTasks]')).toBeChecked();
  for (const width of [320, 390, 1440]) {
    await admin.setViewportSize({width, height: 900});
    await assertResponsive(admin, `Task account permissions at ${width}px`);
  }
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true});
    await admin.setViewportSize({width: 1280, height: 1000});
    await chiefForm.screenshot({path: path.join(screenshotDir, 'accounts-task-access.png')});
  }
  await admin.goto(base + '/tasks.html');
  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({width, height: 900});
    for (const language of ['en', 'bg']) {
      await admin.locator(`[data-hub-language=${language}]`).click();
      for (const section of ['shift', 'global', 'history', 'stats', 'schedules']) { await admin.locator(`[data-view=${section}]`).click(); await assertResponsive(admin, `Tasks ${section}/${language} at ${width}px`); }
      await admin.locator('#newTask').click(); await assertResponsive(admin, `Task editor ${language} at ${width}px`);
      await admin.locator('[data-close=taskEditor]').first().click();
    }
  }
  await admin.locator('[data-hub-language=en]').click(); await expect(admin.locator('#newTask')).toHaveText('+ Assign task');
  await admin.locator('[data-view=history]').click(); await expect(admin.locator('#taskContent')).toContainText('Fictional <b>shift check</b>');
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true}); await admin.setViewportSize({width: 1440, height: 1000});
    await admin.locator('[data-hub-language=bg]').click(); await admin.locator('[data-view=stats]').click();
    await admin.screenshot({path: path.join(screenshotDir, 'tasks-admin-statistics.png'), fullPage: true});
    await chief.setViewportSize({width: 390, height: 844}); await chief.locator('[data-view=shift]').click();
    await chief.screenshot({path: path.join(screenshotDir, 'tasks-supervisor-mobile.png'), fullPage: true});
  }
  assert.equal(hub.tasks.list({role: 'admin'}).items.filter(item => item.report?.note === 'Fictional blocker explanation').length, 1);
}
module.exports = {exerciseTasks};
