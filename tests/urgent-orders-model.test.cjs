const test = require('node:test');
const assert = require('node:assert/strict');
const {parse} = require('../js/urgent-orders-model.js');
// Fictional report rows in the copied column layout: order_position, client, profile, variant, three quantities.
const tabbed = 'DP0000001_10000\tFictional Client Ltd\t500-0001\tA000001\t100.50\t0\t100.50';
const spaced = 'DP0000002_10000   Fictional Client Ltd 500-0002    A000002     20     0     20';
test('report rows from Excel tabs or screen spaces keep their columns; headers and totals are skipped', () => {
  const {orders, skipped, duplicates} = parse(['Поръчка\tКлиент\tПрофил', tabbed, '', spaced, 'Общо   120.50'].join('\n'));
  assert.equal(skipped, 2); assert.equal(duplicates, 0);
  assert.deepEqual(orders[0], {order: 'DP0000001_10000', client: 'Fictional Client Ltd', profile: '500-0001', variant: 'A000001', quantity: '100.50', available: '', furnace: '', note: '', text: 'DP0000001_10000 · 500-0001 · A000001', source: 'DP0000001_10000 Fictional Client Ltd 500-0001 A000001 100.50 0 100.50'});
  assert.deepEqual([orders[1].client, orders[1].profile, orders[1].quantity], ['Fictional Client Ltd', '500-0002', '20']); // one space between client and profile
});
test('free text stays one order per line; repeats and known orders are skipped', () => {
  assert.deepEqual(parse('Fictional 4521\n  fictional 4521 \nFictional 4530').orders.map(order => order.text), ['Fictional 4521', 'Fictional 4530']);
  const {orders, duplicates} = parse([tabbed, tabbed].join('\n'), [parse(tabbed).orders[0].source.toLocaleLowerCase('bg')]);
  assert.equal(orders.length, 0); assert.equal(duplicates, 2);
});
test('a trailing note, single spaces between quantities and short client names are recognised', () => {
  const {orders, skipped, duplicates} = parse([
    'DP0000003_10000   Demo Metal B.V. 500-10003   A000001     5562  5275  287   елокс',
    'DP0000004_10000   DEMO NV   500-0004    A000009     784.8 392   392.8 !!!!!прахово',
    'DP0000005_90000   DEMO NV  500-0005    A000006     500   0     500   2500 проверка печки',
    'DP0000004_10000   DEMO NV   500-0004    A000009     784.8 392   392.8 600',
    'DP0000004_10000   DEMO NV   500-0004    A000009     784.8 392   392.8 600'
  ].join('\n'));
  assert.equal(skipped, 0); assert.equal(duplicates, 1); // the same order with another note is a separate row; an identical row is a repeat
  assert.deepEqual(orders.map(order => [order.client, order.profile, order.variant, order.quantity, order.note]), [
    ['Demo Metal B.V.', '500-10003', 'A000001', '5562', 'елокс'],
    ['DEMO NV', '500-0004', 'A000009', '784.8', '!!!!!прахово'],
    ['DEMO NV', '500-0005', 'A000006', '500', 'проверка печки'],
    ['DEMO NV', '500-0004', 'A000009', '784.8', '']
  ]);
});
test('the newer report adds available kilograms and the furnace before the note', () => {
  const {orders} = parse([
    'DP0000006_10000   DEMO BALTIC UAB      500-0006    A000001     502   0     502   569.77      1300',
    'DP0000007_120000  Demo Aluminium GmbH      500-0007    A000005     500   166   334   534.6 2500',
    'DP0000008_40000   Demo GMBH c/o    500-10008   A000010     2577.5      641   1936.5      1886.89     1300',
    'DP0000009_20000   Demo NV      500-0009    A000003     1000  0     1000  0     1300 ще се пресова',
    'DP0000010_80000   Demo NV      500-0010    A000008     500   0     500   0     ще се пресова'
  ].join('\n'));
  assert.deepEqual(orders.map(order => [order.client, order.quantity, order.available, order.furnace, order.note]), [
    ['DEMO BALTIC UAB', '502', '569.77', '1300', ''],
    ['Demo Aluminium GmbH', '500', '534.6', '2500', ''],
    ['Demo GMBH c/o', '2577.5', '1886.89', '1300', ''],
    ['Demo NV', '1000', '0', '1300', 'ще се пресова'],
    ['Demo NV', '500', '0', '', 'ще се пресова']
  ]);
});
// Regression rows: each layout seen in a pasted report is kept here with fictional values.
test('report variants: long client names, a note instead of the furnace and a dash before the note', () => {
  const {orders, skipped} = parse([
    'DP0000011_10000   DEMO METALS s.r.o.     500-10011   A000002     2000  1380  620   2148.31     1800',
    'DP0000012_120000  DEMO-METAL-SPOT s.r.o.    500-0012    A000001     500   0     500   544.5 2000 - ЧАКА ПЕЧКА',
    'DP0000013_10000   DEMO - SHADE EXPERTS Sp. z o.o. 500-0013    A000003     1020.6      0     1020.6      1073.6      ПРАХОВО',
    'DP0000014_110000  Demo S.A. 500-0014    A000001     1443.42     0     1443.42     1600  600',
    'DP0000015_70000   Demo S.A. 500-0015    A000002     510.51      291   219.51      600   елокс/тц'
  ].join('\n'));
  assert.equal(skipped, 0);
  assert.deepEqual(orders.map(order => [order.client, order.profile, order.quantity, order.available, order.furnace, order.note]), [
    ['DEMO METALS s.r.o.', '500-10011', '2000', '2148.31', '1800', ''],
    ['DEMO-METAL-SPOT s.r.o.', '500-0012', '500', '544.5', '2000', 'ЧАКА ПЕЧКА'],
    ['DEMO - SHADE EXPERTS Sp. z o.o.', '500-0013', '1020.6', '1073.6', '', 'ПРАХОВО'],
    ['Demo S.A.', '500-0014', '1443.42', '1600', '600', ''],
    ['Demo S.A.', '500-0015', '510.51', '600', '', 'елокс/тц']
  ]);
});


