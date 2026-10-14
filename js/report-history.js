/* History and snapshots are read from the protected server database only. */
(() => {
  if (typeof HubServer === 'undefined') { document.getElementById('historyMessage').textContent = 'Историята е достъпна при работа със сървъра.'; return; }
  if (!HubServer.canViewModule('report-history')) return;
  const $ = id => document.getElementById(id);
  const kind = $('historyKind'), detail = $('historyDetail'), message = $('historyMessage');
  const query = new URLSearchParams(location.search);
  const names = {'production-log': 'Производство', 'line-downtime': 'Престои', 'pair-targets': 'Двойки'};
  const actions = {create: 'Създаване', update: 'Редакция', delete: 'Изтриване', restore: 'Възстановяване'};
  let selected = null, history = null, pending = null, busy = false, sequence = 0, listSequence = 0, listCursor = null;
  HubServer.guardUpdate({isBusy:() => busy,hasDraft:() => !!pending});
  const node = (tag, text, parent) => {
    const element = document.createElement(tag); element.textContent = text;
    parent?.append(element); return element;
  };
  const storedText = (tag, text, parent) => {
    const element = node(tag, text, parent); element.setAttribute('translate', 'no'); return element;
  };
  for (const [value, label] of Object.entries(names)) {
    if (!HubServer.can(HubPermissions.reports[value].edit) || !HubServer.canViewModule(value)) continue;
    const option = node('option', label, kind); option.value = value;
  }
  if (Array.from(kind.options).some(option => option.value === query.get('module'))) kind.value = query.get('module');
  const api = () => '/api/reports/' + kind.value + '/history';
  const entryURL = id => api() + '?entryId=' + encodeURIComponent(id);
  function placeholder() {
    detail.replaceChildren();
    const empty = node('div','',detail); empty.className = 'history-placeholder';
    node('h2','Преглед на запис',empty); node('p','Избери запис, за да видиш версиите.',empty);
  }
  function reset() {
    ++sequence; ++listSequence; selected = null; history = null; pending = null; listCursor = null;
    placeholder(); $('historyRecords').replaceChildren(); $('historyMore').hidden = true;
    $('historyListEmpty').hidden = false; $('historyListEmpty').textContent = 'Натисни „Покажи записи“, за да започнеш.';
    message.textContent = ''; message.dataset.state = '';
    $('historyRefresh').disabled = false; $('historyMore').disabled = false;
  }
  async function open(id) {
    if (busy) return;
    const ticket = ++sequence;
    selected = id; history = null; pending = null; detail.replaceChildren(); message.textContent = 'Зарежда се...';
    try {
      const result = await HubServer.json(entryURL(id) + '&metadata=1');
      if (ticket !== sequence) return;
      history = result; render(); message.textContent = ''; message.dataset.state = 'loaded';
      if (matchMedia('(max-width:760px)').matches) detail.scrollIntoView({behavior:'instant',block:'start'});
    } catch (error) { if (ticket === sequence) message.textContent = error.message; }
  }
  async function load(append = false) {
    if (busy) return;
    const ticket = ++listSequence;
    if (!append) { ++sequence; selected = null; history = null; pending = null; listCursor = null; placeholder(); $('historyRecords').replaceChildren(); }
    $('historyRefresh').disabled = true; $('historyMore').disabled = true;
    message.textContent = 'Зарежда се...';
    try {
      const params = new URLSearchParams({date:$('historyDate').value});
      if (append && listCursor) params.set('cursor',listCursor);
      const result = await HubServer.json(api() + '?' + params);
      if (ticket !== listSequence) return;
      message.textContent = selected ? '' : result.entries.length ? 'Избери запис, за да видиш версиите.' : 'Няма записи.';
      message.dataset.state = 'loaded'; $('historyListEmpty').hidden = true;
      listCursor = result.nextCursor; $('historyMore').hidden = !listCursor;
      for (const entry of result.entries) {
        const button = node('button', '', $('historyRecords'));
        button.type = 'button'; button.dataset.entryId = entry.entryId;
        node('span', (entry.date || 'Запис') + (entry.shift ? ' · ' + entry.shift : '') + ' · v' + entry.version + (entry.deleted ? ' · Изтрит' : ''), button).className = 'history-record-label';
        storedText('span', entry.entryId, button).className = 'history-record-id';
        button.addEventListener('click', () => open(entry.entryId));
      }
    } catch (error) { if (ticket === listSequence) { message.textContent = error.message; message.dataset.state = 'rejected'; } }
    finally { if (ticket === listSequence) { $('historyRefresh').disabled = false; $('historyMore').disabled = false; } }
  }
  const labels = {
    id: 'Идентификатор', date: 'Дата', shift: 'Смяна', tonnage: 'Тонаж (кг)', brak: 'Брак (кг)',
    breakdown: 'Разбивка', autoKg: 'Автоматично (кг)', autoCrates: 'Автоматично (касетки)', manKg: 'Ръчно (кг)', manCrates: 'Ръчно (касетки)',
    start: 'Начало', end: 'Край', durationMin: 'Минути', reason: 'Причина за престоя', reasonNote: 'Описание', note: 'Бележка',
    team: 'Екип', members: 'Участници', name: 'Име', category: 'Категория', role: 'Роля', result: 'Резултат', kg: 'Килограми', crates: 'Касетки',
    targetKg: 'Цел (кг)', targetCrates: 'Цел (касетки)', areas: 'Работни зони', createdAt: 'Създадено', updatedAt: 'Обновено',
    reportedAt: 'Отчетено', shiftCode: 'Смяна', cancellation: 'Отмяна', reasonKey: 'Причина', reasonText: 'Обяснение', cancelledAt: 'Отменено'
  };
  function snapshot(value, parent) {
    if (value === null) { node('p', 'Няма активен запис', parent); return; }
    const list = node('dl', '', parent);
    for (const [key, item] of Object.entries(value)) {
      node('dt', Array.isArray(value) ? String(Number(key) + 1) : (Object.hasOwn(labels,key) ? labels[key] : key), list);
      const cell = node('dd', '', list);
      if (item && typeof item === 'object') snapshot(item, cell);
      else { cell.setAttribute('translate', 'no'); cell.textContent = String(item ?? '—'); }
    }
  }
  function render() {
    detail.replaceChildren();
    node('h2', (history.deleted ? 'Изтрит запис' : 'Активен запис') + ' · v' + history.version, detail);
    storedText('p', history.entryId, detail).className = 'history-detail-id';
    for (const button of $('historyRecords').querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.entryId === selected));
    const tools = node('div','',detail); tools.className = 'history-detail-tools';
    const refresh = node('button','Обнови този запис',tools); refresh.type = 'button'; refresh.className = 'history-secondary';
    refresh.addEventListener('click',() => open(selected));
    if (history.deleted && history.events.length) {
      const restore = node('button', 'Възстанови изтрития запис', tools); restore.type = 'button';
      restore.id = 'historyRestore'; restore.addEventListener('click', restoreRecord);
    }
    if (!history.events.length) {
      node('p', 'Няма запазени корекции за този запис.', detail).className = 'history-empty';
      const value=history.current, fold = node('details','',detail); fold.className='history-event'; node('summary','Съдържание на записа',fold);
      fold.addEventListener('toggle',() => { if (fold.open && fold.isConnected && !fold.querySelector('.history-snapshot')) { const contents=node('div','',fold); contents.className='history-snapshot'; snapshot(value,contents); } });
    }
    const events = node('div','',detail); events.id = 'historyEvents';
    for (const event of history.events) renderEvent(event,events);
    const more = node('button','Още версии',detail); more.type = 'button'; more.className = 'history-secondary'; more.id = 'historyVersionsMore'; more.hidden = !history.nextVersion;
    more.addEventListener('click',async () => {
      if (busy) return;
      const ticket = sequence; more.disabled = true;
      try {
        const result = await HubServer.json(entryURL(selected)+'&metadata=1&beforeVersion='+history.nextVersion);
        if (ticket !== sequence) return;
        history.events.push(...result.events); history.nextVersion = result.nextVersion;
        for (const event of result.events) renderEvent(event,events);
        more.hidden = !history.nextVersion;
      } catch(error) { if (ticket === sequence) message.textContent = error.message; }
      finally { more.disabled = false; }
    });
  }
  function renderEvent(event, parent) {
      const ticket = sequence, url = entryURL(selected) + '&version=' + event.version;
      let snapshots = null;
      const card = node('article', '', parent); card.className = 'history-event';
      node('h3', 'v' + event.version + ' · ' + actions[event.action], card);
      storedText('time', new Date(event.at).toLocaleString(document.documentElement.lang), card).dateTime = new Date(event.at).toISOString();
      storedText('p', event.account || '#' + event.accountId, card).className = 'history-event-account';
      if (event.reason) storedText('p', event.reason, card).className = 'history-event-reason';
      for (const [label, key] of [['Преди промяната', 'before'], ['След промяната', 'after']]) {
        const fold = node('details', '', card); node('summary', label, fold);
        let rendered = false, loading = false;
        fold.addEventListener('toggle',async () => {
          if (!fold.open || rendered || loading || ticket !== sequence || !card.isConnected) return;
          loading = true;
          const contents = node('div','Зарежда се...',fold); contents.className = 'history-snapshot';
          try {
            if (!snapshots) snapshots = HubServer.json(url).catch(error => { snapshots = null; throw error; });
            const result = await snapshots;
            if (ticket !== sequence) return;
            contents.replaceChildren(); snapshot(result[key],contents); rendered = true;
          } catch(error) { if (ticket === sequence) { contents.remove(); message.textContent = error.message; } }
          finally { loading = false; }
        });
      }
  }
  async function restoreRecord() {
    if (busy || !history?.deleted) return;
    busy = true; message.textContent = 'Записва се...'; message.dataset.state = 'pending'; kind.disabled = true; $('historyDate').disabled = true; $('historyRefresh').disabled = true; $('historyRestore').disabled = true;
    try {
      if (!pending) {
        const reason = await HubServer.correctionReason();
        if (reason === null) { message.textContent = ''; message.dataset.state = 'loaded'; return; }
        pending = {operationId: crypto.randomUUID(), action: 'restore', entryId: selected, sourceVersion: history.events[0].version, reason};
      }
      const result = await HubServer.send('/api/reports/' + kind.value + '/operations', 'POST', pending, {'If-Match': '"' + history.version + '"'});
      if (result.receipt?.operationId !== pending.operationId || result.receipt?.entryId !== selected || result.receipt?.action !== 'restore' || result.receipt?.status !== 'confirmed') throw new Error('Промяната не е потвърдена. Опитай отново.');
      const id = selected; busy = false; await open(id);
      message.textContent = 'Сървърът потвърди възстановяването.'; message.dataset.state = 'success';
    } catch (error) {
      message.textContent = error.status ? error.message : 'Възстановяването не е потвърдено. Опитай отново със същата причина.';
      message.dataset.state = error.code === 'REPORT_CONFLICT' ? 'conflict' : error.status && error.status < 500 ? 'rejected' : 'unconfirmed';
      if (error.status && error.status < 500) {
        pending = null;
        if (error.code === 'REPORT_CONFLICT') history = null; // Explicit refresh is required before another attempt.
      }
    } finally {
      busy = false; kind.disabled = false; $('historyDate').disabled = false; $('historyRefresh').disabled = false;
      if ($('historyRestore')) $('historyRestore').disabled = !history?.deleted;
    }
  }
  kind.addEventListener('change', reset);
  $('historyDate').addEventListener('change', reset);
  $('historyFilters').addEventListener('submit',event => { event.preventDefault(); load(); });
  $('historyMore').addEventListener('click',() => load(true));
  // A record link is itself an explicit request; it never loads the whole list.
  if (query.get('entryId')) open(query.get('entryId'));
})();
