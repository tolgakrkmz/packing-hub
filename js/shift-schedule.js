/* Shared rotation and production-day boundaries for personnel and pair targets. */
const ShiftSchedule = (() => {
  const TEAMS = ['А', 'Б', 'В', 'Г'];
  const PATTERN = [3,3,3,3,'Н',2,2,2,2,'Н',1,1,1,1,'Н','Н'];
  const OFFSETS = {'А':2, 'Б':14, 'В':6, 'Г':10};
  const EPOCH = Date.UTC(2026, 11, 1);
  const LABELS = {1:'1-ва смяна', 2:'2-ра смяна', 3:'Нощна смяна', 'Н':'Почивка'};
  const HOURS = {1:'06:00–14:00', 2:'14:00–22:00', 3:'22:00–06:00'};
  const STICKERS = {team:'СТИКЕРИ', start:'09:00', end:'17:30', hours:'09:00–17:30'};

  function localDate(date = new Date()) {
    return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
  }
  function parseDate(value) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('Изберете валидна дата.');
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month-1, day);
    if(localDate(date) !== value) throw new Error('Изберете валидна дата.');
    return date;
  }
  function addDays(value, count) {
    const date = parseDate(value);
    date.setDate(date.getDate()+count);
    return localDate(date);
  }
  const sofiaClock = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Sofia', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
  function sofiaParts(at) {
    return Object.fromEntries(sofiaClock.formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  }
  function sofiaDate(at = new Date()) {
    const p=sofiaParts(at);
    return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
  }
  function sofiaInstant(date, hour, minute=0) {
    parseDate(date);
    const [y,m,d]=date.split('-').map(Number), wall=Date.UTC(y,m-1,d,hour,minute);
    let instant=wall;
    for(let n=0;n<2;n++) {
      const p=sofiaParts(new Date(instant));
      instant+=wall-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    }
    return instant;
  }
  function shiftInterval(team, date) {
    const code=shiftCodeFor(team,parseDate(date));
    if(code==='Н') return null;
    const start=team===STICKERS.team ? sofiaInstant(date,9) : sofiaInstant(date,code===1?6:code===2?14:22);
    const end=team===STICKERS.team ? sofiaInstant(date,17,30) : sofiaInstant(code===3?addDays(date,1):date,code===1?14:code===2?22:6);
    return {start,end,code};
  }
  function shiftCodeFor(team, date) {
    if(team === STICKERS.team) return [0,6].includes(date.getDay()) ? 'Н' : 1;
    if(!TEAMS.includes(team)) throw new Error('Невалиден екип.');
    const days = Math.round((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-EPOCH)/86400000);
    return PATTERN[((days+OFFSETS[team])%16+16)%16];
  }
  function teamFor(date, code) {
    return TEAMS.find(team => shiftCodeFor(team, date) === Number(code)) || null;
  }
  function current(at = new Date()) {
    const hour = at.getHours();
    const code = hour < 6 || hour >= 22 ? 3 : hour < 14 ? 1 : 2;
    const date = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    if(hour < 6) date.setDate(date.getDate()-1);
    return {date:localDate(date), shiftCode:code, team:teamFor(date,code)};
  }
  function isScheduled(context) {
    if(context.team === STICKERS.team) return Number(context.shiftCode) === 1 && shiftCodeFor(context.team,parseDate(context.date)) === 1;
    return TEAMS.includes(context.team) && shiftCodeFor(context.team,parseDate(context.date)) === Number(context.shiftCode);
  }
  function hoursFor(context) {
    return context.team === STICKERS.team ? STICKERS.hours : HOURS[context.shiftCode];
  }
  function isCurrent(context, at = new Date()) {
    if(context.team !== STICKERS.team) {
      const live = current(at);
      return context.date === live.date && Number(context.shiftCode) === live.shiftCode && context.team === live.team;
    }
    const minutes = at.getHours()*60 + at.getMinutes();
    return context.date === localDate(at) && isScheduled(context) && minutes >= 9*60 && minutes < 17*60+30;
  }
  return {TEAMS, LABELS, HOURS, STICKERS, localDate, parseDate, addDays, sofiaDate, shiftInterval, shiftCodeFor, teamFor, current, isScheduled, hoursFor, isCurrent};
})();
