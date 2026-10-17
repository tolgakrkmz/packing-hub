/* Task text and identities stay out of browser persistence and translation. */
(() => {
  const $ = id => document.getElementById(id), admin = typeof HubServer !== 'undefined' && HubServer.can('canManageTasks');
  if (typeof HubServer === 'undefined') { $('taskMessage').textContent = 'Задачите са достъпни в сървърната версия след вход с личен акаунт.'; $('taskContent').hidden = true; return; }
  const supervisor = HubServer.can('canReportTasks'), reader = !admin && !supervisor;
  const assigner = HubServer.can('canAssignTasks'), reviewer = HubServer.can('canReviewTasks');
  const administrator = admin && HubServer.user.role === 'admin';
  let state, view = 'shift', historyView = 'reported', editing = null, acting = null, busy = false, sequence = 0, creationKey = null, actionKey = null, previewSequence = 0;
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
  function selectedOwner(item) { return !$('ownerFilter').value || String(item.owner.id) === $('ownerFilter').value; }
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
    return assigner && view !== 'history' ? empty(baseText, button('+ Възложи задача', () => { if (state) openEditor(); }, '')) : empty(baseText);
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
  function withoutMetadata(dataURL) {
    // Some browsers add an ICC profile to canvas JPEGs. Strip optional metadata
    // segments as well as camera tags; compressed pixels stay unchanged.
    const binary = atob(dataURL.split(',')[1]), parts = [binary.slice(0, 2)];
    let offset = 2;
    while (offset + 4 <= binary.length) {
      const marker = binary.charCodeAt(offset + 1);
      if (marker === 0xda || marker === 0xd9) { parts.push(binary.slice(offset)); break; }
      const length = (binary.charCodeAt(offset + 2) << 8) + binary.charCodeAt(offset + 3), end = offset + 2 + length;
      if (binary.charCodeAt(offset) !== 0xff || length < 2 || end > binary.length) throw new Error('Снимката не може да се отвори. Избери JPEG, PNG или WebP.');
      if (!(marker >= 0xe1 && marker <= 0xef || marker === 0xfe)) parts.push(binary.slice(offset, end));
      offset = end;
    }
    return 'data:image/jpeg;base64,' + btoa(parts.join(''));
  }
  function photoView(item, photo, label, recurring = false, index = 0, total = 1) {
    label = (HubI18n.language === 'en' ? label === 'Проблем' ? 'Problem' : 'Solution' : label) + (total > 1 ? ' ' + (index + 1) : '');
    const figure = el('figure', '', 'task-photo'); figure.append(el('figcaption', label, '', true));
    if (!photo?.available) { figure.append(el('p', photo ? 'Снимката е изтрита след срока за съхранение.' : 'Няма снимка от предишната версия.', 'task-muted')); return figure; }
    const url = '/api/tasks/' + (recurring ? 'schedules/' : 'items/') + item.id + '/photos/' + photo.id;
    const control = button('Отвори снимката', () => {
      $('photoViewerTitle').textContent = label; $('photoViewerFeedback').textContent = '';
      $('photoViewerImage').alt = label; $('photoViewerImage').src = url; $('taskPhotoViewer').showModal();
    }, 'secondary task-photo-button');
    const img = el('img'); img.alt = label; img.loading = 'lazy'; img.decoding = 'async'; img.width = photo.width || 220; img.height = photo.height || 130;
    if (photoObserver) img.dataset.photoSrc = url; else img.src = url;
    img.addEventListener('error', () => { control.replaceChildren(el('span', 'Снимката не е достъпна. Опресни задачите.')); });
    control.replaceChildren(img, el('span', 'Отвори снимката')); figure.append(control); return figure;
  }
  const photoViews = (item, list, label, recurring = false) => list.map((photo, index) => photoView(item, photo, label, recurring, index, list.length));
  function photoPicker(prefix) {
    let entries = [], pending = false, failed = false, original = null, sequence = 0, expected = 0;
    const input = $(prefix + 'Photo'), camera = $(prefix + 'Camera'), preview = $(prefix + 'PhotoPreview'), info = $(prefix + 'PhotoInfo'), clear = $(prefix + 'PhotoClear');
    const clearFeedback = () => { $(prefix === 'problem' ? 'editorFeedback' : 'actionFeedback').textContent = ''; };
    function render() {
      forgetPhotos(preview); preview.replaceChildren(); clear.hidden = !entries.length && !failed && !pending;
      entries.forEach((entry, index) => {
        const row = el('div', '', 'task-photo-choice');
        if (entry.photo) row.append(photoView(original.item, entry.photo, 'Проблем', original.recurring, index, entries.length));
        else { const img = el('img', '', 'task-photo-preview'); img.alt = 'Избрана снимка'; img.src = 'data:image/jpeg;base64,' + entry.data; row.append(img); }
        row.append(button('Премахни снимката', () => { if (!busy && !pending) { entries.splice(index, 1); failed = false; info.textContent = ''; clearFeedback(); render(); } })); preview.append(row);
      });
      const count = $(prefix + 'PhotoCount'); count.setAttribute('translate', 'no');
      count.textContent = HubI18n.language === 'en' ? expected ? `Solution photos: ${entries.length} / ${expected} required.` : `Selected photos: ${entries.length} / ${state?.photoPolicy.maxPhotos || 10}.` : expected ? `Снимки на решението: ${entries.length} / ${expected} задължителни.` : `Избрани снимки: ${entries.length} / ${state?.photoPolicy.maxPhotos || 10}.`;
      observePhotos(preview);
    }
    function reset(existing = [], item = null, recurring = false, required = 0) {
      ++sequence; entries = existing.map(photo => ({photo})); pending = false; failed = false; original = {existing, item, recurring}; expected = required;
      input.value = ''; camera.value = ''; input.disabled = busy; camera.disabled = busy; info.textContent = ''; render();
    }
    async function encode(file) {
      let bitmap;
      try {
        if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('Избери снимка до 20 MB, която браузърът може да отвори (JPEG, PNG или WebP).');
        bitmap = await createImageBitmap(file);
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('Снимката е прекалено голяма. Избери по-малка снимка.');
        let edge = state.photoPolicy.maxEdge, result;
        while (edge >= 320) {
          const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          for (const quality of [.82, .7, .58]) {
            result = canvas.toDataURL('image/jpeg', quality);
            if ((result.length - result.indexOf(',') - 1) * 3 / 4 <= state.photoPolicy.maxBytes) break;
          }
          if ((result.length - result.indexOf(',') - 1) * 3 / 4 <= state.photoPolicy.maxBytes) break;
          result = null; edge = Math.floor(edge * .75);
        }
        if (!result) throw new Error('Снимката е прекалено голяма. Избери по-малка снимка.');
        return withoutMetadata(result).split(',')[1];
      } finally { bitmap?.close(); }
    }
    async function choose(event) {
      if (busy || pending) return;
      const files = [...event.target.files]; if (!files.length) return;
      const current = ++sequence; pending = true; failed = false; clear.hidden = false; input.disabled = true; camera.disabled = true; clearFeedback(); info.textContent = 'Подготвяне на снимката…';
      try {
        if (entries.length + files.length > state.photoPolicy.maxPhotos) throw new Error('Можеш да добавиш до 10 снимки.');
        const added = [];
        for (const file of files) { added.push({data: await encode(file)}); if (sequence !== current) return; }
        entries.push(...added); info.textContent = entries.length === 1 ? 'Снимката е готова за запис.' : 'Снимките са готови за запис.';
      } catch (error) { if (sequence === current) { failed = true; info.textContent = /^(Избери|Снимката|Можеш)/.test(error.message) ? error.message : 'Снимката не може да се отвори. Избери JPEG, PNG или WebP.'; } }
      finally { if (sequence === current) { pending = false; input.disabled = busy; camera.disabled = busy; input.value = ''; camera.value = ''; render(); } }
    }
    input.addEventListener('change', choose); camera.addEventListener('change', choose); clear.addEventListener('click', () => { if (!busy) { clearFeedback(); reset([], original?.item, original?.recurring, expected); } });
    return {reset, render, get values() { return entries.map(entry => entry.photo ? {id: entry.photo.id} : entry.data); }, get count() { return entries.length; }, get valid() { return entries.every(entry => !entry.photo || entry.photo.available); }, get pending() { return pending; }, get failed() { return failed; }};
  }
  const problemPicker = photoPicker('problem'), solutionPicker = photoPicker('solution');
  const editorDraft = HubServer.formDraft($('taskEditor'),{isOpen:() => $('taskEditor').open,extra:() => [problemPicker.values,problemPicker.failed,creationKey]});
  const actionDraft = HubServer.formDraft($('taskAction'),{isOpen:() => $('taskAction').open,extra:() => [solutionPicker.values,solutionPicker.failed,actionKey]});
  HubServer.guardUpdate({isBusy:() => busy || problemPicker.pending || solutionPicker.pending,
    hasDraft:() => editorDraft.hasDraft() || actionDraft.hasDraft()});
  function period(item) { const key = item.kind === 'shift' ? item.shift.date : date(item.due); return key >= $('statsFrom').value && key <= $('statsUntil').value; }
  function historyIncludes(item, group) {
    const kind = item.status === 'cancelled' ? 'cancelled' : item.report ? 'reported' : 'unreported';
    return kind === group && (group === 'unreported' || period(item));
  }
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
  function renderHistory(items, allItems = items) {
    const wrap = el('div', '', 'task-history');
    const controls = el('div', '', 'task-tabs task-history-tabs');
    controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Отчети в историята');
    wrap.append(controls, el('p', 'Последно възложените задачи са най-отгоре.', 'task-muted'));
    const newestFirst = [...items].sort((a, b) => b.createdAt - a.createdAt || b.due - a.due);
    for (const [key, label, description, noMatch] of [
      ['reported', 'Отчетени', 'Имат подаден отчет, независимо от резултата.', 'Няма отчетени задачи по тези критерии.'],
      ['unreported', 'Неотчетени', 'Нямат подаден отчет за текущото състояние. Показани са всички дати.', 'Няма неотчетени задачи по тези критерии.'],
      ['cancelled', 'Отменени', 'Задачи с отменено възлагане.', 'Няма отменени задачи по тези критерии.']
    ]) {
      const values = newestFirst.filter(item => historyIncludes(item, key));
      const control = button('', () => {
        historyView = key; listPage = 1; render();
        $('taskContent').querySelector(`[data-history-view="${key}"]`).focus();
      });
      control.dataset.historyView = key; control.setAttribute('aria-pressed', String(historyView === key));
      control.setAttribute('aria-controls', 'taskHistoryResults');
      control.append(el('span', label), el('span', String(values.length), 'task-badge', true)); controls.append(control);
      if (historyView !== key) continue;
      const section = el('section', '', 'task-history-group'); section.dataset.historyGroup = key;
      section.id = 'taskHistoryResults';
      const heading = el('h2', '', 'task-history-heading'); heading.id = 'taskHistoryHeading-' + key;
      heading.append(el('span', label), el('span', String(values.length), 'task-badge', true));
      section.setAttribute('aria-labelledby', heading.id);
      section.append(heading, el('p', description, 'task-muted'));
      if (!values.length) { listPage = 1; section.append(filtersActive() && allItems.some(item => historyIncludes(item, key)) ? noResults(true) : empty(noMatch)); }
      else appendPage(section, values);
      wrap.append(section);
    }
    return wrap;
  }
  function history(item) {
    const content = $('historyContent'); forgetPhotos(content); content.replaceChildren(el('h3', item.title, '', true));
    for (const entry of item.events) { const row = el('div', '', 'task-history-event'); row.append(el('strong', actionLabels[entry.action]), el('p', `${clock(entry.at)} · ${entry.actor.username}`, 'task-muted', true)); if (entry.status) row.append(el('span', statusLabels[entry.status], 'task-badge')); if (entry.late) row.append(el('span', 'Закъснял отчет', 'task-badge alert')); if (entry.note) row.append(el('p', entry.note, '', true)); if (entry.transfer) row.append(el('p', `${entry.transfer.from.username} → ${entry.transfer.to.username}`, 'task-muted', true)); if (entry.snapshot) { row.append(el('p', entry.snapshot.title, '', true), el('p', entry.snapshot.description, '', true), el('p', [entry.snapshot.owner.username, ...(entry.snapshot.participants || []).map(person => person.username)].join(' · '), 'task-muted', true), el('span', photoRequirementLabel(entry.snapshot), 'task-badge')); if (entry.snapshot.due) row.append(el('p', clock(entry.snapshot.due), 'task-muted', true)); } if (entry.snapshot) row.append(...photoViews(item, problemPhotos(entry.snapshot), 'Проблем', !item.kind)); row.append(...photoViews(item, solutionPhotos(entry), 'Решение')); content.append(row); }
    $('taskHistory').showModal(); observePhotos(content);
  }
  function card(item, recurring = false) {
    const alert = item.displayStatus === 'unreported' || item.overdue || item.status === 'not-done';
    const node = el('article', '', 'task-card' + (alert ? ' is-alert' : '')); node.dataset.taskId = item.id; node.dataset.notificationTarget = item.id;
    const head = el('div', '', 'task-card-head'); head.append(el('h2', item.title, '', true), el('span', item.owner.username, 'task-meta', true)); node.append(head);
    const badges = el('div', '', 'task-badges');
    const status = recurring ? item.stoppedAt ? 'Повторението е спряно' : 'Активно повторение' : statusLabels[item.displayStatus];
    badges.append(el('span', status, 'task-badge' + (alert ? ' alert' : item.status === 'completed' ? ' good' : '')));
    badges.append(el('span', photoRequirementLabel(item), 'task-badge'));
    if (item.priority === 'high') badges.append(el('span', 'Висок приоритет', 'task-badge alert'));
    if (item.overdue) badges.append(el('span', 'Просрочена', 'task-badge alert')); if (item.late) badges.append(el('span', 'Закъснял отчет', 'task-badge alert'));
    node.append(badges, el('p', item.description, 'task-description', true));
    if (requiresPhotos(item) || problemPhotos(item).length || solutionPhotos(item.report).length) {
      const evidence = el('div', '', 'task-photos');
      if (requiresPhotos(item) || problemPhotos(item).length) evidence.append(...photoViews(item, problemPhotos(item).length ? problemPhotos(item) : [null], 'Проблем', recurring));
      if (item.report && !solutionPhotos(item.report).length && item.events.at(-1)?.action === 'complete') evidence.append(el('p', 'Завършена от администратор без снимки.', 'task-muted'));
      else if (item.report && (requiresPhotos(item) || solutionPhotos(item.report).length)) evidence.append(...photoViews(item, solutionPhotos(item.report).length ? solutionPhotos(item.report) : [null], 'Решение')); node.append(evidence);
    }
    node.append(el('p', recurring ? `${item.from} – ${item.until} · Екип ${item.team}` : item.kind === 'shift' ? `${item.shift.date} · Екип ${item.shift.team} · ${shiftLabel(item.shift)} · ${clock(item.shift.start)} – ${clock(item.due)}` : `Краен срок: ${clock(item.due)}`, 'task-meta'));
    if (item.participants.length) node.append(el('p', item.participants.map(person => person.username).join(' · '), 'task-meta', true));
    const lastNote = item.events.findLast(entry => entry.note); if (lastNote) node.append(el('p', lastNote.note, 'task-description', true));
    const actions = el('div', '', 'task-actions'); actions.append(button('История', () => history(item)));
    if (recurring) { if (admin && !item.stoppedAt) actions.append(button('Промени бъдещите задачи', () => openEditor(item, true)), button('Спри повторението', () => openAction(item, 'stop', true))); }
    else {
      const final = ['completed', 'cancelled'].includes(item.status);
      if (supervisor && item.owner.id === HubServer.user.id && !final && (item.kind === 'global' || state.now >= item.shift.start)) actions.append(button('Отчети', () => openAction(item, 'report'), ''));
      if (supervisor && item.kind === 'global' && !final && (item.owner.id === HubServer.user.id || item.participants.some(person => person.id === HubServer.user.id))) actions.append(button('Добави напредък', () => openAction(item, 'progress')));
      if (reviewer && item.status === 'review') actions.append(button('Потвърди приключване', () => openAction(item, 'approve'), ''), button('Върни за работа', () => openAction(item, 'return')));
      if (admin && !final) {
        if (administrator) actions.append(button('Прехвърли задача', () => openAction(item, 'transfer')));
        if (administrator && (item.kind === 'global' || state.now >= item.shift.start)) actions.append(button('Завърши задача', () => openAction(item, 'complete'), ''));
        if (item.kind === 'global' || state.now < item.due && !item.report) actions.append(button('Промени', () => openEditor(item)));
        actions.append(button('Отмени', () => openAction(item, 'cancel')));
      }
      if (admin && ['completed', 'cancelled', 'not-done', 'not-applicable'].includes(item.status)) actions.append(button('Отвори отново', () => openAction(item, 'reopen')));
    }
    node.append(actions); return node;
  }
  function render() {
    if (!state) return;
    clearTimeout(searchTimer);
    $('taskContent').removeAttribute('aria-busy');
    const owner = $('ownerFilter').value, search = $('taskSearch').value.trim().toLowerCase();
    const selected = item => (!owner || String(item.owner.id) === owner) && (item.title + ' ' + item.description).toLowerCase().includes(search);
    const items = state.items.filter(selected), overview = $('taskOverview'); overview.replaceChildren();
    for (const [label, count] of [['Активни задачи', items.filter(item => !['completed', 'cancelled', 'not-done', 'not-applicable'].includes(item.status)).length], ['Неотчетени', items.filter(item => item.displayStatus === 'unreported').length], ['Готови за проверка', items.filter(item => item.status === 'review').length], ['Просрочени глобални', items.filter(item => item.overdue).length]]) { const metric = el('div', '', 'task-metric'); metric.append(el('strong', String(count)), el('span', label)); overview.append(metric); }
    const usesPeriod = view === 'stats' || view === 'history' && historyView !== 'unreported';
    $('taskPeriod').hidden = !usesPeriod;
    const content = $('taskContent'), retainedFocus = content.contains(document.activeElement) ? document.activeElement : null;
    forgetPhotos(content); content.replaceChildren();
    try {
    if (usesPeriod && (!$('statsFrom').value || !$('statsUntil').value || $('statsFrom').value > $('statsUntil').value)) { content.append(empty('Избери валиден период.')); return; }
    if (view === 'stats') { content.append(renderStats(items)); return; }
    if (view === 'history') { content.append(renderHistory(items, state.items)); return; }
    const inView = item => view === 'shift' ? item.kind === 'shift' && !['completed', 'cancelled', 'not-done', 'not-applicable'].includes(item.status) : view === 'global' ? item.kind === 'global' && !['completed', 'cancelled'].includes(item.status) : period(item);
    const values = view === 'schedules' ? state.schedules.filter(selected) : items.filter(inView);
    values.sort((a, b) => (a.due || Date.parse(a.from)) - (b.due || Date.parse(b.from)));
    if (!values.length) {
      listPage = 1;
      const filtered = filtersActive() && (view === 'schedules' ? state.schedules.length > 0 : state.items.some(inView));
      content.append(noResults(filtered, {schedules: 'Няма повтарящи се задачи.', shift: 'Няма активни сменни задачи.', global: 'Няма активни глобални задачи.'}[view] || 'Няма задачи по тези критерии.'));
    }
    else appendPage(content, values, view === 'schedules');
    } finally {
      // History builds its section off-DOM. Restore focus and reveal the target
      // only after the complete view is connected to the page.
      if (retainedFocus?.isConnected && document.activeElement === document.body) retainedFocus.focus({preventScroll: true});
      globalThis.HubNotificationTarget?.reveal(content);
    }
  }
  function appendPage(content, values, recurring = false) {
    listPage = HubListPagination.clamp(listPage, values.length, pageSize);
    const list = el('div', '', 'task-list');
    const nextCache = new Map();
    for (const item of values.slice((listPage - 1) * pageSize, listPage * pageSize)) {
      const signature = JSON.stringify([item, recurring, HubI18n.language, state.timezone, state.now >= item.shift?.start, state.now < item.due]);
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
      const snapshot = JSON.stringify({...result, now:undefined, timeBoundaries:result.items.map(item => [
        result.now >= item.shift?.start, result.now < item.due, item.due + result.graceMinutes * 60000 < result.now
      ])});
      if (snapshot === displayedSnapshot) return;
      displayedSnapshot = snapshot;
      renderPhotoPolicy();
      const value = $('ownerFilter').value, options = new Map([...state.items, ...state.schedules].map(item => [item.owner.id, item.owner.username])); for (const person of state.supervisors) options.set(person.id, person.username);
      $('ownerFilter').replaceChildren(new Option('Всички отговорници', '')); for (const [id, name] of options) { const option = new Option(name, id); option.setAttribute('translate', 'no'); $('ownerFilter').append(option); } $('ownerFilter').value = value;
      if (!$('statsUntil').value) {
        const today = date(state.now);
        $('statsUntil').value = today;
        $('statsFrom').value = new Date(Date.parse(today) - 2 * 86400000).toISOString().slice(0, 10);
      }
      globalThis.HubNotificationTarget?.select([...state.items, ...state.schedules], item => item.id, item => {
        $('ownerFilter').value = ''; $('taskSearch').value = '';
        let values;
        if (state.schedules.includes(item)) {
          view = 'schedules'; values = [...state.schedules].sort((a,b) => Date.parse(a.from) - Date.parse(b.from));
        } else {
          view = 'history'; historyView = item.status === 'cancelled' ? 'cancelled' : item.report ? 'reported' : 'unreported';
          const day = item.kind === 'shift' ? item.shift.date : date(item.due);
          $('statsFrom').value = day; $('statsUntil').value = day;
          values = state.items.filter(value => historyIncludes(value, historyView)).sort((a,b) => b.createdAt-a.createdAt || b.due-a.due);
        }
        listPage = Math.floor(values.indexOf(item) / pageSize) + 1;
        for (const tab of $('taskTabs').querySelectorAll('button')) tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
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
    $('taskOwner').disabled = !!item && !administrator;
    $('taskFrom').value = recurring ? item.from : item?.shift?.date || state.currentShift.date; $('taskUntil').value = item?.until || date(state.now + 30 * 86400000);
    $('taskDueDate').value = item?.due ? date(item.due) : date(state.now + 86400000);
    $('taskDueTime').value = item?.due ? new Intl.DateTimeFormat('en-GB', {timeZone: state.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(item.due)) : '17:00';
    $('taskTimezone').textContent = 'Часова зона: ' + state.timezone; editorFields(); editorDraft.accept(); $('taskEditor').showModal(); $('taskTitle').focus();
  }
  function openAction(item, action, recurring = false) {
    acting = {item, action, recurring}; actionKey = null; $('actionForm').reset(); $('actionFeedback').textContent = ''; solutionPicker.reset([], null, false, action === 'complete' ? 0 : requiredPhotoCount(item)); $('solutionPhotoFields').hidden = action !== 'complete' && (action !== 'report' || !requiresPhotos(item));
    $('solutionPhotoHelp').textContent = action === 'complete' ? 'Снимките са незадължителни при завършване от администратор. Можеш да завършиш със или без снимки.' : 'Всеки отчет изисква толкова нови снимки на решението или текущото състояние, колкото са снимките на проблема, включително при неизпълнена задача.';
    $('transferOwnerLabel').hidden = action !== 'transfer'; $('transferHelp').hidden = action !== 'transfer'; $('transferOwner').required = action === 'transfer';
    $('transferOwner').replaceChildren(new Option('Избери нов отговорник', ''));
    for (const person of state.supervisors.filter(person => person.id !== item.owner.id)) {
      const option = new Option(person.username + ' · ' + person.team, person.id); option.setAttribute('translate', 'no'); $('transferOwner').append(option);
    }
    if (action === 'transfer' && $('transferOwner').options.length === 1) $('actionFeedback').textContent = 'Няма друг активен отговорник с право за отчитане.';
    $('actionTitle').textContent = action === 'report' ? 'Отчети задача' : action === 'complete' ? 'Завърши задача' : action === 'transfer' ? 'Прехвърли задача' : actionLabels[action]; $('actionTaskTitle').textContent = item.title;
    $('reportStatusLabel').hidden = action !== 'report'; $('reportStatus').replaceChildren();
    for (const status of item.kind === 'shift' ? ['completed', 'not-done', 'not-applicable'] : ['in-progress', 'blocked', 'review']) $('reportStatus').append(new Option(statusLabels[status], status));
    $('actionNote').required = !['approve', 'complete'].includes(action) && (action !== 'report' || $('reportStatus').value !== 'completed'); actionDraft.accept(); $('taskAction').showModal();
  }
  async function mutate(form, feedback, fn) {
    if (busy) return;
    busy = true; const submit = form.querySelector('button[type=submit]'); submit.disabled = true; feedback.textContent = '';
    const controls = [...form.querySelectorAll('input,select,textarea,button')].filter(control => !control.disabled); for (const control of controls) control.disabled = true;
    ++sequence; pendingRead = null;
    try { await fn(); ++sequence; pendingRead = null; form.closest('dialog').close(); busy = false; await refresh({fresh:true}); $('taskMessage').textContent = 'Промяната е записана.'; }
    catch (error) { feedback.textContent = error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.'; if (error.status === 409) feedback.textContent += ' Затвори прозореца и натисни „Опресни“. Въведеното е запазено до затваряне.'; }
    finally { busy = false; for (const control of controls) control.disabled = false; submit.disabled = false; }
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
  for (const id of ['ownerFilter', 'statsFrom', 'statsUntil']) $(id).addEventListener('input', () => { listPage = 1; render(); });
  $('taskSearch').addEventListener('input', () => {
    listPage = 1; clearTimeout(searchTimer); $('taskContent').setAttribute('aria-busy', 'true');
    searchTimer = setTimeout(render, 150);
  });
  $('taskTabs').addEventListener('click', event => { const tab = event.target.closest('[data-view]'); if (!tab) return; view = tab.dataset.view; listPage = 1; for (const control of $('taskTabs').querySelectorAll('button')) control.setAttribute('aria-pressed', String(control === tab)); render(); });
  document.addEventListener('click', event => { if (event.target.closest('[data-hub-language]')) { renderPhotoPolicy(); problemPicker.render(); solutionPicker.render(); if (!draftOpen()) render(); } });
  HubServer.watch('tasks', refresh, draftOpen); HubServer.watch('accounts', refresh, draftOpen);
  setInterval(() => refresh(), 30000); refresh();
})();
