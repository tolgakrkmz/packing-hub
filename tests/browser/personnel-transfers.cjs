const assert=require('node:assert/strict');
const {assertResponsive}=require('./responsive.cjs');
const demo={schemaVersion:3,employees:[{id:'demo-transfer-browser',name:'Demo Transfer Browser',category:'auto',team:'А',role:'Опаковчик',active:true,note:''}],settings:{stickersStage1:4,stickersStage2:6},moveLog:[]};
async function exercisePersonnelTransfers({page,expect,read,replace,failNextWrite,setTime,capture=async()=>{}}){
  await replace(demo);await page.reload();await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  const edit=()=>page.locator('[data-edit-person="demo-transfer-browser"]').click();
  await edit();await page.locator('#personTeam').selectOption('Г');
  await expect(page.locator('#transferPanel')).toBeVisible();
  await page.locator('#transferEffectiveDate').fill('2026-10-20');await page.locator('#transferEffectiveDate').dispatchEvent('change');
  await expect(page.locator('#transferError')).toContainText('почивен ден');
  await expect(page.locator('#personForm button[type=submit]')).toBeDisabled();
  assert.equal((await read()).employees[0].transfers,undefined);
  await page.locator('#transferEffectiveDate').fill('2026-10-14');await page.locator('#transferEffectiveDate').dispatchEvent('change');
  await expect(page.locator('#transferRun')).toHaveText('6');
  await expect(page.locator('#personForm button[type=submit]')).toBeEnabled();
  await page.setViewportSize({width:390,height:844});await assertResponsive(page,'Planned personnel transfer');await capture('mobile');
  await page.locator('#personForm button[type=submit]').click();await expect(page.locator('#personModal')).not.toHaveClass(/open/);
  const stored=await read();assert.equal(stored.schemaVersion,4);assert.equal(stored.employees[0].team,'А');
  assert.deepEqual(stored.employees[0].transfers,[{effectiveDate:'2026-10-14',category:'auto',team:'Г'}]);
  await page.reload();await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await expect(page.locator('.person-row').filter({hasText:demo.employees[0].name})).toContainText('Планирано');
  await page.locator('#todayDate').fill('2026-10-13');await page.locator('#todayDate').dispatchEvent('change');
  await expect(page.locator('.today-card[data-team="А"] .names')).toContainText(demo.employees[0].name);
  await expect(page.locator('.today-card[data-team="Г"] .names')).not.toContainText(demo.employees[0].name);
  await page.locator('#todayDate').fill('2026-10-14');await page.locator('#todayDate').dispatchEvent('change');
  await expect(page.locator('.today-card[data-team="Г"] .names')).toContainText(demo.employees[0].name);
  await edit();await page.locator('#personCategory').selectOption('stickers');
  await page.locator('#transferEffectiveDate').fill('2026-10-16');await page.locator('#transferEffectiveDate').dispatchEvent('change');
  await expect(page.locator('#transferDays tr').filter({hasText:'16.10.2026'}).locator('td').nth(2)).toHaveText('09:00–17:30');
  await page.locator('#personForm button[type=submit]').click();await expect(page.locator('#personModal')).not.toHaveClass(/open/);
  assert.deepEqual((await read()).employees[0].transfers,[{effectiveDate:'2026-10-16',category:'stickers',team:'1 смяна'}]);
  await edit();await page.locator('#cancelTransferPlan').click();await page.locator('#personForm button[type=submit]').click();
  await expect(page.locator('#personModal')).not.toHaveClass(/open/);assert.deepEqual((await read()).employees[0].transfers,[]);
  await edit();await page.locator('#personTeam').selectOption('Г');
  await page.locator('#transferSearchStart').fill('2026-12-01');await page.locator('#transferSearchStart').dispatchEvent('change');
  await page.locator('#personForm button[type=submit]').click();await expect(page.locator('#personModal')).not.toHaveClass(/open/);
  const distantPlan=(await read()).employees[0].transfers;
  await page.reload();await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);await edit();
  await expect(page.locator('#personForm button[type=submit]')).toBeEnabled();
  await page.locator('#personNote').fill('Demo unrelated edit');await page.locator('#personForm button[type=submit]').click();
  await expect(page.locator('#personModal')).not.toHaveClass(/open/);assert.deepEqual((await read()).employees[0].transfers,distantPlan);
  await edit();await page.locator('#cancelTransferPlan').click();await page.locator('#personForm button[type=submit]').click();await expect(page.locator('#personModal')).not.toHaveClass(/open/);
  await edit();await page.locator('#personTeam').selectOption('Г');
  await page.locator('#transferEffectiveDate').fill('2026-10-14');await page.locator('#transferEffectiveDate').dispatchEvent('change');
  await failNextWrite();await page.locator('#personForm button[type=submit]').click();
  await expect(page.locator('#personError')).not.toBeEmpty();await expect(page.locator('#personModal')).toHaveClass(/open/);
  await expect(page.locator('#transferEffectiveDate')).toHaveValue('2026-10-14');assert.deepEqual((await read()).employees[0].transfers,[]);
  await page.locator('#personModal [data-close-modal]').first().click();
  await page.locator('[data-hub-language=en]').click();await edit();await page.locator('#personTeam').selectOption('Г');
  await expect(page.locator('#transferPanel h4')).toHaveText('Planned transfer');
  await expect(page.locator('#transferRules')).toContainText('6 consecutive');
  await assertResponsive(page,'English planned transfer');
  await page.setViewportSize({width:1440,height:1000});await assertResponsive(page,'Desktop planned transfer');await capture('desktop');
  await page.locator('#personModal [data-close-modal]').first().click();
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-hub-language=bg]').click();
  await edit();await page.locator('#personNote').fill('Demo conflicting draft');
  const concurrent=await read();concurrent.employees[0].note='Demo concurrent edit';await replace(concurrent);
  await page.locator('#personForm button[type=submit]').click();
  await expect(page.locator('#personError')).not.toBeEmpty();await expect(page.locator('#personNote')).toHaveValue('Demo conflicting draft');
  assert.equal((await read()).employees[0].note,'Demo concurrent edit');
  await page.keyboard.press('Escape');await expect(page.locator('#personModal')).not.toHaveClass(/open/);
  await page.reload();await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);
  await edit();await page.locator('#personTeam').selectOption('Г');
  await page.locator('#transferEffectiveDate').fill('2026-10-14');await page.locator('#transferEffectiveDate').dispatchEvent('change');
  const beforeSubmit=await read();
  await page.evaluate(()=>{const form=document.getElementById('personForm');form.requestSubmit();form.requestSubmit();});
  await expect(page.locator('#personModal')).not.toHaveClass(/open/);
  assert.equal((await read()).moveLog.length,beforeSubmit.moveLog.length+1);
  const beforeActivation=await read();await edit();
  // Modal keyboard focus stays inside the form; a day change keeps its draft.
  await page.locator('#personModal [data-close-modal]').first().focus();await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#personForm button[type=submit]')).toBeFocused();
  await page.locator('#cancelTransferPlan').click();
  await setTime('2026-10-14T12:00:00+03:00');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#transferEffectiveDate')).toHaveValue('2026-10-14');
  await page.evaluate(()=>document.getElementById('personForm').requestSubmit());
  await expect(page.locator('#personModal')).toHaveClass(/open/);
  await expect(page.locator('#transferError')).toContainText('вече е в сила');
  assert.deepEqual(await read(),beforeActivation);
  await page.keyboard.press('Escape');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await edit();await expect(page.locator('#transferCurrent')).toContainText('Г');
  await expect(page.locator('#cancelTransferPlan')).toBeHidden();
  await page.keyboard.press('Escape');assert.deepEqual(await read(),beforeActivation);

}
module.exports={exercisePersonnelTransfers};