const {slots, distribute, slotKey} = require('../js/urgent-orders-model.js');
const {shiftSchedule} = require('../server/store.cjs');
const sofia = (date, hour) => shiftSchedule.sofiaInstant(date, hour);
test('a truck gets the shifts from the running one to the night before its day; a truck due today gets the rest of today', () => {
  const at = sofia('2026-10-26', 15), keys = truck => slots(shiftSchedule, at, truck).map(slotKey);
  assert.deepEqual(keys('2026-10-27'), ['2026-10-26/2', '2026-10-26/3']);
  assert.deepEqual(keys('2026-10-28'), ['2026-10-26/2', '2026-10-26/3', '2026-10-27/1', '2026-10-27/2', '2026-10-27/3']);
  assert.deepEqual(keys('2026-10-26'), ['2026-10-26/2', '2026-10-26/3']);
  assert.deepEqual(slots(shiftSchedule, sofia('2026-10-27', 3), '2026-10-28').map(slotKey)[0], '2026-10-26/3'); // the night shift still runs after midnight
  for (const slot of slots(shiftSchedule, at, '2026-10-28')) assert.equal(slot.team, shiftSchedule.teamFor(shiftSchedule.parseDate(slot.date), slot.code));
});
test('the magic button splits kilograms by team output, keeps live shifts and sends unpressed orders later', () => {
  const at = sofia('2026-10-26', 15), [first, second] = slots(shiftSchedule, at, '2026-10-27');
  const order = (id, quantity, extra = {}) => ({id, status: 'open', truckDate: '2026-10-27', quantity: String(quantity), ...extra});
  const items = [order('a', 1000), order('b', 1000), order('c', 1000), order('d', 1000), order('e', 500, {available: '0', note: 'ще се пресова'}),
    order('kept', 700, {shift: second}), order('late', 300, {shift: {date: '2026-10-26', code: 1, team: 'А'}}), {...order('done', 900), status: 'packed'}];
  // The second shift's team usually packs three times as much.
  const plan = distribute(shiftSchedule, at, items, {[first.team]: 1000, [second.team]: 3000});
  const placed = Object.fromEntries(plan.map(entry => [entry.id, slotKey(entry.shift)]));
  assert.deepEqual(Object.keys(placed).sort(), ['a', 'b', 'c', 'd', 'e', 'late']); // the live, the packed and nothing else stay as they are
  assert.equal(placed.e, slotKey(second));
  const load = key => items.filter(item => (placed[item.id] || (item.id === 'kept' && slotKey(second))) === key).reduce((sum, item) => sum + Number(item.quantity), 0);
  assert.deepEqual([load(slotKey(first)), load(slotKey(second))], [1300, 4200]); // 5500 kg at 1:3 is ideally 1375 / 4125
});
