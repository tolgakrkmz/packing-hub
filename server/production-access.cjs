/* One reporting policy for operation writes, legacy replacements and closeout. */
const {isDeepStrictEqual}=require('node:util');
const {can}=require('./permissions.cjs');
function createProductionAccess(store,{schedule,problem,now=Date.now}) {
  const teams=[...schedule.TEAMS,'СТИКЕРИ'];
  const GRACE=4*60*60*1000;
  const validReason=value=>typeof value==='string'&&value.trim().length>0&&value.length<=1000;
  function scope(date,team) {
    try {schedule.parseDate(date);if(!teams.includes(team))throw new Error();}
    catch {throw problem(400,'INVALID_PRODUCTION_SCOPE');}
    return {date,team};
  }
  function interval(date,team) {
    scope(date,team);
    const regular=schedule.shiftInterval(team,date);
    return regular?{...regular,extraordinary:false}:null;
  }
  // Stickers report any day and time; only the team assignment applies.
  function status(date,team,user,at=now(),kind='production-log',shiftCode=null) {
    const stickers=team==='СТИКЕРИ', value=interval(date,team)??(stickers?{code:1,extraordinary:true}:null), assigned=user.taskTeam===team;
    const inWindow=stickers?shiftCode===null||Number(shiftCode)===1:!!value&&at>=value.start&&at<value.end+GRACE&&(shiftCode===null||Number(shiftCode)===value.code);
    const prefix=kind==='pair-targets'?'PAIR':'PRODUCTION';
    const code=!teams.includes(user.taskTeam)?prefix+'_TEAM_REQUIRED':!assigned?prefix+'_TEAM_MISMATCH':!inWindow?prefix+'_WINDOW_CLOSED':null;
    return {date,team,now:at,interval:value,deadline:value&&!stickers?value.end+GRACE:null,
      allowed:!code,code,adminException:user.role==='admin'&&!!code};
  }
  function currentScope(user,at=now()) {
    const team=teams.includes(user.taskTeam)?user.taskTeam:teams[0], today=schedule.sofiaDate(new Date(at));
    const candidates=[schedule.addDays(today,-1),today].map(date=>({date,team,value:interval(date,team)}));
    const current=candidates.find(({value})=>value&&at>=value.start&&at<value.end+GRACE);
    if(current)return {date:current.date,team};
    return {date:today,team};
  }
  function read(input,user,kind='production-log') {
    const pairs=kind==='pair-targets',view=pairs?'canViewPairs':'canViewProduction';
    if(!can(user,view))throw problem(403,'FORBIDDEN');
    const params=input instanceof URLSearchParams?input:new URLSearchParams(input);
    if([...params.keys()].some(key=>!(pairs?['date','team','shiftCode']:['date','team']).includes(key)||params.getAll(key).length!==1))throw problem(400,'INVALID_PRODUCTION_SCOPE');
    const current=currentScope(user), date=params.get('date')??current.date,team=params.get('team')??current.team;
    const shiftCode=params.get('shiftCode');
    if(shiftCode!==null&&!/^[123]$/.test(shiftCode))throw problem(400,'INVALID_PRODUCTION_SCOPE');
    const value=status(date,team,user,now(),kind,shiftCode);
    const reported=!pairs&&store.get('production-log').data.entries.some(entry=>entry.date===date&&entry.shift===team);
    return {...value,reported,canCreate:(!reported||pairs||user.role==='admin')&&can(user,pairs?'canCreatePairs':'canCreateProduction')&&(value.allowed||value.adminException),
      canEdit:can(user,pairs?'canEditPairs':'canEditProduction')&&(value.allowed||value.adminException),
currentScope:pairs?{...current,shiftCode:interval(current.date,current.team)?.code||1}:current};
  }
  function requireChanges(before,after,user,reason,kind='production-log') {
    const pairs=kind==='pair-targets';
    // Pair administrators retain their existing correction workflow.
    if(pairs&&user.role==='admin')return;
    const prior=new Map(before.entries.map(e=>[e.id,e])),next=new Map(after.entries.map(e=>[e.id,e]));
    const checked=new Map();
    for(const id of new Set([...prior.keys(),...next.keys()])) {
      if(isDeepStrictEqual(prior.get(id),next.get(id)))continue;
      for(const entry of [prior.get(id),next.get(id)].filter(Boolean))checked.set(entry.date+'/'+(pairs?entry.team+'/'+entry.shiftCode:entry.shift),entry);
    }
    const exceptions=[];
    for(const entry of checked.values()) {
      const value=status(entry.date,pairs?entry.team:entry.shift,user,now(),kind,pairs?entry.shiftCode:null);
      if(value.allowed)continue;
      if(!value.adminException)throw problem(403,value.code);
      if(!validReason(reason))throw problem(428,'PRODUCTION_EXCEPTION_REASON_REQUIRED');
      exceptions.push({date:entry.date,team:entry.shift});
    }
    if(!pairs&&user.role!=='admin') {
      for(const entry of after.entries) {
        const old=prior.get(entry.id);
        if(old&&old.date===entry.date&&old.shift===entry.shift)continue;
        if(before.entries.some(other=>other.id!==entry.id&&other.date===entry.date&&other.shift===entry.shift)||after.entries.some(other=>other.id!==entry.id&&other.date===entry.date&&other.shift===entry.shift))throw problem(403,'PRODUCTION_ALREADY_REPORTED');
      }
    }
    if(exceptions.length)store.audit(user,'production-exception','production-log',{scopes:exceptions,reason:reason.trim()});
  }
  return {interval,status,read,currentScope,requireChanges};
}
module.exports={createProductionAccess};
