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
