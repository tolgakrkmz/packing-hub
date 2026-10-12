/* History and snapshots are read from the protected server database only. */
(() => {
  if (typeof HubServer === 'undefined') { document.getElementById('historyMessage').textContent = 'Историята е достъпна при работа със сървъра.'; return; }
  if (!HubServer.canViewModule('report-history')) return;
  const $ = id => document.getElementById(id);
  const kind = $('historyKind'), detail = $('historyDetail'), message = $('historyMessage');
  const query = new URLSearchParams(location.search);
  const names = {'production-log': 'Производство', 'line-downtime': 'Престои', 'pair-targets': 'Двойки'};
  const actions = {create: 'Създаване', update: 'Редакция', delete: 'Изтриване', restore: 'Възстановяване'};
  let selected = null, history = null, pending = null, busy = false, sequence = 0;
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
  async function open(id) {
    if (busy) return;
    const ticket = ++sequence;
    selected = id; history = null; pending = null; detail.replaceChildren(); message.textContent = 'Зарежда се...';
    try {
      const result = await HubServer.json(api() + '?entryId=' + encodeURIComponent(id));
      if (ticket !== sequence) return;
      history = result; render(); message.textContent = '';
    } catch (error) { if (ticket === sequence) message.textContent = error.message; }
  }
  async function load(initialId) {
    if (busy) return;
    const ticket = ++sequence;
    selected = null; history = null; pending = null; detail.replaceChildren(); $('historyRecords').replaceChildren();
    message.textContent = 'Зарежда се...';
    try {
      const result = await HubServer.json(api());
      if (ticket !== sequence) return;
      message.textContent = result.entries.length ? 'Избери запис, за да видиш версиите.' : 'Няма записи.';
      for (const entry of result.entries) {
        const button = node('button', '', $('historyRecords'));
        button.type = 'button'; button.dataset.entryId = entry.entryId;
        node('span', (entry.date || 'Запис') + (entry.shift ? ' · ' + entry.shift : '') + ' · v' + entry.version + (entry.deleted ? ' · Изтрит' : ''), button).className = 'history-record-label';
        storedText('span', entry.entryId, button).className = 'history-record-id';
        button.addEventListener('click', () => open(entry.entryId));
      }
      if (typeof initialId === 'string') await open(initialId);
    } catch (error) { if (ticket === sequence) message.textContent = error.message; }
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
    storedText('p', history.entryId, detail);
    for (const button of $('historyRecords').querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.entryId === selected));
    if (history.deleted && history.events.length) {
      const restore = node('button', 'Възстанови изтрития запис', detail);
      restore.id = 'historyRestore'; restore.addEventListener('click', restoreRecord);
    }
    if (!history.events.length) {
      node('p', 'Няма запазени корекции за този запис.', detail).className = 'history-empty';
      snapshot(history.current, detail);
    }
    for (const event of history.events) {
      const card = node('article', '', detail); card.className = 'history-event';
      node('h3', 'v' + event.version + ' · ' + actions[event.action], card);
      storedText('time', new Date(event.at).toLocaleString(document.documentElement.lang), card).dateTime = new Date(event.at).toISOString();
      storedText('p', event.account || '#' + event.accountId, card);
      if (event.reason) storedText('p', event.reason, card);
      for (const [label, value] of [['Преди промяната', event.before], ['След промяната', event.after]]) {
        const fold = node('details', '', card); node('summary', label, fold);
        const contents = node('div', '', fold); contents.className = 'history-snapshot'; snapshot(value, contents);
      }
    }
  }
  async function restoreRecord() {
    if (busy || !history?.deleted) return;
    busy = true; message.textContent = 'Записва се...'; message.dataset.state = 'pending'; kind.disabled = true; $('historyRefresh').disabled = true; $('historyRestore').disabled = true;
    try {
      if (!pending) {
        const reason = await HubServer.correctionReason();
        if (reason === null) { message.textContent = ''; message.dataset.state = 'loaded'; return; }
        pending = {operationId: crypto.randomUUID(), action: 'restore', entryId: selected, sourceVersion: history.events[0].version, reason};
      }
      const result = await HubServer.send('/api/reports/' + kind.value + '/operations', 'POST', pending, {'If-Match': '"' + history.version + '"'});
      if (result.receipt?.operationId !== pending.operationId || result.receipt?.entryId !== selected || result.receipt?.action !== 'restore' || result.receipt?.status !== 'confirmed') throw new Error('Промяната не е потвърдена. Опитай отново.');
      const id = selected; busy = false; await load(); await open(id);
      message.textContent = 'Сървърът потвърди възстановяването.'; message.dataset.state = 'success';
    } catch (error) {
      message.textContent = error.status ? error.message : 'Възстановяването не е потвърдено. Опитай отново със същата причина.';
      message.dataset.state = error.code === 'REPORT_CONFLICT' ? 'conflict' : error.status && error.status < 500 ? 'rejected' : 'unconfirmed';
      if (error.status && error.status < 500) {
        pending = null;
        if (error.code === 'REPORT_CONFLICT') history = null; // Explicit refresh is required before another attempt.
      }
    } finally {
      busy = false; kind.disabled = false; $('historyRefresh').disabled = false;
      if ($('historyRestore')) $('historyRestore').disabled = !history?.deleted;
    }
  }
  kind.addEventListener('change', () => load());
  $('historyRefresh').addEventListener('click', () => load());
  load(query.get('entryId'));
})();
