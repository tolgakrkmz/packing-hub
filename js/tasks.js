/* Task text and identities stay out of browser persistence and translation. */
(() => {
  const $ = id => document.getElementById(id), admin = typeof HubServer !== 'undefined' && HubServer.can('canManageTasks');
  if (typeof HubServer === 'undefined') { $('taskMessage').textContent = 'Задачите са достъпни в сървърната версия след вход с личен акаунт.'; $('taskContent').hidden = true; return; }
  const supervisor = HubServer.can('canReportTasks'), reader = !admin && !supervisor;
  const assigner = HubServer.can('canAssignTasks'), reviewer = HubServer.can('canReviewTasks');
  const administrator = admin && HubServer.user.role === 'admin';
  let state, view = 'open', month = null, monthChosen = false, editing = null, acting = null, busy = false, sequence = 0, creationKey = null, actionKey = null, previewSequence = 0;
  const pageSize = 50;
  let listPage = 1, searchTimer;
  let pendingRead = null, displayedSnapshot = null;
  let cardCache = new Map(), formatterTimezone, dateFormatter, clockFormatter;
  const photoObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    for (const {target, isIntersecting} of entries) if (isIntersecting && target.dataset.photoSrc) {
      target.src = target.dataset.photoSrc; delete target.dataset.photoSrc; photoObserver.unobserve(target);
    }
  }, {rootMargin: '150px'});
  function observePhotos(container) { for (const img of container.querySelectorAll('img[data-photo-src]')) photoObserver.observe(img); }
  function forgetPhotos(container) { for (const img of container.querySelectorAll('img[data-photo-src]')) photoObserver.unobserve(img); }
  const statusLabels = {pending: 'Чака отчет', unreported: 'Неотчетена', completed: 'Изпълнена', 'not-done': 'Неизпълнена', 'not-applicable': 'Не е приложима', 'in-progress': 'В процес', blocked: 'Има пречка', review: 'Готова за проверка', cancelled: 'Отменена'};
  const actionLabels = {created: 'Възложена', report: 'Отчет', progress: 'Напредък', approve: 'Потвърдено приключване', complete: 'Завършена от администратор', transfer: 'Прехвърлена', return: 'Върната за работа', reopen: 'Отворена отново', cancel: 'Отменена', edit: 'Променена', stop: 'Повторението е спряно'};
  const requiresPhotos = item => item?.requiresPhotos !== false;
  const photoList = (item, plural, single) => Array.isArray(item?.[plural]) ? item[plural] : item?.[single] ? [item[single]] : [];
  const problemPhotos = item => photoList(item, 'problemPhotos', 'problemPhoto');
  const solutionPhotos = item => photoList(item, 'photos', 'photo');
  const requiredPhotoCount = item => Math.max(1, problemPhotos(item).length);
  const photoRequirementLabel = item => requiresPhotos(item) ? 'Изисква снимки' : 'Снимки не се изискват';
  const dialogs = ['taskEditor', 'taskAction', 'taskHistory', 'taskPhotoViewer'];
  const draftOpen = () => busy || dialogs.some(id => $(id).open);
  function renderPhotoPolicy() {
    if (!state) return;
    $('photoPolicy').setAttribute('translate', 'no');
    $('photoPolicy').textContent = HubI18n.language === 'en' ? `Photos: up to 1280 px and 300 KB each. Deleted ${state.photoPolicy.retentionMonths} months after closing; active tasks retain their photos. Storage: ${Math.ceil(state.photoPolicy.usedBytes / 1048576)} / ${Math.round(state.photoPolicy.limitBytes / 1048576)} MB.` : `Снимки: до 1280 px и 300 KB всяка. Изтриват се ${state.photoPolicy.retentionMonths} месеца след приключване; активните задачи пазят снимките си. Място: ${Math.ceil(state.photoPolicy.usedBytes / 1048576)} / ${Math.round(state.photoPolicy.limitBytes / 1048576)} MB.`;
  }
  function el(tag, text = '', cls = '', custom = false) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; if (custom) node.setAttribute('translate', 'no'); return node; }
  function formatters() {
    if (formatterTimezone === state.timezone) return;
    formatterTimezone = state.timezone;
    dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone: state.timezone, year: 'numeric', month: '2-digit', day: '2-digit'});
    clockFormatter = new Intl.DateTimeFormat('bg-BG', {timeZone: state.timezone, dateStyle: 'short', timeStyle: 'short'});
  }
  function date(at) { formatters(); return dateFormatter.format(new Date(at)); }
  function clock(at) { formatters(); return clockFormatter.format(new Date(at)); }
  function shiftLabel(shift) { return shift.team === 'СТИКЕРИ' ? 'Редовна смяна' : {1: '1-ва смяна', 2: '2-ра смяна', 3: 'Нощна смяна'}[shift.code]; }
  function button(label, fn, cls = 'secondary') { const node = el('button', label, cls); node.type = 'button'; node.addEventListener('click', fn); return node; }
  function empty(text, ...actions) {
    if (!actions.length) return el('p', text, 'task-empty');
    const node = el('div', '', 'task-empty'), row = el('div', '', 'task-actions task-empty-actions');
    row.append(...actions); node.append(el('p', text), row); return node;
  }
  const filtersActive = () => !!$('ownerFilter').value || !!$('taskSearch').value.trim();
  function clearFilters() {
    $('ownerFilter').value = ''; $('taskSearch').value = ''; listPage = 1; render();
    $('taskSearch').focus();
  }
  // Separate an empty database from filters without matches; only assigners get a create action.
  function noResults(filtered, baseText) {
    if (filtered) return empty('Няма задачи, които отговарят на търсенето или избрания отговорник.', button('Изчисти филтрите', clearFilters));
    return assigner && ['open', 'schedules'].includes(view) ? empty(baseText, button('+ Нова задача', () => { if (state) openEditor(); }, '')) : empty(baseText);
  }
  function loadFailed(error) {
    const retry = button('Опитай отново', () => refresh({fresh: true}));
    if (!state) {
      $('taskMessage').textContent = '';
      $('taskContent').removeAttribute('aria-busy');
      $('taskContent').replaceChildren(empty('Задачите не могат да се заредят. ' + error.message, retry));
      return;
    }
    $('taskMessage').replaceChildren(el('span', error.message + ' Показани са последно заредените данни. '), retry);
  }
  const {photoViews, photoPicker} = createTaskPhotos({$, el, button, photoObserver, observePhotos, forgetPhotos, getState: () => state, isBusy: () => busy});
  const problemPicker = photoPicker('problem'), solutionPicker = photoPicker('solution');
  const editorDraft = HubServer.formDraft($('taskEditor'),{isOpen:() => $('taskEditor').open,extra:() => [problemPicker.values,problemPicker.failed,creationKey]});
  const actionDraft = HubServer.formDraft($('taskAction'),{isOpen:() => $('taskAction').open,extra:() => [solutionPicker.values,solutionPicker.failed,actionKey]});
  HubServer.guardUpdate({isBusy:() => busy || problemPicker.pending || solutionPicker.pending,
    hasDraft:() => editorDraft.hasDraft() || actionDraft.hasDraft()});
  // Everyone except a supervisor without other task rights sees owners, filters and the per-owner summary.
  const overseer = !supervisor || admin || assigner || reviewer;
  const finalStatuses = ['completed', 'cancelled', 'not-done', 'not-applicable'];
  const placeOf = item => TaskViewModel.place(item, state.now, reviewer);
  const monthOf = item => TaskViewModel.monthOf(item, state.timezone);
  const groupLabels = {confirm: 'Чакат твоето потвърждение', shift: 'Тази смяна', deadline: 'Проблеми с краен срок', unreported: 'Пропуснат отчет', upcoming: 'Предстоящи'};
  const groupOrder = Object.keys(groupLabels);
  const monthNames = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
  const monthLabel = value => monthNames[Number(value.slice(5)) - 1] + ' ' + value.slice(0, 4);
  // Ordered items of one tab; render and notification links share it so pages match.
  function listFor(tab, items) {
    if (tab === 'schedules') return [...items].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
    if (tab === 'open') return items.filter(item => placeOf(item).tab === 'open')
      .sort((a, b) => groupOrder.indexOf(placeOf(a).group) - groupOrder.indexOf(placeOf(b).group) || a.due - b.due);
    return items.filter(item => placeOf(item).tab === tab && monthOf(item) === month).sort((a, b) => b.due - a.due);
  }
  function renderSummary(items) {
    const args = [items, month, state.timezone, state.now, state.graceMinutes * 60000], total = TaskViewModel.monthSummary(...args);
    const wrap = el('section', '', 'task-summary'); wrap.setAttribute('aria-label', 'Обобщение за месеца');
    for (const [value, label] of [[total.pct + '%', 'Изпълнени от отчетите'], [String(total.done), 'Изпълнени смени'], [String(total.failed), 'Неизпълнени или без отчет']]) {
      const metric = el('div', '', 'task-metric'); metric.append(el('strong', value), el('span', label)); wrap.append(metric);
    }
    const owners = overseer ? TaskViewModel.byOwner(...args) : [];
    if (owners.length) {
      const list = el('div', '', 'task-owner-list');
      for (const owner of owners) { const row = el('p', '', 'task-owner-row'); row.append(el('span', owner.username, '', true), el('span', `${owner.done} / ${owner.total} · ${owner.pct}%`)); list.append(row); }
      wrap.append(list);
    }
    wrap.append(el('p', 'Броят се сменните задачи с отчет и смените с изтекъл гратисен период без отчет. Отменените и неприложимите не влизат.', 'task-muted'));
    return wrap;
  }
  function history(item) {
    const content = $('historyContent'); forgetPhotos(content); content.replaceChildren(el('h3', item.title, '', true));
    for (const entry of item.events) { const row = el('div', '', 'task-history-event'); row.append(el('strong', actionLabels[entry.action]), el('p', `${clock(entry.at)} · ${entry.actor.username}`, 'task-muted', true)); if (entry.status) row.append(el('span', statusLabels[entry.status], 'task-badge')); if (entry.late) row.append(el('span', 'Закъснял отчет', 'task-badge alert')); if (entry.note) row.append(el('p', entry.note, '', true)); if (entry.transfer) row.append(el('p', `${entry.transfer.from.username} → ${entry.transfer.to.username}`, 'task-muted', true)); if (entry.snapshot) { row.append(el('p', entry.snapshot.title, '', true), el('p', entry.snapshot.description, '', true), el('p', [entry.snapshot.owner.username, ...(entry.snapshot.participants || []).map(person => person.username)].join(' · '), 'task-muted', true), el('span', photoRequirementLabel(entry.snapshot), 'task-badge')); if (entry.snapshot.due) row.append(el('p', clock(entry.snapshot.due), 'task-muted', true)); } if (entry.snapshot) row.append(...photoViews(item, problemPhotos(entry.snapshot), 'Проблем', !item.kind)); row.append(...photoViews(item, solutionPhotos(entry), 'Решение')); content.append(row); }
    $('taskHistory').showModal(); observePhotos(content);
  }
  function menuItem(label, fn, cls = '') { const node = button(label, () => { node.closest('details').open = false; fn(); }, 'task-menu-item' + (cls ? ' ' + cls : '')); return node; }
  function card(item, recurring = false) {
    const place = recurring ? null : placeOf(item);
    const alert = !recurring && (item.displayStatus === 'unreported' || item.overdue || item.status === 'not-done');
    const node = el('article', '', 'task-card' + (alert ? ' is-alert' : place?.group === 'confirm' ? ' is-waiting' : item.status === 'completed' ? ' is-done' : ''));
    node.dataset.taskId = item.id; node.dataset.notificationTarget = item.id;
    const head = el('div', '', 'task-card-head'); head.append(el('h2', item.title, '', true)); node.append(head);
    node.append(el('p', recurring ? `${item.from} – ${item.until} · Екип ${item.team}` : item.kind === 'shift' ? `${item.shift.date} · ${shiftLabel(item.shift)} · ${clock(item.shift.start)} – ${clock(item.due)}` : `Краен срок: ${clock(item.due)}`, 'task-meta'));
    if (overseer) { const owner = el('p', '', 'task-meta'); owner.append(el('span', 'Отговорник'), document.createTextNode(': '), el('span', item.owner.username, '', true)); node.append(owner); }
    if (item.participants.length) node.append(el('p', item.participants.map(person => person.username).join(' · '), 'task-meta', true));
    const badges = el('div', '', 'task-badges'), badge = (text, cls = '') => badges.append(el('span', text, 'task-badge' + (cls ? ' ' + cls : '')));
    if (recurring) badge(item.stoppedAt ? 'Повторението е спряно' : 'Всяка смяна', item.stoppedAt ? 'alert' : '');
    else if (item.status !== 'pending' || item.displayStatus === 'unreported') badge(item.status === 'review' ? 'Готово — чака потвърждение' : statusLabels[item.displayStatus], alert ? 'alert' : item.status === 'completed' ? 'good' : item.status === 'review' ? 'info' : '');
    else if (item.kind === 'shift' && state.now >= item.due) badge('Отчетът закъснява', 'alert');
    if (!recurring && item.scheduleId) badge('Всяка смяна');
    if (!recurring && item.kind === 'global') badge('Обща задача');
    if (requiresPhotos(item)) badge('Изисква снимки');
    if (item.priority === 'high') badge('Спешно', 'alert');
    if (item.overdue) badge('Просрочена', 'alert'); if (item.late) badge('Закъснял отчет', 'alert');
    node.append(badges);
    if (item.description) node.append(el('p', item.description, 'task-description', true));
    if (requiresPhotos(item) || problemPhotos(item).length || solutionPhotos(item.report).length) {
      const evidence = el('div', '', 'task-photos');
      if (requiresPhotos(item) || problemPhotos(item).length) evidence.append(...photoViews(item, problemPhotos(item).length ? problemPhotos(item) : [null], 'Проблем', recurring));
      if (item.report && !solutionPhotos(item.report).length && item.events.at(-1)?.action === 'complete') evidence.append(el('p', 'Завършена от администратор без снимки.', 'task-muted'));
      else if (item.report && (requiresPhotos(item) || solutionPhotos(item.report).length)) evidence.append(...photoViews(item, solutionPhotos(item.report).length ? solutionPhotos(item.report) : [null], 'Решение')); node.append(evidence);
    }
    const lastNote = item.events.findLast(entry => entry.note); if (lastNote) node.append(el('p', lastNote.note, 'task-description task-note', true));
    const quick = el('div', '', 'task-actions task-quick'), menu = el('details', '', 'task-more'), summary = el('summary', '•••');
    summary.setAttribute('aria-label', 'Още действия'); const items = el('div', '', 'task-menu'); menu.append(summary, items);
    items.append(menuItem('История', () => history(item)));
    if (recurring) { if (admin && !item.stoppedAt) items.append(menuItem('Промени бъдещите задачи', () => openEditor(item, true)), menuItem('Спри повторението', () => openAction(item, 'stop', true), 'danger')); }
    else {
      const final = ['completed', 'cancelled'].includes(item.status), owner = supervisor && item.owner.id === HubServer.user.id, started = item.kind === 'global' || state.now >= item.shift.start;
      if (owner && !final && started && place.tab === 'open' && item.kind === 'shift') {
        const done = button('✓ Изпълнена', () => requiresPhotos(item) ? openAction(item, 'report', false, 'completed') : quickDone(item, done), 'task-yes'); done.dataset.quick = 'done';
        const failed = button('× Не е изпълнена', () => openAction(item, 'report', false, 'not-done')); failed.dataset.quick = 'not-done'; quick.append(done, failed);
      }
      if (owner && !final && item.kind === 'global' && item.status !== 'review') { const ready = button('✓ Готово', () => openAction(item, 'report', false, 'review'), 'task-yes'); ready.dataset.quick = 'ready'; quick.append(ready); }
      if (supervisor && item.kind === 'global' && !final && (owner || item.participants.some(person => person.id === HubServer.user.id))) { const note = button('Добави бележка', () => openAction(item, 'progress')); note.dataset.quick = 'note'; quick.append(note); }
      if (reviewer && item.status === 'review') quick.append(button('✓ Потвърди', () => openAction(item, 'approve'), 'task-yes'), button('Върни', () => openAction(item, 'return')));
      if (owner && !final && started && place.tab !== 'open') items.append(menuItem('Промени отчета', () => openAction(item, 'report')));
      if (admin && !final) {
        if (item.kind === 'global' || state.now < item.due && !item.report) items.append(menuItem('Промени', () => openEditor(item)));
        if (administrator) items.append(menuItem('Прехвърли на друг', () => openAction(item, 'transfer')));
        if (administrator && started) items.append(menuItem('Отбележи като изпълнена', () => openAction(item, 'complete')));
      }
      if (admin && finalStatuses.includes(item.status)) items.append(menuItem('Отвори отново', () => openAction(item, 'reopen')));
      if (admin && !final) items.append(menuItem('Отмени задачата', () => openAction(item, 'cancel'), 'danger'));
    }
    head.append(menu); if (quick.childElementCount) node.append(quick); return node;
  }
  let quickKeys = new Map();
  // One tap reports a shift task completed; a retry after a lost response reuses the request id.
  async function quickDone(item, control) {
    if (busy) return;
    busy = true; control.disabled = true; ++sequence; pendingRead = null;
    const requestId = quickKeys.get(item.id) || crypto.randomUUID(); quickKeys.set(item.id, requestId);
    try {
      await HubServer.send('/api/tasks/items/' + item.id, 'PATCH', {action: 'report', status: 'completed', note: '', requestId}, {'If-Match': '"' + item.revision + '"'});
      quickKeys.delete(item.id); busy = false; await refresh({fresh: true}); $('taskMessage').textContent = 'Отчетено като изпълнена.';
    } catch (error) { $('taskMessage').textContent = error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.'; }
    finally { busy = false; if (control.isConnected) control.disabled = false; }
  }
  function render() {
    if (!state) return;
    clearTimeout(searchTimer);
    $('taskContent').removeAttribute('aria-busy');
    const owner = $('ownerFilter').value, search = $('taskSearch').value.trim().toLowerCase();
    const selected = item => (!owner || String(item.owner.id) === owner) && (item.title + ' ' + item.description).toLowerCase().includes(search);
    const items = state.items.filter(selected);
    for (const tab of $('taskTabs').querySelectorAll('[data-view]')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
      const count = ['open', 'missed'].includes(tab.dataset.view) ? listFor(tab.dataset.view, items).length : 0, badge = tab.querySelector('.task-badge');
      badge.textContent = String(count); badge.hidden = !count;
    }
    $('taskMonth').hidden = !['done', 'missed'].includes(view); $('monthLabel').textContent = monthLabel(month);
    const content = $('taskContent'), retainedFocus = content.contains(document.activeElement) ? document.activeElement : null;
    forgetPhotos(content); content.replaceChildren();
    try {
      const values = listFor(view, view === 'schedules' ? state.schedules.filter(selected) : items);
      if (view === 'done') content.append(renderSummary(items));
      if (!values.length) {
        listPage = 1;
        const filtered = filtersActive() && listFor(view, view === 'schedules' ? state.schedules : state.items).length > 0;
        content.append(noResults(filtered, {schedules: 'Няма повтарящи се задачи.', open: 'Няма задачи за отчет.', done: 'Няма изпълнени задачи през този месец.', missed: 'Няма неизпълнени задачи през този месец.'}[view]));
      }
      else appendPage(content, values, view === 'schedules');
    } finally {
      if (retainedFocus?.isConnected && document.activeElement === document.body) retainedFocus.focus({preventScroll: true});
      globalThis.HubNotificationTarget?.reveal(content);
    }
  }
  function appendPage(content, values, recurring = false) {
    listPage = HubListPagination.clamp(listPage, values.length, pageSize);
    const list = el('div', '', 'task-list');
    const nextCache = new Map();
    let group = null;
    for (const item of values.slice((listPage - 1) * pageSize, listPage * pageSize)) {
      // Open tasks are listed by group; each page repeats the heading of its first group.
      const current = view === 'open' ? placeOf(item).group : null;
      if (current !== group) { group = current; const heading = el('h2', groupLabels[group], 'task-group'); heading.dataset.taskGroup = group; list.append(heading); }
      const signature = JSON.stringify([item, recurring, HubI18n.language, state.timezone, state.now >= item.shift?.start, state.now < item.due, current]);
      const previous = cardCache.get(item.id), entry = previous?.signature === signature ? previous : {signature, node: card(item, recurring)};
      nextCache.set(item.id, entry); list.append(entry.node);
    }
    cardCache = nextCache;
    content.append(list, HubListPagination.create({id: 'taskPagination', page: listPage, total: values.length, size: pageSize,
      onChange: page => { listPage = page; render(); }}));
    observePhotos(list);
  }
  function refresh({fresh = false} = {}) {
    if (draftOpen() || document.hidden) return Promise.resolve();
    if (!fresh && pendingRead) return pendingRead;
    const current = ++sequence;
    const operation = (async () => { try {
      const result = await HubServer.json('/api/tasks'); if (current !== sequence || draftOpen() || document.hidden) return;
      state = result; $('taskMessage').textContent = '';
      // Clock ticks alone do not change cards, but crossing a start/due/grace
      // boundary changes actions and overdue totals even with the same records.
      const snapshot = JSON.stringify({...result, now:undefined, month:monthChosen ? null : date(result.now).slice(0, 7), timeBoundaries:result.items.map(item => [
        result.now >= item.shift?.start, result.now < item.due, item.due + result.graceMinutes * 60000 < result.now
      ])});
      if (snapshot === displayedSnapshot) return;
      displayedSnapshot = snapshot;
      renderPhotoPolicy();
      const value = $('ownerFilter').value, options = new Map([...state.items, ...state.schedules].map(item => [item.owner.id, item.owner.username])); for (const person of state.supervisors) options.set(person.id, person.username);
      $('ownerFilter').replaceChildren(new Option('Всички отговорници', '')); for (const [id, name] of options) { const option = new Option(name, id); option.setAttribute('translate', 'no'); $('ownerFilter').append(option); } $('ownerFilter').value = value;
      // An open page follows the current month until the user picks another one.
      if (!monthChosen) month = date(state.now).slice(0, 7);
      globalThis.HubNotificationTarget?.select([...state.items, ...state.schedules], item => item.id, item => {
        $('ownerFilter').value = ''; $('taskSearch').value = '';
        view = state.schedules.includes(item) ? 'schedules' : placeOf(item).tab;
        if (['done', 'missed'].includes(view)) { month = monthOf(item); monthChosen = true; }
        const values = listFor(view, view === 'schedules' ? state.schedules : state.items);
        listPage = Math.floor(values.indexOf(item) / pageSize) + 1;
      });
      $('taskSubtitle').textContent = reviewer ? assigner ? 'Възлагай задачи, следи отчетите и потвърждавай решените проблеми.' : 'Следи отчетите и потвърждавай решените проблеми.' : admin ? 'Редактирай задачи и проследявай изпълнението им.' : assigner ? 'Възлагай сменни и глобални задачи и проследявай изпълнението им.' : reader ? 'Преглед на всички задачи, отчети и история. Акаунтът няма право да ги променя.' : 'Твоите сменни задачи и общите проблеми, в които участваш.';
      render();
    } catch (error) { if (current === sequence && !draftOpen()) loadFailed(error); }
    })();
    pendingRead = operation;
    operation.finally(() => { if (pendingRead === operation) pendingRead = null; }).catch(() => {});
    return operation;
  }
  function editorFields() {
    const global = $('taskKind').value === 'global', recurring = $('taskRepeat').value === 'every-shift';
    $('problemPhotoFields').hidden = !$('taskRequiresPhotos').checked;
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
    problemPicker.reset(problemPhotos(item), item, recurring); $('problemPhotoHelp').textContent = item ? 'Добави или премахни снимки на проблема. Предишните остават в историята.' : 'Добави една или повече снимки на проблема. При повторение се използват за всички смени.';
    $('taskRequiresPhotos').checked = requiresPhotos(item);
    $('editorTitle').textContent = item ? recurring ? 'Промени бъдещите задачи' : 'Промени задача' : 'Нова задача'; $('saveTask').textContent = item ? 'Запази' : 'Възложи';
    $('taskKind').value = item?.kind || 'shift'; $('taskKind').disabled = !!item; $('taskRepeat').value = recurring ? 'every-shift' : 'once'; $('taskRepeat').disabled = !!item;
    $('taskFrom').disabled = !!item; $('taskUntil').disabled = !!item; $('editReasonLabel').hidden = !item; $('editReason').required = !!item;
    $('taskMore').open = !!(item?.description || item?.priority === 'high'); $('taskTitle').value = item?.title || ''; $('taskDescription').value = item?.description || ''; $('taskPriority').value = item?.priority || 'normal';
    $('taskOwner').replaceChildren(new Option('Избери началник смяна', '')); $('participantOptions').replaceChildren();
    for (const person of state.supervisors) {
      const option = new Option(person.username + ' · ' + person.team, person.id); option.setAttribute('translate', 'no'); $('taskOwner').append(option);
      const label = el('label'), check = el('input'); check.type = 'checkbox'; check.value = person.id; check.checked = !!item?.participants.some(value => value.id === person.id); label.append(check, el('span', person.username, '', true)); $('participantOptions').append(label);
    }
    $('taskOwner').value = item ? String(item.owner.id) : '';
    $('taskOwner').disabled = !!item && !administrator;
    $('taskFrom').value = recurring ? item.from : item?.shift?.date || state.currentShift.date; $('taskUntil').value = item?.until || date(state.now + 30 * 86400000);
    $('taskDueDate').value = item?.due ? date(item.due) : date(state.now + 86400000);
    $('taskDueTime').value = item?.due ? new Intl.DateTimeFormat('en-GB', {timeZone: state.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(item.due)) : '17:00';
    $('taskTimezone').textContent = 'Часова зона: ' + state.timezone; editorFields(); editorDraft.accept(); $('taskEditor').showModal(); $('taskTitle').focus();
  }
  function openAction(item, action, recurring = false, preset = null) {
    acting = {item, action, recurring}; actionKey = null; $('actionForm').reset(); $('actionFeedback').textContent = ''; solutionPicker.reset([], null, false, action === 'complete' ? 0 : requiredPhotoCount(item)); $('solutionPhotoFields').hidden = action !== 'complete' && (action !== 'report' || !requiresPhotos(item));
    $('solutionPhotoHelp').textContent = action === 'complete' ? 'Снимките са незадължителни при завършване от администратор. Можеш да завършиш със или без снимки.' : 'Всеки отчет изисква толкова нови снимки на решението или текущото състояние, колкото са снимките на проблема, включително при неизпълнена задача.';
    $('transferOwnerLabel').hidden = action !== 'transfer'; $('transferHelp').hidden = action !== 'transfer'; $('transferOwner').required = action === 'transfer';
    $('transferOwner').replaceChildren(new Option('Избери нов отговорник', ''));
    for (const person of state.supervisors.filter(person => person.id !== item.owner.id)) {
      const option = new Option(person.username + ' · ' + person.team, person.id); option.setAttribute('translate', 'no'); $('transferOwner').append(option);
    }
    if (action === 'transfer' && $('transferOwner').options.length === 1) $('actionFeedback').textContent = 'Няма друг активен отговорник с право за отчитане.';
    $('actionTitle').textContent = {completed: '✓ Изпълнена', 'not-done': '× Не е изпълнена', review: '✓ Готово'}[preset] || (action === 'report' ? 'Отчети задача' : action === 'complete' ? 'Завърши задача' : action === 'transfer' ? 'Прехвърли задача' : actionLabels[action]); $('actionTaskTitle').textContent = item.title;
    // Quick buttons preset the result; a not-done report may still be marked not applicable.
    const statuses = preset === 'not-done' ? ['not-done', 'not-applicable'] : preset ? [preset] : item.kind === 'shift' ? ['completed', 'not-done', 'not-applicable'] : ['in-progress', 'blocked', 'review'];
    $('reportStatus').replaceChildren(); for (const status of statuses) $('reportStatus').append(new Option(statusLabels[status], status));
    $('reportStatusLabel').hidden = action !== 'report' || statuses.length === 1;
    $('actionNote').required = !['approve', 'complete'].includes(action) && (action !== 'report' || $('reportStatus').value !== 'completed'); actionDraft.accept(); $('taskAction').showModal();
  }
  async function mutate(form, feedback, fn) {
    if (busy) return;
    busy = true; const submit = form.querySelector('button[type=submit]'); submit.disabled = true; feedback.textContent = '';
    const focused = document.activeElement, dialog = form.closest('dialog');
    const controls = [...form.querySelectorAll('input,select,textarea,button')].filter(control => !control.disabled); for (const control of controls) control.disabled = true;
    ++sequence; pendingRead = null;
    try { await fn(); ++sequence; pendingRead = null; dialog.close(); busy = false; await refresh({fresh:true}); $('taskMessage').textContent = 'Промяната е записана.'; if (document.activeElement === document.body) $('taskMessage').focus(); }
    catch (error) { feedback.textContent = error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.'; if (error.status === 409) feedback.textContent += ' Затвори прозореца и натисни „Опресни“. Въведеното е запазено до затваряне.'; }
    finally { busy = false; for (const control of controls) control.disabled = false; submit.disabled = false; if (dialog.open && !dialog.contains(document.activeElement)) (dialog.contains(focused) ? focused : submit).focus(); }
  }
  $('taskForm').addEventListener('submit', event => {
    event.preventDefault();
    const needsPhoto = $('taskRequiresPhotos').checked;
    if (needsPhoto && problemPicker.pending) { $('editorFeedback').textContent = 'Изчакай снимката да е готова.'; return; }
    if (needsPhoto && problemPicker.failed) { $('editorFeedback').textContent = 'Снимката не е валидна. Избери я отново.'; return; }
    if (needsPhoto && (!problemPicker.count || !problemPicker.valid)) { $('editorFeedback').textContent = 'Добави снимка преди запис.'; return; }
    const payload = {title: $('taskTitle').value, description: $('taskDescription').value, priority: $('taskPriority').value, assigneeId: Number($('taskOwner').value), participantIds: $('taskKind').value === 'global' ? [...$('participantOptions').querySelectorAll('input:checked')].map(input => Number(input.value)) : [], kind: $('taskKind').value, repeat: $('taskRepeat').value, from: $('taskFrom').value, until: $('taskUntil').value, dueDate: $('taskDueDate').value, dueTime: $('taskDueTime').value, note: $('editReason').value};
    payload.requiresPhotos = needsPhoto;
    if (needsPhoto) payload.problemPhotos = problemPicker.values;
    if (!editing) { const signature = JSON.stringify(payload); if (!creationKey || creationKey.signature !== signature) creationKey = {signature, id: crypto.randomUUID()}; payload.requestId = creationKey.id; }
    mutate($('taskForm'), $('editorFeedback'), () => editing ? HubServer.send('/api/tasks/' + (editing.recurring ? 'schedules/' : 'items/') + editing.item.id, 'PATCH', {...payload, action: 'edit'}, {'If-Match': '"' + editing.item.revision + '"'}) : HubServer.send('/api/tasks', 'POST', payload));
  });
  $('actionForm').addEventListener('submit', event => {
    event.preventDefault();
    if (solutionPicker.pending) { $('actionFeedback').textContent = 'Изчакай снимката да е готова.'; return; }
    if (acting.action === 'complete' && solutionPicker.failed) { $('actionFeedback').textContent = 'Снимката не е валидна. Избери я отново.'; return; }
    if (acting.action === 'report' && requiresPhotos(acting.item) && !solutionPicker.count) { $('actionFeedback').textContent = 'Добави снимка преди запис.'; return; }
    if (acting.action === 'report' && requiresPhotos(acting.item) && solutionPicker.failed) { $('actionFeedback').textContent = 'Снимката не е валидна. Избери я отново.'; return; }
    if (acting.action === 'report' && requiresPhotos(acting.item) && solutionPicker.count !== requiredPhotoCount(acting.item)) { $('actionFeedback').textContent = 'Броят на снимките на решението трябва да е равен на броя на снимките на проблема.'; return; }
    const payload = {action: acting.action, status: $('reportStatus').value, note: $('actionNote').value};
    if (acting.action === 'transfer') payload.assigneeId = Number($('transferOwner').value);
    if (acting.action === 'complete' || acting.action === 'report' && requiresPhotos(acting.item)) payload.solutionPhotos = solutionPicker.values;
    const signature = JSON.stringify(payload); if (!actionKey || actionKey.signature !== signature) actionKey = {signature, id: crypto.randomUUID()}; payload.requestId = actionKey.id;
    mutate($('actionForm'), $('actionFeedback'), () => HubServer.send('/api/tasks/' + (acting.recurring ? 'schedules/' : 'items/') + acting.item.id, 'PATCH', payload, {'If-Match': '"' + acting.item.revision + '"'}));
  });
  $('reportStatus').addEventListener('change', () => { $('actionNote').required = $('reportStatus').value !== 'completed'; });
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => { if (!busy) $(control.dataset.close).close(); });
  for (const id of dialogs) $(id).addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  for (const id of dialogs) $(id).addEventListener('close', () => { if (!draftOpen()) refresh(); });
  $('taskEditor').addEventListener('close', () => problemPicker.reset()); $('taskAction').addEventListener('close', () => solutionPicker.reset());
  $('taskPhotoViewer').addEventListener('close', () => $('photoViewerImage').removeAttribute('src'));
  $('photoViewerImage').addEventListener('error', () => { if ($('taskPhotoViewer').open) $('photoViewerFeedback').textContent = 'Снимката не е достъпна. Опресни задачите.'; });
  for (const id of ['taskKind', 'taskRepeat', 'taskOwner', 'taskFrom', 'taskRequiresPhotos']) $(id).addEventListener('change', editorFields);
  $('newTask').hidden = !assigner; $('newTask').addEventListener('click', () => { if (state && assigner) openEditor(); }); $('ownerFilterLabel').hidden = supervisor && !assigner && !admin && !reviewer;
  $('refreshTasks').addEventListener('click', refresh);
  $('ownerFilter').addEventListener('input', () => { listPage = 1; render(); });
  for (const [id, step] of [['monthPrev', -1], ['monthNext', 1]]) $(id).addEventListener('click', () => { month = TaskViewModel.addMonths(month, step); monthChosen = true; listPage = 1; render(); });
  $('schedulesTab').hidden = !admin && !assigner; $('taskSearchLabel').hidden = !overseer;
  // Shift starts and grace periods change the list without any record change.
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  $('taskSearch').addEventListener('input', () => {
    listPage = 1; clearTimeout(searchTimer); $('taskContent').setAttribute('aria-busy', 'true');
    searchTimer = setTimeout(render, 150);
  });
  $('taskTabs').addEventListener('click', event => { const tab = event.target.closest('[data-view]'); if (!tab) return; view = tab.dataset.view; listPage = 1; for (const control of $('taskTabs').querySelectorAll('button')) control.setAttribute('aria-pressed', String(control === tab)); render(); });
  document.addEventListener('click', event => { if (event.target.closest('[data-hub-language]')) { renderPhotoPolicy(); problemPicker.render(); solutionPicker.render(); if (!draftOpen()) render(); } });
  HubServer.watch('tasks', refresh, draftOpen); HubServer.watch('accounts', refresh, draftOpen);
  setInterval(() => refresh(), 30000); refresh();
})();
