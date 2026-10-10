const test = require('node:test');
const assert = require('node:assert/strict');
const {environment} = require('./report-write-environment.cjs');

const historyIds = env => [...env.controls.historyWrap.innerHTML.matchAll(/data-id="([^"]+)"/g)].map(match => match[1]);
const ids = [
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '00000000-0000-4000-8000-000000000001',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
];

for(const fallback of [false,true]) {
  test(`downtime history: latest entry is first within its day (${fallback ? 'browser storage' : 'file'})`,async () => {
    const env = await environment('line-downtime',{fallback});
    let nextId = 0;
    env.sandbox.crypto = {randomUUID:() => ids[nextId++]};
    for(const [date,start,end] of [
      ['2026-10-05','23:50','00:10'],
      ['2026-10-06','12:00','12:30'],
      ['2026-10-05','08:00','08:15'],
      ['2026-09-30','10:00','10:20']
    ]) {
      await env.draft();
      env.controls.dateInput.value = date;
      env.controls.startInput.value = start;
      env.controls.endInput.value = end;
      await env.save();
    }
    assert.deepEqual(historyIds(env),[ids[1],ids[2],ids[0]]);
    assert.deepEqual(env.data.entries.map(entry => entry.id),ids,'Rendering preserves the saved insertion order');
    const saved = fallback ? JSON.parse([...env.local.values()][0]) : JSON.parse(env.handle.text);
    assert.deepEqual(saved.entries.map(entry => entry.id),ids);

    const reopened = await environment('line-downtime',{fallback});
    if(fallback) {
      reopened.controls.importFallback.files = [{text:async () => JSON.stringify(saved)}];
      await reopened.controls.importFallback.dispatch('change');
    } else {
      reopened.handle.text = JSON.stringify(saved);
      await reopened.controls.openFileBtn.dispatch('click');
    }
    assert.deepEqual(historyIds(reopened),[ids[1],ids[2],ids[0]]);
    reopened.controls.historyMonth.value = '2026-09';
    await reopened.controls.historyMonth.dispatch('change');
    assert.deepEqual(historyIds(reopened),[ids[3]]);
    reopened.controls.historyMonth.value = '2026-10';
    await reopened.controls.historyMonth.dispatch('change');
    await reopened.remove(ids[2]);
    assert.deepEqual(historyIds(reopened),[ids[1],ids[0]]);
  });
}

test('downtime history keeps the addition order for legacy IDs and refreshed file entries',async () => {
  const env = await environment('line-downtime');
  const record = (id,date) => ({id,date,shift:'А',start:'10:00',end:'10:20',durationMin:20,reason:'Механична повреда'});
  const saved = {reasons:['Механична повреда','Друго'],entries:[
    record('legacy-z-last','2026-10-05'),
    record('legacy-0-next','2026-10-05'),
    record(ids[0],'2026-10-06'),
    record(ids[2],'2026-10-05')
  ]};
  env.handle.text = JSON.stringify(saved);
  await env.controls.refreshBtn.dispatch('click');
  assert.deepEqual(historyIds(env),[ids[0],ids[2],'legacy-0-next','legacy-z-last']);
  assert.deepEqual(env.data,saved);

  saved.entries.push(record('demo-external-addition','2026-10-05'));
  env.handle.text = JSON.stringify(saved);
  await env.poll();
  assert.deepEqual(historyIds(env),[ids[0],'demo-external-addition',ids[2],'legacy-0-next','legacy-z-last']);
  assert.deepEqual(JSON.parse(env.handle.text),saved);
});

test('downtime history shows a retried save first without duplicates',async () => {
  const env = await environment('line-downtime');
  let nextId = 0;
  env.sandbox.crypto = {randomUUID:() => ids[nextId++]};
  await env.draft(); await env.save();
  await env.draft();
  env.fail('close-applied'); await env.save();
  assert.deepEqual(historyIds(env),[ids[0]]);
  await env.retry();
  assert.deepEqual(historyIds(env),[ids[1],ids[0]]);
  assert.deepEqual(JSON.parse(env.handle.text).entries.map(entry => entry.id),ids.slice(0,2));
});
