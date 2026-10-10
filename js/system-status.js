(() => {
  const $ = id => document.getElementById(id);
  const states = {ok: 'Изправно', warning: 'Внимание', failed: 'Проблем', unknown: 'Няма данни'};
  const warnings = {DATABASE_UNAVAILABLE: 'Базата не може да бъде проверена.', DISK_SPACE_LOW: 'Свободното място е малко. Освободи място на диска.',
    DISK_STATUS_UNKNOWN: 'Няма данни за свободното място.', SECONDARY_UNAVAILABLE: 'Вторият носител е недостъпен или не съответства на настройката.',
    BACKUP_FAILED: 'Последният опит за архивиране е неуспешен.', BACKUP_OVERDUE: 'Архивът е по-стар от зададения график.',
    SECONDARY_COPY_OVERDUE: 'Второто копие е по-старо от зададения график.',
    BACKUP_STATUS_UNKNOWN: 'Няма потвърдени данни за архивирането.', SINGLE_DISK_BACKUP: 'Архивите са на основния диск. При повреда на диска могат да се загубят заедно с работната база.', UPDATE_FAILED: 'Последната проверка или обновяване е неуспешно.',
    UPDATE_STATUS_UNKNOWN: 'Няма потвърдени данни за последното обновяване.', MANUAL_BACKUP_FAILED: 'Ръчният архив е неуспешен. Провери местната настройка.',
    MANUAL_BACKUP_UNAVAILABLE: 'Ръчният архив не е достъпен. Провери местната настройка.',
    MANUAL_BACKUP_STATUS_UNKNOWN: 'Резултатът от ръчния архив не може да бъде потвърден.'};
  const clock = value => value ? new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'bg-BG', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value)) : '—';
  const bytes = value => value === null ? '—' : new Intl.NumberFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'bg-BG', {maximumFractionDigits: 1}).format(value / 1024 ** 3) + ' GiB';
  const uncertainBackup = 'Не можем да потвърдим заявката за архив. Опресни статуса, преди нов опит.';
  let current, refreshController, manualController, timer, manualPending = false, destroyed = false, manualError = '', renderedLanguage = document.documentElement.lang;
  function badge(id, state) { $(id).dataset.state = state; $(id).textContent = states[state] || states.unknown; }
  function render(data) {
    current = data; $('systemContent').hidden = false;
    $('systemSummary').dataset.state = data.state;
    $('summaryLabel').textContent = {ok: 'Проверките са успешни', warning: 'Има предупреждение', failed: 'Необходима е проверка', unknown: 'Проверката е непълна'}[data.state];
    badge('summaryBadge', data.state); $('checkedAt').textContent = clock(data.checkedAt);
    for (const [id, key] of [['databaseState', 'database'], ['diskState', 'disk'], ['backupState', 'backups'], ['secondaryState', 'secondary'], ['updateState', 'updates']]) badge(id, data[key].state);
    $('databaseValue').textContent = data.database.state === 'ok' ? 'Достъпна' : 'Няма потвърждение';
    $('diskValue').textContent = bytes(data.disk.freeBytes);
    $('diskDetail').replaceChildren(document.createTextNode('Свободни от '));
    const total = document.createElement('span'); total.setAttribute('translate', 'no'); total.textContent = bytes(data.disk.totalBytes); $('diskDetail').append(total);
    $('diskMeter').hidden = data.disk.totalBytes === null;
    if (data.disk.totalBytes) $('diskMeter').value = 100 * (1 - data.disk.freeBytes / data.disk.totalBytes);
    for (const [id, value] of [['backupTime', data.backups.lastSuccess], ['backupAttempt', data.backups.lastAttempt], ['secondaryTime', data.secondary.lastCopy], ['updateTime', data.updates.lastSuccess], ['updateAttempt', data.updates.lastAttempt]]) $(id).textContent = clock(value);
    $('backupSchedule').textContent = data.backups.intervalHours ? 'На всеки ' + data.backups.intervalHours + ' часа' : 'Няма данни';
    $('backupMode').textContent = data.backups.mode === 'single' ? 'Основен диск' : data.backups.mode === 'dual' ? 'Два отделни диска' : 'Няма данни';
    $('secondaryState').textContent = data.backups.mode === 'single' ? 'Няма независимо копие' : states[data.secondary.state] || states.unknown;
    $('secondaryDetail').textContent = data.backups.mode === 'single' ? 'Второ независимо копие не е настроено.' : {ok: 'Носителят е достъпен. Провери часа на копието.', warning: warnings.SECONDARY_COPY_OVERDUE,
      failed: 'Провери втория носител на сървъра.', unknown: 'Няма потвърждение за втория носител.'}[data.secondary.state];
    $('systemWarnings').replaceChildren();
    for (const code of data.warnings) if (warnings[code]) { const item = document.createElement('li'); item.textContent = warnings[code]; $('systemWarnings').append(item); }
    $('systemWarnings').hidden = !$('systemWarnings').childElementCount;
    const running = manualPending || data.manual.state === 'running';
    if (data.manual.state === 'running') manualError = '';
    $('manualBackup').hidden = !HubServer.can('canBackupSystem');
    $('manualBackup').disabled = !HubServer.can('canBackupSystem') || !data.manual.available || running;
    $('manualBackup').textContent = running ? 'Архивиране…' : 'Създай архив';
    $('manualHint').textContent = data.manual.available ? 'Резултатът се показва тук. Архивите остават на сървъра.' : 'Контролът на архивите не е настроен.';
    $('manualMessage').dataset.state = manualError || data.manual.state === 'failed' ? 'failed' : data.manual.state;
    if (manualPending) $('manualMessage').textContent = 'Заявката за архив е изпратена.';
    else if (manualError && data.manual.state !== 'running') $('manualMessage').textContent = manualError;
    else if (data.manual.state === 'running') $('manualMessage').textContent = 'Архивът се създава и проверява. Можеш да оставиш екрана отворен.';
    else if (data.manual.state === 'ok') $('manualMessage').textContent = data.backups.mode === 'single' ? 'Ръчният архив на основния диск е завършен и проверен.' : 'Ръчният архив е завършен. Провери статуса на двете копия.';
    else if (data.manual.state === 'failed') $('manualMessage').textContent = warnings.MANUAL_BACKUP_FAILED;
    else if (data.manual.state === 'unknown') $('manualMessage').textContent = warnings.MANUAL_BACKUP_STATUS_UNKNOWN;
    else $('manualMessage').textContent = '';
  }
  async function refresh() {
    if (refreshController || destroyed) return;
    const operation = new AbortController(); refreshController = operation;
    const timeout = setTimeout(() => operation.abort(), 20000);
    $('refreshSystem').disabled = true; $('systemContent').setAttribute('aria-busy', 'true');
    try {
      const data = await HubServer.json('/api/admin/status', {signal: operation.signal});
      if (destroyed || refreshController !== operation) return;
      render(data); $('systemMessage').textContent = '';
    }
    catch {
      if (destroyed || refreshController !== operation) return;
      // Hide the last green summary immediately after a failed refresh.
      $('systemContent').hidden = true; current = null;
      $('systemMessage').textContent = 'Статусът не може да се прочете. Опитай отново.';
    } finally {
      clearTimeout(timeout);
      if (refreshController === operation) {
        refreshController = null; $('refreshSystem').disabled = false; $('systemContent').removeAttribute('aria-busy');
      }
    }
  }
  function cancelRefresh() {
    const previous = refreshController; refreshController = null; previous?.abort();
  }
  if (typeof HubServer === 'undefined' || !HubServer.can('canViewSystemStatus')) {
    $('systemMessage').textContent = 'Този екран изисква право за преглед на статуса на системата.'; $('refreshSystem').disabled = true; return;
  }
  $('refreshSystem').addEventListener('click', refresh);
  $('manualBackup').addEventListener('click', async () => {
    if (!HubServer.can('canBackupSystem') || destroyed || manualPending || !current?.manual.available || current.manual.state === 'running') return;
    manualError = '';
    const operation = new AbortController(); manualController = operation;
    const timeout = setTimeout(() => operation.abort(), 20000);
    manualPending = true; $('manualBackup').disabled = true; $('manualBackup').textContent = 'Архивиране…';
    $('manualMessage').textContent = 'Заявката за архив е изпратена.';
    try {
      const result = await HubServer.json('/api/admin/backup', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}', signal: operation.signal});
      if (result?.state !== 'running') throw new Error();
    }
    catch (error) {
      if (manualController === operation) manualError = error.code === 'BACKUP_BUSY' ? 'Вече се изпълнява архив. Изчакай и опресни.' : uncertainBackup;
    }
    finally {
      clearTimeout(timeout);
      if (manualController === operation) { manualController = null; manualPending = false; cancelRefresh(); await refresh(); }
    }
  });
  function startPolling() {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  new MutationObserver(() => {
    if (renderedLanguage !== document.documentElement.lang) { renderedLanguage = document.documentElement.lang; if (current) render(current); }
  }).observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
  window.addEventListener('pagehide', () => {
    destroyed = true; clearInterval(timer);
    cancelRefresh();
    if (manualPending) manualError = uncertainBackup;
    manualController?.abort(); manualController = null; manualPending = false;
    current = null; $('systemContent').hidden = true;
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { destroyed = false; startPolling(); refresh(); }
  });
  startPolling();
  refresh();
})();
