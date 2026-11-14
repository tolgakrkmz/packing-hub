const test = require('node:test');
const assert = require('node:assert/strict');
const {parse} = require('../server/label-reader.cjs');
// Fictional label text; the layout is an assumption until it is checked against Tesseract output of a real label.
const text = `Customer: Delivery Address
Fictional Customer Ltd
Example Street 1
Purchase Order No. Sampletown
4500000001 BULGARIA
Type of Production Packing Date Gross Wt. Net Wt.
Drawing profile 2026-01-02 120 110
500-0000/6063/T6 Cast No. Length Pieces
/C1 SB 40000001 3000 50
Production Order/Contract Ref.Customer No
DP0000001_00001 XX1 - 0001
Pallet No
PA00000001`;
test('label fields are read from the printed text', () => {
  assert.deepEqual(parse(text), {palletNo: 'PA00000001', productionOrder: 'DP0000001_00001', customer: 'Fictional Customer Ltd', grossWt: '120', netWt: '110', length: '3000', pieces: '50'});
});
test('the QR code wins for the pallet; OCR letter-for-digit slips in numbers are repaired', () => {
  assert.equal(parse('Pallet No\nPA0000O00l', 'PA00000009').palletNo, 'PA00000009');
  assert.equal(parse('Pallet No\nPA0000O00l').palletNo, 'PA00000001');
  assert.equal(parse('DPOOO0001_0000l').productionOrder, 'DP0000001_00001');
});
test('an unreadable photo gives empty fields, never an error', () => {
  assert.deepEqual(Object.values(parse('')), ['', '', '', '', '', '', '']);
});
