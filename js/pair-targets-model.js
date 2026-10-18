/* Pure validation and calculations. No browser storage or personnel writes. */
const PairTargets = (() => {
  const TEAMS = [...ShiftSchedule.TEAMS, 'СТИКЕРИ'];
  const REASONS = [
    {key:'materials', label:'Липса на материал'},
    {key:'downtime', label:'Авария / престой'},
    {key:'changeover', label:'Смяна на артикул / пренастройка'},
    {key:'quality', label:'Проблем с качеството / доработка'},
    {key:'staffing', label:'Недостатъчен състав / отсъствие'},
    {key:'small-profiles', label:'Дребни / леки профили (много каси, малко кг)'},
    {key:'heavy-profiles', label:'Тежки профили (кг постигнати, по-малко каси)'},
    {key:'crane', label:'Чакане на кран / товарач'},
    {key:'slow-pace', label:'Бавно темпо'},
    {key:'training', label:'Нов / обучаващ се служител'},
    {key:'other-work', label:'Друга задача / преместване'},
    {key:'cleaning', label:'Почистване на машина'},
    {key:'other', label:'Друга причина'}
  ];
  const CANCELLATION_REASONS = [
    {key:'left', label:'Тръгнал си'},
    {key:'cleaning', label:'Чистене'},
    {key:'other-work', label:'Извършване на друга дейност'},
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
  function roster(employees, team, date = ShiftSchedule.sofiaDate()) {
    return employees.map(person => {
      if(typeof PersonnelModel !== 'undefined') return PersonnelModel.assignmentAt(person,date);
      if(person.transfers?.length) throw new Error('Липсва моделът за планирания състав.');
      return person;
    }).filter(person => person.active !== false && person.id && person.name &&
      typeof person.role === 'string' && person.role.trim().toLowerCase() === 'опаковчик' &&
      (team === 'СТИКЕРИ' ? person.category === 'stickers' : person.team === team && ['auto','manual'].includes(person.category))
    ).slice().sort((a,b) => a.name.localeCompare(b.name,'bg'));
  }
  function status(entry) {
    if(entry.cancellation) return 'cancelled';
    if(!entry.result) return 'pending';
    return entry.result.kg >= entry.targetKg && entry.result.crates >= entry.targetCrates ? 'achieved' : 'missed';
  }
  function plan({data, employees, context, memberIds, targetKg, targetCrates, workAreas, existingId = null, id, now, extraordinary = false}) {
    ShiftSchedule.parseDate(context.date);
    if(![1,2,3].includes(Number(context.shiftCode)) || !TEAMS.includes(context.team) || !ShiftSchedule.isScheduled(context) && !(extraordinary && context.team === 'СТИКЕРИ' && Number(context.shiftCode) === 1)) {
      throw new Error('Избраният екип не работи тази смяна според ротацията.');
    }
    const existing = existingId ? data.entries.find(entry => entry.id === existingId) : null;
    if(existingId && (!existing || !inScope(existing,context))) throw new Error('Двойката вече не е налична в тази смяна.');
    if(existing?.cancellation) throw new Error('Отменена двойка не може да се променя или отчита.');
    if(existing && existing.result) throw new Error('Тази двойка вече е отчетена. Коригирайте отчета при нужда.');
    if(!Array.isArray(memberIds) || memberIds.length !== 2 || !memberIds[0] || !memberIds[1] || memberIds[0] === memberIds[1]) {
      throw new Error('Изберете двама различни човека.');
    }
    const people = roster(employees,context.team,context.date);
    const members = memberIds.map(memberId => {
      const person = people.find(person => person.id === memberId);
      if(person) return {id:person.id, name:person.name, category:person.category, role:person.role || ''};
      const saved = existing && existing.members.find(person => person.id === memberId);
      if(saved) return {...saved};
      throw new Error('Човекът вече не е в активния състав на този екип. Опреснете избора.');
    });
    const occupied = data.entries.filter(entry => !entry.cancellation && entry.id !== existingId && inScope(entry,context));
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
    if(entry.cancellation) throw new Error('Отменена двойка не може да се променя или отчита.');
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
  function cancel(entry, {context, reasonKey, reasonText = '', now}) {
    if(!context || !inScope(entry,context)) throw new Error('Двойката не е от избраната смяна.');
    if(entry.result || entry.cancellation) throw new Error('Може да се отменя само неотчетена активна двойка.');
    const preset = CANCELLATION_REASONS.find(reason => reason.key === reasonKey);
    if(typeof reasonText !== 'string' || reasonText.length > 1000 || !preset || preset.key === 'other' && !reasonText.trim()) {
      throw new Error('Изберете причина за отмяната. При друга причина добавете обяснение до 1000 знака.');
    }
    if(typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(now) || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString().replace('.000Z','Z') !== now.replace('.000Z','Z')) throw new Error('Невалиден момент на отмяна.');
    return {...entry, cancellation:{reasonKey:preset.key, reasonText:reasonText.trim(), cancelledAt:now}, updatedAt:now};
  }
  // Every shift aims for 30 t, split across the pairs the supervisor entered.
  const SHIFT_GOAL_KG = 30000;
  function pairNorm(pairCount) { return pairCount ? SHIFT_GOAL_KG/pairCount : 0; }
  const HISTORY_SHIFTS = 10, NOT_PEOPLE_REASONS = ['downtime','materials'];
  // Average kg per person over their last 10 reported shifts; a pair result is split equally between its two people.
  // Shifts lost to downtime or missing material are skipped because the people could not influence them.
  function personAverages(history, scope) {
    const shifts = new Map();
    history.filter(entry => entry.result && !entry.cancellation && !NOT_PEOPLE_REASONS.includes(entry.result.reasonKey) && !(scope && inScope(entry,scope)))
      .sort((a,b) => (b.date+b.shiftCode).localeCompare(a.date+a.shiftCode))
      .forEach(entry => entry.members.forEach(person => {
        const list = shifts.get(person.id) || [];
        if(list.length < HISTORY_SHIFTS) shifts.set(person.id,[...list,entry.result.kg/entry.members.length]);
      }));
    return new Map([...shifts].map(([id,list]) => [id,{kg:list.reduce((sum,kg) => sum+kg,0)/list.length,shifts:list.length}]));
  }
  // Expected kg of each pair; people without history get the average of the known people in the same shift.
  function pairStrengths(entries, history) {
    const averages = personAverages(history,entries[0]);
    const people = entries.flatMap(entry => entry.members.map(person => averages.get(person.id)?.kg)).filter(kg => kg > 0);
    const fallback = people.length ? people.reduce((sum,kg) => sum+kg,0)/people.length : 1;
    return new Map(entries.map(entry => {
      const known = entry.members.every(person => averages.get(person.id)?.kg > 0);
      return [entry.id,{kg:entry.members.reduce((sum,person) => sum+(averages.get(person.id)?.kg > 0 ? averages.get(person.id).kg : fallback),0),known}];
    }));
  }
  // Стикери work to their own plan, so the 30 t shift goal does not apply to them.
  function hasShiftGoal(team) { return team !== 'СТИКЕРИ'; }
  // Splits what reported pairs leave of 30 t across the unreported pairs in proportion to their history.
  // A target the supervisor set higher is never lowered; the rest is shared by the others. Rounded up to 100 kg.
  function equalize(entries, now, history = []) {
    const active = entries.filter(entry => !entry.cancellation), open = active.filter(entry => !entry.result);
    if(!open.length || !hasShiftGoal(open[0].team) || active.reduce((sum,entry) => sum+entry.targetKg,0) >= SHIFT_GOAL_KG) return [];
    const strength = pairStrengths(open,history);
    let remaining = SHIFT_GOAL_KG-active.filter(entry => entry.result).reduce((sum,entry) => sum+entry.targetKg,0), free = open, kept;
    do {
      const total = free.reduce((sum,entry) => sum+strength.get(entry.id).kg,0);
      kept = free.filter(entry => remaining*strength.get(entry.id).kg/total <= entry.targetKg);
      remaining -= kept.reduce((sum,entry) => sum+entry.targetKg,0);
      free = free.filter(entry => !kept.includes(entry));
    } while(kept.length && free.length);
    const total = free.reduce((sum,entry) => sum+strength.get(entry.id).kg,0);
    return free.map(entry => ({...entry, targetKg:Math.ceil(remaining*strength.get(entry.id).kg/total/100)*100, updatedAt:now}))
      .filter(entry => entry.targetKg > open.find(item => item.id === entry.id).targetKg);
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
      const memberIds = new Set();
      entry.members.forEach(person => {
        if(!person || typeof person.id !== 'string' || !person.id || typeof person.name !== 'string' || !person.name.trim()) throw new Error('Невалиден човек в двойката.');
        const key = scopeKey(entry) + '/' + person.id;
        if(memberIds.has(person.id) || !entry.cancellation && used.has(key)) throw new Error('Човек участва в две двойки в същата смяна.');
        memberIds.add(person.id);
        if(!entry.cancellation) used.add(key);
      });
      number(entry.targetKg,'Целта в килограми',true);
      number(entry.targetCrates,'Целта в каси',true,true);
      if(typeof entry.targetKg !== 'number' || typeof entry.targetCrates !== 'number') throw new Error('Невалидни числови таргети.');
      areas(entry.areas);
      if(entry.cancellation !== undefined && entry.cancellation !== null) {
        const value = entry.cancellation;
        if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Невалидна отмяна на двойка.');
        const cancelled = cancel({...entry,cancellation:null},{context:entry,reasonKey:value.reasonKey,reasonText:value.reasonText,now:value.cancelledAt});
        if(Object.keys(value).length !== 3 || Object.keys(cancelled.cancellation).some(key => cancelled.cancellation[key] !== value[key]) || entry.updatedAt !== value.cancelledAt) throw new Error('Невалидна отмяна на двойка.');
      }
      if(entry.result) {
        if(typeof entry.result.kg !== 'number' || typeof entry.result.crates !== 'number') throw new Error('Невалиден числов отчет.');
        report(entry,{context:entry,...entry.result,workAreas:entry.areas,now:entry.result.reportedAt});
      }
    });
    return data;
  }
  return {TEAMS, REASONS, CANCELLATION_REASONS, emptyData, scopeKey, inScope, roster, status, plan, report, cancel, validateData, SHIFT_GOAL_KG, HISTORY_SHIFTS, hasShiftGoal, pairNorm, personAverages, pairStrengths, equalize};
})();
