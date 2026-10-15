const test=require('node:test'),assert=require('node:assert/strict');
const {present}=require('../js/shift-closeout-indicator.js');
const snapshot=(extra={})=>({configurationRequired:false,phase:'working',interval:{start:0,end:1},scope:{date:'2026-10-15',team:'А',shiftCode:1},availability:{production:true,pairs:true},production:{state:'missing'},pairs:{pending:2},...extra});
test('indicator counts mandatory production once plus pending pairs',()=>{
  assert.deepEqual(present(snapshot()),{state:'missing',text:'3 липси'});
  assert.equal(present(snapshot({production:{state:'entered'}})).text,'2 липси');
  assert.deepEqual(present(snapshot({production:{state:'entered'},pairs:{pending:0}})),{state:'complete',text:'Всичко е отчетено'});
  assert.equal(present(snapshot({pairs:{pending:0}})).text,'1 липса');
});
test('hidden, invalid or unavailable status cannot become a successful check',()=>{
  for(const value of [null,{},snapshot({availability:{production:false,pairs:true},production:null,pairs:{pending:0}}),snapshot({pairs:null}),snapshot({pairs:{pending:-1}}),snapshot({pairs:{pending:NaN}}),snapshot({interval:null}),snapshot({production:{state:'bad'}})])assert.equal(present(value).state,'neutral');
  assert.deepEqual(present(snapshot({availability:{production:false,pairs:true},production:null})),{state:'neutral',text:'Няма пълен достъп'});
  assert.equal(present(snapshot({configurationRequired:true})).text,'Няма зададен екип');
});
test('upcoming and rest-day scopes have neutral status even before reports exist',()=>{
  assert.deepEqual(present(snapshot({phase:'rest',interval:null})),{state:'neutral',text:'Почивка по график'});
  assert.deepEqual(present(snapshot({phase:'upcoming'})),{state:'neutral',text:'Предстояща смяна'});
});
