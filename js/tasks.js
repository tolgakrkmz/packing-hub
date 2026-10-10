/* Task text and identities stay out of browser persistence and translation. */
(() => {
  const $ = id => document.getElementById(id), admin = typeof HubServer !== 'undefined' && HubServer.can('canManageTasks');
  if (typeof HubServer === 'undefined') { $('taskMessage').textContent = 'Задачите са достъпни в сървърната версия след вход с личен акаунт.'; $('taskContent').hidden = true; return; }
  const supervisor = HubServer.can('canReportTasks'), reader = !admin && !supervisor;
  const assigner = HubServer.can('canAssignTasks'), reviewer = HubServer.can('canReviewTasks');
  let state, view = 'shift', editing = null, acting = null, busy = false, sequence = 0, creationKey = null, previewSequence = 0;
  const statusLabels = {pending: 'Чака отчет', unreported: 'Неотчетена', completed: 'Изпълнена', 'not-done': 'Неизпълнена', 'not-applicable': 'Не е приложима', 'in-progress': 'В процес', blocked: 'Има пречка', review: 'Готова за проверка', cancelled: 'Отменена'};
  const actionLabels = {created: 'Възложена', report: 'Отчет', progress: 'Напредък', approve: 'Потвърдено приключване', return: 'Върната за работа', reopen: 'Отворена отново', cancel: 'Отменена', edit: 'Променена', stop: 'Повторението е спряно'};
  const dialogs = ['taskEditor', 'taskAction', 'taskHistory'];
  const draftOpen = () => busy || dialogs.some(id => $(id).open);
  function el(tag, text = '', cls = '', custom = false) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; if (custom) node.setAttribute('translate', 'no'); return node; }
  function date(at) { return new Intl.DateTimeFormat('en-CA', {timeZone: state.timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(at)); }
  function clock(at) { return new Intl.DateTimeFormat('bg-BG', {timeZone: state.timezone, dateStyle: 'short', timeStyle: 'short'}).format(new Date(at)); }
  function shiftLabel(shift) { return shift.team === 'СТИКЕРИ' ? 'Редовна смяна' : {1: '1-ва смяна', 2: '2-ра смяна', 3: 'Нощна смяна'}[shift.code]; }
  function button(label, fn, cls = 'secondary') { const node = el('button', label, cls); node.type = 'button'; node.addEventListener('click', fn); return node; }
  function selectedOwner(item) { return !$('ownerFilter').value || String(item.owner.id) === $('ownerFilter').value; }
  function selected(item) { return selectedOwner(item) && (item.title + ' ' + item.description).toLowerCase().includes($('taskSearch').value.trim().toLowerCase()); }
  function empty(text) { return el('p', text, 'task-empty'); }
  function period(item) { const key = item.kind === 'shift' ? item.shift.date : date(item.due); return key >= $('statsFrom').value && key <= $('statsUntil').value; }
  function summarize(items) {
    const shifts = items.filter(item => item.kind === 'shift' && item.due + state.graceMinutes * 60000 < state.now && !['cancelled', 'not-applicable'].includes(item.status));
    return {total: shifts.length, done: shifts.filter(item => item.status === 'completed').length, failed: shifts.filter(item => item.status === 'not-done').length, missing: shifts.filter(item => item.displayStatus === 'unreported').length,
      missingShifts: new Set(shifts.filter(item => item.displayStatus === 'unreported').map(item => `${item.shift.date}:${item.shift.code}:${item.shift.team}`)).size, late: shifts.filter(item => item.late).length};
  }
  function renderStats(items) {
    const wrap = el('div'), relevant = items.filter(period), summary = summarize(relevant);
    wrap.append(el('p', `Отчетени като изпълнени: ${summary.done} / ${summary.total} (${summary.total ? Math.round(summary.done / summary.total * 100) : 0}%).`, 'task-muted'));
    const tableWrap = el('div', '', 'task-table-wrap'), table = el('table', '', 'task-table');
    const head = el('tr'); for (const label of ['Отговорник', 'Приложими задачи', 'Изпълнени', 'Неизпълнени', 'Неотчетени', 'Смени без пълен отчет', 'Закъснели отчети']) head.append(el('th', label));
    const thead = el('thead'); thead.append(head); table.append(thead); const tbody = el('tbody');
    const owners = new Map(relevant.filter(item => item.kind === 'shift').map(item => [item.owner.id, item.owner.username]));
    for (const [id, name] of owners) { const value = summarize(relevant.filter(item => item.owner.id === id)), row = el('tr'); row.append(el('td', name, '', true)); for (const key of ['total', 'done', 'failed', 'missing', 'missingShifts', 'late']) row.append(el('td', String(value[key]))); tbody.append(row); }
    table.append(tbody); tableWrap.append(table); wrap.append(tableWrap);
    if (!owners.size) wrap.append(empty('Няма приключили смени в избрания период.'));
    const global = relevant.filter(item => item.kind === 'global');
    wrap.append(el('h2', 'Глобални задачи'), el('p', `Общо: ${global.length} · Приключени: ${global.filter(item => item.status === 'completed').length} · Просрочени: ${global.filter(item => item.overdue).length} · Готови за проверка: ${global.filter(item => item.status === 'review').length}`, 'task-muted'));
    const series = new Map();
    for (const item of relevant.filter(item => item.scheduleId && item.due + state.graceMinutes * 60000 < state.now).sort((a, b) => a.due - b.due)) {
      const key = item.scheduleId + ':' + item.owner.id, prior = series.get(key) || {item, failed: 0, missing: 0};
      prior.item = item; prior.failed = item.status === 'not-done' ? prior.failed + 1 : 0; prior.missing = item.displayStatus === 'unreported' ? prior.missing + 1 : 0; series.set(key, prior);
    }
    wrap.append(el('h2', 'Последователни пропуски'));
    const streaks = [...series.values()].filter(value => value.failed || value.missing);
    for (const value of streaks) { const entry = el('p', '', 'task-muted'); entry.append(el('span', value.item.title, '', true), document.createTextNode(' · '), el('span', value.item.owner.username, '', true), document.createTextNode(` · Неизпълнени поред: ${value.failed} · Неотчетени поред: ${value.missing}`)); wrap.append(entry); }
    if (!streaks.length) wrap.append(el('p', 'Няма последователни пропуски в избрания период.', 'task-muted'));
    wrap.append(el('p', 'Броят се само приключили смени след гратисния период. Отменените и неприложимите задачи не влизат в процента. Една смяна с няколко липсващи отчета се брои веднъж.', 'task-muted'));
    return wrap;
  }
  function history(item) {
    const content = $('historyContent'); content.replaceChildren(el('h3', item.title, '', true));
    for (const entry of item.events) { const row = el('div', '', 'task-history-event'); row.append(el('strong', actionLabels[entry.action]), el('p', `${clock(entry.at)} · ${entry.actor.username}`, 'task-muted', true)); if (entry.status) row.append(el('span', statusLabels[entry.status], 'task-badge')); if (entry.late) row.append(el('span', 'Закъснял отчет', 'task-badge alert')); if (entry.note) row.append(el('p', entry.note, '', true)); if (entry.snapshot) { row.append(el('p', entry.snapshot.title, '', true), el('p', entry.snapshot.description, '', true), el('p', [entry.snapshot.owner.username, ...(entry.snapshot.participants || []).map(person => person.username)].join(' · '), 'task-muted', true)); if (entry.snapshot.due) row.append(el('p', clock(entry.snapshot.due), 'task-muted', true)); } content.append(row); }
    $('taskHistory').showModal();
  }
  function card(item, recurring = false) {
    const alert = item.displayStatus === 'unreported' || item.overdue || item.status === 'not-done';
    const node = el('article', '', 'task-card' + (alert ? ' is-alert' : '')); node.dataset.taskId = item.id;
    const head = el('div', '', 'task-card-head'); head.append(el('h2', item.title, '', true), el('span', item.owner.username, 'task-meta', true)); node.append(head);
    const badges = el('div', '', 'task-badges');
    const status = recurring ? item.stoppedAt ? 'Повторението е спряно' : 'Активно повторение' : statusLabels[item.displayStatus];
    badges.append(el('span', status, 'task-badge' + (alert ? ' alert' : item.status === 'completed' ? ' good' : '')));
    if (item.priority === 'high') badges.append(el('span', 'Висок приоритет', 'task-badge alert'));
    if (item.overdue) badges.append(el('span', 'Просрочена', 'task-badge alert')); if (item.late) badges.append(el('span', 'Закъснял отчет', 'task-badge alert'));
    node.append(badges, el('p', item.description, 'task-description', true));
    node.append(el('p', recurring ? `${item.from} – ${item.until} · Екип ${item.team}` : item.kind === 'shift' ? `${item.shift.date} · Екип ${item.shift.team} · ${shiftLabel(item.shift)} · ${clock(item.shift.start)} – ${clock(item.due)}` : `Краен срок: ${clock(item.due)}`, 'task-meta'));
    if (item.participants.length) node.append(el('p', item.participants.map(person => person.username).join(' · '), 'task-meta', true));
    const lastNote = [...item.events].reverse().find(entry => entry.note); if (lastNote) node.append(el('p', lastNote.note, 'task-description', true));
    const actions = el('div', '', 'task-actions'); actions.append(button('История', () => history(item)));
    if (recurring) { if (admin && !item.stoppedAt) actions.append(button('Промени бъдещите задачи', () => openEditor(item, true)), button('Спри повторението', () => openAction(item, 'stop', true))); }
    else {
      const final = ['completed', 'cancelled'].includes(item.status);
      if (supervisor && item.owner.id === HubServer.user.id && !final && (item.kind === 'global' || state.now >= item.shift.start)) actions.append(button('Отчети', () => openAction(item, 'report'), ''));
      if (supervisor && item.kind === 'global' && !final && (item.owner.id === HubServer.user.id || item.participants.some(person => person.id === HubServer.user.id))) actions.append(button('Добави напредък', () => openAction(item, 'progress')));
      if (reviewer && item.status === 'review') actions.append(button('Потвърди приключване', () => openAction(item, 'approve'), ''), button('Върни за работа', () => openAction(item, 'return')));
      if (admin && !final) {
        if (item.kind === 'global' || state.now < item.due && !item.report) actions.append(button('Промени', () => openEditor(item)));
        actions.append(button('Отмени', () => openAction(item, 'cancel')));
      }
      if (admin && ['completed', 'cancelled', 'not-done', 'not-applicable'].includes(item.status)) actions.append(button('Отвори отново', () => openAction(item, 'reopen')));
    }
    node.append(actions); return node;
  }
  function render() {
    if (!state) return;
    const items = state.items.filter(selected), overview = $('taskOverview'); overview.replaceChildren();
    for (const [label, count] of [['Активни задачи', items.filter(item => !['completed', 'cancelled', 'not-done', 'not-applicable'].includes(item.status)).length], ['Неотчетени', items.filter(item => item.displayStatus === 'unreported').length], ['Готови за проверка', items.filter(item => item.status === 'review').length], ['Просрочени глобални', items.filter(item => item.overdue).length]]) { const metric = el('div', '', 'task-metric'); metric.append(el('strong', String(count)), el('span', label)); overview.append(metric); }
    $('taskPeriod').hidden = !['stats', 'history'].includes(view);
    const content = $('taskContent'); content.replaceChildren();
    if (view === 'stats') { if (!$('statsFrom').value || !$('statsUntil').value || $('statsFrom').value > $('statsUntil').value) content.append(empty('Избери валиден период.')); else content.append(renderStats(items)); return; }
    const values = view === 'schedules' ? state.schedules.filter(selected) : items.filter(item => view === 'shift' ? item.kind === 'shift' && !['completed', 'cancelled', 'not-done', 'not-applicable'].includes(item.status) : view === 'global' ? item.kind === 'global' && !['completed', 'cancelled'].includes(item.status) : period(item));
    values.sort((a, b) => (a.due || Date.parse(a.from)) - (b.due || Date.parse(b.from)));
    if (!values.length) content.append(empty(view === 'schedules' ? 'Няма повтарящи се задачи.' : 'Няма задачи по тези критерии.'));
    else { const list = el('div', '', 'task-list'); for (const item of values) list.append(card(item, view === 'schedules')); content.append(list); }
  }
  async function refresh() {
    if (draftOpen()) return;
    const current = ++sequence;
    try {
      const result = await HubServer.json('/api/tasks'); if (current !== sequence) return;
      state = result; $('taskMessage').textContent = '';
      const value = $('ownerFilter').value, options = new Map([...state.items, ...state.schedules].map(item => [item.owner.id, item.owner.username])); for (const person of state.supervisors) options.set(person.id, person.username);
      $('ownerFilter').replaceChildren(new Option('Всички отговорници', '')); for (const [id, name] of options) { const option = new Option(name, id); option.setAttribute('translate', 'no'); $('ownerFilter').append(option); } $('ownerFilter').value = value;
      if (!$('statsUntil').value) { $('statsUntil').value = date(state.now); $('statsFrom').value = date(state.now - 30 * 86400000); }
      $('taskSubtitle').textContent = reviewer ? assigner ? 'Възлагай задачи, следи отчетите и потвърждавай решените проблеми.' : 'Следи отчетите и потвърждавай решените проблеми.' : admin ? 'Редактирай задачи и проследявай изпълнението им.' : assigner ? 'Възлагай сменни и глобални задачи и проследявай изпълнението им.' : reader ? 'Преглед на всички задачи, отчети и история. Акаунтът няма право да ги променя.' : 'Твоите сменни задачи и общите проблеми, в които участваш.';
      render();
    } catch (error) { $('taskMessage').textContent = error.message; }
  }
  function editorFields() {
    const global = $('taskKind').value === 'global', recurring = $('taskRepeat').value === 'every-shift';
    $('shiftFields').hidden = global || !!editing && !editing.recurring; $('globalFields').hidden = !global; $('taskParticipants').hidden = !global;
    $('taskUntilLabel').hidden = !recurring; $('taskFrom').required = !global && !editing; $('taskUntil').required = !global && recurring && !editing;
    $('taskDueDate').required = global; $('taskDueTime').required = global;
    const owner = state.supervisors.find(person => String(person.id) === $('taskOwner').value);
    $('ownerTeam').textContent = owner ? 'Екип: ' + owner.team : '';
    $('shiftPreview').textContent = 'Смяната и краят ѝ се определят от графика на избрания екип. Нощната смяна остава към датата на започване.';
    for (const check of $('participantOptions').querySelectorAll('input')) { check.disabled = check.value === $('taskOwner').value; if (check.disabled) check.checked = false; }
    if (!global && owner && $('taskFrom').value && !editing) {
      const sequence = ++previewSequence;
      HubServer.json('/api/tasks/preview?date=' + encodeURIComponent($('taskFrom').value) + '&assigneeId=' + owner.id).then(value => {
        if (sequence !== previewSequence || !$('taskEditor').open) return;
        $('shiftPreview').textContent = value.shift ? `${shiftLabel(value.shift)} · ${clock(value.shift.start)} – ${clock(value.shift.due)}` : 'Екипът е в почивка на тази дата. При повторение се включват следващите работни смени.';
      }).catch(error => { if (sequence === previewSequence && $('taskEditor').open) $('shiftPreview').textContent = error.message; });
    } else ++previewSequence;
  }
  function openEditor(item = null, recurring = false) {
    editing = item ? {item, recurring} : null; creationKey = null; $('taskForm').reset(); $('editorFeedback').textContent = state.supervisors.length ? '' : 'Няма активни началници смяна с право за преглед. Настрой ги в „Акаунти“ с право за отчитане и избран екип.';
    $('editorTitle').textContent = item ? recurring ? 'Промени бъдещите задачи' : 'Промени задача' : 'Възложи задача'; $('saveTask').textContent = item ? 'Запази' : 'Възложи';
    $('taskKind').value = item?.kind || 'shift'; $('taskKind').disabled = !!item; $('taskRepeat').value = recurring ? 'every-shift' : 'once'; $('taskRepeat').disabled = !!item;
    $('taskFrom').disabled = !!item; $('taskUntil').disabled = !!item; $('editReasonLabel').hidden = !item; $('editReason').required = !!item;
    $('taskTitle').value = item?.title || ''; $('taskDescription').value = item?.description || ''; $('taskPriority').value = item?.priority || 'normal';
    $('taskOwner').replaceChildren(new Option('Избери началник смяна', '')); $('participantOptions').replaceChildren();
    for (const person of state.supervisors) {
      const option = new Option(person.username + ' · ' + person.team, person.id); option.setAttribute('translate', 'no'); $('taskOwner').append(option);
      const label = el('label'), check = el('input'); check.type = 'checkbox'; check.value = person.id; check.checked = !!item?.participants.some(value => value.id === person.id); label.append(check, el('span', person.username, '', true)); $('participantOptions').append(label);
    }
    $('taskOwner').value = item ? String(item.owner.id) : '';
    $('taskFrom').value = recurring ? item.from : item?.shift?.date || state.currentShift.date; $('taskUntil').value = item?.until || date(state.now + 30 * 86400000);
    $('taskDueDate').value = item?.due ? date(item.due) : date(state.now + 86400000);
    $('taskDueTime').value = item?.due ? new Intl.DateTimeFormat('en-GB', {timeZone: state.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(item.due)) : '17:00';
    $('taskTimezone').textContent = 'Часова зона: ' + state.timezone; editorFields(); $('taskEditor').showModal(); $('taskTitle').focus();
  }
  function openAction(item, action, recurring = false) {
    acting = {item, action, recurring}; $('actionForm').reset(); $('actionFeedback').textContent = '';
    $('actionTitle').textContent = action === 'report' ? 'Отчети задача' : actionLabels[action]; $('actionTaskTitle').textContent = item.title;
    $('reportStatusLabel').hidden = action !== 'report'; $('reportStatus').replaceChildren();
    for (const status of item.kind === 'shift' ? ['completed', 'not-done', 'not-applicable'] : ['in-progress', 'blocked', 'review']) $('reportStatus').append(new Option(statusLabels[status], status));
    $('actionNote').required = action !== 'approve' && (action !== 'report' || $('reportStatus').value !== 'completed'); $('taskAction').showModal();
  }
  async function mutate(form, feedback, fn) {
    busy = true; const submit = form.querySelector('button[type=submit]'); submit.disabled = true; feedback.textContent = '';
    try { await fn(); form.closest('dialog').close(); busy = false; await refresh(); $('taskMessage').textContent = 'Промяната е записана.'; }
    catch (error) { feedback.textContent = error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.'; if (error.status === 409) feedback.textContent += ' Затвори прозореца и натисни „Опресни“. Въведеното е запазено до затваряне.'; }
    finally { busy = false; submit.disabled = false; }
  }
  $('taskForm').addEventListener('submit', event => {
    event.preventDefault();
    const payload = {title: $('taskTitle').value, description: $('taskDescription').value, priority: $('taskPriority').value, assigneeId: Number($('taskOwner').value), participantIds: $('taskKind').value === 'global' ? [...$('participantOptions').querySelectorAll('input:checked')].map(input => Number(input.value)) : [], kind: $('taskKind').value, repeat: $('taskRepeat').value, from: $('taskFrom').value, until: $('taskUntil').value, dueDate: $('taskDueDate').value, dueTime: $('taskDueTime').value, note: $('editReason').value};
    if (!editing) { const signature = JSON.stringify(payload); if (!creationKey || creationKey.signature !== signature) creationKey = {signature, id: crypto.randomUUID()}; payload.requestId = creationKey.id; }
    mutate($('taskForm'), $('editorFeedback'), () => editing ? HubServer.send('/api/tasks/' + (editing.recurring ? 'schedules/' : 'items/') + editing.item.id, 'PATCH', {...payload, action: 'edit'}, {'If-Match': '"' + editing.item.revision + '"'}) : HubServer.send('/api/tasks', 'POST', payload));
  });
  $('actionForm').addEventListener('submit', event => { event.preventDefault(); mutate($('actionForm'), $('actionFeedback'), () => HubServer.send('/api/tasks/' + (acting.recurring ? 'schedules/' : 'items/') + acting.item.id, 'PATCH', {action: acting.action, status: $('reportStatus').value, note: $('actionNote').value}, {'If-Match': '"' + acting.item.revision + '"'})); });
  $('reportStatus').addEventListener('change', () => { $('actionNote').required = $('reportStatus').value !== 'completed'; });
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => { if (!busy) $(control.dataset.close).close(); });
  for (const id of dialogs) $(id).addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  for (const id of ['taskKind', 'taskRepeat', 'taskOwner', 'taskFrom']) $(id).addEventListener('change', editorFields);
  $('newTask').hidden = !assigner; $('newTask').addEventListener('click', () => { if (state && assigner) openEditor(); }); $('ownerFilterLabel').hidden = supervisor && !assigner && !admin && !reviewer;
  $('refreshTasks').addEventListener('click', refresh);
  for (const id of ['ownerFilter', 'taskSearch', 'statsFrom', 'statsUntil']) $(id).addEventListener('input', render);
  $('taskTabs').addEventListener('click', event => { const tab = event.target.closest('[data-view]'); if (!tab) return; view = tab.dataset.view; for (const control of $('taskTabs').querySelectorAll('button')) control.setAttribute('aria-pressed', String(control === tab)); render(); });
  HubServer.watch('tasks', refresh, draftOpen); HubServer.watch('accounts', refresh, draftOpen);
  setInterval(() => { if (!draftOpen()) refresh(); }, 30000); refresh();
})();
