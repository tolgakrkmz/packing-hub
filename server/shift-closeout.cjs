/* Read-only obligations: production and pair results never contribute twice. */
const {shiftSchedule:schedule, problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const TEAMS=[...schedule.TEAMS,'СТИКЕРИ'], MINUTE=60000;
function validated(scope,intervalFor=schedule.shiftInterval) {
  try {
    if(typeof scope.date!=='string' || !TEAMS.includes(scope.team) || !/^[123]$/.test(String(scope.shiftCode))) throw new Error();
    schedule.parseDate(scope.date);
    const interval=intervalFor(scope.team,scope.date);
    if(interval && interval.code!==Number(scope.shiftCode)) throw new Error();
    return {scope:{date:scope.date,team:scope.team,shiftCode:Number(scope.shiftCode)},interval:interval?{start:interval.start,end:interval.end}:null};
  } catch {throw problem(400,'INVALID_CLOSEOUT_SCOPE');}
}
function scopeFromTarget(target) {
  if(typeof target!=='string' || target.length>100) throw problem(400,'INVALID_CLOSEOUT_SCOPE');
  const parts=target.split('/');
  if(parts.length!==3) throw problem(400,'INVALID_CLOSEOUT_SCOPE');
  return validated({date:parts[0],team:parts[1],shiftCode:parts[2]}).scope;
}
function summarizeShift(input,{productionEntries=[],pairEntries=[],now=Date.now(),intervalFor=schedule.shiftInterval}) {
  const {scope,interval}=validated(input,intervalFor);
  const entries=pairEntries.filter(e=>e.date===scope.date && e.team===scope.team && e.shiftCode===scope.shiftCode).map(e=>({
    id:e.id,members:e.members.map(p=>({id:p.id,name:p.name})),state:e.cancellation?'cancelled':e.result?'reported':'pending',
    reasonKey:e.cancellation?.reasonKey||'',reasonText:e.cancellation?.reasonText||''
  }));
  const entryCount=productionEntries.filter(e=>e.date===scope.date && e.shift===scope.team).length;
  const phase=!interval?'rest':now<interval.start?'upcoming':now<interval.end?'working':now<interval.end+10*MINUTE?'ended':'overdue';
  return {scope,interval,phase,production:{state:!interval?'not-applicable':entryCount?'entered':'missing',entryCount},
    pairs:{planned:entries.length,reported:entries.filter(e=>e.state==='reported').length,pending:entries.filter(e=>e.state==='pending').length,cancelled:entries.filter(e=>e.state==='cancelled').length,entries}};
}
function createShiftCloseout(store,{now=Date.now}={}) {
  const intervalFor=(team,date)=>store.productionAccess.interval(date,team);
  function teamsFor(user) {
    if(!can(user,'canViewShiftCloseout')) throw problem(403,'FORBIDDEN');
    return user.role==='admin'?[...TEAMS]:TEAMS.includes(user.taskTeam)?[user.taskTeam]:[];
  }
  function currentScope(user,at=now()) {
    const teams=teamsFor(user), today=schedule.sofiaDate(new Date(at));
    for(const date of [schedule.addDays(today,-1),today]) for(const team of teams) {
      const interval=intervalFor(team,date);
      if(interval && at>=interval.start && at<interval.end)return {date,team,shiftCode:interval.code};
    }
    for(const date of [schedule.addDays(today,-1),today]) for(const team of teams) {
      const interval=intervalFor(team,date);
      if(interval&&store.productionAccess.status(date,team,user,at).allowed)return {date,team,shiftCode:interval.code};
    }
    const team=teams[0];
    return team?{date:today,team,shiftCode:intervalFor(team,today)?.code||1}:null;
  }
  function read(input,user) {
    const teams=teamsFor(user), at=now(), current=currentScope(user,at);
    if(!teams.length)return {configurationRequired:true,teams,now:at,currentScope:null};
    const params=input instanceof URLSearchParams?input:new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined));
    if([...params.keys()].some(k=>!['date','team','shiftCode'].includes(k) || params.getAll(k).length!==1))throw problem(400,'INVALID_CLOSEOUT_SCOPE');
    const date=params.get('date')??current.date;
    try {schedule.parseDate(date);}catch {throw problem(400,'INVALID_CLOSEOUT_SCOPE');}
    const requestedCode=params.get('shiftCode');
    if(requestedCode!==null && !/^[123]$/.test(requestedCode))throw problem(400,'INVALID_CLOSEOUT_SCOPE');
    const team=params.get('team')??(user.role==='admin' && requestedCode?schedule.teamFor(schedule.parseDate(date),Number(requestedCode)):current.team);
    if(!TEAMS.includes(team))throw problem(400,'INVALID_CLOSEOUT_SCOPE');
    if(!teams.includes(team))throw problem(403,'FORBIDDEN');
    const shiftCode=requestedCode??intervalFor(team,date)?.code??1;
    const availability={production:can(user,'canViewProduction'),pairs:can(user,'canViewPairs')};
    const summary=summarizeShift({date,team,shiftCode},{now:at,intervalFor,
      productionEntries:availability.production?store.get('production-log').data.entries:[],
      pairEntries:availability.pairs?store.get('pair-targets').data.entries:[]});
    if(!availability.production)summary.production=null;
    if(!availability.pairs)summary.pairs=null;
    const productionAccess=availability.production?store.productionAccess.status(date,team,user,at):null;
    return {...summary,availability,teams,now:at,currentScope:current,configurationRequired:false,productionAccess,
      canReportProduction:availability.production&&can(user,'canCreateProduction')&&(user.role==='admin'||summary.production.entryCount===0)&&(productionAccess.allowed||productionAccess.adminException),canReportPairs:availability.pairs&&can(user,'canCreatePairs')&&(user.role==='admin'||store.productionAccess.status(date,team,user,at,'pair-targets',Number(shiftCode)).allowed)};
  }
  function reminderCandidates(at,user) {
    const teams=teamsFor(user), today=schedule.sofiaDate(new Date(at)), candidates=[];
    for(const offset of [-2,-1,0])for(const team of teams) {
      const date=schedule.addDays(today,offset), interval=intervalFor(team,date);
      if(!interval)continue;
      const phase=at>=interval.end-10*MINUTE && at<interval.end?'due':at>=interval.end+10*MINUTE && at<=interval.end+24*60*MINUTE?'overdue':null;
      if(!phase)continue;
      const scope={date,team,shiftCode:interval.code}, value=read(scope,user);
      if(value.production?.state!=='missing' && !value.pairs?.pending)continue;
      candidates.push({scope,phase,dueAt:interval.end+(phase==='due'?-10:10)*MINUTE,target:[date,team,interval.code].join('/')});
    }
    return candidates;
  }
  return {read,reminderCandidates};
}
module.exports={summarizeShift,createShiftCloseout,scopeFromTarget};
