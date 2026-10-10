const test = require('node:test');
const assert = require('node:assert/strict');
const {create, WEEK} = require('../js/notification-prompt.js');
const storage = () => { const values = new Map(); return {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)}; };
const conditions = {configured: true, allowed: true, supported: true, subscribed: false, visible: true, busy: false};
test('invitation waits a week across refreshes and tabs, while accounts stay independent', () => {
  let time = 10000; const local = storage(), session = storage();
  const make = (accountId = 1, tab = session) => create({storage: local, sessionStorage: tab, accountId, now: () => time});
  const first = make(), secondTab = make(1, storage());
  assert.equal(first.eligible(conditions), true); first.shownNow(); first.defer();
  assert.equal(secondTab.eligible(conditions), false); assert.equal(make().eligible(conditions), false);
  assert.equal(make(2).eligible(conditions), true);
  time += WEEK - 1; assert.equal(make(1, storage()).eligible(conditions), false);
  time++; assert.equal(make(1, storage()).eligible(conditions), true);
  assert.equal(make().eligible(conditions), false); // Same tab/session never repeats.
});
test('never remind persists; enabling reminders waits another week', () => {
  let time = 10000; const local = storage();
  const make = () => create({storage: local, sessionStorage: storage(), accountId: 1, now: () => time});
  const prompt = make(); prompt.never(); time += 10 * WEEK;
  assert.equal(make().eligible(conditions), false); assert.equal(make().muted(), true);
  const renewed = make(); renewed.reset(); assert.equal(renewed.eligible(conditions), false);
  time += WEEK; assert.equal(make().eligible(conditions), true);
});
test('unsupported, unconfigured, denied access, subscribed, busy and hidden states suppress invitation', () => {
  const prompt = create({storage: storage(), sessionStorage: storage(), accountId: 1});
  for (const [key, value] of [['configured', false], ['allowed', false], ['supported', false], ['subscribed', true], ['visible', false], ['busy', true]]) assert.equal(prompt.eligible({...conditions, [key]: value}), false);
});
test('blocked or invalid storage does not crash and still limits invitations in the loaded page', () => {
  const blocked = {getItem() { throw Error('DEMO_STORAGE_BLOCKED'); }, setItem() { throw Error('DEMO_STORAGE_BLOCKED'); }};
  const prompt = create({storage: blocked, sessionStorage: blocked, accountId: 1});
  assert.equal(prompt.eligible(conditions), true); prompt.shownNow(); assert.equal(prompt.eligible(conditions), false);
  const invalid = {getItem: () => 'not-json', setItem() {}};
  assert.equal(create({storage: invalid, sessionStorage: invalid, accountId: 1}).eligible(conditions), true);
});
