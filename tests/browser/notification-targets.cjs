/* Real navigation with fictional records, temporary accounts and local files. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('../server/import-fixture.cjs');
const {href} = require('../../js/notification-model.js');
const {assertResponsive} = require('./responsive.cjs');
const password = 'Fictional-password-123';
async function exerciseNotificationTargets({admin, hub, base, device, expect, setTime, screenshotDir}) {
  const actor = hub.auth.list().find(user => user.username === 'demo-admin');
  const imported = fixture(), staged = hub.imports.create(imported.payload, actor);
  imported.contents.forEach((content, index) => hub.imports.upload(staged.id, index, content, actor));
  hub.imports.apply(staged.id, hub.imports.preview(staged.id, actor).token, actor);
  const records = imported.payload.documents;
  async function opened(page, type, id) {
    await page.goto(base + href(type, id));
    const highlighted = page.locator('.notification-target');
    await expect(highlighted).toHaveCount(1); await expect(highlighted).toHaveAttribute('data-notification-target', id);
    await expect(highlighted).toBeVisible();
    await expect.poll(() => highlighted.evaluate(node => document.activeElement === node)).toBe(true);
    await assertResponsive(page, 'notification target ' + type);
    return highlighted;
  }
  // A month older than the default must expand without entering edit mode.
  await opened(admin, 'productionAdded', 'demo-legacy-production');
  await expect(admin.locator('.history-month[data-month="2026-10"]')).toHaveAttribute('open', '');
  await opened(admin, 'downtimeChanged', 'demo-legacy-downtime');
  await expect(admin.locator('#historyMonth')).toHaveValue('2026-10');
  await opened(admin, 'pairs', 'demo-legacy-pair');
  await expect(admin.locator('#contextDate')).toHaveValue('2026-10-04');
  await expect(admin.locator('#contextTeam')).toHaveValue('СТИКЕРИ');

  // A profile after the first fifty needs the matching page and open content.
  const original = records['package-instructions']['900202'], current = hub.store.get('package-instructions');
  const profiles = {...current.data, ...Object.fromEntries(Array.from({length: 55}, (_, i) => [String(910000+i), {
    number: String(910000+i), name: 'Fictional linked profile ' + i, client: 'Demo Client', folderName: 'demo-link-profile-' + i, timestamp: i+1, images: []
  }]))};
  hub.store.put('package-instructions', profiles, current.revision, actor); hub.notifications.sync();
  await opened(admin, 'instructions', original.folderName);
  await expect(admin.locator('.notification-target')).toHaveClass(/\bopen\b/);
  await expect(admin.locator('.notification-target .result-text')).toHaveText('Fictional imported instruction.');
  await expect(admin.locator('#profilePagination')).toContainText('2');

  setTime('2026-10-05T08:30:00+03:00');
  const chief = await hub.auth.create('demo-link-chief', password, 'operator', actor, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  const payload = title => ({requestId: crypto.randomUUID(), title, description: '', priority: 'normal', requiresPhotos: false, assigneeId: chief.id, participantIds: [], kind: 'global', dueDate: '2026-10-05', dueTime: '17:00'});
  const task = hub.tasks.create(payload('Fictional oldest linked task'), actor);
  for (let i = 0; i < 52; i++) { setTime(new Date(Date.parse('2026-10-05T08:31:00+03:00')+i*1000).toISOString()); hub.tasks.create({...payload('Fictional later task ' + i), dueDate: '2026-10-06'}, actor); }
  await opened(admin, 'taskDue', task.id);
  await expect(admin.locator('[data-view=history]')).toHaveAttribute('aria-pressed', 'true');
  await expect(admin.locator('#taskPagination')).toContainText('2');
  hub.tasks.change(task.id, {action: 'report', status: 'review', note: 'Fictional linked result'}, 1, chief);
  hub.tasks.change(task.id, {action: 'approve'}, 2, actor);
  await opened(admin, 'taskOutcome', task.id);
  await expect(admin.locator('[data-history-view=reported]')).toHaveAttribute('aria-pressed', 'true');
  const schedule = hub.tasks.create({...payload('Fictional linked recurring plan'), kind: 'shift', repeat: 'every-shift', from: '2026-10-05', until: '2026-10-10'}, actor);
  await opened(admin, 'taskChanged', schedule.id);
  await expect(admin.locator('[data-view=schedules]')).toHaveAttribute('aria-pressed', 'true');

  for (const [type, id] of Object.entries({systemDatabase:'databaseCard',systemDisk:'diskCard',systemBackup:'backupCard',systemUpdate:'updateCard',systemRecovery:'systemSummary'})) await opened(admin, type, id);

  const viewer = await hub.auth.create('demo-link-viewer', password, 'observer', actor, {canReceiveProductionAdded: true});
  const currentReports = hub.store.get('production-log');
  const report = {id: 'demo-link-mobile-report', date: '2026-09-05', shift: 'А', tonnage: 1000, brak: 0};
  hub.store.put('production-log', {...currentReports.data, entries: [...currentReports.data.entries, report]}, currentReports.revision, actor,'report',false,{reason:'Fictional historical report'}); hub.notifications.sync();
  const page = await device(viewer.username, true); await page.goto(base + '/notifications');
  const link = page.locator('.notification-open').first();
  await expect(link).toHaveAttribute('href', href('productionAdded', report.id));
  assert.ok(await link.evaluate(node => node.getBoundingClientRect().height >= 44));
  assert.notEqual(await link.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.locator('[data-hub-language=en]').click(); await expect(link).toHaveText('Open');
  await link.click(); await expect(page).toHaveURL(base + href('productionAdded', report.id));
  await expect(page.locator('.notification-target')).toHaveAttribute('data-notification-target', report.id);
  await expect(page.locator('.history-month[data-month="2026-09"]')).toHaveAttribute('open', '');
  await expect(page.locator('.notification-target .edit-report-btn')).toHaveCount(0);
  assert.equal(hub.notifications.list(viewer).count, 0);
  for (const width of [320,390,1440]) { await page.setViewportSize({width,height:844}); await assertResponsive(page, 'linked report at ' + width); }
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true}); await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(screenshotDir,'notification-linked-report.png'),fullPage:true});
  }
  const saved = hub.store.get('production-log');
  hub.store.put('production-log', {...saved.data, entries: saved.data.entries.filter(entry => entry.id !== report.id)}, saved.revision, actor, 'report', false, {action:'delete',reason:'Fictional deletion'});
  await page.reload(); await expect(page.locator('#notificationTargetMessage')).toContainText('deleted or is no longer available');
  await expect(page.locator('.notification-target')).toHaveCount(0);
  await page.locator('#notificationTargetMessage a').click(); await expect(page).toHaveURL(base + '/notifications');
  await opened(admin, 'productionAdded', 'demo-legacy-production');
  await admin.goto(base + '/production-log?target=' + encodeURIComponent('demo"/><script>bad</script>'));
  await expect(admin.locator('#notificationTargetMessage')).toBeVisible();
  assert.equal(await admin.locator('script').filter({hasText:'bad'}).count(), 0);
  await page.context().close();
  console.log('PASS notification buttons and exact links: reports, downtime, pairs, paged/open instructions, paged/closed tasks, recurring plans, system sections, read marking, missing records and mobile/BG/EN');
}
module.exports = {exerciseNotificationTargets};
