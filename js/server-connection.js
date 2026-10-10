/* Loaded only by the authenticated server. The offline file-based application remains independent. */
const HubServer = (() => {
  const boot = window.HUB_SERVER_BOOT;
  const can = key => boot.user.permissions ? boot.user.permissions[key] === true : key === 'canExportReports' || (key === 'canImportData' || key === 'canEditReports' ? boot.user.role === 'admin' : key === 'canCreateReports' && boot.user.role !== 'observer');
  const listeners = new Map();
  const messages = {CONFLICT: 'Данните са променени от друг потребител. Опресни и опитай отново.', FORBIDDEN: 'Акаунтът няма право за тази промяна.', INVALID_DATA: 'Данните не са валидни.', LAST_ADMIN: 'Последният активен администратор трябва да остане активен.', PASSWORD_LENGTH: 'Паролата трябва да съдържа 12–128 знака.', ACCOUNT_EXISTS: 'Потребителското име вече се използва.', INVALID_ACCOUNT: 'Провери името и ролята на акаунта.', RATE_LIMITED: 'Твърде много опити. Опитай отново след 15 минути.'};
  messages.INVALID_PAIR_CHANGE = 'Двойката е променена или съставът вече не е валиден. Опресни и опитай отново.';
  messages.INVALID_PERMISSIONS = 'Провери правата на акаунта.';
  messages.SELF_DELETE = 'Не можеш да изтриеш акаунта, с който си влязъл.';
  messages.NOT_FOUND = 'Записът вече не е наличен. Опресни страницата.';
  Object.assign(messages, {INVALID_TASK_PROFILE: 'Началникът трябва да е оператор с избран екип.', INVALID_TASK: 'Провери полетата на задачата.', INVALID_TASK_DATE: 'Избери валидна работна смяна или бъдещ срок.', INVALID_TASK_ASSIGNEE: 'Избери активен началник смяна. Екипът на повтарящата се задача се запазва.', TASK_REASON: 'Добави причина или бележка.', TASK_STATE: 'Състоянието е променено. Опресни задачите.', TASK_NOT_STARTED: 'Смяната още не е започнала.', TASK_REPEAT_TEAM: 'За Стикери възлагай конкретни смени; повтарянето следва графика на А–Г.'});
  async function request(url, options = {}) {
    const headers = {...options.headers};
    if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = boot.csrf;
    const response = await fetch(url, {...options, headers, credentials: 'same-origin', cache: 'no-store'});
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) location.assign('/login.html');
      const error = new Error(messages[data.error] || 'Връзката със сървъра е прекъсната. Опитай отново.');
      error.code = response.status === 409 && data.error === 'CONFLICT' ? 'REPORT_CONFLICT' : data.error;
      error.status = response.status;
      throw error;
    }
    return response;
  }
  const json = async (url, options) => (await request(url, options)).json();
  const send = (url, method, data, headers = {}) => json(url, {method, headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(data)});
  function watch(module, refresh, busy = () => false) {
    let running = false, pending = false;
    const update = async () => {
      pending = true;
      if (running) return;
      running = true;
      try {
        while (pending) {
          pending = false;
          while (busy()) await new Promise(resolve => setTimeout(resolve, 200));
          await refresh();
        }
      } catch {} finally { running = false; }
    };
    if (!listeners.has(module)) listeners.set(module, []);
    listeners.get(module).push(update);
  }
  function fileSync(cfg) {
    const kind = cfg.suggestedFileName.replace(/\.json$/, '');
    const page = location.pathname.split('/').pop();
    const readURL = kind === 'personnel' && page === 'pair-targets.html' ? '/api/pair-roster'
      : kind === 'personnel' && page === 'statistics.html' ? '/api/statistics/workforce' : '/api/data/' + kind;
    let ready = false, initialized = false, revision = 0, sequence = 0;
    const handle = {name: 'Обща база'};
    const el = cfg.elements;
    const panel = registerConnectionPanel(el.connDot);
    for (const control of [el.openFileBtn, el.createFileBtn, el.reconnectBtn, el.importFallback]) if (control) control.hidden = true;
    if (el.refreshBtn) { el.refreshBtn.style.display = ''; el.refreshBtn.textContent = 'Опресни'; }
    if (el.connNote) el.connNote.textContent = 'Общи данни за всички устройства. Промените се показват автоматично.';
    function status(ok, message) { el.connDot.className = 'conn-dot ' + (ok ? 'on' : 'off'); el.connText.textContent = message; panel(ok); }
    async function refresh() {
      const current = ++sequence;
      try {
        const result = await json(readURL);
        if (current !== sequence) return;
        if (initialized) await cfg.onRefresh(result.data); else await cfg.onConnect(result.data);
        initialized = true; revision = result.revision; ready = true;
        status(true, 'Свързан с общата база'); cfg.render();
      } catch (error) { ready = false; status(false, error.message); throw error; }
    }
    el.refreshBtn?.addEventListener('click', () => refresh().catch(() => {}));
    watch(kind, refresh, cfg.isBusy);
    return {
      init: () => refresh().catch(() => {}), refreshFromDisk: refresh,
      async commitData() {
        if (cfg.readOnly || boot.user.role === 'observer' || ['production-log', 'line-downtime', 'pair-targets'].includes(kind) && !can('canCreateReports') && !can('canEditReports')) throw new Error('Само за преглед.');
        if (!ready) throw new Error('Опресни връзката със сървъра.');
        ++sequence;
        const result = await send('/api/data/' + kind, 'PUT', cfg.getData(), {'If-Match': '"' + revision + '"'});
        revision = result.revision;
      },
      get isReady() { return ready; }, get fileHandle() { return initialized ? handle : null; }
    };
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
    const handle = serverDirectory();
    let initialized = false;
    const el = cfg.elements;
    const panel = registerConnectionPanel(el.connDot);
    for (const control of [el.openFileBtn, el.createFileBtn, el.reconnectBtn]) if (control) control.hidden = true;
    async function refresh() {
      try {
        const result = await json('/api/data/package-instructions');
        if (initialized) await cfg.onRefresh(result.data); else await cfg.onConnect(result.data, handle);
        initialized = true;
        el.connDot.className = 'conn-dot on'; el.connText.textContent = 'Свързан с общата база'; panel(true); cfg.render();
      } catch (error) { el.connDot.className = 'conn-dot off'; el.connText.textContent = error.message; panel(false); throw error; }
    }
    el.connNote.textContent = 'Инструкциите и приложенията се пазят в общата база.';
    el.refreshBtn.style.display = ''; el.refreshBtn.addEventListener('click', () => refresh().catch(() => {}));
    watch('package-instructions', refresh, cfg.isBusy);
    return {init: () => refresh().catch(() => {}), refreshFromDisk: refresh, get dirHandle() { return initialized ? handle : null; }};
  }
  const roleLabels = {admin: 'Администратор', operator: 'Оператор', observer: 'Наблюдател'};
  function applyPermissions() {
    const module = location.pathname.split('/').pop();
    const observer = boot.user.role === 'observer';
    let selector = '';
    if (boot.user.role !== 'admin') selector = 'a[href="personnel.html"],a[href="/personnel.html"]';
    if (boot.user.role === 'operator') selector += ',a[href="statistics.html"],a[href="/statistics.html"]';
    if (!can('canViewTasks')) selector += ',a[href="tasks.html"],a[href="/tasks.html"]';
    if (boot.user.role !== 'admin' && module === 'personnel.html') selector += ',#addPersonBtn,#settingsBtn,[data-edit-person]';
    if (boot.user.role !== 'admin' && module === 'package-instructions.html') selector += ',#addBtn,#bulkBtn,.cat-select';
    if (['production-log.html', 'line-downtime.html'].includes(module)) {
      if (!can('canCreateReports')) selector += ',#saveBtn,#retrySaveBtn';
      if (!can('canEditReports')) selector += ',.del-btn';
      if (boot.user.role !== 'admin' || !can('canEditReports')) {
        const goal = document.getElementById('goalInput'); if (goal) goal.disabled = true;
        selector += ',#reasonsAdminPanel';
      }
    }
    if (module === 'production-log.html' && !can('canCreateReports')) {
      selector += ',#reportEntryPanel';
      const dateRow = document.getElementById('reportDateRow'), filter = document.getElementById('dayFilter');
      if (dateRow && filter && dateRow.parentElement !== filter) {
        filter.append(dateRow); filter.hidden = false;
      }
    }
    if (module === 'pair-targets.html') {
      if (!can('canCreateReports')) selector += ',#addPairBtn,[data-action=edit],[data-action=cancel]';
      document.querySelectorAll('[data-action=report]').forEach(control => {
        if (!(control.dataset.reported === 'true' ? can('canEditReports') : can('canCreateReports')) && !control.hidden) control.hidden = true;
      });
      if (observer || !can('canCreateReports') && !can('canEditReports')) selector += ',#savePairBtn';
    }
    selector = selector.replace(/^,/, '');
    if (selector) document.querySelectorAll(selector).forEach(control => { if (!control.hidden) control.hidden = true; });
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('server-mode');
    const bar = document.createElement('nav'); bar.className = 'server-bar'; bar.setAttribute('aria-label', 'Package Hub');
    const top = document.createElement('div'); top.className = 'server-top';
    const brand = document.createElement('a'); brand.className = 'hub-brand'; brand.href = '/index.html'; brand.setAttribute('translate', 'no');
    const mark = document.createElement('img'); mark.src = '/assets/package-hub-mark.svg'; mark.alt = ''; mark.width = 44; mark.height = 44;
    const wordmark = document.createElement('span'); wordmark.className = 'hub-wordmark'; wordmark.textContent = 'Package ';
    const hubName = document.createElement('span'); hubName.className = 'brand-hub'; hubName.textContent = 'Hub'; wordmark.append(hubName); brand.append(mark, wordmark);
    const session = document.createElement('div'); session.className = 'server-session';
    const identity = document.createElement('div'); identity.className = 'server-identity';
    const who = document.createElement('span'); who.className = 'server-user'; who.setAttribute('translate', 'no'); who.textContent = boot.user.username;
    const role = document.createElement('span'); role.className = 'server-role'; role.textContent = roleLabels[boot.user.role]; identity.append(who, role);
    top.append(brand, session);
    const tools = document.createElement('div'); tools.className = 'server-tools';
    const links = document.createElement('div'); links.className = 'server-links';
    const addLink = (href, label) => {
      const link = document.createElement('a'); link.href = href; link.textContent = label;
      if (location.pathname === href.split('?')[0]) link.setAttribute('aria-current', 'page');
      links.append(link);
      return link;
    };
    const current = location.pathname.split('/').pop().replace(/\.html$/, '');
    const reports = ['production-log', 'line-downtime', 'pair-targets'];
    const module = reports.includes(current) ? current : new URLSearchParams(location.search).get('module');
    const query = reports.includes(module) ? '?module=' + module : '';
    if (boot.user.role === 'admin') {
      const link = addLink('/admin-panel.html' + query, 'Админ панел');
      if (['system-status','accounts','activity-log','data-import','production-import'].includes(current)) link.setAttribute('aria-current', 'location');
    } else if (can('canImportData') || can('canExportReports')) {
      addLink('/data-import.html' + query, 'Импорт / експорт');
    }
    tools.append(links);
    const state = document.createElement('span'); state.id = 'serverState'; state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite'); state.setAttribute('data-connection', 'pending'); state.textContent = 'Свързване…';
    const logout = document.createElement('button'); logout.className = 'server-logout'; logout.type = 'button'; logout.textContent = 'Изход'; logout.onclick = async () => { await send('/api/logout', 'POST', {}); location.assign('/login.html'); };
    session.append(identity, state, logout); bar.append(top, tools);
    document.body.prepend(bar);
    // The language switch is initialized by i18n after the injected server script.
    setTimeout(() => { const language = document.querySelector('.hub-language'); if (language) tools.append(language); }, 0);
    const eventSource = new EventSource('/api/events');
    eventSource.onopen = () => { state.setAttribute('data-connection', 'ready'); state.textContent = 'Свързан'; refreshTaskCount(); };
    eventSource.onerror = () => { state.setAttribute('data-connection', 'pending'); state.textContent = 'Възстановяване на връзката…'; };
    eventSource.addEventListener('change', event => { const data = JSON.parse(event.data); for (const refresh of listeners.get(data.module) || []) refresh(); });
    eventSource.addEventListener('logout', () => { eventSource.close(); location.assign('/login.html'); });
    eventSource.addEventListener('version', event => {
      if (JSON.parse(event.data).version !== boot.version && !document.getElementById('serverUpdate')) {
        const button = document.createElement('button'); button.id = 'serverUpdate'; button.textContent = 'Нова версия — обнови'; button.onclick = () => location.reload(); tools.append(button);
      }
      for (const refreshers of listeners.values()) for (const refresh of refreshers) refresh();
    });
    if (location.pathname === '/' || location.pathname.endsWith('/index.html')) {
      const tasksLink = document.querySelector('a[href="tasks.html"]');
      if (tasksLink && can('canViewTasks')) tasksLink.hidden = false;
      document.querySelector('.sub').textContent = 'Общи данни за всички устройства. Изберете модул.';
      document.querySelector('footer').textContent = 'Общи данни за всички устройства. Промените се показват автоматично.';
    }
    const taskBadges = [];
    let taskCountSequence = 0;
    if (can('canViewTasks')) {
      for (const link of document.querySelectorAll('a[href="tasks.html"],a[href="/tasks.html"],.tasks-heading h1')) {
        const badge = document.createElement('span'); badge.className = 'task-count'; badge.hidden = true;
        badge.setAttribute('role', 'status'); (link.querySelector('h2') || link).append(badge); taskBadges.push(badge);
      }
      watch('tasks', refreshTaskCount); watch('accounts', refreshTaskCount);
      setInterval(() => { if (!document.hidden) refreshTaskCount(); }, 30000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTaskCount(); });
      refreshTaskCount();
    }
    async function refreshTaskCount() {
      if (!taskBadges.length) return;
      const sequence = ++taskCountSequence;
      try {
        const {count} = await json('/api/tasks/summary');
        if (sequence !== taskCountSequence) return;
        for (const badge of taskBadges) {
          badge.textContent = String(count); badge.hidden = count === 0;
          const label = (boot.user.role === 'admin' ? 'Задачи за проверка:' : 'Чакащи задачи:') + ' ' + count;
          badge.setAttribute('aria-label', label); badge.title = label;
        }
      } catch {
        if (sequence === taskCountSequence) for (const badge of taskBadges) badge.hidden = true;
      }
    }
    applyPermissions();
    new MutationObserver(applyPermissions).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']});
  });
  return {user: boot.user, can, fileSync, directorySync, json, send, watch};
})();
