/* Fictional task records only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {place, monthOf, addMonths, monthSummary, byOwner} = require('../js/task-view-model.js');

const GRACE = 30 * 60000, TZ = 'Europe/Sofia';
const at = value => Date.parse(value);
const shiftTask = (status, extra = {}) => ({kind: 'shift', status, displayStatus: status, owner: {id: 1, username: 'demo-chief'},
  shift: {date: '2026-11-03', start: at('2026-11-03T14:00:00+02:00')}, due: at('2026-11-03T22:00:00+02:00'), report: status === 'pending' ? null : {}, ...extra});
const globalTask = (status, extra = {}) => ({kind: 'global', status, displayStatus: status, owner: {id: 2, username: 'demo-other'}, due: at('2026-11-06T17:00:00+02:00'), report: null, ...extra});

test('every status lands in exactly one tab', () => {
  const now = at('2026-11-03T15:00:00+02:00');
  const expected = {pending: 'open', 'in-progress': 'open', blocked: 'open', review: 'open', completed: 'done', 'not-done': 'missed', 'not-applicable': 'missed', cancelled: 'missed'};
  for (const [status, tab] of Object.entries(expected)) {
    assert.equal(place(globalTask(status), now, false).tab, tab, status);
    assert.equal(place(shiftTask(status), now, false).tab, tab, status);
  }
  assert.equal(place(shiftTask('pending', {displayStatus: 'unreported'}), at('2026-11-04T10:00:00+02:00'), false).tab, 'open');
});

test('open tasks fall into the designed groups', () => {
  assert.deepEqual(place(globalTask('review'), 0, true), {tab: 'open', group: 'confirm'});
  assert.deepEqual(place(globalTask('review'), 0, false), {tab: 'open', group: 'deadline'});
  assert.equal(place(globalTask('blocked', {overdue: true}), 0, false).group, 'deadline');
  assert.equal(place(shiftTask('pending'), at('2026-11-03T13:59:00+02:00'), false).group, 'upcoming');
  assert.equal(place(shiftTask('pending'), at('2026-11-03T15:00:00+02:00'), false).group, 'shift');
  // After the shift ends the task stays reportable until the grace period marks it unreported.
  assert.equal(place(shiftTask('pending'), at('2026-11-03T22:10:00+02:00'), false).group, 'shift');
  assert.equal(place(shiftTask('pending', {displayStatus: 'unreported'}), at('2026-11-03T22:31:00+02:00'), false).group, 'unreported');
  assert.equal(place(shiftTask('completed'), 0, true).group, null);
});

test('months use the shift date or the local due date', () => {
  assert.equal(monthOf(shiftTask('completed', {shift: {date: '2026-10-31'}, due: at('2026-11-01T06:00:00+02:00')}), TZ), '2026-10');
  assert.equal(monthOf(globalTask('completed', {due: at('2026-11-01T00:30:00+02:00')}), TZ), '2026-11');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('month summary counts reports at once and missing reports after grace', () => {
  const now = at('2026-11-03T15:00:00+02:00');
  const items = [
    shiftTask('completed'),
    shiftTask('not-done'),
    shiftTask('pending'),
    shiftTask('pending', {displayStatus: 'unreported', shift: {date: '2026-11-02', start: at('2026-11-02T14:00:00+02:00')}, due: at('2026-11-02T22:00:00+02:00')}),
    shiftTask('cancelled'), shiftTask('not-applicable'),
    shiftTask('completed', {shift: {date: '2026-10-31'}}),
    globalTask('completed')
  ];
  assert.deepEqual(monthSummary(items, '2026-11', TZ, now, GRACE), {done: 1, failed: 2, total: 3, pct: 33});
  assert.deepEqual(monthSummary([], '2026-11', TZ, now, GRACE), {done: 0, failed: 0, total: 0, pct: 0});
  assert.deepEqual(byOwner(items, '2026-11', TZ, now, GRACE), [{id: 1, username: 'demo-chief', done: 1, failed: 2, total: 3, pct: 33}]);
});
