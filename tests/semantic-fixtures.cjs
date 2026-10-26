/* Fictional records shared by client, file and isolated server regressions. */
const production = {id:'demo-semantic-production',date:'2026-10-04',shift:'А',tonnage:300,brak:2,
  breakdown:{autoKg:100,autoCrates:4,manKg:200,manCrates:8}};
const downtime = {id:'demo-semantic-downtime',date:'2026-10-04',shift:'А',start:'23:50',end:'00:10',durationMin:20,reason:'Demo semantic reason'};
const sample = (name,kind,row) => ({name,kind,data:{entries:[row]}});
const accepted = [
  sample('matching kilogram breakdown','production-log',production),
  sample('large matching whole kilograms','production-log',{...production,tonnage:8000000000000000,breakdown:{...production.breakdown,autoKg:4000000000000000,manKg:4000000000000000}}),
  sample('legacy omitted breakdown','production-log',(({breakdown,...row}) => row)(production)),
  sample('legacy null breakdown','production-log',{...production,breakdown:null}),
  sample('legacy fractional kilograms','production-log',{...production,tonnage:0.3,breakdown:{autoKg:0.1,autoCrates:1,manKg:0.2,manCrates:2}}),
  sample('empty kilogram breakdown','production-log',{...production,tonnage:0,breakdown:{autoKg:0,autoCrates:4,manKg:0,manCrates:8}}),
  sample('sticker total with crates','production-log',{...production,shift:'СТИКЕРИ',breakdown:null,crates:42}),
  sample('overnight downtime','line-downtime',downtime),
  sample('same-day downtime','line-downtime',{...downtime,start:'09:00',end:'09:20'}),
  sample('one-minute midnight crossing','line-downtime',{...downtime,start:'23:59',end:'00:00',durationMin:1}),
  sample('longest valid downtime','line-downtime',{...downtime,start:'00:01',end:'00:00',durationMin:1439})
];
const rejected = [
  sample('mismatched kilogram total','production-log',{...production,tonnage:301}),
  sample('crate counts are not kilograms','production-log',{...production,tonnage:312}),
  sample('fractional kilogram mismatch','production-log',{...production,tonnage:300.001}),
  sample('large whole kilogram mismatch','production-log',{...production,tonnage:8000000000000001,breakdown:{...production.breakdown,autoKg:4000000000000000,manKg:4000000000000000}}),
  sample('overflowing kilogram sum','production-log',{...production,tonnage:Number.MAX_VALUE,breakdown:{...production.breakdown,autoKg:Number.MAX_VALUE,manKg:Number.MAX_VALUE}}),
  sample('negative sticker crates','production-log',{...production,shift:'СТИКЕРИ',breakdown:null,crates:-1}),
  sample('same-day duration mismatch','line-downtime',{...downtime,start:'09:00',end:'09:20',durationMin:21}),
  sample('overnight duration mismatch','line-downtime',{...downtime,durationMin:21}),
  sample('equal times with positive duration','line-downtime',{...downtime,end:downtime.start,durationMin:1}),
  sample('fractional minute duration','line-downtime',{...downtime,durationMin:20.5})
];
module.exports = {accepted,rejected};
