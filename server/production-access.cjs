/* One reporting policy for operation writes, legacy replacements and closeout. */
const {isDeepStrictEqual}=require('node:util');
const {can}=require('./permissions.cjs');
function createProductionAccess(store,{schedule,problem,now=Date.now}) {
  const {db}=store, teams=[...schedule.TEAMS,'СТИКЕРИ'];
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  db.exec(`CREATE TABLE IF NOT EXISTS production_shift_authorizations(
    date TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL,
    enabled INTEGER NOT NULL, reason TEXT NOT NULL, user_id INTEGER, at INTEGER NOT NULL)`);
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
  function status(date,team,user,at=now()) {
    const value=interval(date,team), assigned=user.taskTeam===team;
    const inWindow=!!value&&at>=value.start&&at<value.end;
    const code=!teams.includes(user.taskTeam)?'PRODUCTION_TEAM_REQUIRED':!assigned?'PRODUCTION_TEAM_MISMATCH':!inWindow?'PRODUCTION_WINDOW_CLOSED':null;
    return {date,team,now:at,interval:value,deadline:value?value.end:null,
      allowed:!code,code,adminException:user.role==='admin'&&!!code};
  }
  function currentScope(user,at=now()) {
    const team=teams.includes(user.taskTeam)?user.taskTeam:teams[0], today=schedule.sofiaDate(new Date(at));
    const candidates=[schedule.addDays(today,-1),today].map(date=>({date,team,value:interval(date,team)}));
    const current=candidates.find(({value})=>value&&at>=value.start&&at<value.end);
    if(current)return {date:current.date,team};
    return {date:today,team};
  }
  function read(input,user) {
    if(!can(user,'canViewProduction'))throw problem(403,'FORBIDDEN');
    const params=input instanceof URLSearchParams?input:new URLSearchParams(input);
    if([...params.keys()].some(key=>!['date','team'].includes(key)||params.getAll(key).length!==1))throw problem(400,'INVALID_PRODUCTION_SCOPE');
    const current=currentScope(user), date=params.get('date')??current.date,team=params.get('team')??current.team;
    const value=status(date,team,user);
    return {...value,canCreate:can(user,'canCreateProduction')&&(value.allowed||value.adminException),
      canEdit:can(user,'canEditProduction')&&(value.allowed||value.adminException),
      canAuthorize:user.role==='admin'&&can(user,'canManageProductionSettings'),currentScope:current};
  }
  function requireChanges(before,after,user,reason) {
    const prior=new Map(before.entries.map(e=>[e.id,e])),next=new Map(after.entries.map(e=>[e.id,e]));
    const checked=new Map();
    for(const id of new Set([...prior.keys(),...next.keys()])) {
      if(isDeepStrictEqual(prior.get(id),next.get(id)))continue;
      for(const entry of [prior.get(id),next.get(id)].filter(Boolean))checked.set(entry.date+'/'+entry.shift,entry);
    }
    const exceptions=[];
    for(const entry of checked.values()) {
      const value=status(entry.date,entry.shift,user);
      if(value.allowed)continue;
      if(!value.adminException)throw problem(403,value.code);
      if(!validReason(reason))throw problem(428,'PRODUCTION_EXCEPTION_REASON_REQUIRED');
      exceptions.push({date:entry.date,team:entry.shift});
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
    return store.transaction(()=>{
      db.prepare(`INSERT INTO production_shift_authorizations VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(date) DO UPDATE SET start=excluded.start,end=excluded.end,enabled=excluded.enabled,reason=excluded.reason,user_id=excluded.user_id,at=excluded.at`)
        .run(input.date,input.start,input.end,input.enabled?1:0,input.reason.trim(),user.id??null,now());
      store.audit(user,'production-shift-authorize','production-log',{date:input.date,start:input.start,end:input.end,enabled:input.enabled,reason:input.reason.trim()});
      return read({date:input.date,team:'СТИКЕРИ'},user);
    });
  }
  return {interval,status,read,currentScope,requireChanges,configure};
}
module.exports={createProductionAccess};
