const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../js/report-scope.js');
test('explicit scope requires a real calendar day, approved team and unambiguous shift',()=>{
  assert.equal(parse('?target=demo-id'),null);
  assert.deepEqual(parse('?date=2026-10-04&team='+encodeURIComponent('А')+'&shiftCode=3'),{date:'2026-10-04',team:'А',shiftCode:3});
  assert.deepEqual(parse('?date=2028-02-29&team='+encodeURIComponent('СТИКЕРИ')+'&shiftCode=1&target=demo-pair'),{date:'2028-02-29',team:'СТИКЕРИ',shiftCode:1});
  for(const query of ['date=2026-02-30&team=А&shiftCode=1','date=2026-10-04&team=А&shiftCode=01','date=2026-10-04&team=bad&shiftCode=1','date=2026-10-04&team=А','date=2026-10-04&team=А&shiftCode=1&shiftCode=2','date=2026-10-04&team=СТИКЕРИ&shiftCode=3','date=2026-10-04&team=А&shiftCode=1&target=one&target=two'])assert.throws(()=>parse('?'+query));
});
