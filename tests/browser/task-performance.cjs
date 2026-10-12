/* Synthetic tasks/photos only; assert user-visible loading and current actions. */
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {photo} = require('../server/task-photo-fixture.cjs');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseTaskPerformance({admin: page, hub, base, expect, setTime}) {
  setTime('2026-10-12T10:00:00+03:00');
  const now = Date.parse('2026-10-12T10:00:00+03:00'), manager = hub.auth.list()[0];
  const ids = [], content = Buffer.from(photo, 'base64');
  const insert = hub.store.db.prepare('INSERT INTO task_items(id,data) VALUES(?,?)');
  const insertPhoto = hub.store.db.prepare('INSERT INTO task_photos(id,content,created_at) VALUES(?,?,?)');
  hub.store.transaction(() => {
    for (let i = 0; i < 60; i++) {
      const id = randomUUID(), photoId = randomUUID(); ids.push(id);
      insertPhoto.run(photoId, content, now);
      const item = {id, kind: 'global', title: 'Fictional image task ' + i, description: 'Generated loading fixture', priority: 'normal', requiresPhotos: true,
        owner: {id: manager.id, username: manager.username, team: 'А'}, participants: [], status: 'pending', due: now + 86400000 + i * 60000, createdAt: now,
        problemPhotos: [{id: photoId, at: now, bytes: content.length, width: 8, height: 8}], events: []};
      insert.run(id, JSON.stringify(item));
    }
    for (const day of ['2026-10-09', '2026-10-10', '2026-10-12']) {
      const due = Date.parse(day + 'T08:00:00+03:00');
      const item = {id: randomUUID(), kind: 'shift', title: 'Fictional review date ' + day, description: '', priority: 'normal', requiresPhotos: false,
        owner: {id: manager.id, username: manager.username, team: 'А'}, participants: [], status: 'cancelled', due, createdAt: due,
        shift: {date: day, code: 1, team: 'А', start: due - 8 * 3600000, due}, problemPhotos: [], events: []};
      insert.run(item.id, JSON.stringify(item));
    }
  });
  const requests = [];
  const track = request => { if (/\/api\/tasks\/items\/[^/]+\/photos\//.test(request.url())) requests.push(request.url()); };
  page.on('request', track);
  try {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto(base + '/tasks'); await page.locator('[data-hub-language=bg]').click();
    await page.locator('[data-view=history]').click(); await page.locator('[data-history-view=cancelled]').click();
    await expect(page.locator('.task-card h2')).toHaveText(['Fictional review date 2026-10-12', 'Fictional review date 2026-10-10']);
    await page.locator('#statsFrom').fill('2026-10-09'); await expect(page.locator('.task-card')).toHaveCount(3);
    await page.locator('#refreshTasks').click(); await expect(page.locator('#statsFrom')).toHaveValue('2026-10-09');
    // Calendar dates still span two days when daylight saving starts.
    setTime('2026-03-30T00:30:00+03:00'); await page.goto(base + '/tasks');
    await expect(page.locator('#statsFrom')).toHaveValue('2026-03-28'); await expect(page.locator('#statsUntil')).toHaveValue('2026-03-30');
    setTime('2026-10-12T10:00:00+03:00'); await page.goto(base + '/tasks'); await page.locator('[data-view=global]').click();
    const cards = page.locator('.task-card'), firstImage = cards.first().locator('img'), lastImage = cards.last().locator('img');
    await expect(cards).toHaveCount(50);
    await expect.poll(() => firstImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    assert.equal(await lastImage.getAttribute('src'), null, 'Distant evidence stays unloaded');
    assert.ok(requests.length < 10, 'Initial viewport does not fetch the whole page');
    await lastImage.scrollIntoViewIfNeeded();
    await expect.poll(() => lastImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.evaluate(() => { window.__retainedTaskCard = document.querySelector('.task-card'); });
    const reads = requests.length;
    const raw = JSON.parse(hub.store.db.prepare('SELECT data FROM task_items WHERE id=?').get(ids[49]).data);
    raw.title = 'Fictional changed image task';
    hub.store.db.prepare('UPDATE task_items SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(raw), ids[49]);
    await page.locator('#refreshTasks').click();
    await expect(cards.last().locator('h2')).toHaveText(raw.title);
    assert.equal(await page.evaluate(() => window.__retainedTaskCard === document.querySelector('.task-card')), true, 'Unchanged cards survive another task changing');
    // The changed card can reload its photo. Other loaded cards must keep theirs.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(requests.length <= reads + 1);
    await cards.last().getByRole('button', {name: 'История', exact: true}).click();
    await expect(page.locator('#historyContent h3')).toHaveText(raw.title); await page.locator('[data-close=taskHistory]').click();
    await page.locator('#taskPagination [data-page-action=next]').click(); await expect(cards).toHaveCount(10);
    await cards.last().locator('img').scrollIntoViewIfNeeded();
    await expect.poll(() => cards.last().locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await cards.last().getByRole('button', {name: 'Отвори снимката'}).click();
    await expect.poll(() => page.locator('#photoViewerImage').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.locator('[data-close=taskPhotoViewer]').click();
    await page.locator('#taskSearch').fill('Fictional image task 1'); await expect(cards).toHaveCount(11);
    for (const language of ['bg', 'en']) {
      await page.locator('[data-hub-language=' + language + ']').click();
      for (const width of [320, 390, 1440]) { await page.setViewportSize({width, height: 900}); await assertResponsive(page, 'Deferred task photos'); }
    }
    // Date boundaries must invalidate cached action controls even without edits.
    const shiftId = randomUUID();
    insert.run(shiftId, JSON.stringify({id: shiftId, kind: 'shift', title: 'Fictional boundary task', description: '', priority: 'normal', requiresPhotos: false,
      owner: {id: manager.id, username: manager.username, team: 'А'}, participants: [], status: 'pending', due: now + 60000, createdAt: now,
      shift: {date: '2026-10-12', code: 1, team: 'А', start: now - 3600000, due: now + 60000}, problemPhotos: [], events: []}));
    await page.locator('[data-hub-language=bg]').click(); await page.locator('#taskSearch').fill('Fictional boundary task');
    await page.locator('[data-view=shift]').click(); await page.locator('#refreshTasks').click();
    await expect(cards).toHaveCount(1); await expect(cards.getByRole('button', {name: 'Промени', exact: true})).toBeVisible();
    setTime('2026-10-12T10:01:00+03:00'); await page.locator('#refreshTasks').click();
    await expect(cards.getByRole('button', {name: 'Промени', exact: true})).toHaveCount(0);
    // A live update must preserve focus on a reused card opened by an exact link.
    await page.goto(base + '/tasks?target=' + ids[0]);
    const target = page.locator('.notification-target');
    await expect(target).toHaveAttribute('data-task-id', ids[0]); await expect(target).toBeFocused();
    const other = JSON.parse(hub.store.db.prepare('SELECT data FROM task_items WHERE id=?').get(ids[1]).data);
    other.title = 'Fictional updated neighbor';
    hub.store.db.prepare('UPDATE task_items SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(other), ids[1]);
    await page.evaluate(() => document.getElementById('refreshTasks').click());
    await expect(cards.filter({hasText: other.title})).toHaveCount(1); await expect(target).toBeFocused();
    await expect.poll(() => target.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    // Browsers without IntersectionObserver retain the native lazy-image fallback.
    await page.context().addInitScript(() => { window.IntersectionObserver = undefined; });
    await page.goto(base + '/tasks'); await page.locator('[data-view=global]').click(); await expect(cards).toHaveCount(50);
    await expect(cards.last().locator('img')).toHaveAttribute('src', /\/api\/tasks\//);
    console.log('PASS two-day review dates, manual history range, DST boundary, viewport-only photos, scroll/pages/viewer, retained cards, updated history, time boundaries, linked focus, fallback and BG/EN mobile layout');
  } finally { page.off('request', track); }
}
module.exports = {exerciseTaskPerformance};
