/* Pure validation and calculations. No browser storage or personnel writes. */
const PairTargets = (() => {
  const TEAMS = [...ShiftSchedule.TEAMS, 'СТИКЕРИ'];
  const REASONS = [
    {key:'materials', label:'Липса на материал'},
    {key:'downtime', label:'Авария / престой'},
    {key:'changeover', label:'Смяна на артикул / пренастройка'},
    {key:'quality', label:'Проблем с качеството / доработка'},
    {key:'staffing', label:'Недостатъчен състав / отсъствие'},
    {key:'other', label:'Друга причина'}
  ];
  function emptyData() { return {module:'pair-targets', schemaVersion:1, entries:[]}; }
  function scopeKey(context) { return context.date + '/' + context.shiftCode + '/' + context.team; }
  function inScope(entry, context) { return scopeKey(entry) === scopeKey(context); }
  function number(value, label, positive = false, integer = false) {
    if(value === null || value === undefined || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) throw new Error('Въведете '+label+'.');
    const result = Number(value);
    if(!Number.isFinite(result) || (positive ? result <= 0 : result < 0) || integer && !Number.isInteger(result)) {
      throw new Error(label+' трябва да е '+(positive ? 'положително' : 'неотрицателно')+(integer ? ' цяло число.' : ' число.'));
    }
    return result;
  }
  function areas(value) {
    if(!Array.isArray(value) || !value.length || value.some(area => !['auto','manual'].includes(area))) {
      throw new Error('Изберете автоматична и/или ръчна опаковка.');
    }
    return [...new Set(value)];
  }
  function roster(employees, team) {
    return employees.filter(person => person.active !== false && person.id && person.name &&
      (team === 'СТИКЕРИ' ? person.category === 'stickers' : person.team === team && ['auto','manual'].includes(person.category))
    ).slice().sort((a,b) => a.name.localeCompare(b.name,'bg'));
  }
  function status(entry) {
    if(!entry.result) return 'pending';
    return entry.result.kg >= entry.targetKg && entry.result.crates >= entry.targetCrates ? 'achieved' : 'missed';
  }
  function plan({data, employees, context, memberIds, targetKg, targetCrates, workAreas, existingId = null, id, now}) {
    ShiftSchedule.parseDate(context.date);
    if(![1,2,3].includes(Number(context.shiftCode)) || !TEAMS.includes(context.team) || !ShiftSchedule.isScheduled(context)) {
      throw new Error('Избраният екип не работи тази смяна според ротацията.');
    }
    const existing = existingId ? data.entries.find(entry => entry.id === existingId) : null;
    if(existingId && (!existing || !inScope(existing,context))) throw new Error('Двойката вече не е налична в тази смяна.');
    if(existing && existing.result) throw new Error('Тази двойка вече е отчетена. Коригирайте отчета при нужда.');
    if(!Array.isArray(memberIds) || memberIds.length !== 2 || !memberIds[0] || !memberIds[1] || memberIds[0] === memberIds[1]) {
      throw new Error('Изберете двама различни човека.');
    }
    const people = roster(employees,context.team);
    const members = memberIds.map(memberId => {
      const person = people.find(person => person.id === memberId);
      if(person) return {id:person.id, name:person.name, category:person.category, role:person.role || ''};
      const saved = existing && existing.members.find(person => person.id === memberId);
      if(saved) return {...saved};
      throw new Error('Човекът вече не е в активния състав на този екип. Опреснете избора.');
    });
    const occupied = data.entries.filter(entry => entry.id !== existingId && inScope(entry,context));
    if(occupied.some(entry => entry.members.some(person => memberIds.includes(person.id)))) {
      throw new Error('Някой от избраните хора вече участва в друга двойка за тази смяна.');
    }
    return {
      id:existing ? existing.id : id, date:context.date, shiftCode:Number(context.shiftCode), team:context.team,
      members, areas:areas(workAreas), targetKg:number(targetKg,'Целта в килограми',true),
      targetCrates:number(targetCrates,'Целта в каси',true,true), result:null,
      createdAt:existing ? existing.createdAt : now, updatedAt:now
    };
  }
  function report(entry, {context, kg, crates, reasonKey, reasonText, workAreas, now}) {
    if(!context || !inScope(entry,context)) throw new Error('Отчетът трябва да е за избраната работна смяна.');
    const result = {kg:number(kg,'Резултата в килограми'), crates:number(crates,'Резултата в каси',false,true), reasonKey:'', reasonText:'', reportedAt:now};
    const missed = result.kg < entry.targetKg || result.crates < entry.targetCrates;
    if(missed) {
      const preset = REASONS.find(reason => reason.key === reasonKey);
      const text = String(reasonText || '').trim();
      if(!preset && !text || preset && preset.key === 'other' && !text) throw new Error('При непостигнат таргет изберете причина или напишете обяснение.');
      result.reasonKey = preset ? preset.key : 'other';
      result.reasonText = text;
    }
    return {...entry, areas:areas(workAreas), result, updatedAt:now};
  }
  function validateData(data) {
    if(!data || data.module !== 'pair-targets' || data.schemaVersion !== 1 || !Array.isArray(data.entries)) {
      throw new Error('Изберете pair-targets.json. Този файл не съдържа двойки и таргети.');
    }
    const ids = new Set();
    const used = new Set();
    data.entries.forEach(entry => {
      if(!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || !TEAMS.includes(entry.team) || ![1,2,3].includes(entry.shiftCode)) throw new Error('Невалиден запис за двойка.');
      ids.add(entry.id);
      ShiftSchedule.parseDate(entry.date);
      if(!Array.isArray(entry.members) || entry.members.length !== 2) throw new Error('Всяка двойка трябва да има двама човека.');
      entry.members.forEach(person => {
        if(!person || typeof person.id !== 'string' || !person.id || typeof person.name !== 'string' || !person.name.trim()) throw new Error('Невалиден човек в двойката.');
        const key = scopeKey(entry) + '/' + person.id;
        if(used.has(key)) throw new Error('Човек участва в две двойки в същата смяна.');
        used.add(key);
      });
      number(entry.targetKg,'Целта в килограми',true);
      number(entry.targetCrates,'Целта в каси',true,true);
      if(typeof entry.targetKg !== 'number' || typeof entry.targetCrates !== 'number') throw new Error('Невалидни числови таргети.');
      areas(entry.areas);
      if(entry.result) {
        if(typeof entry.result.kg !== 'number' || typeof entry.result.crates !== 'number') throw new Error('Невалиден числов отчет.');
        report(entry,{context:entry,...entry.result,workAreas:entry.areas,now:entry.result.reportedAt});
      }
    });
    return data;
  }
  return {TEAMS, REASONS, emptyData, scopeKey, inScope, roster, status, plan, report, validateData};
})();
