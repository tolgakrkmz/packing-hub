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
  let creationMinute = 0;
  function create(key, extra) {
    setTime(`2026-12-01T10:${String(creationMinute++).padStart(2, '0')}:00+02:00`);
    ids[key] = hub.tasks.create({requestId: randomUUID(), title: 'Fictional history ' + key, description: 'Fictional history detail', priority: 'normal', requiresPhotos: false,
      assigneeId: owner.id, participantIds: [], kind: 'global', dueDate: '2026-12-03', dueTime: '17:00', ...extra}, manager).id;
  }
  function change(key, action, user = manager, status) {
    const item = hub.tasks.list(manager).items.find(item => item.id === ids[key]);
    hub.tasks.change(item.id, {action, status, note: 'Fictional history reason'}, item.revision, user);
  }
  create('approved', {dueDate: '2026-12-01', dueTime: '11:00'});
  create('completed', {kind: 'shift', repeat: 'once', from: '2026-12-01'});
  create('not-applicable', {kind: 'shift', repeat: 'once', from: '2026-12-01'});
  create('not-done', {kind: 'shift', repeat: 'once', from: '2026-12-02'});
  create('blocked', {});
  create('review', {dueDate: '2026-12-02', dueTime: '18:00'});
  create('pending-global', {dueTime: '18:00'});
  create('pending-shift', {kind: 'shift', repeat: 'once', from: '2026-12-02'});
  create('cancelled', {dueTime: '16:00'});
  create('cancelled-with-report', {kind: 'shift', repeat: 'once', from: '2026-12-01'});
  create('other-owner', {assigneeId: other.id});
  change('approved', 'report', owner, 'review'); change('approved', 'approve');
  for (const status of ['completed', 'not-applicable']) change(status, 'report', owner, status);
  change('blocked', 'report', owner, 'blocked'); change('review', 'report', owner, 'review');
  change('cancelled', 'cancel');
  change('cancelled-with-report', 'report', owner, 'not-done'); change('cancelled-with-report', 'cancel');
  setTime('2026-12-02T18:31:00+02:00');
  change('not-done', 'report', owner, 'not-done');

  const group = (page, key) => page.locator(`[data-history-group=${key}]`);
  const titles = (page, key) => group(page, key).locator('.task-card h2');
  const toggle = (page, key) => page.locator(`[data-history-view=${key}]`);
  const count = (page, key) => toggle(page, key).locator('.task-badge');
  async function choose(page, key) {
    await toggle(page, key).click();
    await expect(toggle(page, key)).toHaveAttribute('aria-pressed', 'true');
    await expect(group(page, key)).toBeVisible();
    await expect(page.locator('[data-history-group]')).toHaveCount(1);
    await expect(page.locator('[data-history-view][aria-pressed=true]')).toHaveCount(1);
  }
  async function open(page) {
    await page.goto(base + '/tasks'); await page.locator('[data-hub-language=bg]').click();
    await page.locator('[data-view=history]').click();
    await page.locator('#statsFrom').fill('2026-12-01'); await page.locator('#statsUntil').fill('2026-12-03');
  }
  await open(admin); await admin.locator('#ownerFilter').selectOption(String(owner.id));
  await expect(toggle(admin, 'reported')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(admin, 'unreported')).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle(admin, 'cancelled')).toHaveAttribute('aria-pressed', 'false');
  await expect(group(admin, 'unreported')).toHaveCount(0);
  // Assignment order differs from both deadline order and the last report time.
  const reportedTitles = ['review', 'blocked', 'not-done', 'not-applicable', 'completed', 'approved'].map(key => 'Fictional history ' + key);
  const unreportedTitles = ['pending-shift', 'pending-global'].map(key => 'Fictional history ' + key);
  const cancelledTitles = ['cancelled-with-report', 'cancelled'].map(key => 'Fictional history ' + key);
  await expect(titles(admin, 'reported')).toHaveText(reportedTitles);
  await toggle(admin, 'reported').focus(); await admin.keyboard.press('Tab');
  await expect(toggle(admin, 'unreported')).toBeFocused(); await admin.keyboard.press('Enter');
  await expect(toggle(admin, 'unreported')).toBeFocused();
  await expect(group(admin, 'reported')).toHaveCount(0);
  await expect(titles(admin, 'unreported')).toHaveText(unreportedTitles);
  await expect(count(admin, 'reported')).toHaveText('6'); await expect(count(admin, 'unreported')).toHaveText('2');
  await expect(count(admin, 'cancelled')).toHaveText('2');
  await expect(group(admin, 'unreported')).toContainText('Неотчетена'); await expect(group(admin, 'unreported')).not.toContainText('Отменена');
  await choose(admin, 'cancelled'); await expect(titles(admin, 'cancelled')).toHaveText(cancelledTitles);
  const chief = await device(owner.username, true); await open(chief);
  await expect(count(chief, 'reported')).toHaveText('6'); await expect(count(chief, 'unreported')).toHaveText('2');
  await expect(count(chief, 'cancelled')).toHaveText('2');
  await expect(titles(chief, 'reported')).toHaveText(reportedTitles);
  await choose(chief, 'unreported'); await expect(titles(chief, 'unreported')).toHaveText(unreportedTitles);
  await choose(chief, 'cancelled'); await expect(titles(chief, 'cancelled')).toHaveText(cancelledTitles);
  await expect(chief.locator('#taskContent')).not.toContainText('Fictional history other-owner');

  for (const width of [320, 390, 1440]) {
    await admin.setViewportSize({width, height: 900});
    for (const language of ['en', 'bg']) {
      await admin.locator(`[data-hub-language=${language}]`).click();
      await expect(toggle(admin, 'reported').locator('span').first()).toHaveText(language === 'en' ? 'Reported' : 'Отчетени');
      await expect(toggle(admin, 'unreported').locator('span').first()).toHaveText(language === 'en' ? 'Unreported' : 'Неотчетени');
      await expect(toggle(admin, 'cancelled').locator('span').first()).toHaveText(language === 'en' ? 'Cancelled' : 'Отменени');
      for (const key of ['unreported', 'reported', 'cancelled']) {
        await choose(admin, key); await assertResponsive(admin, `Task history ${key}/${language} at ${width}px`);
      }
    }
  }
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true});
    await choose(admin, 'reported');
    await admin.screenshot({path: path.join(screenshotDir, 'tasks-history-desktop.png'), fullPage: true});
    await choose(admin, 'unreported');
    await admin.screenshot({path: path.join(screenshotDir, 'tasks-history-unreported-desktop.png'), fullPage: true});
    await choose(admin, 'cancelled'); await admin.screenshot({path: path.join(screenshotDir, 'tasks-history-cancelled-desktop.png'), fullPage: true});
    await choose(chief, 'cancelled');
    await chief.screenshot({path: path.join(screenshotDir, 'tasks-history-mobile.png'), fullPage: true});
  }
  await choose(admin, 'reported');
  await admin.locator('#taskSearch').fill('Fictional history blocked');
  await expect(count(admin, 'reported')).toHaveText('1'); await expect(count(admin, 'unreported')).toHaveText('0');
  await choose(admin, 'unreported');
  await expect(group(admin, 'unreported')).toContainText('Няма неотчетени задачи по тези критерии.');
  await admin.locator('[data-hub-language=en]').click();
  await expect(group(admin, 'unreported')).toContainText('No unreported tasks match these filters.');
  await choose(admin, 'cancelled'); await expect(count(admin, 'cancelled')).toHaveText('0');
  await expect(group(admin, 'cancelled')).toContainText('No cancelled tasks match these filters.');
  await admin.locator('[data-hub-language=bg]').click(); await admin.locator('#taskSearch').fill('');
  await admin.locator('#taskSearch').fill('Fictional history cancelled');
  await expect(count(admin, 'reported')).toHaveText('0'); await expect(count(admin, 'unreported')).toHaveText('0');
  await expect(titles(admin, 'cancelled')).toHaveText(cancelledTitles); await admin.locator('#taskSearch').fill('');
  await admin.locator('#ownerFilter').selectOption(String(other.id));
  await expect(count(admin, 'reported')).toHaveText('0'); await expect(count(admin, 'unreported')).toHaveText('1');
  await expect(count(admin, 'cancelled')).toHaveText('0');
  await expect(group(admin, 'cancelled')).toContainText('Няма отменени задачи по тези критерии.');
  await choose(admin, 'unreported');
  await expect(titles(admin, 'unreported')).toHaveText(['Fictional history other-owner']);
  await choose(admin, 'reported');
  await expect(group(admin, 'reported')).toContainText('Няма отчетени задачи по тези критерии.');
  await admin.locator('#ownerFilter').selectOption(String(owner.id)); await admin.locator('#statsUntil').fill('2026-12-02');
  await expect(count(admin, 'reported')).toHaveText('5'); await expect(count(admin, 'unreported')).toHaveText('1');
  await expect(count(admin, 'cancelled')).toHaveText('1');
  await admin.locator('#statsFrom').fill('2026-12-03'); await expect(admin.locator('#taskContent')).toHaveText('Избери валиден период.');
  await admin.locator('#statsFrom').fill('2026-12-01'); await admin.locator('#statsUntil').fill('2026-12-03');
  await choose(admin, 'unreported'); await admin.locator('#refreshTasks').click();
  await expect(toggle(admin, 'unreported')).toHaveAttribute('aria-pressed', 'true');
  await expect(titles(admin, 'unreported')).toHaveText(unreportedTitles);
  await admin.locator('[data-view=global]').click(); await expect(toggle(admin, 'unreported')).toHaveCount(0);
  await admin.locator('[data-view=history]').click();
  await expect(toggle(admin, 'unreported')).toHaveAttribute('aria-pressed', 'true');
  await expect(group(admin, 'reported')).toHaveCount(0);
  await choose(admin, 'reported');

  await group(admin, 'reported').locator('.task-card').filter({hasText: 'Fictional history review'}).getByRole('button', {name: 'Върни за работа', exact: true}).click();
  await admin.locator('#actionNote').fill('Fictional history return reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(count(admin, 'reported')).toHaveText('5'); await expect(count(admin, 'unreported')).toHaveText('3');
  await expect(group(admin, 'reported')).not.toContainText('Fictional history review');
  await choose(admin, 'unreported');
  await expect(group(admin, 'unreported')).toContainText('Fictional history review');
  await choose(admin, 'reported');
  await group(admin, 'reported').locator('.task-card').filter({hasText: 'Fictional history completed'}).getByRole('button', {name: 'Отвори отново', exact: true}).click();
  await admin.locator('#actionNote').fill('Fictional history reopen reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(count(admin, 'reported')).toHaveText('4'); await expect(count(admin, 'unreported')).toHaveText('4');
  await choose(chief, 'unreported');
  await chief.locator('#refreshTasks').click();
  await expect(group(chief, 'unreported')).toContainText('Fictional history completed');
  await group(chief, 'unreported').locator('.task-card').filter({hasText: 'Fictional history completed'}).getByRole('button', {name: 'Отчети', exact: true}).click();
  await chief.locator('#actionForm button[type=submit]').click(); await expect(chief.locator('#taskAction')).not.toBeVisible();
  await expect(count(chief, 'reported')).toHaveText('5'); await expect(count(chief, 'unreported')).toHaveText('3');
  await expect(toggle(chief, 'unreported')).toHaveAttribute('aria-pressed', 'true');
  await expect(group(chief, 'unreported')).not.toContainText('Fictional history completed');
  await choose(chief, 'reported'); await expect(group(chief, 'reported')).toContainText('Fictional history completed');
  await admin.locator('#refreshTasks').click(); await choose(admin, 'unreported');
  await group(admin, 'unreported').locator('.task-card').filter({hasText: 'Fictional history pending-global'}).getByRole('button', {name: 'Отмени', exact: true}).click();
  await admin.locator('#actionNote').fill('Fictional history cancellation reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(count(admin, 'unreported')).toHaveText('2'); await expect(count(admin, 'cancelled')).toHaveText('3');
  await expect(group(admin, 'unreported')).not.toContainText('Fictional history pending-global');
  await choose(admin, 'cancelled'); await expect(titles(admin, 'cancelled')).toHaveText([...cancelledTitles, 'Fictional history pending-global']);
  await admin.locator('#refreshTasks').click(); await expect(toggle(admin, 'cancelled')).toHaveAttribute('aria-pressed', 'true');
  await group(admin, 'cancelled').locator('.task-card').filter({hasText: 'Fictional history cancelled-with-report'}).getByRole('button', {name: 'Отвори отново', exact: true}).click();
  await admin.locator('#actionNote').fill('Fictional cancelled task reopen reason'); await admin.locator('#actionForm button[type=submit]').click();
  await expect(admin.locator('#taskAction')).not.toBeVisible();
  await expect(count(admin, 'cancelled')).toHaveText('2'); await expect(count(admin, 'unreported')).toHaveText('3');
  await expect(group(admin, 'cancelled')).not.toContainText('Fictional history cancelled-with-report');
  await choose(admin, 'unreported'); await expect(titles(admin, 'unreported').first()).toHaveText('Fictional history cancelled-with-report');
  await chief.context().close();
  console.log('PASS task history buttons, selected group, keyboard focus, newest order, filters, report transitions and BG/EN layouts');
}
module.exports = {exerciseTaskHistory};
