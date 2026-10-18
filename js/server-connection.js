/* Loaded only by the authenticated server. The offline file-based application remains independent. */
const HubServer = (() => {
  const boot = window.HUB_SERVER_BOOT;
  const currentModule = location.pathname.split('/').pop().replace(/\.html$/, '') || 'index';
  const can = key => {
    const report = HubPermissions.reports[currentModule];
    const resolved = report && ['canCreateReports', 'canEditReports'].includes(key) ? report[key === 'canCreateReports' ? 'create' : 'edit'] : key;
    return boot.user.permissions[resolved] === true;
  };
  const canViewModule = name => HubPermissions.canViewModule(boot.user, name);
  function applyServerText() {
    document.querySelectorAll('[data-server-text]').forEach(element => { element.textContent = element.dataset.serverText; });
  }
  const listeners = new Map();
  const watchers = new WeakMap(), idle = () => false;
  const updateGuards = new Set();
  let pendingWrites = 0;
  let approvedLeave = false;
  let preparingLeave = false, signingOut = false;
  function guardUpdate({isBusy = idle, hasDraft = idle}) {
    const guard = {isBusy, hasDraft}; updateGuards.add(guard);
    return () => updateGuards.delete(guard);
  }
  // Baselines live only in this page's memory, never in browser persistence.
  function formDraft(root, {isOpen = () => true, extra = () => null} = {}) {
    const fileIds = new WeakMap(); let nextFile = 0, baseline;
    const read = () => JSON.stringify([
      [...root.querySelectorAll('input,select,textarea')].map(field => field.type === 'file'
        ? [...field.files].map(file => { if (!fileIds.has(file)) fileIds.set(file, ++nextFile); return fileIds.get(file); })
        : [field.value, field.checked]), extra()
    ]);
    const accept = () => { baseline = read(); };
    accept();
    return {accept, hasDraft:() => isOpen() && read() !== baseline};
  }
  function updateState() {
    let busy = pendingWrites > 0, dirty = false;
    for (const guard of updateGuards) {
      try { busy = guard.isBusy() || busy; dirty = guard.hasDraft() || dirty; }
      catch { busy = true; }
    }
    return {busy, dirty};
  }
  window.addEventListener('beforeunload', event => {
    const state = updateState();
    if (!approvedLeave && (state.busy || state.dirty)) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pageshow', () => { approvedLeave = false; });
  function leavePage(action) {
    if (updateState().busy) { showLeaveError(busyLeaveMessage); return; }
    approvedLeave = true;
    try { action(); } catch { approvedLeave = false; showLeaveError('Напускането не успя. Опитай отново.'); }
  }
  function prepareDeparture(action) {
    if (preparingLeave) return;
    try {
      const result = action();
      if (!result?.then) return;
      preparingLeave = true;
      const wasInert = document.body.inert; document.body.inert = true;
      result.catch(() => { showLeaveError('Напускането не успя. Опитай отново.'); })
        .finally(() => { preparingLeave = false; document.body.inert = wasInert; });
    } catch { showLeaveError('Напускането не успя. Опитай отново.'); }
  }
  function showLeaveError(text) {
    const message = document.getElementById('serverLeaveFeedback');
    if (message) message.textContent = text;
  }
  const busyLeaveMessage = 'Изчакай текущия запис и опитай отново. Формата остава отворена.';
  let leaveDialog = null, leaveAction = null, leaveTrigger = null;
  function requestLeave(action, trigger) {
    if (leaveDialog?.open || preparingLeave) return;
    const state = updateState(); showLeaveError(state.busy ? busyLeaveMessage : '');
    if (state.busy) return;
    if (!state.dirty) { prepareDeparture(action); return; }
    if (!leaveDialog) {
      const node = (tag, id, text) => { const element = document.createElement(tag); element.id = id; element.textContent = text; return element; };
      leaveDialog = node('dialog', 'serverLeaveDialog', ''); leaveDialog.className = 'report-reason';
      leaveDialog.setAttribute('aria-labelledby', 'serverLeaveTitle');
      leaveDialog.setAttribute('aria-describedby', 'serverLeaveWarning');
      const title = node('h2', 'serverLeaveTitle', 'Напускане с незапазени промени');
      const warning = node('p', 'serverLeaveWarning', 'Има незапазени или непотвърдени промени. Ако напуснеш, въведените полета и избраните файлове ще се загубят.');
      const saved = node('p', 'serverLeaveSavedNote', 'Напускането не отменя промяна, която сървърът вече е записал.');
      const message = node('p', 'serverLeaveDialogFeedback', ''); message.setAttribute('role', 'status');
      const cancel = node('button', 'serverLeaveCancel', 'Върни се към формата'); cancel.type = 'button';
      const confirm = node('button', 'serverLeaveConfirm', 'Откажи промените и продължи'); confirm.type = 'button';
      const close = () => { leaveDialog.close(); leaveAction = null; leaveTrigger?.focus(); };
      cancel.addEventListener('click', close);
      leaveDialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
      leaveDialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      confirm.addEventListener('click', () => {
        if (updateState().busy) { message.textContent = busyLeaveMessage; return; }
        const action = leaveAction; close(); if (action) prepareDeparture(action);
      });
      leaveDialog.append(title, warning, saved, message, cancel, confirm); document.body.append(leaveDialog);
    }
    leaveAction = action; leaveTrigger = trigger;
    document.getElementById('serverLeaveDialogFeedback').textContent = '';
    leaveDialog.showModal(); document.getElementById('serverLeaveCancel').focus();
  }
  function navigate(href, trigger, before) {
    const go = () => leavePage(() => location.assign(href));
    requestLeave(before ? async () => { await before(); go(); } : go, trigger);
  }
  const messages = {CONFLICT: 'Данните са променени от друг потребител. Опресни и опитай отново.', FORBIDDEN: 'Акаунтът няма право за тази промяна.', INVALID_DATA: 'Данните не са валидни.', LAST_ADMIN: 'Последният активен администратор трябва да остане активен.', PASSWORD_LENGTH: 'Паролата трябва да съдържа 12–128 знака.', PASSWORD_CHANGE_REQUIRED: 'Смени временната парола, за да продължиш.', ACCOUNT_EXISTS: 'Потребителското име вече се използва.', INVALID_ACCOUNT: 'Провери името и ролята на акаунта.', RATE_LIMITED: 'Твърде много опити. Опитай отново след 15 минути.'};
  messages.INVALID_PAIR_CHANGE = 'Двойката е променена или съставът вече не е валиден. Опресни и опитай отново.';
  messages.LAST_ACCOUNT_MANAGER = 'Трябва да остане поне един активен акаунт с право за управление на акаунти.';
  messages.INVALID_PERMISSIONS = 'Провери правата на акаунта.';
  messages.SELF_DELETE = 'Не можеш да изтриеш акаунта, с който си влязъл.';
  messages.NOT_FOUND = 'Записът вече не е наличен. Опресни страницата.';
  messages.INVALID_PERIOD = 'Избери валиден месец и година.';
  messages.INVALID_HISTORY_FILTER = 'Провери датата и зареди записите отново.';
  Object.assign(messages, {
    PRODUCTION_TEAM_REQUIRED:'Акаунтът няма зададен екип. Обърнете се към администратор.',
    PRODUCTION_TEAM_MISMATCH:'Можете да въвеждате тонаж само за екипа на акаунта си. Черновата остава във формата.',
    PRODUCTION_ALREADY_REPORTED:'Тонажът за тази смяна вече е въведен. Втори запис не е разрешен.',
    PAIR_TEAM_REQUIRED:'Акаунтът няма зададен екип. Обърнете се към администратор.',
    PAIR_TEAM_MISMATCH:'Можете да въвеждате двойки и таргети само за екипа на акаунта си.',
    PAIR_WINDOW_CLOSED:'Двойки и таргети могат да се въвеждат от началото на назначената смяна до 4 часа след края ѝ. Черновата остава във формата.',
    PRODUCTION_WINDOW_CLOSED:'Тонаж може да се въвежда от началото на назначената смяна до 4 часа след края ѝ. Черновата остава във формата.',
    PRODUCTION_EXCEPTION_REASON_REQUIRED:'За административно изключение е задължителна причина. Черновата остава във формата.',
    INVALID_PRODUCTION_SCOPE:'Изберете валидна дата и екип.',
    INVALID_PRODUCTION_AUTHORIZATION:'Проверете почивния ден, началния и крайния час и причината.',
    REPORT_CONFLICT: 'Записът е променен или изтрит от друг потребител. Черновата остава във формата. Прегледай актуалния запис преди нов опит.',
    OPERATION_REUSED: 'Този опит вече е използван за друга промяна. Прегледай актуалния запис.',
    INVALID_OPERATION: 'Провери данните за записа.',
    REVISION_REQUIRED: 'Прегледай актуалната версия на записа преди промяна.',
    CORRECTION_REASON_REQUIRED: 'Добави причина за корекцията.'
  });
  const receiptMessages = {REPORT_SAVED: 'Сървърът потвърди записа.', REPORT_DELETED: 'Сървърът потвърди изтриването.', REPORT_RESTORED: 'Сървърът потвърди възстановяването.'};
  const receiptCodes = {create:'REPORT_SAVED', update:'REPORT_SAVED', delete:'REPORT_DELETED', restore:'REPORT_RESTORED'};
  Object.assign(messages, {TASK_PHOTO_REQUIRED: 'Добави снимка преди запис.', TASK_PHOTO_INVALID: 'Снимката не е валидна. Избери я отново.', TASK_PHOTO_STORAGE: 'Няма достатъчно място за снимката. Свържи се с администратор; отчетът не е записан.', TASK_PHOTO_EXPIRED: 'Снимката е изтрита след срока за съхранение.'});
  Object.assign(messages, {AVATAR_INVALID: 'Снимката не е валидна. Избери друга снимка.'});
  Object.assign(messages, {TASK_PHOTO_COUNT: 'Броят на снимките на решението трябва да е равен на броя на снимките на проблема.', TASK_PHOTO_LIMIT: 'Можеш да добавиш до 10 снимки.'});
  Object.assign(messages, {INVALID_TASK_PROFILE: 'Началникът трябва да има избран екип.', INVALID_TASK: 'Провери полетата на задачата.', INVALID_TASK_DATE: 'Избери валидна работна смяна или бъдещ срок.', INVALID_TASK_ASSIGNEE: 'Избери активен началник смяна. Екипът на повтарящата се задача се запазва.', TASK_REASON: 'Добави причина или бележка.', TASK_STATE: 'Състоянието е променено. Опресни задачите.', TASK_NOT_STARTED: 'Смяната още не е започнала.', TASK_REPEAT_TEAM: 'За Стикери възлагай конкретни смени; повтарянето следва графика на А–Г.'});
  Object.assign(messages, {INVALID_PROBLEM: 'Провери полетата на проблема.', INVALID_PROBLEM_DATE: 'Избери валидна дата. Контактът не може да е в бъдещето.', INVALID_PROBLEM_OWNER: 'Избери активен акаунт с достъп до „Глобални проблеми“.', PROBLEM_ESCALATION_INCOMPLETE: 'За ескалация са нужни: от кого зависи, нашето искане, наш отговорник и следващ контакт.', PROBLEM_REASON: 'Добави причина или бележка.', PROBLEM_STATE: 'Проблемът е затворен. Отвори го отново със смяна на статус.'});
  async function request(url, options = {}) {
    const headers = {...options.headers};
    if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = boot.csrf;
    const response = await fetch(url, {...options, headers, credentials: 'same-origin', cache: 'no-store'});
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && !signingOut) location.assign('/login');
      if (data.error === 'PASSWORD_CHANGE_REQUIRED') location.assign('/account-password');
      const error = new Error(messages[data.error] || 'Връзката със сървъра е прекъсната. Опитай отново.');
      error.code = response.status === 409 && data.error === 'CONFLICT' ? 'REPORT_CONFLICT' : data.error;
      error.status = response.status;
      throw error;
    }
    return response;
  }
  const json = async (url, options) => {
    const writing = options?.method && !['GET', 'HEAD'].includes(options.method);
    if (writing) pendingWrites++;
    try { return await (await request(url, options)).json(); }
    finally { if (writing) pendingWrites--; }
  };
  const send = (url, method, data, headers = {}) => json(url, {method, headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(data)});
  function watch(module, refresh, busy = idle) {
    let shared = watchers.get(refresh);
    if (!shared) { shared = new Map(); watchers.set(refresh, shared); }
    if (shared.has(busy)) {
      if (!listeners.has(module)) listeners.set(module, []);
      if (!listeners.get(module).includes(shared.get(busy))) listeners.get(module).push(shared.get(busy));
      return;
    }
    let running = null, pending = false, retry = null;
    const update = () => {
      pending = true;
      if (running) return running;
      if (document.hidden) return;
      if (busy()) {
        if (!retry) retry = setTimeout(() => { retry = null; update(); }, 200);
        return;
      }
      // Assign the drain promise before starting: refresh can throw or emit
      // another change synchronously, and callers still join this same work.
      let finish;
      const work = running = new Promise(resolve => { finish = resolve; });
      (async () => {
        try {
          while (pending && !document.hidden && !busy()) {
            pending = false;
            await refresh();
          }
        } catch {} finally {
          running = null;
          const next = pending && !document.hidden ? update() : null;
          if (next) next.then(finish);
          else finish();
        }
      })();
      return work;
    };
    if (!listeners.has(module)) listeners.set(module, []);
    listeners.get(module).push(update);
    shared.set(busy, update);
  }
  function refreshVisibleWatchers() {
    if (document.hidden) return Promise.resolve();
    const refreshers = new Set(Array.from(listeners.values()).flat());
    return Promise.allSettled(Array.from(refreshers, refresh => refresh())).then(() => {});
  }
  function fileSync(cfg) {
    applyServerText();
    const kind = cfg.suggestedFileName.replace(/\.json$/, '');
    const page = currentModule;
    const defaultURL = kind === 'personnel' && page === 'pair-targets' ? '/api/pair-roster'
      : kind === 'personnel' && page === 'statistics' ? '/api/statistics/workforce' : page === 'statistics' && HubPermissions.reports[kind] ? '/api/statistics/data/' + kind : '/api/data/' + kind;
    const readOnly = cfg.readOnly || page === 'statistics';
    const readURL = () => {
      if (page !== 'statistics' || !HubPermissions.reports[kind] || !cfg.getStatisticsPeriod) return defaultURL;
      const period = cfg.getStatisticsPeriod();
      return '/api/statistics/period/' + kind + '?month=' + encodeURIComponent(period.month) +
        (kind === 'line-downtime' ? '&scope=' + encodeURIComponent(period.scope) : '');
    };
    let ready = false, initialized = false, revision = 0, sequence = 0, versions = {};
    let pendingRead = null, pendingURL = null, acceptedURL = null, acceptedText = null, renderedDay = null, connectionState = '';
    const handle = {name: 'Обща база'};
    const el = cfg.elements;
    const panel = registerConnectionPanel(el.connDot);
    for (const control of [el.openFileBtn, el.createFileBtn, el.reconnectBtn, el.importFallback]) if (control) control.hidden = true;
    if (el.refreshBtn) { el.refreshBtn.style.display = ''; el.refreshBtn.textContent = 'Опресни'; }
    if (el.connNote) el.connNote.textContent = 'Общи данни за всички устройства. Промените се показват автоматично.';
    function status(ok, message) {
      if (connectionState === ok + message) return;
      connectionState = ok + message;
      el.connDot.className = 'conn-dot ' + (ok ? 'on' : 'off'); el.connText.textContent = message; panel(ok);
    }
    function refresh({fresh = false} = {}) {
      const url = readURL();
      if (!fresh && pendingRead && pendingURL === url) return pendingRead;
      const current = ++sequence;
      const operation = (async () => { try {
        const result = await json(url);
        if (current !== sequence || url !== readURL() || !fresh && (document.hidden || cfg.isBusy?.())) return result;
        const text = JSON.stringify(result.data), changed = fresh || text !== acceptedText;
        if (!initialized) await cfg.onConnect(result.data);
        else if (changed) await cfg.onRefresh(result.data);
        if (current !== sequence) return result;
        acceptedText = text;
        acceptedURL = url;
        initialized = true; revision = result.revision; versions = result.versions || {}; ready = true;
        status(true, 'Свързан с общата база');
        const day = new Date().toDateString();
        if (changed || day !== renderedDay) { cfg.render(); renderedDay = day; }
        return result;
      } catch (error) { if (current === sequence) { ready = false; status(false, error.message); } throw error; }
      })();
      pendingRead = operation;
      pendingURL = url;
      operation.finally(() => { if (pendingRead === operation) pendingRead = null; }).catch(() => {});
      return operation;
    }
    el.refreshBtn?.addEventListener('click', () => refresh().catch(() => {}));
    watch(kind, refresh, cfg.isBusy);
    return {
      init: () => refresh().catch(() => {}), refreshFromDisk: refresh,
      recordVersion: id => versions[id],
      async commitOperation(operation) {
        if (readOnly) throw new Error('Само за преглед.');
        if(kind==='production-log'&&operation.action==='create'&&boot.user.role==='admin'&&!operation.reason) {
          const reason=await correctionReason({exception:true});
          if(!reason)throw Object.assign(new Error(messages.PRODUCTION_EXCEPTION_REASON_REQUIRED),{status:428,code:'PRODUCTION_EXCEPTION_REASON_REQUIRED'});
          operation.reason=reason;
        }
        ++sequence;
        pendingRead = null; acceptedText = null;
        const {version, ...input} = operation;
        const result = await send('/api/reports/' + kind + '/operations', 'POST', input, version ? {'If-Match': '"' + version + '"'} : {});
        ++sequence;
        pendingRead = null;
        const receipt = result.receipt;
        if (!Object.hasOwn(receiptCodes, operation.action) || receipt?.operationId !== operation.operationId ||
            receipt.entryId !== operation.entryId || receipt.action !== operation.action ||
            receipt.status !== 'confirmed' || receipt.message !== receiptCodes[operation.action]) {
          throw new Error('Сървърът не потвърди резултата. Опитай отново.');
        }
        revision = result.revision; versions = result.versions; ready = true;
        await cfg.onRefresh(result.data);
        acceptedText = JSON.stringify(result.data);
        return {...result, message: receiptMessages[result.receipt.message]};
      },
      async commitData() {
        if (readOnly || ['production-log', 'line-downtime', 'pair-targets'].includes(kind) && !can('canCreateReports') && !can('canEditReports') && !can(HubPermissions.reports[kind].settings)) throw new Error('Само за преглед.');
        if (!ready) throw new Error('Опресни връзката със сървъра.');
        ++sequence;
        pendingRead = null; acceptedText = null;
        const result = await send('/api/data/' + kind, 'PUT', cfg.getData(), {'If-Match': '"' + revision + '"'});
        ++sequence;
        pendingRead = null;
        revision = result.revision;
      },
      get isReady() { return ready; }, get isCurrent() { return ready && acceptedURL === readURL(); }, get fileHandle() { return initialized ? handle : null; }
    };
  }
  async function reviewRecord(sync, id, restoreDraft = () => {}) {
    const result = await sync.refreshFromDisk({fresh:true});
    restoreDraft();
    const entry = result.data.entries.find(item => item.id === id);
    const dialog = document.createElement('dialog');
    dialog.className = 'report-review';
    const heading = document.createElement('h2'); heading.textContent = 'Актуален запис на сървъра';
    const description = document.createElement('p');
    description.textContent = entry ? 'Черновата ти остава във формата. Използвай тази версия само след преглед на промените.' : 'Записът е изтрит. Черновата ти остава във формата.';
    dialog.append(heading, description);
    if (entry) {
      const details = document.createElement('dl');
      const labels = {date:'Дата',shift:'Смяна',shiftCode:'Смяна',team:'Екип',tonnage:'Тонаж (кг)',brak:'Брак (кг)',start:'Начало',end:'Край',durationMin:'Минути',reason:'Причина',reasonNote:'Обяснение',note:'Бележка',targetKg:'Цел (кг)',targetCrates:'Цел (каси)'};
      const values = Object.entries(labels).filter(([key]) => entry[key] !== undefined).map(([key,label]) => [label,entry[key]]);
      if (entry.breakdown) values.push(['Автоматична / ръчна (кг)',entry.breakdown.autoKg+' / '+entry.breakdown.manKg],['Автоматична / ръчна (каси)',entry.breakdown.autoCrates+' / '+entry.breakdown.manCrates]);
      if (entry.members) values.push(['Двойка',entry.members.map(person => person.name).join(' + ')],['Зони',entry.areas.map(area => area === 'auto' ? 'Автоматична' : 'Ръчна').join(', ')]);
      if (entry.result) values.push(['Резултат (кг / каси)',entry.result.kg+' / '+entry.result.crates],['Причина',[PairTargets.REASONS.find(item => item.key === entry.result.reasonKey)?.label,entry.result.reasonText].filter(Boolean).join(' · ') || '—']);
      if (entry.cancellation) values.push(['Отменена',[PairTargets.CANCELLATION_REASONS.find(item => item.key === entry.cancellation.reasonKey)?.label,entry.cancellation.reasonText].filter(Boolean).join(' · ')]);
      for (const [label,value] of values) {
        const term = document.createElement('dt'); term.textContent = label;
        const detail = document.createElement('dd'); detail.textContent = String(value); detail.setAttribute('translate','no');
        details.append(term,detail);
      }
      dialog.append(details);
    }
    const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = 'Използвай тази версия за нов опит'; accept.hidden = !entry;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Затвори';
    dialog.append(accept,close); document.body.append(dialog);
    return new Promise(resolve => {
      const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
      accept.addEventListener('click', () => finish({entry,version:result.versions[id]}));
      close.addEventListener('click', () => finish(null));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      dialog.showModal();
    });
  }
  const fileURL = name => '/api/files?path=' + encodeURIComponent(name);
  function serverFile(name) {
    let revision;
    return {
      kind: 'file', name: name.split('/').pop(),
      async getFile() {
        const response = await request(fileURL(name));
        revision = Number(response.headers.get('etag').replaceAll('"', ''));
        return new File([await response.blob()], this.name, {type: response.headers.get('content-type')});
      },
      async createWritable() {
        if (!revision) await this.getFile();
        const expected = revision;
        let content, aborted = false;
        return {
          async write(value) { content = value instanceof Blob ? value : new Blob([value], {type: name.endsWith('.txt') ? 'text/plain' : 'application/octet-stream'}); },
          async close() {
            if (aborted || !content) throw new Error('Няма данни за запис.');
            const result = await json(fileURL(name), {method: 'PUT', headers: {'Content-Type': content.type || 'application/octet-stream', 'If-Match': '"' + expected + '"'}, body: content});
            revision = result.revision;
          },
          async abort() { aborted = true; }
        };
      }
    };
  }
  function serverDirectory(name = '') {
    const child = leaf => {
      if (typeof leaf !== 'string' || !leaf || leaf.includes('/') || leaf.includes('\\') || ['.', '..'].includes(leaf)) throw new Error('Невалидно име.');
      return name ? name + '/' + leaf : leaf;
    };
    const exists = async (target, kind, create) => {
      try {
        if (kind === 'directory') await json('/api/folders?path=' + encodeURIComponent(target));
        else await request(fileURL(target));
      } catch (error) {
        if (!create || error.status !== 404) throw error;
        await send('/api/folders', 'POST', {path: target, kind});
      }
    };
    return {
      kind: 'directory', name: name.split('/').pop() || 'Обща база',
      async getDirectoryHandle(leaf, options = {}) { const target = child(leaf); await exists(target, 'directory', options.create); return serverDirectory(target); },
      async getFileHandle(leaf, options = {}) { const target = child(leaf); await exists(target, 'file', options.create); return serverFile(target); },
      async *entries() { const list = await json('/api/folders?path=' + encodeURIComponent(name)); for (const item of list.entries) yield [item.name, item.kind === 'file' ? serverFile(child(item.name)) : serverDirectory(child(item.name))]; }
    };
  }
  function directorySync(cfg) {
    applyServerText();
    const handle = serverDirectory();
    let initialized = false, pendingRead = null, acceptedText = null, connectionState = '';
    const el = cfg.elements;
    const panel = registerConnectionPanel(el.connDot);
    for (const control of [el.openFileBtn, el.createFileBtn, el.reconnectBtn]) if (control) control.hidden = true;
    function status(ok, message) {
      if (connectionState === ok + message) return;
      connectionState = ok + message;
      el.connDot.className = 'conn-dot ' + (ok ? 'on' : 'off'); el.connText.textContent = message; panel(ok);
    }
    function refresh({reloadAssets = false} = {}) {
      if (pendingRead) { pendingRead.reloadAssets ||= reloadAssets; return pendingRead.promise; }
      const pending = {reloadAssets};
      const operation = (async () => { try {
        const result = await json('/api/data/package-instructions');
        if (document.hidden || cfg.isBusy?.()) return result;
        const text = JSON.stringify(result.data), changed = pending.reloadAssets || text !== acceptedText;
        if (!initialized) await cfg.onConnect(result.data, handle);
        else if (changed) await cfg.onRefresh(result.data);
        acceptedText = text;
        initialized = true;
        status(true, 'Свързан с общата база');
        if (changed) cfg.render();
        return result;
      } catch (error) { status(false, error.message); throw error; }
      })();
      pending.promise = operation; pendingRead = pending;
      operation.finally(() => { if (pendingRead === pending) pendingRead = null; }).catch(() => {});
      return operation;
    }
    el.connNote.textContent = 'Инструкциите и приложенията се пазят в общата база.';
    el.refreshBtn.style.display = ''; el.refreshBtn.addEventListener('click', () => refresh({reloadAssets:true}).catch(() => {}));
    // File changes can leave the index unchanged; invalidate attachment caches.
    watch('package-instructions', () => refresh({reloadAssets:true}), cfg.isBusy);
    return {init: () => refresh().catch(() => {}), refreshFromDisk: refresh, get dirHandle() { return initialized ? handle : null; }};
  }
  const roleLabels = {admin: 'Администратор', operator: 'Оператор', observer: 'Наблюдател'};
  // Avatars show the owner's photo, or initials on a stable colour derived from the username.
  const avatars = new Set();
  function initials(name) {
    const parts = String(name).split(/[._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : String(name).slice(0, 2)).toUpperCase();
  }
  function paintAvatar(node, user = boot.user) {
    node.textContent = '';
    node.setAttribute('data-tone', String([...user.username].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5));
    if (user.avatar) {
      // Other accounts' photos go through the account-management route and its permission check.
      const route = user.id === boot.user.id ? '/api/account/avatar' : '/api/accounts/' + encodeURIComponent(user.id) + '/avatar';
      const image = document.createElement('img'); image.alt = ''; image.src = route + '?v=' + encodeURIComponent(user.avatar);
      image.onerror = () => { image.remove(); node.textContent = initials(user.username); };
      node.append(image);
    } else node.textContent = initials(user.username);
  }
  // Without a user the avatar follows the signed-in account, including later photo changes.
  function avatar(className = '', user) {
    const node = document.createElement('span'); node.className = ('hub-avatar ' + className).trim();
    node.setAttribute('aria-hidden', 'true'); node.setAttribute('translate', 'no');
    if (!user) avatars.add(node);
    paintAvatar(node, user); return node;
  }
  function setAvatar(version) { boot.user.avatar = version || null; for (const node of avatars) paintAvatar(node); }
  function applyPermissions() {
    const module = currentModule;
    let selector = '';
    for (const group of HubPermissions.groups.filter(group => group.module)) {
      if (!canViewModule(group.module)) selector += ',a[href="' + group.module + '.html"],a[href="/' + group.module + '.html"],a[href="/' + group.module + '"]';
    }
    if (!can('canManagePersonnel') && module === 'personnel') selector += ',#addPersonBtn,#settingsBtn,[data-edit-person]';
    if (!can('canManageInstructions') && module === 'package-instructions') selector += ',#addBtn,#bulkBtn,.cat-select';
    if (['production-log', 'line-downtime'].includes(module)) {
      if (!can('canCreateReports') && !can('canEditReports')) selector += ',#saveBtn';
      if (!can('canCreateReports') && !can('canEditReports') && !can(HubPermissions.reports[currentModule].settings)) selector += ',#retrySaveBtn';
      if (!can('canEditReports')) selector += ',.del-btn';
      if (!can(HubPermissions.reports[currentModule].settings)) {
        const goal = document.getElementById('goalInput'); if (goal) goal.disabled = true;
        selector += ',#reasonsAdminPanel';
      }
    }
    if (module === 'production-log' && !can('canCreateReports') && !can('canEditReports')) {
      selector += ',#reportEntryPanel';
      const dateRow = document.getElementById('reportDateRow'), filter = document.getElementById('dayFilter');
      if (dateRow && filter && dateRow.parentElement !== filter) {
        filter.append(dateRow); filter.hidden = false;
      }
    }
    if (module === 'pair-targets') {
      if (!can('canCreateReports')) selector += ',#addPairBtn,[data-action=edit],[data-action=cancel]';
      document.querySelectorAll('[data-action=report]').forEach(control => {
        if (!(control.dataset.reported === 'true' ? can('canEditReports') : can('canCreateReports')) && !control.hidden) control.hidden = true;
      });
      if (!can('canCreateReports') && !can('canEditReports')) selector += ',#savePairBtn';
    }
    selector = selector.replace(/^,/, '');
    if (selector) document.querySelectorAll(selector).forEach(control => { if (!control.hidden) control.hidden = true; });
  }
  const setSigningOut = value => { signingOut = value; }, isSigningOut = () => signingOut;
  document.addEventListener('DOMContentLoaded', () => renderHubServerShell({boot, currentModule, can, canViewModule, applyServerText, listeners, setSigningOut, isSigningOut, updateState, leavePage, requestLeave, navigate, json, send, watch, refreshVisibleWatchers, roleLabels, avatar, applyPermissions}));
  function correctionReason({exception=false}={}) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.id = 'reportCorrectionDialog'; dialog.className = 'report-reason'; dialog.setAttribute('aria-labelledby','reportCorrectionTitle');
      dialog.innerHTML = '<form><h2 id="reportCorrectionTitle">Причина за промяната</h2><label for="reportCorrectionReason">Опиши защо променяш записа</label><textarea id="reportCorrectionReason" required maxlength="1000"></textarea><button id="reportCorrectionConfirm" type="submit">Потвърди</button><button type="button" id="reportCorrectionCancel">Отказ</button></form>';
      if(exception) {dialog.querySelector('h2').textContent='Административно изключение';dialog.querySelector('label').textContent='Опиши причината за административния запис на тонаж';}
      const reasonDraft = formDraft(dialog,{isOpen:() => dialog.open}), unguard = guardUpdate({hasDraft:reasonDraft.hasDraft});
      const previousFocus = document.activeElement;
      document.body.append(dialog);
      const finish = value => { unguard(); dialog.close(); dialog.remove(); previousFocus?.focus(); resolve(value); };
      dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); const value=dialog.querySelector('textarea').value.trim(); if(value) finish(value); });
      dialog.querySelector('#reportCorrectionCancel').addEventListener('click', () => finish(null));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      dialog.showModal(); dialog.querySelector('textarea').focus();
    });
  }
  return {correctionReason, guardUpdate, formDraft, navigate, user: boot.user, can, canViewModule, fileSync, directorySync, json, send, watch, reviewRecord, avatar, setAvatar};
})();
