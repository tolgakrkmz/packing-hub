/* Shared rotation and production-day boundaries for personnel and pair targets. */
const ShiftSchedule = (() => {
  const TEAMS = ['А', 'Б', 'В', 'Г'];
  const PATTERN = [3,3,3,3,'Н',2,2,2,2,'Н',1,1,1,1,'Н','Н'];
  const OFFSETS = {'А':2, 'Б':14, 'В':6, 'Г':10};
  const EPOCH = Date.UTC(2026, 11, 1);
  const LABELS = {1:'1-ва смяна', 2:'2-ра смяна', 3:'Нощна смяна', 'Н':'Почивка'};
  const HOURS = {1:'06:00–14:00', 2:'14:00–22:00', 3:'22:00–06:00'};

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
  function shiftCodeFor(team, date) {
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
    if(context.team === 'СТИКЕРИ') return Number(context.shiftCode) === 1;
    return TEAMS.includes(context.team) && shiftCodeFor(context.team,parseDate(context.date)) === Number(context.shiftCode);
  }
  return {TEAMS, LABELS, HOURS, localDate, parseDate, shiftCodeFor, teamFor, current, isScheduled};
})();
