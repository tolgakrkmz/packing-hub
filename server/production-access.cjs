/* One reporting policy for operation writes, legacy replacements and closeout. */
const {isDeepStrictEqual}=require('node:util');
const {can}=require('./permissions.cjs');
function createProductionAccess(store,{schedule,problem,now=Date.now}) {
  const {db,get,updateDocument,audit,transaction}=store, teams=[...schedule.TEAMS,'СТИКЕРИ'];
  const GRACE=4*60*60*1000;
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  db.exec(`CREATE TABLE IF NOT EXISTS production_shift_authorizations(
    date TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL,
    enabled INTEGER NOT NULL, reason TEXT NOT NULL, user_id INTEGER, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS production_pending_shifts(date TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
  const validReason=value=>typeof value==='string'&&value.trim().length>0&&value.length<=1000;
  const instant=(date,time)=>{const [hour,minute]=time.split(':').map(Number);return schedule.sofiaInstant(date,hour,minute);};
  function scope(date,team) {
    try {schedule.parseDate(date);if(!teams.includes(team))throw new Error();}
    catch {throw problem(400,'INVALID_PRODUCTION_SCOPE');}
    return {date,team};
  }
  function interval(date,team) {
    scope(date,team);
    const regular=schedule.shiftInterval(team,date);
    if(regular)return {...regular,extraordinary:false};
    if(team!=='СТИКЕРИ')return null;
    const extra=db.prepare('SELECT start,end FROM production_shift_authorizations WHERE date=? AND enabled=1').get(date);
    if(!extra)return null;
    return {start:instant(date,extra.start),end:instant(date,extra.end),code:1,extraordinary:true};
  }
  // A Stickers rest day without any administrator decision accepts reports that wait for approval.
  function pending(date) {
    return !schedule.shiftInterval('СТИКЕРИ',date)&&!db.prepare('SELECT 1 FROM production_shift_authorizations WHERE date=?').get(date);
  }
  // Only dates reported without a decision wait; older rest-day history stays counted.
  function awaiting(date) {
    return !!db.prepare('SELECT 1 FROM production_pending_shifts p WHERE p.date=? AND NOT EXISTS(SELECT 1 FROM production_shift_authorizations a WHERE a.date=p.date)').get(date);
  }
  function writeInterval(date,team) {
    const value=interval(date,team);
    if(value||team!=='СТИКЕРИ'||!pending(date))return value;
    const {start,end}=schedule.STICKERS;
    return {start:instant(date,start),end:instant(date,end),code:1,extraordinary:true,pending:true};
  }
  function status(date,team,user,at=now(),kind='production-log',shiftCode=null) {
    const value=writeInterval(date,team), assigned=user.taskTeam===team;
    const inWindow=!!value&&at>=value.start&&at<value.end+GRACE&&(shiftCode===null||Number(shiftCode)===value.code);
    const prefix=kind==='pair-targets'?'PAIR':'PRODUCTION';
    const code=!teams.includes(user.taskTeam)?prefix+'_TEAM_REQUIRED':!assigned?prefix+'_TEAM_MISMATCH':!inWindow?prefix+'_WINDOW_CLOSED':null;
    return {date,team,now:at,interval:value,deadline:value?value.end+GRACE:null,
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
      canAuthorize:!pairs&&user.role==='admin'&&can(user,'canManageProductionSettings'),restDay:team==='СТИКЕРИ'&&!schedule.shiftInterval(team,date),currentScope:pairs?{...current,shiftCode:interval(current.date,current.team)?.code||1}:current};
  }
  function requireChanges(before,after,user,reason,kind='production-log') {
    const pairs=kind==='pair-targets';
    const prior=new Map(before.entries.map(e=>[e.id,e])),next=new Map(after.entries.map(e=>[e.id,e]));
    const checked=new Map();
    for(const id of new Set([...prior.keys(),...next.keys()])) {
      if(isDeepStrictEqual(prior.get(id),next.get(id)))continue;
      for(const entry of [prior.get(id),next.get(id)].filter(Boolean))checked.set(entry.date+'/'+(pairs?entry.team+'/'+entry.shiftCode:entry.shift),entry);
    }
    // Pair administrators retain their existing correction workflow.
    if(pairs&&user.role==='admin') {
      for(const entry of checked.values())if(writeInterval(entry.date,entry.team)?.pending)db.prepare('INSERT OR IGNORE INTO production_pending_shifts VALUES(?,?)').run(entry.date,now());
      return;
    }
    const exceptions=[];
    for(const entry of checked.values()) {
      const value=status(entry.date,pairs?entry.team:entry.shift,user,now(),kind,pairs?entry.shiftCode:null);
      if(value.interval?.pending)db.prepare('INSERT OR IGNORE INTO production_pending_shifts VALUES(?,?)').run(entry.date,now());
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
  function configure(input,user) {
    if(user.role!=='admin'||!can(user,'canViewProduction')||!can(user,'canManageProductionSettings'))throw problem(403,'FORBIDDEN');
    if(!input||Object.keys(input).some(key=>!['date','start','end','enabled','reason'].includes(key))||typeof input.enabled!=='boolean'||typeof input.start!=='string'||typeof input.end!=='string'||!validReason(input.reason)||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.end)||input.start>=input.end)throw problem(400,'INVALID_PRODUCTION_AUTHORIZATION');
    scope(input.date,'СТИКЕРИ');
    if(schedule.shiftInterval('СТИКЕРИ',input.date))throw problem(400,'INVALID_PRODUCTION_AUTHORIZATION');
    const start=instant(input.date,input.start),end=instant(input.date,input.end);
    if(clock.format(start)!==input.start||clock.format(end)!==input.end||end<=start)throw problem(400,'INVALID_PRODUCTION_AUTHORIZATION');
    return transaction(()=>{
      db.prepare(`INSERT INTO production_shift_authorizations VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(date) DO UPDATE SET start=excluded.start,end=excluded.end,enabled=excluded.enabled,reason=excluded.reason,user_id=excluded.user_id,at=excluded.at`)
        .run(input.date,input.start,input.end,input.enabled?1:0,input.reason.trim(),user.id??null,now());
      // Rejecting the shift removes its Stickers reports; report history keeps them for a restore.
      let removed=0;
      if(!input.enabled)for(const kind of ['production-log','pair-targets']) {
        const current=get(kind), entries=current.data.entries.filter(entry=>!(entry.date===input.date&&(kind==='pair-targets'?entry.team:entry.shift)==='СТИКЕРИ'));
        if(entries.length===current.data.entries.length)continue;
        removed+=current.data.entries.length-entries.length;
        updateDocument(kind,{...current.data,entries},user,{reason:input.reason.trim(),action:'delete'},current);
      }
      audit(user,'production-shift-authorize','production-log',{date:input.date,start:input.start,end:input.end,enabled:input.enabled,reason:input.reason.trim(),removed});
      return read({date:input.date,team:'СТИКЕРИ'},user);
    });
  }
  return {interval,writeInterval,pending,awaiting,status,read,currentScope,requireChanges,configure};
}
module.exports={createProductionAccess};
