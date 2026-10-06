/* Offline shift planning. Personnel is read only; all reports live in a separate file. */
(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt = value => Number(value).toLocaleString('bg-BG',{maximumFractionDigits:2});
  const fmtDate = value => value.split('-').reverse().join('.');
  const statusLabels = {pending:'Очаква отчет',achieved:'Постигнат',missed:'Непостигнат'};
  const areaLabels = {auto:'Автоматична',manual:'Ръчна'};
  let data = PairTargets.emptyData();
  let personnel = {employees:[]};
  let pairsLoaded = false, rosterLoaded = false, busy = false;
  let context = null, followLive = true, editing = null;
  const elements = prefix => Object.fromEntries(['connDot','connText','openFileBtn','createFileBtn','reconnectBtn','refreshBtn','connRow','connNote','importFallback'].map(key => [key,$(prefix+key[0].toUpperCase()+key.slice(1))]));
  const acceptPairs = value => { data = PairTargets.validateData(value); pairsLoaded = true; };
  const acceptRoster = value => {
    if(!value || !Array.isArray(value.employees) || value.employees.some(person => !person || typeof person.id !== 'string' || !person.id || typeof person.name !== 'string' || !person.name.trim()) || new Set(value.employees.map(person => person.id)).size !== value.employees.length) {
      throw new Error('Изберете файла personnel.json със състава от „Смени и хора“.');
    }
    personnel = value;
    rosterLoaded = true;
  };
  const sync = createFileSync({
    dbName:'portfolio-pair-targets-fs-db',suggestedFileName:'pair-targets.json',localStorageKey:'portfolio-pair-targets-fallback',
    strictJson:true,defaultData:PairTargets.emptyData,onConnect:acceptPairs,onRefresh:acceptPairs,
    getData:() => data,render,elements:elements('pairs'),isBusy:() => busy
  });
  const rosterSync = createFileSync({
    dbName:'portfolio-personnel-fs-db',suggestedFileName:'personnel.json',localStorageKey:'portfolio-personnel-fallback',
    readOnly:true,strictJson:true,defaultData:() => ({employees:[]}),onConnect:acceptRoster,onRefresh:acceptRoster,
    getData:() => personnel,render,elements:elements('roster'),isBusy:() => busy
  });

  function selectLive() {
    const live = ShiftSchedule.current();
    context = {...live};
    followLive = true;
    updateControls();
  }
  function updateControls() {
    if(!context) return;
    $('contextDate').value = context.date;
    $('contextShift').value = String(context.shiftCode);
    $('contextTeam').value = context.team;
  }
  function validScope() {
    try { return !!context && ShiftSchedule.isScheduled(context); } catch(error) { return false; }
  }
  function selectedEntries() { return data.entries.filter(entry => PairTargets.inScope(entry,context)); }
  function pairCard(entry, actions = false) {
    const state = PairTargets.status(entry);
    const metric = (target, actual, unit) => `<div class="metric"><span>${actual === undefined ? 'Цел' : 'Реално / цел'} · ${unit}</span><strong>${actual === undefined ? fmt(target) : fmt(actual)+' / '+fmt(target)}</strong></div>${actual === undefined ? '' : `<progress max="${target}" value="${Math.min(actual,target)}" aria-label="Изпълнение в ${unit}"></progress>`}`;
    const reason = PairTargets.REASONS.find(item => item.key === entry.result?.reasonKey);
    const cause = [reason ? escape(reason.label) : '', entry.result?.reasonText ? `<span translate="no">${escape(entry.result.reasonText)}</span>` : ''].filter(Boolean).join(' · ');
    return `<article class="pair-card">
      <div class="card-top"><h3 translate="no">${entry.members.map(person => escape(person.name)).join(' + ')}</h3><span class="badge ${state}">${statusLabels[state]}</span></div>
      <div class="area-tags">${entry.areas.map(area => `<span class="badge">${areaLabels[area]} опаковка</span>`).join('')}</div>
      ${metric(entry.targetKg,entry.result?.kg,'кг')}${metric(entry.targetCrates,entry.result?.crates,'каси')}
      ${state === 'missed' ? `<p class="cause"><strong>Причина:</strong> ${cause}</p>` : ''}
      ${actions ? `<div class="card-actions"><button data-action="report" data-reported="${!!entry.result}" data-id="${escape(entry.id)}">${entry.result ? 'Коригирай отчета' : 'Отчети резултат'}</button>${entry.result ? '' : `<button data-action="edit" data-id="${escape(entry.id)}">Промени</button><button class="delete" data-action="delete" data-id="${escape(entry.id)}">Премахни</button>`}</div>` : ''}
    </article>`;
  }
  function render() {
    if(!context) return;
    const live = ShiftSchedule.current();
    $('liveShift').textContent = `Екип ${live.team} · ${ShiftSchedule.LABELS[live.shiftCode]}`;
    $('stickersShiftBtn').setAttribute('aria-pressed',String(context.team === 'СТИКЕРИ'));
    $('stickersShiftBtn').disabled = busy;
    $('liveDate').textContent = `${fmtDate(live.date)} · ${ShiftSchedule.HOURS[live.shiftCode]}${new Date().getHours() < 6 ? ' · започнала вчера' : ''}`;
    const isCurrent = PairTargets.inScope(context,live) || context.team === 'СТИКЕРИ' && context.date === live.date && context.shiftCode === live.shiftCode;
    $('contextBadge').textContent = isCurrent ? 'Текуща смяна' : 'Друга работна смяна';
    $('contextBadge').className = 'badge '+(isCurrent ? 'achieved' : 'pending');
    $('contextNote').classList.toggle('historical',!isCurrent);
    const scheduled = validScope();
    const entries = selectedEntries();
    const people = PairTargets.roster(personnel.employees,context.team);
    const used = new Set(entries.flatMap(entry => entry.members.map(person => person.id)));
    const available = people.filter(person => !used.has(person.id));
    const done = entries.filter(entry => entry.result).length;
    const hit = entries.filter(entry => PairTargets.status(entry) === 'achieved').length;
    const totalKg = entries.reduce((sum,entry) => sum+entry.targetKg,0);
    const actualKg = entries.reduce((sum,entry) => sum+(entry.result?.kg || 0),0);
    const totalCrates = entries.reduce((sum,entry) => sum+entry.targetCrates,0);
    const actualCrates = entries.reduce((sum,entry) => sum+(entry.result?.crates || 0),0);
    $('contextNote').textContent = !pairsLoaded || !rosterLoaded ? 'Свържете файла за двойките и файла за състава, за да започнете.' : !scheduled ? `Екип ${context.team} не работи в избраните часове според ротацията. Изберете работната му смяна.` : `Екип ${context.team} · ${fmtDate(context.date)} · ${ShiftSchedule.HOURS[context.shiftCode]}. Таргетът е постигнат при изпълнение и на двете цели.${context.team === 'СТИКЕРИ' ? ' 1 смяна, фиксиран състав, без автоматична ротация.' : ''}`;
    $('shiftTotals').innerHTML = [
      [rosterLoaded ? people.length : '—','Хора в състава'],[rosterLoaded ? available.length : '—','Неразпределени'],
      [entries.length,`Двойки · ${done} отчетени · ${hit} постигнати`],[`${fmt(actualKg)} / ${fmt(totalKg)}`,`кг · ${fmt(actualCrates)} / ${fmt(totalCrates)} каси`]
    ].map(([value,label]) => `<div class="stat"><strong>${value}</strong>${label}</div>`).join('');
    $('rosterSummary').textContent = `Състав · ${rosterLoaded ? people.length+' човека' : 'изберете Personnel'}${rosterLoaded ? ' · '+available.length+' неразпределени' : ''}`;
    $('rosterList').innerHTML = people.map(person => `<span class="person ${used.has(person.id) ? 'used' : ''}"><span translate="no">${escape(person.name)}</span><small>${person.category === 'auto' ? 'Автоматична' : person.category === 'manual' ? 'Ръчна' : 'Стикери'} · ${used.has(person.id) ? 'В двойка' : 'Неразпределен'}</small></span>`).join('') || '<p class="muted">Няма зареден активен състав за този екип.</p>';
    $('addPairBtn').disabled = busy || !pairsLoaded || !rosterLoaded || !scheduled || available.length < 2;
    $('pairsList').innerHTML = entries.map(entry => pairCard(entry,true)).join('') || '<p class="empty">Няма двойки за избраната смяна.</p>';
    renderHistory();
  }
  function renderHistory() {
    const open = new Set(Array.from($('historyList').querySelectorAll('details[open]'),item => item.dataset.scope));
    const groups = new Map();
    data.entries.filter(entry => entry.date.slice(0,7) === $('historyMonth').value).sort((a,b) => b.date.localeCompare(a.date) || b.shiftCode-a.shiftCode || a.team.localeCompare(b.team,'bg')).forEach(entry => {
      const key = PairTargets.scopeKey(entry);
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(entry);
    });
    $('historyList').innerHTML = Array.from(groups,([key,entries]) => {
      const first = entries[0];
      const count = state => entries.filter(entry => PairTargets.status(entry) === state).length;
      return `<details class="history-group" data-scope="${escape(key)}" ${open.has(key) ? 'open' : ''}><summary>${fmtDate(first.date)} · Екип ${escape(first.team)} · ${ShiftSchedule.HOURS[first.shiftCode]}<span class="history-counts">${entries.length} двойки · ${count('achieved')} постигнати · ${count('missed')} непостигнати · ${count('pending')} без отчет</span></summary><button class="jump" data-action="view" data-id="${escape(first.id)}">Отвори смяната</button><div class="pair-grid">${entries.map(entry => pairCard(entry)).join('')}</div></details>`;
    }).join('') || '<p class="empty">Няма записи за този месец.</p>';
  }
  function closeDialog() {
    if(busy) return;
    $('pairDialog').close();
    editing = null;
    if(followLive) { selectLive(); render(); }
  }
  function updateMemberOptions() {
    const one = $('memberOne'), two = $('memberTwo');
    Array.from(one.options).forEach(option => { option.disabled = !!option.value && option.value === two.value; });
    Array.from(two.options).forEach(option => { option.disabled = !!option.value && option.value === one.value; });
  }
  function openDialog(mode, entry = null) {
    if(busy || !pairsLoaded || !rosterLoaded) return;
    const scope = entry || context;
    editing = {mode,id:entry?.id || null,context:{date:scope.date,shiftCode:scope.shiftCode,team:scope.team},followLive,original:entry ? JSON.stringify(entry) : null};
    $('pairForm').reset();
    $('dialogError').textContent = '';
    $('dialogTitle').textContent = mode === 'report' ? 'Отчет на двойката' : entry ? 'Промяна на двойката' : 'Нова двойка';
    $('dialogContext').innerHTML = `${fmtDate(scope.date)} · Екип ${escape(scope.team)} · ${ShiftSchedule.HOURS[scope.shiftCode]}${mode === 'report' ? ' · <span translate="no">'+entry.members.map(person => escape(person.name)).join(' + ')+'</span>' : ''}`;
    $('planFields').hidden = mode === 'report';
    $('reportFields').hidden = mode !== 'report';
    ['memberOne','memberTwo','targetKg','targetCrates'].forEach(id => { $(id).disabled = mode === 'report'; $(id).required = mode !== 'report'; });
    ['actualKg','actualCrates','reasonKey','reasonText'].forEach(id => { $(id).disabled = mode !== 'report'; $(id).required = ['actualKg','actualCrates'].includes(id) && mode === 'report'; });
    const occupied = new Set(selectedEntries().filter(item => item.id !== entry?.id).flatMap(item => item.members.map(person => person.id)));
    const people = PairTargets.roster(personnel.employees,scope.team).filter(person => !occupied.has(person.id));
    (entry?.members || []).forEach(person => { if(!people.some(item => item.id === person.id)) people.push(person); });
    const options = '<option value="">Изберете човек</option>'+people.map(person => `<option translate="no" value="${escape(person.id)}">${escape(person.name)}</option>`).join('');
    $('memberOne').innerHTML = options;
    $('memberTwo').innerHTML = options;
    if(entry) {
      $('memberOne').value = entry.members[0].id;
      $('memberTwo').value = entry.members[1].id;
      $('targetKg').value = entry.targetKg;
      $('targetCrates').value = entry.targetCrates;
    }
    updateMemberOptions();
    $('reasonKey').innerHTML = '<option value="">Без предварително зададена причина</option>'+PairTargets.REASONS.map(reason => `<option value="${reason.key}">${reason.label}</option>`).join('');
    if(mode === 'report') {
      $('reportTargets').textContent = `Цел: ${fmt(entry.targetKg)} кг и ${fmt(entry.targetCrates)} каси`;
      $('actualKg').value = entry.result?.kg ?? '';
      $('actualCrates').value = entry.result?.crates ?? '';
      $('reasonKey').value = entry.result?.reasonKey || '';
      $('reasonText').value = entry.result?.reasonText || '';
    }
    $('areaAuto').checked = (entry?.areas || []).includes('auto');
    $('areaManual').checked = (entry?.areas || []).includes('manual');
    updateResultPreview();
    $('pairDialog').showModal();
  }
  function updateResultPreview() {
    if(editing?.mode !== 'report') return;
    const entry = data.entries.find(item => item.id === editing.id);
    if(!entry) return;
    const kg = $('actualKg').value, crates = $('actualCrates').value;
    const filled = kg !== '' && crates !== '';
    const achieved = filled && Number(kg) >= entry.targetKg && Number(crates) >= entry.targetCrates;
    $('resultPreview').textContent = filled ? (achieved ? 'Постигнат таргет · изпълнени са и двете цели.' : 'Непостигнат таргет · добавете причина.') : 'Въведете реалните килограми и каси.';
    $('resultPreview').className = 'badge '+(filled ? achieved ? 'achieved' : 'missed' : 'pending');
    $('reasonFields').hidden = achieved;
  }
  async function mutate(makeChange, errorElement) {
    if(busy) return false;
    busy = true;
    $('savePairBtn').disabled = true;
    const lockedControls = Array.from(document.querySelectorAll('#connPanel button, #pairDialog button[type="button"], #contextDate, #contextShift, #contextTeam, #currentShiftBtn, #stickersShiftBtn')).map(element => [element,element.disabled]);
    lockedControls.forEach(([element]) => { element.disabled = true; });
    errorElement.textContent = '';
    let previous = null;
    try {
      if(!pairsLoaded || !rosterLoaded) throw new Error('Първо свържете двата файла.');
      await rosterSync.refreshFromDisk();
      await sync.refreshFromDisk();
      previous = JSON.parse(JSON.stringify(data));
      const next = makeChange();
      data = PairTargets.validateData(next);
      await sync.commitData();
      return true;
    } catch(error) {
      if(previous) data = previous;
      errorElement.textContent = 'Записът не е направен. '+error.message;
      return false;
    } finally {
      busy = false;
      $('savePairBtn').disabled = false;
      lockedControls.forEach(([element,disabled]) => { element.disabled = disabled; });
      render();
    }
  }
  $('pairForm').addEventListener('submit', async event => {
    event.preventDefault();
    if(!editing || busy) return;
    const edit = {...editing};
    const inputs = {memberIds:[$('memberOne').value,$('memberTwo').value],targetKg:$('targetKg').value,targetCrates:$('targetCrates').value,
      kg:$('actualKg').value,crates:$('actualCrates').value,reasonKey:$('reasonKey').value,reasonText:$('reasonText').value,
      workAreas:[$('areaAuto').checked ? 'auto' : null,$('areaManual').checked ? 'manual' : null].filter(Boolean),now:new Date().toISOString()};
    const saved = await mutate(() => {
      if(!edit.id && edit.followLive && !PairTargets.inScope(edit.context,ShiftSchedule.current())) throw new Error('Работната смяна се смени, докато формата беше отворена. Затворете я и създайте двойката за текущата смяна.');
      const entry = data.entries.find(item => item.id === edit.id);
      if(edit.id && (!entry || JSON.stringify(entry) !== edit.original)) throw new Error('Двойката е променена след отваряне на формата. Отворете я отново.');
      const next = edit.mode === 'report' ? PairTargets.report(entry,{context:edit.context,...inputs}) : PairTargets.plan({data,employees:personnel.employees,context:edit.context,...inputs,existingId:edit.id,id:window.crypto?.randomUUID ? window.crypto.randomUUID() : 'pair_'+Date.now()+'_'+Math.random().toString(36).slice(2)});
      return {...data,entries:edit.id ? data.entries.map(item => item.id === edit.id ? next : item) : [...data.entries,next]};
    },$('dialogError'));
    if(saved) closeDialog();
  });
  $('pairsList').addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if(!button || busy) return;
    const entry = data.entries.find(item => item.id === button.dataset.id);
    if(!entry) return;
    if(button.dataset.action !== 'delete') { openDialog(button.dataset.action === 'report' ? 'report' : 'plan',entry); return; }
    if(!confirm('Да премахна ли тази неотчетена двойка? Хората ще могат да се разпределят отново.')) return;
    const original = JSON.stringify(entry);
    await mutate(() => {
      const current = data.entries.find(item => item.id === entry.id);
      if(!PairTargets.inScope(entry,context)) throw new Error('Двойката не е от избраната смяна.');
      if(!current || current.result || JSON.stringify(current) !== original) throw new Error('Двойката вече е променена или отчетена.');
      return {...data,entries:data.entries.filter(item => item.id !== entry.id)};
    },$('pageError'));
  });
  $('historyList').addEventListener('click', event => {
    const button = event.target.closest('button[data-action="view"]');
    const entry = button && data.entries.find(item => item.id === button.dataset.id);
    if(!entry) return;
    context = {date:entry.date,shiftCode:entry.shiftCode,team:entry.team};
    followLive = false;
    updateControls(); render();
    $('contextDate').scrollIntoView({behavior:'smooth',block:'center'});
  });
  ['contextDate','contextShift'].forEach(id => $(id).addEventListener('change',() => {
    try {
      const date = $('contextDate').value;
      ShiftSchedule.parseDate(date);
      const shiftCode = Number($('contextShift').value);
      const team = context.team === 'СТИКЕРИ' && shiftCode === 1 ? 'СТИКЕРИ' : ShiftSchedule.teamFor(ShiftSchedule.parseDate(date),shiftCode);
      context = {date,shiftCode,team}; followLive = false;
      $('pageError').textContent = ''; updateControls(); render();
    } catch(error) { updateControls(); $('pageError').textContent = error.message; }
  }));
  $('stickersShiftBtn').addEventListener('click',() => {
    if(busy) return;
    context = {date:ShiftSchedule.localDate(),shiftCode:1,team:'СТИКЕРИ'};
    followLive = false;
    $('pageError').textContent = ''; updateControls(); render();
  });
  $('currentShiftBtn').addEventListener('click',() => { selectLive(); render(); });
  $('addPairBtn').addEventListener('click',() => {
    if(followLive) { selectLive(); render(); }
    if(!$('addPairBtn').disabled) openDialog('plan');
  });
  $('historyMonth').value = ShiftSchedule.current().date.slice(0,7);
  $('historyMonth').addEventListener('change',renderHistory);
  ['memberOne','memberTwo'].forEach(id => $(id).addEventListener('change',updateMemberOptions));
  ['actualKg','actualCrates'].forEach(id => $(id).addEventListener('input',updateResultPreview));
  $('closeDialogBtn').addEventListener('click',closeDialog);
  $('cancelDialogBtn').addEventListener('click',closeDialog);
  $('pairDialog').addEventListener('cancel',event => { event.preventDefault(); closeDialog(); });
  selectLive(); render();
  Promise.allSettled([sync.init(),rosterSync.init()]).then(render);
  setInterval(() => {
    if(followLive && !editing && !busy) { selectLive(); }
    render();
  },30000);
})();