async function exerciseTransferConsumers({page,expect,go,connect,setTime,replaceSources}){
  await setTime('2026-10-13T12:00:00+03:00');
  const sources=require('./statistics-period.cjs').statisticsFixture();
  sources.personnel.schemaVersion=4;sources['pair-targets'].entries=[];
  sources['production-log'].entries.push({id:'demo-transfer-production',date:'2026-10-14',shift:'Г',tonnage:1000,brak:0,breakdown:{autoKg:1000,autoCrates:40,manKg:0,manCrates:0}});
  sources.personnel.employees=[
    {...demo.employees[0],transfers:[{effectiveDate:'2026-10-14',category:'auto',team:'Г'}]},
    {...demo.employees[0],id:'demo-transfer-pair-two',name:'Demo Transfer Pair Two',transfers:[{effectiveDate:'2026-10-14',category:'auto',team:'Г'}]},
    {...demo.employees[0],id:'demo-transfer-stickers',name:'Demo Transfer Stickers',transfers:[{effectiveDate:'2026-10-16',category:'stickers',team:'1 смяна'}]}
  ];
  await replaceSources(sources);await page.locator('[data-hub-language=bg]').click();await go('pair-targets');
  await connect('#pairsOpenFileBtn','pair-targets.json','#pairsConnDot');await connect('#rosterOpenFileBtn','personnel.json','#rosterConnDot');
  await page.locator('#contextDate').fill('2026-10-13');await page.locator('#contextDate').dispatchEvent('change');await page.locator('#contextShift').selectOption('3');
  await expect(page.locator('#contextTeam')).toHaveValue('А');await expect(page.locator('#rosterList')).toContainText(demo.employees[0].name);
  await page.locator('#contextDate').fill('2026-10-14');await page.locator('#contextDate').dispatchEvent('change');await page.locator('#contextShift').selectOption('1');
  await expect(page.locator('#contextTeam')).toHaveValue('Г');await page.locator('#addPairBtn').click();
  await page.locator('#memberOne').selectOption(demo.employees[0].id);await page.locator('#memberTwo').selectOption('demo-transfer-pair-two');
  await page.locator('#targetKg').fill('1000');await page.locator('#targetCrates').fill('40');await page.locator('#areaAuto').check();
  await page.locator('#savePairBtn').click();await expect(page.locator('#pairDialog')).not.toBeVisible();await expect(page.locator('#pairsList')).toContainText(demo.employees[0].name);
  // Sofia crosses midnight while the browser's UTC date is unchanged.
  await setTime('2026-10-15T20:00:00Z');await go('statistics');await page.locator('#statsFilesBtn').click();
  await connect('#openFileBtn','production-log.json','#connDot');await connect('#avOpenFileBtn','line-downtime.json','#avConnDot');
  await connect('#personnelOpenFileBtn','personnel.json','#personnelConnDot');
  await page.locator('[data-stats-tab=workforce]').click();await expect(page.locator('#wfCurrentStaff')).toHaveText('3');await expect(page.locator('#wfStickersCount')).toHaveText('0 души');
  await setTime('2026-10-15T22:00:00Z');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#wfCurrentStaff')).toHaveText('2');await expect(page.locator('#wfStickersCount')).toHaveText('1 души');
  await go('personnel');await expect(page.locator('#connDot')).toHaveClass(/\bon\b/);await page.locator('[data-edit-person="demo-transfer-stickers"]').click();
  await page.locator('#personCategory').selectOption('auto');await page.locator('#personTeam').selectOption('Г');
  await page.locator('#transferEffectiveDate').fill('2026-10-17');await page.locator('#transferEffectiveDate').dispatchEvent('change');
  await expect(page.locator('#transferDays tr').filter({hasText:'16.10.2026'}).locator('td').nth(1)).toHaveText('09:00–17:30');
  await page.keyboard.press('Escape');
}
module.exports.exerciseTransferConsumers=exerciseTransferConsumers;
