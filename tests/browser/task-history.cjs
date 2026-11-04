/* Fictional tasks in the browser runner's temporary SQLite database: tabs, groups, months and transitions. */
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {assertResponsive} = require('./responsive.cjs');
const {menuAction, taskCard, showMonth} = require('./task-ui.cjs');

async function exerciseTaskHistory({admin, hub, base, device, expect, setTime, screenshotDir}) {
  setTime('2026-12-01T10:00:00+02:00');
  const manager = hub.auth.list().find(user => user.username === 'demo-admin');
  const owner = await hub.auth.create('demo-history-chief', 'Fictional-password-123', 'operator', manager, {}, () => {}, {taskSupervisor: true, taskTeam: 'СТИКЕРИ'});
  const other = await hub.auth.create('demo-history-other', 'Fictional-password-123', 'operator', manager, {}, () => {}, {taskSupervisor: true, taskTeam: 'СТИКЕРИ'});
  const ids = {};
  let creationMinute = 0;
  function create(key, extra) {
    setTime(`2026-12-01T10:${String(creationMinute++).padStart(2, '0')}:00+02:00`);
    ids[key] = hub.tasks.create({requestId: randomUUID(), title: 'Fictional history ' + key, description: 'Fictional history detail', priority: 'normal', requiresPhotos: false,
      assigneeId: owner.id, participantIds: [], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', ...extra}, manager).id;
  }
  const item = key => hub.tasks.list(manager).items.find(value => value.id === ids[key]);
  function change(key, action, user = manager, status) { hub.tasks.change(ids[key], {action, status, note: 'Fictional history reason'}, item(key).revision, user); }
  create('approved', {dueDate: '2026-12-01', dueTime: '11:00'});
  create('completed', {kind: 'shift', repeat: 'once', from: '2026-12-01'});
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

  const titles = page => page.locator('.task-card h2');
  const names = keys => keys.map(key => 'Fictional history ' + key);
  const badge = (page, tab) => page.locator(`[data-view=${tab}] .task-badge`);
  async function open(page) { await page.goto(base + '/tasks'); await page.locator('[data-hub-language=bg]').click(); await expect(page.locator('.task-card').first()).toBeVisible(); }

  // Every state has exactly one place: open groups, completed and missed per month.
  await open(admin); await admin.locator('#ownerFilter').selectOption(String(owner.id));
  await expect(admin.locator('[data-view=open]')).toHaveAttribute('aria-pressed', 'true');
  await expect(admin.locator('#taskMonth')).toBeHidden();
  await expect(titles(admin)).toHaveText(names(['review', 'blocked', 'pending-global', 'pending-shift']));
  await expect(admin.locator('[data-task-group]')).toHaveText(['Чакат твоето потвърждение', 'Проблеми с краен срок', 'Пропуснат отчет']);
  await expect(badge(admin, 'open')).toHaveText('4'); await expect(badge(admin, 'missed')).toHaveText('3'); await expect(badge(admin, 'done')).toBeHidden();
  await admin.locator('[data-view=done]').click(); await expect(admin.locator('#monthLabel')).toHaveText('Декември 2026');
  await expect(titles(admin)).toHaveText(names(['completed', 'approved']));
  await admin.locator('[data-view=missed]').click(); await expect(titles(admin)).toHaveText(names(['cancelled', 'not-done', 'not-applicable']));
  await expect(taskCard(admin, 'Fictional history not-done')).toContainText('Закъснял отчет');
  await expect(taskCard(admin, 'Fictional history cancelled')).toContainText('Отменена');

  // A supervisor without review rights sees the review task with its deadline and has no filters.
  const chief = await device(owner.username, true); await open(chief);
  await expect(chief.locator('#ownerFilterLabel')).toBeHidden(); await expect(chief.locator('#taskSearchLabel')).toBeHidden();
  await expect(titles(chief)).toHaveText(names(['review', 'blocked', 'pending-global', 'pending-shift']));
  await expect(chief.locator('[data-task-group]')).toHaveText(['Проблеми с краен срок', 'Пропуснат отчет']);
  await expect(taskCard(chief, 'Fictional history review')).toContainText('Готово — чака потвърждение');
  await expect(taskCard(chief, 'Fictional history review').locator('[data-quick=ready]')).toHaveCount(0);
  await expect(chief.locator('#taskContent')).not.toContainText('Fictional history other-owner');
  await expect(taskCard(chief, 'Fictional history pending-shift').locator('.task-more summary')).toBeVisible();
  await taskCard(chief, 'Fictional history pending-shift').locator('.task-more summary').click();
  await expect(taskCard(chief, 'Fictional history pending-shift').locator('.task-menu-item')).toHaveText(['История']);
  await taskCard(chief, 'Fictional history pending-shift').locator('.task-more summary').click();

  // Return for work moves a review back to the deadline group.
  await admin.locator('[data-view=open]').click();
  await taskCard(admin, 'Fictional history review').getByRole('button', {name: 'Върни за работа', exact: true}).click();
  await admin.locator('#actionNote').fill('Fictional history return reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(admin.locator('[data-task-group]')).toHaveText(['Проблеми с краен срок', 'Пропуснат отчет']);
  // Reopening a completed shift returns it to the open list as a missing report.
  await admin.locator('[data-view=done]').click();
  await menuAction(taskCard(admin, 'Fictional history completed'), 'Отвори отново');
  await admin.locator('#actionNote').fill('Fictional history reopen reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(titles(admin)).toHaveText(names(['approved'])); await expect(badge(admin, 'open')).toHaveText('5');
  // One tap reports it again; a double tap still records a single report.
  await chief.locator('#refreshTasks').click();
  const reopened = taskCard(chief, 'Fictional history completed');
  await reopened.locator('[data-quick=done]').dblclick();
  await expect(chief.locator('#taskMessage')).toHaveText('Отчетено като изпълнена.'); await expect(reopened).toHaveCount(0);
  assert.equal(item('completed').events.filter(event => event.action === 'report').length, 2);
  await chief.locator('[data-view=done]').click(); await expect(titles(chief)).toHaveText(names(['completed', 'approved']));
  await expect(reopened).toContainText('Закъснял отчет');
  // Cancel and reopen through the card menu.
  await admin.locator('#refreshTasks').click(); await admin.locator('[data-view=open]').click();
  await menuAction(taskCard(admin, 'Fictional history pending-global'), 'Отмени задачата');
  await admin.locator('#actionNote').fill('Fictional history cancellation reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible(); await expect(badge(admin, 'missed')).toHaveText('4');
  await admin.locator('[data-view=missed]').click(); await menuAction(taskCard(admin, 'Fictional history cancelled'), 'Отвори отново');
  await admin.locator('#actionNote').fill('Fictional cancelled task reopen reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible(); await expect(badge(admin, 'missed')).toHaveText('3');
  await expect(admin.locator('[data-view=missed]')).toHaveAttribute('aria-pressed', 'true');

  // Search and owner filters, with a clear action when filters hide existing tasks.
  await admin.locator('[data-view=open]').click();
  await admin.locator('#taskSearch').fill('Fictional history blocked'); await expect(titles(admin)).toHaveText(names(['blocked']));
  await expect(badge(admin, 'open')).toHaveText('1'); await expect(badge(admin, 'missed')).toBeHidden();
  await admin.locator('[data-view=missed]').click();
  await expect(admin.locator('#taskContent')).toContainText('Няма задачи, които отговарят на търсенето или избрания отговорник.');
  await admin.locator('#taskContent').getByRole('button', {name: 'Изчисти филтрите'}).click();
  await expect(admin.locator('#taskSearch')).toHaveValue(''); await expect(titles(admin)).toHaveText(names(['pending-global', 'not-done', 'not-applicable']));
  await admin.locator('#ownerFilter').selectOption(String(other.id)); await admin.locator('[data-view=open]').click();
  await expect(titles(admin)).toHaveText(names(['other-owner']));
  await admin.locator('#ownerFilter').selectOption('');

  for (const width of [320, 390, 1440]) {
    await admin.setViewportSize({width, height: 900});
    for (const language of ['en', 'bg']) {
      await admin.locator(`[data-hub-language=${language}]`).click();
      await expect(admin.locator('[data-view=done] span').first()).toHaveText(language === 'en' ? 'Completed' : 'Изпълнени');
      for (const tab of ['open', 'done', 'missed']) { await admin.locator(`[data-view=${tab}]`).click(); await assertResponsive(admin, `Task tabs ${tab}/${language} at ${width}px`); }
    }
  }
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true});
    for (const tab of ['open', 'done', 'missed']) { await admin.locator(`[data-view=${tab}]`).click(); await admin.screenshot({path: path.join(screenshotDir, `tasks-${tab}-desktop.png`), fullPage: true}); }
    await chief.locator('[data-view=open]').click(); await chief.screenshot({path: path.join(screenshotDir, 'tasks-open-mobile.png'), fullPage: true});
  }

  // An open page follows the month until another month is chosen; old open tasks stay listed.
  setTime('2026-12-31T23:50:00+02:00'); await admin.goto(base + '/tasks'); await admin.locator('[data-view=done]').click();
  await expect(admin.locator('#monthLabel')).toHaveText('Декември 2026');
  setTime('2027-01-01T00:10:00+02:00'); await admin.locator('#refreshTasks').click();
  await expect(admin.locator('#monthLabel')).toHaveText('Януари 2027'); await expect(admin.locator('.task-card')).toHaveCount(0);
  await expect(admin.locator('#taskContent')).toContainText('Няма изпълнени задачи през този месец.');
  await showMonth(admin, 'Декември 2026'); await expect(titles(admin)).toHaveText(names(['completed', 'approved']));
  setTime('2027-01-02T10:00:00+02:00'); await admin.locator('#refreshTasks').click();
  await expect(admin.locator('#monthLabel')).toHaveText('Декември 2026');
  await admin.locator('[data-view=open]').click(); await expect(titles(admin)).toContainText(names(['other-owner']));
  await chief.context().close();
  console.log('PASS one place per state, open groups, monthly completed/missed, return/reopen/cancel, one-tap report with double tap, filters, month following and BG/EN layouts');
}
module.exports = {exerciseTaskHistory};
