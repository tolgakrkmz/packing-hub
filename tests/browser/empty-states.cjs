/* Empty, zero, filtered and failed states. Every record here is fictional and lives in a temporary database. */
const {assertResponsive} = require('./responsive.cjs');

async function exerciseEmptyStates({admin, hub, base, device, expect, createObserver, setTime}) {
  console.log('RUN empty data, real zero results, filters without matches, API failure and permissions');
  const replace = (kind, data) => hub.store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(data), kind);
  const original = Object.fromEntries(['production-log', 'package-instructions'].map(kind => [kind, hub.store.get(kind).data]));
  replace('production-log', {entries:[], goalTons:3000});
  replace('package-instructions', {});

  const refreshProduction = async () => {
    await admin.locator('#statsFilesBtn').click(); await admin.locator('#refreshBtn').click(); await admin.locator('#statsFilesBtn').click();
  };
  await admin.goto(base + '/statistics');
  await admin.locator('[data-stats-tab=production]').click();
  await expect(admin.locator('#productionEmpty')).toBeVisible();
  await expect(admin.locator('#productionEmptyText')).toHaveText('Няма тонажни отчети за избраната година.');
  await expect(admin.locator('#productionBody')).toBeHidden();
  await expect(admin.locator('#productionAddLink')).toBeVisible();
  await expect(admin.locator('#productionConnectBtn')).toBeHidden();
  await admin.locator('[data-view=year]').click();
  await expect(admin.locator('#productionEmptyText')).toHaveText('Още няма тонажни отчети.');
  await admin.locator('[data-view=month]').click();
  // A saved report with zero tonnes is a result, not missing data.
  replace('production-log', {entries:[{id:'demo-empty-zero', date:'2026-10-04', shift:'А', tonnage:0, brak:0, breakdown:null}], goalTons:3000});
  await admin.locator('#yearSelect').selectOption('2026');
  await refreshProduction();
  await expect(admin.locator('#productionBody')).toBeVisible();
  await expect(admin.locator('#productionEmpty')).toBeHidden();
  await expect(admin.locator('#kpiRow .val').first()).toHaveText('0 т');
  await expect(admin.locator('#tableContainer .stats-table')).toHaveCount(1);
  replace('production-log', {entries:[], goalTons:3000});
  await refreshProduction();
  await expect(admin.locator('#productionEmpty')).toBeVisible();
  await admin.locator('[data-hub-language=en]').click();
  await expect(admin.locator('#productionEmptyText')).toHaveText('No production reports for the selected year.');
  await expect(admin.locator('#productionAddLink')).toHaveText('Enter a production report');
  await admin.locator('[data-hub-language=bg]').click();

  const observer = await createObserver('demo-empty-observer', {canViewTasks:true, canViewInstructions:true, canViewStatistics:true});
  await observer.goto(base + '/statistics');
  await observer.locator('[data-stats-tab=production]').click();
  await expect(observer.locator('#productionEmpty')).toBeVisible();
  await expect(observer.locator('#productionAddLink')).toBeHidden();

  // Tasks: empty database, filter without matches and a failed refresh with retained data.
  setTime('2026-12-01T15:00:00+02:00');
  const actor = hub.auth.list().find(user => user.username === 'demo-admin');
  const chief = await hub.auth.create('demo-empty-chief', 'Fictional-password-123', 'operator', actor, {}, () => {}, {taskSupervisor:true, taskTeam:'В'});
  await admin.goto(base + '/tasks');
  const content = admin.locator('#taskContent');
  await expect(content.locator('.task-empty')).toContainText('Няма активни сменни задачи.');
  await expect(content.getByRole('button', {name:'+ Възложи задача'})).toBeVisible();
  await admin.locator('[data-view=global]').click();
  await expect(content.locator('.task-empty')).toContainText('Няма активни глобални задачи.');
  await admin.locator('#taskSearch').fill('fictional-no-match');
  await expect(content.locator('.task-empty')).toContainText('Няма активни глобални задачи.');
  await expect(content.getByRole('button', {name:'Изчисти филтрите'})).toHaveCount(0);
  await admin.locator('#taskSearch').fill('');
  await admin.locator('#newTask').click();
  await admin.locator('#taskTitle').fill('Fictional empty-state task');
  await admin.locator('#taskDescription').fill('Fictional detail');
  await admin.locator('#taskOwner').selectOption(String(chief.id));
  await admin.locator('#taskKind').selectOption('global');
  await admin.locator('#taskDueDate').fill('2026-12-03'); await admin.locator('#taskDueTime').fill('17:00');
  await admin.locator('#taskRequiresPhotos').uncheck();
  await admin.locator('#saveTask').click();
  await expect(admin.locator('#taskEditor')).not.toBeVisible();
  await expect(content).toContainText('Fictional empty-state task');
  await admin.locator('#taskSearch').fill('fictional-no-match');
  await expect(content.locator('.task-empty')).toContainText('Няма задачи, които отговарят на търсенето или избрания отговорник.');
  await content.getByRole('button', {name:'Изчисти филтрите'}).click();
  await expect(admin.locator('#taskSearch')).toHaveValue('');
  await expect(content).toContainText('Fictional empty-state task');
  await admin.route('**/api/tasks', route => route.fulfill({status:503, contentType:'application/json', body:JSON.stringify({error:'UNAVAILABLE'})}));
  await admin.locator('#refreshTasks').click();
  await expect(admin.locator('#taskMessage')).toContainText('Показани са последно заредените данни.');
  await expect(content).toContainText('Fictional empty-state task');
  await admin.unroute('**/api/tasks');
  await admin.locator('#taskMessage').getByRole('button', {name:'Опитай отново'}).click();
  await expect(admin.locator('#taskMessage')).toHaveText('');
  await admin.route('**/api/tasks', route => route.fulfill({status:503, contentType:'application/json', body:JSON.stringify({error:'UNAVAILABLE'})}));
  await admin.reload();
  await expect(content.locator('.task-empty')).toContainText('Задачите не могат да се заредят.');
  await admin.unroute('**/api/tasks');
  await content.getByRole('button', {name:'Опитай отново'}).click();
  await expect(content.locator('.task-card')).toHaveCount(0);
  await expect(content.locator('.task-empty')).toContainText('Няма активни сменни задачи.');
  await admin.locator('[data-hub-language=en]').click();
  await expect(content.locator('.task-empty')).toContainText('No active shift tasks.');
  await admin.locator('[data-hub-language=bg]').click();
  await observer.goto(base + '/tasks');
  await expect(observer.locator('#taskContent .task-empty')).toContainText('Няма активни сменни задачи.');
  await expect(observer.getByRole('button', {name:'+ Възложи задача'})).toHaveCount(0);
  hub.store.db.exec('DELETE FROM task_items; DELETE FROM task_schedules;');

  // Instructions: empty project versus search without matches.
  await admin.goto(base + '/package-instructions');
  const results = admin.locator('#resultsWrap');
  await expect(results).toContainText('Още няма профили с инструкции.');
  await expect(results.getByRole('button', {name:'Нов профил'})).toBeVisible();
  await observer.goto(base + '/package-instructions');
  await expect(observer.locator('#resultsWrap')).toContainText('Профилите се добавят от акаунт с право за управление на инструкциите.');
  await expect(observer.locator('#resultsWrap button')).toHaveCount(0);
  replace('package-instructions', {'000001':{number:'000001', name:'000001', client:'Fictional Empty Client', category:'standard', folderName:'Fictional Empty Client/000001', images:[], timestamp:0}});
  await admin.reload();
  await expect(results).toContainText('Fictional Empty Client');
  await admin.locator('#searchInput').fill('fictional-no-match');
  await expect(results).toContainText('Няма профили, които отговарят на търсенето или избраната категория.');
  await results.getByRole('button', {name:'Изчисти филтрите'}).click();
  await expect(admin.locator('#searchInput')).toHaveValue('');
  await expect(results).toContainText('Fictional Empty Client');

  for (const page of [admin, observer]) for (const width of [390, 1440]) {
    await page.setViewportSize({width, height:900});
    await assertResponsive(page, `Empty states ${width}`);
  }
  await admin.setViewportSize({width:390, height:900});
  for (const path of ['/statistics', '/tasks']) {
    await admin.goto(base + path);
    await assertResponsive(admin, `Empty states phone ${path}`);
  }
  await admin.setViewportSize({width:1440, height:900});
  for (const [kind, data] of Object.entries(original)) replace(kind, data);
  await observer.context().close();
  console.log('PASS empty data, real zero results, filters without matches, API failure and permissions');
}

module.exports = {exerciseEmptyStates};
