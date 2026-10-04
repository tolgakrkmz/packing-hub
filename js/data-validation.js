/* Validate before accepting or writing a file. Filenames and user text remain unchanged. */
const HubDataValidation = (() => {
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && !!value.trim();
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const optionalText = value => value === undefined || typeof value === 'string';
  const shifts = ['А','Б','В','Г','СТИКЕРИ'];
  const labels = {'production-log':'Тонаж и брак','line-downtime':'Престои','personnel':'Смени и хора','pair-targets':'Двойки и таргети','package-instructions':'Инструкции за опаковка'};
  function error(message) { const result = new Error(message); result.code = 'HUB_DATA'; return result; }
  function date(value) {
    if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year,month,day] = value.split('-').map(Number);
    const at = new Date(0); at.setUTCFullYear(year,month-1,day); at.setUTCHours(0,0,0,0);
    return at.getUTCFullYear() === year && at.getUTCMonth() === month-1 && at.getUTCDate() === day;
  }
  function records(rows, predicate) {
    if(!Array.isArray(rows)) return false;
    const ids = new Set();
    return rows.every(row => {
      if(!object(row) || !text(row.id) || ids.has(row.id) || !predicate(row)) return false;
      ids.add(row.id); return true;
    });
  }
  function production(data) {
    return !('reasons' in data) && !('employees' in data) &&
      (data.goalTons === undefined || number(data.goalTons)) &&
      records(data.entries,row => date(row.date) && shifts.includes(row.shift) && number(row.tonnage) && number(row.brak) &&
        (row.breakdown == null || object(row.breakdown) && ['autoKg','autoCrates','manKg','manCrates'].every(key => number(row.breakdown[key]))));
  }
  function downtime(data) {
    const time = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    return !('goalTons' in data) && !('employees' in data) &&
      (data.reasons === undefined || Array.isArray(data.reasons) && data.reasons.every(text)) &&
      records(data.entries,row => date(row.date) && shifts.includes(row.shift) && time(row.start) && time(row.end) &&
        number(row.durationMin) && row.durationMin > 0 && row.durationMin < 1440 && text(row.reason) && optionalText(row.reasonNote) && optionalText(row.note));
  }
  function personnel(data) {
    return !('entries' in data) && Array.isArray(data.employees) &&
      (data.schemaVersion === undefined || [1,2,3].includes(data.schemaVersion)) &&
      records(data.employees,row => text(row.name) && (row.category === undefined || ['auto','manual','stickers'].includes(row.category)) &&
        optionalText(row.team) && optionalText(row.role) && optionalText(row.note) && (row.active === undefined || typeof row.active === 'boolean')) &&
      (data.settings === undefined || object(data.settings) && ['stickersStage1','stickersStage2'].every(key => data.settings[key] === undefined || number(data.settings[key]))) &&
      (data.moveLog === undefined || Array.isArray(data.moveLog) && data.moveLog.every(object));
  }
  function instructions(data) {
    const relative = value => text(value) && !/^[\\/]|^[a-z]:/i.test(value) && !value.split(/[\\/]/).some(part => part === '..' || part === '.');
    return !['entries','employees','schemaVersion','module','goalTons','reasons'].some(key => key in data) &&
      Object.values(data).every(row => object(row) && text(row.number) && typeof row.name === 'string' && relative(row.folderName) &&
        optionalText(row.client) && (row.category == null || ['standard','special'].includes(row.category)) &&
        Array.isArray(row.images) && row.images.every(relative) && (row.timestamp === undefined || number(row.timestamp)));
  }
  function validate(kind,data) {
    let valid = object(data) && (data.module === undefined || data.module === kind);
    if(valid) {
      if(kind === 'pair-targets') {
        try { PairTargets.validateData(data); } catch { valid = false; }
      } else {
        const check = {'production-log':production,'line-downtime':downtime,personnel,'package-instructions':instructions}[kind];
        valid = !!check && check(data);
      }
    }
    if(!valid) throw error('Файлът не е валиден за „'+labels[kind]+'“. Данните не са променени.');
    return data;
  }
  function parse(kind,source) {
    if(!String(source).trim()) throw error('Файлът е празен. Изберете валиден JSON файл.');
    let value;
    try { value = JSON.parse(source); } catch { throw error('Файлът не съдържа валиден JSON.'); }
    return kind ? validate(kind,value) : value;
  }
  function kindFor(filename) { const name = filename.replace(/\.json$/,''); return Object.hasOwn(labels,name) ? name : ''; }
  return {validate,parse,kindFor,error};
})();
