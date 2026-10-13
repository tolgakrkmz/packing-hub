/* Shared personnel normalization for legacy imports and the personnel screen. */
const PersonnelModel = (() => {
const CATS = [
  {key:'auto', label:'Автоматична линия', short:'Автоматична', teams:['А','Б','В','Г']},
  {key:'manual', label:'Ръчна опаковка', short:'Ръчна', teams:['А','Б','В','Г']},
  {key:'stickers', label:'Стикери', short:'Стикери', teams:['1 смяна']}
];
const CAT_BY_KEY = Object.fromEntries(CATS.map(c=>[c.key,c]));
const MAIN_TEAMS = ['А','Б','В','Г'];

const DEFAULT_ROLES = ['Началник смяна','Оператор пулт 1','Оператор пулт 2','Чемберовач','Кранист/чемберовач','Обслужващ','Опаковчик'];
function uniqueRoles(values){
  const result=[], keys=new Set();
  for(const value of values){
    const role=String(value||'').trim().replace(/\s+/g,' '), key=cleanRoleKey(role);
    if(role && !keys.has(key)){ result.push(role); keys.add(key); }
  }
  return result;
}
function roles(settings={},employees=[]){
  return uniqueRoles([...DEFAULT_ROLES,...(settings.customRoles||[]),...employees.map(p=>p.role)]);
}

const DEFAULT_PERSONNEL_SETTINGS = {stickersStage1:4,stickersStage2:6};
function normalizeSettings(value,employees=[]){
  const raw=value||{};
  const customRoles=uniqueRoles([...(Array.isArray(raw.customRoles) ? raw.customRoles : []),...employees.map(p=>normalizeRole(p.category,p.role)).filter(role=>!DEFAULT_ROLES.includes(role))]);
  return {
    stickersStage1: Number.isFinite(Number(raw.stickersStage1)) ? Math.max(0,Math.round(Number(raw.stickersStage1))) : DEFAULT_PERSONNEL_SETTINGS.stickersStage1,
    stickersStage2: Number.isFinite(Number(raw.stickersStage2)) ? Math.max(0,Math.round(Number(raw.stickersStage2))) : DEFAULT_PERSONNEL_SETTINGS.stickersStage2,
    ...(Array.isArray(raw.customRoles) || customRoles.length ? {customRoles} : {})
  };
}
function cleanRoleKey(value){
  return String(value||'').trim().toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
}
function normalizeRole(category, role, allowed=DEFAULT_ROLES){
  const key=cleanRoleKey(role);
  const exact=allowed.find(r=>cleanRoleKey(r)===key);
  if(exact) return exact;

  return String(role||'').trim().replace(/\s+/g,' ') || 'Опаковчик';
}
function normalizeEmployee(p){
  const category=CAT_BY_KEY[p.category] ? p.category : 'auto';
  const allowed=CAT_BY_KEY[category].teams;
  const team=allowed.includes(p.team) ? p.team : allowed[0];
  const name=String(p.name||'').trim();
  return {
    id:String(p.id||''),
    name,
    category,
    team,
    role:normalizeRole(category,p.role),
    active:p.active !== false,
    note:String(p.note||'').trim(),
    ...(p.transfers !== undefined ? {transfers:p.transfers.map(t=>({...t}))} : {})
  };
}
function validAssignment(value){
  return !!value && Object.hasOwn(CAT_BY_KEY,value.category) && CAT_BY_KEY[value.category].teams.includes(value.team);
}
function assignmentAt(person,date){
  ShiftSchedule.parseDate(date);
  let assignment=person;
  for(const t of person.transfers||[]) if(t.effectiveDate<=date) assignment=t; else break;
  return {...person,category:assignment.category,team:assignment.team};
}
function scheduledInterval(person,date){
  const p=assignmentAt(person,date);
  return ShiftSchedule.shiftInterval(p.category==='stickers'?'СТИКЕРИ':p.team,date);
}
function inspectBoundary(person,date){
  let run=0,longestRun=0,previous=null,overlap=false,old=null,next=null;
  for(let offset=-6;offset<=6;offset++){
    const day=ShiftSchedule.addDays(date,offset), interval=scheduledInterval(person,day);
    run=interval?run+1:0; longestRun=Math.max(longestRun,run);
    if(interval){
      if(previous && interval.start<previous.end) overlap=true;
      previous=interval;
      if(day<date) old=interval; else if(!next) next=interval;
    }
  }
  const restHours=old&&next?(next.start-old.end)/3600000:null;
  return {valid:!overlap&&longestRun<=6,reason:overlap?'overlap':longestRun>6?'consecutive':'',longestRun,restHours};
}
function validateTransfers(person){
  if(person.transfers===undefined) return true;
  if(!validAssignment(person)||!Array.isArray(person.transfers)||person.transfers.length>256) throw new Error('Невалиден план за преместване.');
  let previous='';
  for(const t of person.transfers){
    if(!validAssignment(t)||typeof t.effectiveDate!=='string'||t.effectiveDate<=previous) throw new Error('Невалиден план за преместване.');
    ShiftSchedule.parseDate(t.effectiveDate); previous=t.effectiveDate;
  }
  for(const t of person.transfers) if(!inspectBoundary(person,t.effectiveDate).valid) throw new Error('Преместването изисква почивен ден.');
  return true;
}
function assessTransfer(person,transfer){
  if(!validAssignment(transfer)) throw new Error('Изберете валиден участък и екип.');
  ShiftSchedule.parseDate(transfer.effectiveDate);
  const transfers=[...(person.transfers||[]).filter(t=>t.effectiveDate<transfer.effectiveDate),{...transfer}];
  const next={...person,transfers};
  let result=inspectBoundary(next,transfer.effectiveDate);
  for(const t of transfers.slice(0,-1)){
    const prior=inspectBoundary(next,t.effectiveDate);
    if(!prior.valid) result={...prior,longestRun:Math.max(result.longestRun,prior.longestRun)};
  }
  if(person.active===false) return {...result,valid:false,reason:'inactive'};
  return result;
}
function changeTransfer(person,transfer,today=ShiftSchedule.sofiaDate()){
  ShiftSchedule.parseDate(today); validateTransfers(person);
  const completed=(person.transfers||[]).filter(t=>t.effectiveDate<=today);
  if(transfer){
    if(person.active===false||transfer.effectiveDate<=today) throw new Error('Изберете бъдеща дата за активен човек.');
    const result=assessTransfer({...person,transfers:completed},transfer);
    if(!result.valid) throw new Error('Преместването изисква почивен ден.');
  }
  const next={...person,transfers:[...completed,...(transfer?[{...transfer}]:[])]};
  validateTransfers(next);
  return next;
}
function transferOptions(person,target,startDate){
  ShiftSchedule.parseDate(startDate);
  if(!validAssignment(target)) throw new Error('Изберете валиден участък и екип.');
  validateTransfers(person);
  const endDate=ShiftSchedule.addDays(startDate,63);
  let baselineDays=0;
  for(let n=0;n<64;n++) if(scheduledInterval(person,ShiftSchedule.addDays(startDate,n))) baselineDays++;
  const candidates=[];
  for(let n=0;n<32;n++){
    const effectiveDate=ShiftSchedule.addDays(startDate,n),t={effectiveDate,category:target.category,team:target.team};
    const next={...person,transfers:[...(person.transfers||[]).filter(x=>x.effectiveDate<effectiveDate),t]};
    let workingDays=0;
    for(let d=0;d<64;d++) if(scheduledInterval(next,ShiftSchedule.addDays(startDate,d))) workingDays++;
    candidates.push({...t,...assessTransfer(person,t),workingDays,delta:workingDays-baselineDays});
  }
  const valid=candidates.filter(row=>row.valid);
  const preferred=valid.find(row=>row.delta>=0)||valid.slice().sort((a,b)=>b.delta-a.delta||a.effectiveDate.localeCompare(b.effectiveDate))[0];
  return {startDate,endDate,baselineDays,candidates,recommendedDate:preferred?.effectiveDate||null};
}
return {DEFAULT_ROLES, roles, normalizeSettings, normalizeRole, normalizeEmployee, assignmentAt, validateTransfers, assessTransfer, changeTransfer, transferOptions, scheduledInterval};
})();
