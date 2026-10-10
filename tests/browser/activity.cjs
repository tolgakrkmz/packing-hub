const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');
const {openAdminModule} = require('./admin-panel.cjs');
async function exerciseActivity({admin,hub,base,device,expect,screenshotDir}) {
  const operator = await hub.auth.create('demo-activity-operator','Fictional-password-123','operator');
  const inactive = await hub.auth.create('demo-activity-inactive','Fictional-password-123','observer');
  const unused = await hub.auth.create('demo-activity-unused','Fictional-password-123','observer');
  const user = hub.auth.list().find(user => user.username === 'demo-admin');
  const page = await device(operator.username,true);
  await expect(page.locator('.server-links a[href="/activity-log.html"]')).toHaveCount(0);
  await page.goto(base+'/production-log.html');
  await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await page.goto(base+'/pair-targets.html');
  await expect(page.locator('#pairsConnDot')).toHaveClass(/\bon\b/);
  const lastVisit = hub.store.db.prepare("SELECT at FROM audit WHERE user_id=? AND action='visit' ORDER BY id DESC LIMIT 1").get(operator.id).at;
  await page.locator('.server-logout').click(); await expect(page).toHaveURL(base+'/login.html');
  // Known fictional metadata lets the UI exercise more than one page and an old period.
  for (let i=0;i<58;i++) hub.store.audit(operator,'export','production-log');
  const old = Date.now()-100*86400000;
  hub.store.db.prepare("INSERT INTO audit(at,user_id,action,module) VALUES(?,?,'visit','statistics')").run(old,inactive.id);
  await hub.auth.remove(inactive.id,user);
  await openAdminModule(admin,'activity-log');
  await expect(admin.locator('h1')).toHaveText('Потребителска активност');
  await expect(admin.locator('#activityEvents .activity-event')).toHaveCount(50);
  await admin.locator('#activityUser').selectOption(String(operator.id));
  await expect(admin.locator('#activityUsers .activity-user')).toHaveCount(1);
  await expect(admin.locator('#activityUsers strong')).toHaveText(operator.username);
  await expect(admin.locator('#activityUsers p')).toHaveText('Двойки и таргети');
  assert.equal(await admin.locator('#activityUsers time').getAttribute('datetime'),new Date(lastVisit).toISOString());
  await admin.locator('#moreActivity').click();
  await expect(admin.locator('#activityEvents .activity-event')).toHaveCount(63);
  await expect(admin.locator('#moreActivity')).toBeHidden();
  await admin.locator('#activityAction').selectOption('visit');
  await expect(admin.locator('#activityEvents .activity-event')).toHaveCount(3);
  await admin.locator('#activityAction').selectOption('logout');
  await expect(admin.locator('#activityEvents .activity-event')).toHaveCount(1);
  await expect(admin.locator('#activityEvents')).toContainText('Изход от акаунта');
  await admin.locator('#activityUser').selectOption(String(unused.id));
  await expect(admin.locator('#activityEmpty')).toBeVisible();
  await expect(admin.locator('#activityUsers')).toContainText('Няма записано посещение');
  await admin.locator('#activityAction').selectOption('all');
  await admin.locator('#activityUser').selectOption(String(inactive.id));
  await expect(admin.locator('#activityEmpty')).toBeVisible();
  await expect(admin.locator('#activityUsers')).toContainText('Изтрит акаунт');
  await admin.locator('#activityPeriod').selectOption('all');
  await expect(admin.locator('#activityEvents .activity-event')).toHaveCount(1);
  const failed = route => route.abort();
  await admin.route('**/api/admin/activity?*',failed);
  await admin.locator('#refreshActivity').click();
  await expect(admin.locator('#activityMessage')).not.toBeEmpty();
  await expect(admin.locator('#activityEvents .activity-event')).toHaveCount(1);
  await expect(admin.locator('#refreshActivity')).toBeEnabled();
  await admin.unroute('**/api/admin/activity?*',failed);
  await admin.locator('#refreshActivity').click();
  await expect(admin.locator('#activityMessage')).toBeEmpty();
  await admin.locator('#activityUser').selectOption('');
  await admin.locator('#activityAction').selectOption('visit');
  await expect(admin.locator('#activityEvents .activity-event')).toHaveCount(7);
  for (const language of ['bg','en']) {
    await admin.locator('[data-hub-language='+language+']').click();
    await expect(admin.locator('h1')).toHaveText(language === 'en' ? 'User activity' : 'Потребителска активност');
    await expect(admin.locator('#activityUsers')).toContainText(operator.username);
    for (const width of [320,390,768,1440]) {
      await admin.setViewportSize({width,height:900});
      await assertResponsive(admin,'Activity '+language+' at '+width+'px');
      if (screenshotDir && [390,1440].includes(width)) {
        require('node:fs').mkdirSync(screenshotDir,{recursive:true});
        await admin.screenshot({path:require('node:path').join(screenshotDir,'activity-'+language+'-'+width+'.png'),fullPage:width === 1440});
      }
    }
  }
  await admin.locator('[data-hub-language=bg]').click();
  await admin.reload();
  await expect(admin.locator('#activityUsers')).toContainText(operator.username);
  for (const role of ['operator','observer']) {
    const username = 'demo-activity-denied-'+role;
    await hub.auth.create(username,'Fictional-password-123',role);
    const denied = await device(username);
    const response = await denied.goto(base+'/activity-log.html'); assert.equal(response.status(),403);
    const status = await denied.context().request.get(base+'/api/admin/activity'); assert.equal(status.status(),403);
    await denied.context().close();
  }
  await page.context().close();
  console.log('PASS admin activity, visits, logout, last visits, filters, pagination, recovery, permissions and BG/EN responsive layouts');
}
module.exports = {exerciseActivity};
