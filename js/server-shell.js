/* Server toolbar, account menu and page shell. HubServer calls this on DOMContentLoaded with its internals. */
function renderHubServerShell({boot, currentModule, can, canViewModule, applyServerText, listeners, setSigningOut, isSigningOut, updateState, leavePage, requestLeave, navigate, json, send, watch, refreshVisibleWatchers, roleLabels, avatar, applyPermissions}) {
  applyServerText();
  document.body.classList.add('server-mode');
  const bar = document.createElement('nav'); bar.className = 'server-bar'; bar.setAttribute('aria-label', 'Package Hub');
  const top = document.createElement('div'); top.className = 'server-top';
  const brand = document.createElement('a'); brand.className = 'hub-brand'; brand.href = '/'; brand.setAttribute('translate', 'no');
  const mark = document.createElement('img'); mark.src = '/assets/package-hub-mark.svg?v=' + encodeURIComponent(boot.version); mark.alt = ''; mark.width = 44; mark.height = 44;
  const wordmark = document.createElement('span'); wordmark.className = 'hub-wordmark'; wordmark.textContent = 'Package ';
  const hubName = document.createElement('span'); hubName.className = 'brand-hub'; hubName.textContent = 'Hub'; wordmark.append(hubName); brand.append(mark, wordmark);
  const session = document.createElement('div'); session.className = 'server-session';
  const state = document.createElement('span'); state.id = 'serverState'; state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite'); state.setAttribute('data-connection', 'pending'); state.textContent = 'Свързване…';
  const account = document.createElement('div'); account.className = 'server-account';
  const accountButton = document.createElement('button'); accountButton.type = 'button'; accountButton.id = 'serverAccountButton'; accountButton.className = 'server-account-button';
  accountButton.setAttribute('aria-expanded', 'false'); accountButton.setAttribute('aria-controls', 'serverAccountMenu'); accountButton.setAttribute('aria-label', 'Меню на акаунта'); accountButton.title = 'Меню на акаунта';
  const accountName = document.createElement('span'); accountName.className = 'server-account-name'; accountName.setAttribute('translate', 'no'); accountName.textContent = boot.user.username;
  accountButton.append(avatar(), accountName);
  const menu = document.createElement('div'); menu.id = 'serverAccountMenu'; menu.className = 'server-account-menu'; menu.hidden = true;
  const menuHead = document.createElement('div'); menuHead.className = 'server-account-head';
  const identity = document.createElement('div'); identity.className = 'server-identity';
  const who = document.createElement('span'); who.className = 'server-user'; who.setAttribute('translate', 'no'); who.textContent = boot.user.username;
  const role = document.createElement('span'); role.className = 'server-role'; role.textContent = roleLabels[boot.user.role]; identity.append(who, role);
  menuHead.append(avatar('hub-avatar-large'), identity);
  top.append(brand, session);
  const tools = document.createElement('div'); tools.className = 'server-tools';
  const links = document.createElement('div'); links.className = 'server-links';
  const addLink = (href, label) => {
    const link = document.createElement('a'); link.href = href; link.textContent = label;
    if (location.pathname === href.split('?')[0]) link.setAttribute('aria-current', 'page');
    links.append(link);
    return link;
  };
  const current = currentModule;
  const reports = ['production-log', 'line-downtime', 'pair-targets'];
  const module = reports.includes(current) ? current : new URLSearchParams(location.search).get('module');
  const query = reports.includes(module) ? '?module=' + module : '';
  addLink('/account', 'Моят акаунт');
  if (canViewModule('admin-panel')) {
    const link = addLink('/admin-panel' + query, 'Админ панел');
    if (['system-status','accounts','activity-log','data-import','production-import','report-history'].includes(current)) link.setAttribute('aria-current', 'location');
  }
  if (!canViewModule('admin-panel') && canViewModule('data-import')) addLink('/data-import'+query,'Експорт на отчети');
  const moduleNav = document.createElement('div'); moduleNav.className = 'server-module-nav';
  const moduleLabel = document.createElement('label'); moduleLabel.setAttribute('for', 'serverModuleSelect'); moduleLabel.textContent = 'Модул';
  const moduleSelect = document.createElement('select'); moduleSelect.id = 'serverModuleSelect';
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.disabled = true; placeholder.textContent = 'Избери модул'; moduleSelect.append(placeholder);
  const modules = [['index', 'Начална страница'], ['tasks', 'Задачи'], ['shift-closeout','Край на смяната'], ['production-log', 'Тонаж и брак'], ['line-downtime', 'Аварии на линията'], ['personnel', 'Смени и хора'], ['pair-targets', 'Двойки и таргети'], ['package-instructions', 'Инструкции за опаковане'], ['statistics', 'Статистики'], ['problems', 'Глобални проблеми'], ['wall', 'Стена']];
  for (const [name, title] of modules) {
    if (name !== 'index' && !canViewModule(name)) continue;
    const option = document.createElement('option'); option.value = name === 'index' ? '/' : '/' + name; option.textContent = title;
    moduleSelect.append(option);
  }
  const currentRoute = currentModule === 'index' ? '/' : '/' + currentModule;
  moduleSelect.value = modules.some(([name]) => name === currentModule) ? currentRoute : '';
  const originalSelection = moduleSelect.value;
  moduleSelect.addEventListener('change', () => {
    const target = moduleSelect.value; moduleSelect.value = originalSelection;
    if (target && target !== currentRoute) navigate(target, moduleSelect);
  });
  moduleNav.append(moduleLabel, moduleSelect); tools.append(moduleNav);
  const logout = document.createElement('button'); logout.className = 'server-logout'; logout.type = 'button'; logout.textContent = 'Изход';
  logout.onclick = () => requestLeave(async () => {
    logout.disabled = true; setSigningOut(true);
    try { await window.HubNotifications?.stopDevice().catch(() => {}); await send('/api/logout', 'POST', {}); leavePage(() => location.assign('/login')); }
    catch (error) { if (error.status === 401) leavePage(() => location.assign('/login')); else throw error; }
    finally { logout.disabled = false; setSigningOut(false); }
  }, logout);
  const leaveFeedback = document.createElement('span'); leaveFeedback.id = 'serverLeaveFeedback'; leaveFeedback.setAttribute('role', 'status');
  tools.append(leaveFeedback);
  // Version details stay reachable while current; an unconfirmed server version is never shown as up to date.
  const versionInfo = document.createElement('section'); versionInfo.id = 'serverVersionInfo'; versionInfo.className = 'server-version-info';
  versionInfo.setAttribute('aria-labelledby', 'serverVersionTitle');
  const versionTitle = document.createElement('h2'); versionTitle.id = 'serverVersionTitle'; versionTitle.textContent = 'Версия и обновяване';
  const versionList = document.createElement('dl');
  const versionRow = (label, id, value) => {
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.id = id; detail.textContent = value;
    versionList.append(term, detail); return detail;
  };
  versionRow('Заредена версия', 'serverClientVersion', boot.version).setAttribute('translate', 'no');
  const serverVersion = versionRow('Версия на сървъра', 'serverConfirmedVersion', 'Не е потвърдена');
  const versionStatus = versionRow('Състояние', 'serverVersionStatus', 'Проверка…'); versionStatus.setAttribute('data-update-state', 'checking');
  const versionChecked = versionRow('Последна проверка', 'serverVersionChecked', 'Още няма');
  const versionHint = document.createElement('p'); versionHint.id = 'serverVersionHint'; versionHint.hidden = true;
  const versionUpdate = document.createElement('button'); versionUpdate.type = 'button'; versionUpdate.id = 'serverVersionUpdate'; versionUpdate.textContent = 'Обнови до новата версия'; versionUpdate.hidden = true;
  versionInfo.append(versionTitle, versionList, versionHint, versionUpdate);
  const versionLabels = {checking: 'Проверка…', current: 'Актуална версия', update: 'Има нова версия', offline: 'Няма връзка със сървъра', manual: 'Без автоматична проверка'};
  const versionHints = {offline: 'Показана е последната потвърдена версия. Тя може да е остаряла.', manual: 'Тази страница не проверява за нови версии. Отвори друг модул за проверка.'};
  const checkedTime = value => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(value).map(part => [part.type, part.value]));
    return parts.day + '.' + parts.month + ' ' + parts.hour + ':' + parts.minute;
  };
  function renderVersion(state, confirmed = null, checkedAt = null) {
    versionStatus.setAttribute('data-update-state', state);
    if (versionStatus.textContent !== versionLabels[state]) versionStatus.textContent = versionLabels[state];
    if (confirmed && serverVersion.textContent !== confirmed) { serverVersion.setAttribute('translate', 'no'); serverVersion.textContent = confirmed; }
    if (checkedAt) { versionChecked.setAttribute('translate', 'no'); versionChecked.textContent = checkedTime(checkedAt); }
    versionHint.hidden = !versionHints[state]; versionHint.textContent = versionHints[state] || '';
    versionUpdate.hidden = state !== 'update';
  }
  menu.append(menuHead, links, versionInfo, logout); account.append(accountButton, menu);
  const backdrop = document.createElement('div'); backdrop.className = 'server-account-backdrop'; backdrop.hidden = true;
  session.append(state, account); bar.append(top, tools, backdrop);
  function toggleMenu(open, {focus = false} = {}) {
    if (menu.hidden === !open) return;
    menu.hidden = !open; backdrop.hidden = !open; accountButton.setAttribute('aria-expanded', String(open)); bar.classList.toggle('server-menu-open', open);
    if (open && focus) (links.querySelector('a') || logout).focus();
    if (!open && focus) accountButton.focus();
  }
  accountButton.addEventListener('click', () => toggleMenu(menu.hidden, {focus: accountButton.matches(':focus-visible')}));
  account.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.stopPropagation(); toggleMenu(false, {focus: true}); }
    if (event.key === 'ArrowDown' && event.target === accountButton) { event.preventDefault(); toggleMenu(true, {focus: true}); }
  });
  account.addEventListener('focusout', event => { if (!menu.hidden && event.relatedTarget && !account.contains(event.relatedTarget)) toggleMenu(false); });
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !account.contains(event.target)) toggleMenu(false); });
  menu.addEventListener('click', event => { if (event.target.closest('a[href]')) toggleMenu(false); });
  document.body.prepend(bar);
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    const target = new URL(link.href, location.href), current = new URL(location.href);
    if (target.origin !== current.origin || target.pathname === current.pathname && target.search === current.search) return;
    event.preventDefault(); navigate(target.href, link);
  });
  // The language switch is initialized by i18n after the injected server script.
  setTimeout(() => { const language = document.querySelector('.hub-language'); if (language) tools.append(language); }, 0);
  if (currentModule === 'report-history') {
    state.setAttribute('data-connection', 'ready'); state.textContent = 'Ръчно обновяване';
    renderVersion('manual');
  } else {
    const overlay = document.createElement('div'); overlay.id = 'serverReconnectOverlay'; overlay.className = 'server-reconnect-overlay'; overlay.hidden = true;
    const card = document.createElement('div'); card.className = 'server-reconnect-card';
    const ring = document.createElement('span'); ring.className = 'server-reconnect-ring'; ring.setAttribute('aria-hidden', 'true');
    const brand = document.createElement('span'); brand.className = 'server-reconnect-brand'; brand.textContent = 'Package Hub'; brand.setAttribute('translate', 'no');
    const message = document.createElement('p'); message.className = 'server-reconnect-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    const note = document.createElement('p'); note.className = 'server-reconnect-note'; note.textContent = 'Проверяваме връзката и актуалните данни.';
    card.append(ring, brand, message, note); overlay.append(card); document.body.append(overlay);
    let recovery = null, attempt = 0, transportReady = false, resumeWork = null;
    let transportEpoch = 0, synchronizedEpoch = -1;
    function finishRecovery(id) {
      if (!recovery || recovery.id !== id) return;
      recovery.finished = true;
      clearTimeout(recovery.reveal); clearTimeout(recovery.deadline);
      overlay.hidden = true;
    }
    function beginRecovery(text, {restart = false} = {}) {
      // Retain a finished attempt while transport is down: repeated errors
      // must not restart or prolong the bounded decorative visual.
      if (recovery && !restart) return recovery.id;
      if (recovery) { clearTimeout(recovery.reveal); clearTimeout(recovery.deadline); }
      const current = recovery = {id: ++attempt, finished: false};
      message.textContent = text;
      current.reveal = setTimeout(() => { if (recovery === current && !current.finished) overlay.hidden = false; }, 2300);
      current.deadline = setTimeout(() => finishRecovery(current.id), 8000);
      return current.id;
    }
    beginRecovery('Възстановяване на връзката…');
    const eventSource = new EventSource('/api/events');
    eventSource.onopen = () => { transportReady = true; transportEpoch++; versionLive = false; transportLost = false; showVersion(); state.setAttribute('data-connection', 'ready'); state.textContent = 'Свързан'; refreshTaskCount(); };
    eventSource.onerror = () => {
      beginRecovery('Възстановяване на връзката…', {restart: transportReady}); transportReady = false;
      versionLive = false; transportLost = true; showVersion();
      state.setAttribute('data-connection', 'pending'); state.textContent = 'Възстановяване на връзката…';
    };
    eventSource.addEventListener('change', event => { const data = JSON.parse(event.data); for (const refresh of listeners.get(data.module) || []) refresh(); });
    // The server emits this for normal session expiry too. Keep the phone's
    // opt-in; account revocation already removes its subscriptions server-side.
    eventSource.addEventListener('logout', () => { finishRecovery(recovery.id); eventSource.close(); if (!isSigningOut()) location.assign('/login'); });
    let availableVersion = boot.version, updateNotice = null, updateDialog = null;
    // A version is confirmed only by the server's version event on the current connection.
    let confirmedVersion = null, checkedAt = null, versionLive = false, transportLost = false;
    function showVersion() {
      renderVersion(!versionLive ? (transportLost ? 'offline' : 'checking') : availableVersion === boot.version ? 'current' : 'update', confirmedVersion, checkedAt);
    }
    const busyUpdateMessage = 'Изчакай текущия запис и опитай обновяването отново. Формата остава отворена.';
    function updateElement(tag, id, text) {
      const node = document.createElement(tag); node.id = id; node.textContent = text; return node;
    }
    function requestUpdate() {
      if (availableVersion === boot.version) return;
      const status = updateState(), feedback = document.getElementById('serverUpdateFeedback');
      feedback.textContent = status.busy ? busyUpdateMessage : '';
      if (status.busy) return;
      if (!status.dirty) { leavePage(() => location.reload()); return; }
      if (!updateDialog) {
        updateDialog = updateElement('dialog', 'serverUpdateDialog', ''); updateDialog.className = 'report-reason';
        updateDialog.setAttribute('aria-labelledby', 'serverUpdateTitle');
        const title = updateElement('h2', 'serverUpdateTitle', 'Обновяване с незапазени промени');
        const note = updateElement('p', 'serverUpdateWarning', 'Има чернова или непотвърдена промяна. Обновяването ще затвори формата и ще загуби незапазените полета.');
        const saved = updateElement('p', 'serverUpdateSavedNote', 'Обновяването не отменя промяна, която сървърът вече е записал.');
        const message = updateElement('p', 'serverUpdateDialogFeedback', ''); message.setAttribute('role', 'status');
        const cancel = updateElement('button', 'serverUpdateCancel', 'Върни се към формата'); cancel.type = 'button';
        const confirm = updateElement('button', 'serverUpdateConfirm', 'Откажи промените и обнови'); confirm.type = 'button';
        const close = () => { updateDialog.close(); button.focus(); };
        cancel.addEventListener('click', close);
        // Escape belongs to this dialog, not an underlying editor's page handler.
        updateDialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
        updateDialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        confirm.addEventListener('click', () => {
          if (availableVersion === boot.version) { close(); return; }
          if (updateState().busy) { message.textContent = busyUpdateMessage; return; }
          updateDialog.close(); leavePage(() => location.reload());
        });
        updateDialog.append(title, note, saved, message, cancel, confirm); document.body.append(updateDialog);
      }
      document.getElementById('serverUpdateDialogFeedback').textContent = '';
      if (!updateDialog.open) updateDialog.showModal();
      document.getElementById('serverUpdateCancel').focus();
    }
    let button;
    // The menu entry reuses the notice's guarded update flow and its feedback.
    versionUpdate.addEventListener('click', () => { toggleMenu(false); button?.focus(); requestUpdate(); });
    eventSource.addEventListener('version', event => {
      const version = JSON.parse(event.data).version;
      if (typeof version === 'string' && version) { availableVersion = confirmedVersion = version; checkedAt = Date.now(); versionLive = true; }
      if (availableVersion !== boot.version && !updateNotice) {
        updateNotice = updateElement('div', 'serverUpdateNotice', ''); updateNotice.className = 'server-update-notice';
        const versions = document.createElement('span');
        const current = updateElement('span', 'serverCurrentVersion', boot.version); current.setAttribute('translate', 'no');
        const available = updateElement('span', 'serverAvailableVersion', availableVersion); available.setAttribute('translate', 'no');
        const currentLabel = document.createElement('span'); currentLabel.textContent = 'Текуща версия: ';
        const availableLabel = document.createElement('span'); availableLabel.textContent = ' · Налична версия: ';
        versions.append(currentLabel, current, availableLabel, available);
        button = updateElement('button', 'serverUpdate', 'Нова версия — обнови'); button.type = 'button'; button.onclick = requestUpdate;
        const feedback = updateElement('span', 'serverUpdateFeedback', ''); feedback.setAttribute('role', 'status');
        updateNotice.append(versions, button, feedback); tools.append(updateNotice);
      }
      if (updateNotice) {
        updateNotice.hidden = availableVersion === boot.version;
        document.getElementById('serverAvailableVersion').textContent = availableVersion;
        if (updateNotice.hidden && updateDialog?.open) updateDialog.close();
      }
      showVersion();
      const current = recovery.id, connection = transportEpoch;
      refreshVisibleWatchers().then(() => {
        if (transportReady && connection === transportEpoch) {
          synchronizedEpoch = connection;
          finishRecovery(current);
        }
      });
    });
    function resume() {
      if (document.hidden || resumeWork) return;
      const current = beginRecovery('Възстановяване на връзката…', {restart: true});
      const work = resumeWork = refreshVisibleWatchers();
      work.then(() => { if (transportReady && eventSource.readyState === 1 && synchronizedEpoch === transportEpoch) finishRecovery(current); })
        .finally(() => { if (resumeWork === work) resumeWork = null; });
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) resumeWork = null; else resume(); });
    window.addEventListener('pageshow', event => { if (event.persisted) resume(); });
  }
  if (currentModule === 'index') {
    const tasksLink = document.querySelector('a[href="/tasks"],a[href="tasks.html"]');
    if (tasksLink && can('canViewTasks')) tasksLink.hidden = false;
    const problemsLink = document.querySelector('a[href="/problems"],a[href="problems.html"]');
    if (problemsLink && can('canViewProblems')) problemsLink.hidden = false;
    const wallLink = document.querySelector('a[href="/wall"],a[href="wall.html"]');
    if (wallLink && can('canViewWall')) wallLink.hidden = false;
    document.querySelector('.sub').textContent = 'Общи данни за всички устройства. Изберете модул.';
    document.querySelector('footer').textContent = 'Общи данни за всички устройства. Промените се показват автоматично.';
  }
  const taskBadges = [];
  let taskCountSequence = 0;
  let taskCountRead = null;
  if (can('canViewTasks') && currentModule !== 'report-history') {
    for (const link of document.querySelectorAll('a[href="/tasks"],a[href="tasks.html"],a[href="/tasks.html"]' + (currentModule === 'tasks' ? ',.tasks-heading h1' : ''))) {
      const badge = document.createElement('span'); badge.className = 'task-count'; badge.hidden = true;
      badge.setAttribute('role', 'status'); (link.querySelector('h2') || link).append(badge); taskBadges.push(badge);
    }
    watch('tasks', refreshTaskCount); watch('accounts', refreshTaskCount);
    setInterval(() => { if (!document.hidden) refreshTaskCount(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTaskCount(); });
    refreshTaskCount();
  }
  function refreshTaskCount() {
    if (!taskBadges.length || document.hidden) return Promise.resolve();
    if (taskCountRead) return taskCountRead;
    const sequence = ++taskCountSequence;
    const operation = (async () => { try {
      const {count} = await json('/api/tasks/summary');
      if (sequence !== taskCountSequence) return;
      for (const badge of taskBadges) {
        if (badge.textContent !== String(count)) badge.textContent = String(count);
        if (badge.hidden !== (count === 0)) badge.hidden = count === 0;
        const label = (can('canReviewTasks') && !can('canReportTasks') ? 'Задачи за проверка:' : 'Чакащи задачи:') + ' ' + count;
        if (badge.title !== label) { badge.setAttribute('aria-label', label); badge.title = label; }
      }
    } catch {
      if (sequence === taskCountSequence) for (const badge of taskBadges) badge.hidden = true;
    } })();
    taskCountRead = operation;
    operation.finally(() => { if (taskCountRead === operation) taskCountRead = null; }).catch(() => {});
    return operation;
  }
  // "New" marks wall posts by others since this account last opened the wall.
  if (can('canViewWall') && !['wall', 'report-history'].includes(currentModule)) {
    const marks = [...document.querySelectorAll('a[href="/wall"],a[href="wall.html"]')].map(link => {
      const badge = document.createElement('span'); badge.className = 'wall-new'; badge.hidden = true; badge.textContent = 'ново';
      (link.querySelector('h2') || link).append(badge); return badge;
    });
    const option = moduleSelect.querySelector('option[value="/wall"]');
    const refreshWallBadge = () => json('/api/wall/summary').then(({unread}) => {
      for (const badge of marks) { badge.hidden = !unread; badge.title = 'Нови публикации: ' + unread; }
      if (option) option.textContent = unread ? 'Стена · ново' : 'Стена';
    }).catch(() => {});
    watch('wall', refreshWallBadge); refreshWallBadge();
  }
  applyPermissions();
  new MutationObserver(applyPermissions).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']});
}
