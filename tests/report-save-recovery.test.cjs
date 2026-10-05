const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {environment} = require('./report-write-environment.cjs');
const disk = env => JSON.parse(env.handle.text);
const errorShown = env => {
  assert.match(env.controls.msg.textContent,/Промяната не е потвърдена/);
  assert.doesNotMatch(env.controls.msg.textContent,/Synthetic failure details/);
  assert.equal(env.controls.retrySaveBtn.hidden,false);
  assert.equal(env.controls.saveBtn.disabled,false);
  assert.doesNotMatch(env.controls.saveBtn.textContent,/Записва се/);
};
for(const module of ['production-log','line-downtime']) {
  for(const [phase,name,offset] of [['read','NotReadableError',1],['read','NotReadableError',2],['permission','NotAllowedError'],['write','UnknownError'],['close','UnknownError']]) {
    test(module+': failed '+phase+' ('+name+', read '+(offset || 0)+') rolls back and retries the same form',async () => {
      const env = await environment(module); await env.draft();
      const form = env.form(), before = env.data, original = env.handle.text;
      env.fail(phase,name,offset); await env.save();
      errorShown(env);
      assert.deepEqual(env.form(),form);
      assert.deepEqual(env.data,before);
      assert.equal(env.handle.text,original);
      assert.doesNotMatch(env.controls.historyWrap.innerHTML,/Demo note|2026-10-05/);
      if(phase === 'write' || phase === 'close') assert.equal(env.aborts,1);
      await env.retry();
      assert.equal(disk(env).entries.length,1);
      assert.equal(env.data.entries.length,1);
      assert.equal(env.controls.retrySaveBtn.hidden,true);
      assert.match(env.controls.msg.textContent,/Записано/);
      assert.equal(env.controls.saveBtn.disabled,true);
    });
  }
  test(module+': an ambiguous close error is confirmed on retry without adding a duplicate',async () => {
    for(const useRetry of [true,false]) {
      const env = await environment(module); await env.draft();
      env.fail('close-applied'); await env.save();
      errorShown(env); assert.equal(env.data.entries.length,0);
      const saved = disk(env).entries[0], writes = env.writes;
      await (useRetry ? env.retry() : env.save());
      assert.deepEqual(env.data.entries,[saved]);
      assert.equal(disk(env).entries.length,1);
      assert.equal(env.writes,writes);
    }
  });
  test(module+': busy writes freeze the form, pause polling and ignore double clicks and team switches',async () => {
    const env = await environment(module); await env.draft();
    const release = env.hold(), pending = env.save();
    while(!env.writes) await Promise.resolve();
    const beforeReads = env.reads;
    assert.equal(env.controls.saveBtn.disabled,true);
    assert.equal(env.controls.dateInput.disabled,true);
    assert.equal(env.controls.openFileBtn.disabled,true);
    await env.poll(); await env.save(); await env.select('А');
    assert.equal(env.reads,beforeReads);
    release(); await pending;
    assert.equal(disk(env).entries.length,1);
    assert.equal(disk(env).entries[0].shift,'СТИКЕРИ');
    assert.equal(env.controls.dateInput.disabled,false);
    assert.equal(env.controls.openFileBtn.disabled,false);
  });
  test(module+': retry refuses to overwrite a report changed after an ambiguous close',async () => {
    const env = await environment(module); await env.draft();
    env.fail('close-applied'); await env.save();
    const file = disk(env), entry = file.entries[0];
    const revised = module === 'production-log' ? {...entry,tonnage:250} : {...entry,note:'Demo revised'};
    env.handle.text = JSON.stringify({...file,entries:[revised]});
    const writes = env.writes;
    await env.retry();
    assert.equal(env.writes,writes);
    assert.deepEqual(env.data.entries,[revised]);
    assert.match(env.controls.msg.textContent,/Записът е променен/);
    assert.equal(env.controls.retrySaveBtn.hidden,true);
  });
  test(module+': a corrupted file blocks the save and preserves the form for a valid retry',async () => {
    const env = await environment(module); await env.draft();
    const original = env.handle.text, form = env.form();
    env.handle.text = '{broken'; await env.save();
    assert.equal(env.data.entries.length,0); assert.equal(env.writes,0);
    assert.deepEqual(env.form(),form); errorShown(env);
    env.handle.text = original; await env.retry();
    assert.equal(disk(env).entries.length,1);
  });
  test(module+': fresh file records survive a failed save and the successful retry',async () => {
    const env = await environment(module); await env.draft(); await env.save();
    const existing = disk(env).entries[0]; await env.draft();
    const external = {...existing,id:'demo-external'};
    env.handle.text = JSON.stringify({...disk(env),entries:[existing,external]});
    env.fail('write'); await env.save();
    assert.deepEqual(env.data.entries,[existing,external]);
    await env.retry(); assert.equal(disk(env).entries.length,3);
    assert.deepEqual(disk(env).entries.slice(0,2),[existing,external]);
  });
  test(module+': failed deletion keeps the record and totals, and retry removes it once',async () => {
    const env = await environment(module); await env.draft(); await env.save();
    const entry = env.data.entries[0], before = env.data;
    env.fail('close'); await env.remove(entry.id);
    assert.deepEqual(env.data,before); assert.equal(disk(env).entries.length,1);
    assert.match(env.controls.msg.textContent,/не е потвърдена/);
    assert.equal(env.controls.retrySaveBtn.hidden,false);
    await env.retry(); assert.equal(env.data.entries.length,0); assert.equal(disk(env).entries.length,0);
    assert.equal(env.controls.msg.textContent,'Записът е изтрит.');
  });
  test(module+': deletion retry accepts an already applied removal and refuses a changed record',async () => {
    for(const changed of [false,true]) {
      const env = await environment(module); await env.draft(); await env.save();
      const original = env.data.entries[0];
      const revised = module === 'production-log' ? {...original,tonnage:250} : {...original,note:'Demo revised'};
      env.handle.text = JSON.stringify({...disk(env),entries:changed ? [revised] : []});
      const writes = env.writes; await env.remove(original.id);
      assert.equal(env.writes,writes);
      assert.deepEqual(env.data.entries,changed ? [revised] : []);
      assert.equal(env.controls.retrySaveBtn.hidden,true);
      assert.match(env.controls.msg.textContent,changed ? /Записът е променен/ : /изтрит/);
    }
  });
  test(module+': editing a failed draft clears the stale retry and saves the revised form',async () => {
    const env = await environment(module); await env.draft();
    env.fail('write'); await env.save();
    const field = env.controls.tonInput || env.controls.noteInput;
    field.value = module === 'production-log' ? '250' : 'Demo revised';
    await field.dispatch('input'); assert.equal(env.controls.retrySaveBtn.hidden,true);
    await env.save(); assert.equal(disk(env).entries.length,1);
    assert.equal(module === 'production-log' ? disk(env).entries[0].tonnage : disk(env).entries[0].note,module === 'production-log' ? 250 : 'Demo revised');
  });
  test(module+': browser storage failures preserve the form and allow retry',async () => {
    const env = await environment(module,{fallback:true}); await env.draft();
    const before = env.data, form = env.form(); env.fail('storage','QuotaExceededError'); await env.save();
    assert.deepEqual(env.data,before); assert.deepEqual(env.form(),form); errorShown(env);
    await env.retry(); assert.equal(env.data.entries.length,1);
    assert.equal(JSON.parse([...env.local.values()][0]).entries.length,1);
  });
}
test('production goal failures restore the saved target, preserve the draft and offer retry',async () => {
  const env = await environment('production-log');
  env.controls.goalInput.value = '4500'; env.fail('write'); await env.controls.goalInput.dispatch('change');
  assert.equal(env.data.goalTons,3000); assert.equal(disk(env).goalTons,3000);
  assert.equal(String(env.controls.goalInput.value),'4500');
  assert.match(env.controls.goalTgt.textContent,/3/);
  await env.retry(); assert.equal(env.data.goalTons,4500); assert.equal(disk(env).goalTons,4500);
  assert.equal(env.controls.msg.textContent,'Целта е записана.');
});
test('downtime reason changes recover from failures while keeping existing reports',async () => {
  const env = await environment('line-downtime'); await env.draft(); await env.save();
  const existing = env.data.entries;
  env.controls.newReasonInput.value = 'Demo extra'; env.fail('write'); await env.controls.addReasonBtn.dispatch('click');
  assert.equal(env.data.reasons.includes('Demo extra'),false); assert.equal(env.controls.newReasonInput.value,'Demo extra');
  await env.retry(); assert.equal(env.data.reasons.filter(value => value === 'Demo extra').length,1);
  env.fail('write'); await vm.runInContext('removeReason("Demo extra")',env.sandbox);
  assert.equal(env.data.reasons.includes('Demo extra'),true);
  await env.retry(); assert.equal(env.data.reasons.includes('Demo extra'),false);
  assert.deepEqual(env.data.entries,existing);
});
test('a successful production report reflects a freshly loaded monthly goal',async () => {
  const env = await environment('production-log'); await env.draft();
  env.handle.text = JSON.stringify({...disk(env),goalTons:4500});
  await env.save();
  assert.equal(env.data.goalTons,4500);
  assert.equal(String(env.controls.goalInput.value),'4500');
});
test('recovery messages and retry actions translate to English',() => {
  const sandbox = vm.createContext({localStorage:{getItem:() => 'en'}});
  for(const name of ['i18n-en','i18n']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',name+'.js'),'utf8'),sandbox);
  const i18n = vm.runInContext('HubI18n',sandbox);
  for(const message of ['Опитай отново','Промяната не е потвърдена. Проверете връзката с файла и опитайте отново.','Няма разрешение за запис. Възстановете достъпа до файла и опитайте отново.','Проверете дали е свързан валиден файл и дали въведените данни са правилни.','Записът е променен. Опреснете данните преди нов опит.','Записът е изтрит.','Целта е записана.','Причината е добавена.','Причината е изтрита.']) assert.doesNotMatch(i18n.t(message),/[А-Яа-я]/);
});
