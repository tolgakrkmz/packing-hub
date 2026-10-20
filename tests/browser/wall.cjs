/* Fictional wall content and a generated solid-colour photo only. */
const assert = require('node:assert/strict');
const {photo} = require('../server/task-photo-fixture.cjs');
const {assertResponsive} = require('./responsive.cjs');
async function exerciseWall({admin, hub, base, device, expect}) {
  await hub.auth.create('demo-wall-lead', 'Fictional-password-123', 'operator', null, {}, () => {}, {taskSupervisor: true, taskTeam: 'А'});
  await hub.auth.create('demo-wall-operator', 'Fictional-password-123', 'operator');
  const lead = await device('demo-wall-lead', true), operator = await device('demo-wall-operator');
  lead.on('dialog', dialog => dialog.accept());
  await expect(operator.locator('a.tile.wall')).toBeHidden();
  assert.equal((await operator.goto(base + '/wall')).status(), 403);
  // The admin posts with a photo; the shift lead sees the "new" badge until opening the wall.
  hub.store.db.prepare("UPDATE users SET permissions=json_patch(permissions,'{\"canViewWall\":true,\"canPostWall\":true}') WHERE username='demo-admin'").run();
  await admin.goto(base + '/wall'); await admin.locator('[data-hub-language=bg]').click();
  await admin.locator('#wallText').fill('Fictional pizza after the night shift');
  await admin.locator('#wallPhoto').setInputFiles({name: 'fictional-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo, 'base64')});
  await expect(admin.locator('#wallPhotoInfo')).toHaveText('Снимката е готова за запис.');
  await admin.getByRole('button', {name: 'Публикувай', exact: true}).click();
  await expect(admin.locator('#wallMessage')).toHaveText('Публикацията е добавена.');
  await expect(admin.locator('.wall-post .wall-photo img')).toBeVisible();
  await lead.goto(base + '/'); await expect(lead.locator('a.tile.wall')).toBeVisible();
  await expect(lead.locator('a.tile.wall .wall-new')).toHaveText('ново');
  await lead.locator('a.tile.wall').click(); await expect(lead).toHaveURL(base + '/wall');
  const post = lead.locator('.wall-post').first();
  await expect(post).toContainText('Fictional pizza after the night shift');
  await post.getByRole('button', {name: 'Бира: 0'}).click();
  await expect(post.getByRole('button', {name: 'Бира: 1'})).toHaveAttribute('aria-pressed', 'true');
  await post.getByRole('textbox', {name: 'Коментар'}).fill('Fictional cheers');
  await post.getByRole('button', {name: 'Изпрати', exact: true}).click();
  await expect(post.locator('.wall-comment')).toContainText('Fictional cheers');
  await expect(post.getByRole('button', {name: 'Изтрий публикацията'})).toHaveCount(0);
  await assertResponsive(lead, 'wall at 390 px');
  for (const width of [320, 768, 1440]) { await lead.setViewportSize({width, height: 900}); await assertResponsive(lead, 'wall at ' + width + ' px'); }
  await lead.locator('[data-hub-language=en]').click();
  await expect(lead.locator('h1')).toHaveText('Wall');
  await expect(lead.getByRole('button', {name: 'Post', exact: true})).toBeVisible();
  await lead.locator('[data-hub-language=bg]').click();
  await post.locator('.wall-comment').getByRole('button', {name: 'Изтрий коментара'}).click();
  await expect(post.locator('.wall-comment')).toHaveCount(0);
  admin.once('dialog', dialog => dialog.accept());
  await admin.reload(); await admin.locator('.wall-post').first().getByRole('button', {name: 'Изтрий публикацията'}).click();
  await expect(admin.locator('.wall-post')).toHaveCount(0);
  assert.equal(hub.store.db.prepare('SELECT count(*) AS n FROM wall_photos').get().n, 0);
  await lead.context().close(); await operator.context().close();
  console.log('PASS online wall posts, photo, reactions, comments and deletion');
}
module.exports = {exerciseWall};
