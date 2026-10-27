const test = require('node:test');
const assert = require('node:assert/strict');
const {environment} = require('./report-write-environment.cjs');

test('production quantities accept scientific notation without truncating its value', async () => {
  const env = await environment('production-log'); await env.draft();
  env.controls.tonInput.value = '1e3'; env.controls.brakInput.value = '2e1';
  await env.save();
  assert.equal(env.data.entries[0].tonnage, 1000);
  assert.equal(env.data.entries[0].brak, 20);
});

for (const value of ['1.5', '-1', '12wrong', 'Infinity', '1e309', '9007199254740992']) {
  test('production quantities reject invalid whole-number input: ' + value, async () => {
    const env = await environment('production-log'); await env.draft();
    env.controls.tonInput.value = value;
    const before = env.form(), writes = env.writes;
    await env.save();
    assert.equal(env.writes, writes);
    assert.equal(env.data.entries.length, 0);
    assert.deepEqual(env.form(), before);
    assert.match(env.controls.msg.textContent, /цели числа/);
  });
}

test('a browser bad-input value is not silently treated as an empty zero', async () => {
  const env = await environment('production-log'); await env.draft();
  env.controls.tonInput.value = ''; env.controls.tonInput.validity = {badInput: true};
  const writes = env.writes; await env.save();
  assert.equal(env.writes, writes); assert.equal(env.data.entries.length, 0);
});

test('empty quantities remain zero and inactive breakdown fields do not block a report', async () => {
  const env = await environment('production-log'); await env.draft();
  env.controls.tonInput.value = ''; env.controls.brakInput.value = '';
  env.controls.autoKgInput.value = 'invalid';
  await env.save();
  assert.equal(env.data.entries[0].tonnage, 0); assert.equal(env.data.entries[0].brak, 0);
});

test('breakdown preview and saved kilograms use the same exact values', async () => {
  const env = await environment('production-log'); await env.draft();
  env.controls.breakdownToggle.checked = true;
  for (const [id, value] of Object.entries({autoKgInput:'1e3', manKgInput:'2e3', autoCrateInput:'1e2', manCrateInput:'2e2'})) env.controls[id].value = value;
  await env.controls.autoKgInput.dispatch('input');
  assert.equal(env.controls.totalReadout.textContent, (3000).toLocaleString('bg-BG') + ' кг');
  await env.save();
  assert.equal(env.data.entries[0].tonnage, 3000);
  assert.deepEqual(env.data.entries[0].breakdown, {autoKg:1000, manKg:2000, autoCrates:100, manCrates:200});
});

test('invalid breakdown, scrap and an unsafe total stop writes without clearing the draft', async () => {
  for (const [id, value] of [['autoKgInput','1.5'], ['autoCrateInput','-2'], ['manKgInput','bad'], ['manCrateInput','2.5'], ['brakInput','1.5'], ['autoKgInput','9007199254740991']]) {
    const env = await environment('production-log'); await env.draft();
    env.controls.breakdownToggle.checked = true;
    for (const field of ['autoKgInput','autoCrateInput','manKgInput','manCrateInput']) env.controls[field].value = '10';
    env.controls[id].value = value;
    const before = env.form(), writes = env.writes; await env.save();
    assert.equal(env.writes, writes, id); assert.deepEqual(env.form(), before, id);
  }
});

test('monthly goal accepts exact scientific notation and rejects invalid numbers', async () => {
  const env = await environment('production-log');
  env.controls.goalInput.value = '1e3'; await env.controls.goalInput.dispatch('change');
  assert.equal(env.data.goalTons, 1000);
  for (const value of ['1.5','-1','1e309','9007199254740992']) {
    const writes = env.writes; env.controls.goalInput.value = value;
    await env.controls.goalInput.dispatch('change');
    assert.equal(env.writes, writes); assert.equal(env.data.goalTons, 1000);
    assert.equal(env.controls.goalInput.value, value);
  }
});

test('a rejected or actively typed monthly goal survives background refresh until a confirmed save', async () => {
  for (const rejected of [true, false]) {
    const env = await environment('production-log');
    env.controls.goalInput.value = rejected ? '1.5' : '1e3';
    if (rejected) await env.controls.goalInput.dispatch('change');
    else await env.controls.goalInput.dispatch('input');
    env.handle.text = JSON.stringify({...env.data, goalTons:4000}); await env.poll();
    assert.equal(env.data.goalTons, 4000);
    assert.equal(env.controls.goalInput.value, rejected ? '1.5' : '1e3');
    env.controls.goalInput.value = '5000'; await env.controls.goalInput.dispatch('change');
    assert.equal(env.data.goalTons, 5000);
    env.handle.text = JSON.stringify({...env.data, goalTons:6000}); await env.poll();
    assert.equal(Number(env.controls.goalInput.value), 6000);
  }
});

test('a regular shift always reports the automatic / manual breakdown', async () => {
  const env = await environment('production-log'); await env.draft(); await env.select('А');
  assert.equal(env.controls.breakdownToggle.checked, true);
  assert.equal(env.controls.stickerCrateField.hidden, true);
  for (const [id, value] of Object.entries({autoKgInput:'700', manKgInput:'300', autoCrateInput:'28', manCrateInput:'12'})) env.controls[id].value = value;
  await env.save();
  assert.equal(env.data.entries[0].tonnage, 1000);
  assert.deepEqual(env.data.entries[0].breakdown, {autoKg:700, manKg:300, autoCrates:28, manCrates:12});
});

test('stickers report total tonnage with their own crate count', async () => {
  const env = await environment('production-log'); await env.draft();
  assert.equal(env.controls.breakdownToggle.checked, false);
  assert.equal(env.controls.stickerCrateField.hidden, false);
  env.controls.crateInput.value = '42';
  await env.save();
  assert.equal(env.data.entries[0].tonnage, 125);
  // Same place as the shifts' crates: the breakdown, counted as manual packing.
  assert.deepEqual(env.data.entries[0].breakdown, {autoKg:0, autoCrates:0, manKg:125, manCrates:42});
});

test('invalid sticker crates stop the write', async () => {
  const env = await environment('production-log'); await env.draft();
  env.controls.crateInput.value = '-1';
  const writes = env.writes; await env.save();
  assert.equal(env.writes, writes); assert.equal(env.data.entries.length, 0);
});
