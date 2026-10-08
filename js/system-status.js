(() => {
  const $ = id => document.getElementById(id);
  const states = {ok: 'Изправно', warning: 'Внимание', failed: 'Проблем', unknown: 'Няма данни'};
  const warnings = {DATABASE_UNAVAILABLE: 'Базата не може да бъде проверена.', DISK_SPACE_LOW: 'Свободното място е малко. Освободи място на диска.',
    DISK_STATUS_UNKNOWN: 'Няма данни за свободното място.', SECONDARY_UNAVAILABLE: 'Вторият носител е недостъпен или не съответства на настройката.',
    BACKUP_FAILED: 'Последният опит за архивиране е неуспешен.', BACKUP_OVERDUE: 'Архивът е по-стар от зададения график.',
    SECONDARY_COPY_OVERDUE: 'Второто копие е по-старо от зададения график.',
    BACKUP_STATUS_UNKNOWN: 'Няма потвърдени данни за защитата с два архива.', UPDATE_FAILED: 'Последната проверка или обновяване е неуспешно.',
    UPDATE_STATUS_UNKNOWN: 'Няма потвърдени данни за последното обновяване.', MANUAL_BACKUP_FAILED: 'Ръчният архив е неуспешен. Провери местната настройка.'};
  const clock = value => value ? new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'bg-BG', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value)) : '—';
  const bytes = value => value === null ? '—' : new Intl.NumberFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'bg-BG', {maximumFractionDigits: 1}).format(value / 1024 ** 3) + ' GiB';
  let current, pending = false, manualPending = false, destroyed = false, manualError = '', renderedLanguage = document.documentElement.lang;
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
    $('secondaryDetail').textContent = {ok: 'Носителят е достъпен. Провери часа на копието.', warning: warnings.SECONDARY_COPY_OVERDUE,
      failed: 'Провери втория носител на сървъра.', unknown: 'Няма потвърждение за втория носител.'}[data.secondary.state];
    $('systemWarnings').replaceChildren();
    for (const code of data.warnings) if (warnings[code]) { const item = document.createElement('li'); item.textContent = warnings[code]; $('systemWarnings').append(item); }
    $('systemWarnings').hidden = !$('systemWarnings').childElementCount;
    const running = manualPending || data.manual.state === 'running';
    $('manualBackup').disabled = !data.manual.available || running;
    $('manualBackup').textContent = running ? 'Архивиране…' : 'Създай архив';
    $('manualHint').textContent = data.manual.available ? 'Резултатът се показва тук. Архивите остават на сървъра.' : 'Контролът на архивите не е настроен.';
    $('manualMessage').dataset.state = manualError || data.manual.state === 'failed' ? 'failed' : data.manual.state;
    if (manualPending) $('manualMessage').textContent = 'Заявката за архив е изпратена.';
    else if (manualError && data.manual.state !== 'running') $('manualMessage').textContent = manualError;
    else if (data.manual.state === 'running') $('manualMessage').textContent = 'Архивът се създава и проверява. Можеш да оставиш екрана отворен.';
    else if (data.manual.state === 'ok') $('manualMessage').textContent = 'Ръчният архив е завършен. Провери статуса на двете копия.';
    else if (data.manual.state === 'failed') $('manualMessage').textContent = warnings.MANUAL_BACKUP_FAILED;
    else $('manualMessage').textContent = '';
  }
  async function refresh() {
    if (pending || destroyed) return;
    pending = true; $('refreshSystem').disabled = true; $('systemContent').setAttribute('aria-busy', 'true');
    try { render(await HubServer.json('/api/admin/status')); $('systemMessage').textContent = ''; }
    catch {
      // Hide the last green summary immediately after a failed refresh.
      $('systemContent').hidden = true; current = null;
      $('systemMessage').textContent = 'Статусът не може да се прочете. Опитай отново.';
    } finally { pending = false; $('refreshSystem').disabled = false; $('systemContent').removeAttribute('aria-busy'); }
  }
  if (typeof HubServer === 'undefined' || HubServer.user.role !== 'admin') {
    $('systemMessage').textContent = 'Този екран е достъпен само за администратор в сървърната версия.'; $('refreshSystem').disabled = true; return;
  }
  $('refreshSystem').addEventListener('click', refresh);
  $('manualBackup').addEventListener('click', async () => {
    if (manualPending || !current?.manual.available) return;
    manualError = '';
    manualPending = true; $('manualBackup').disabled = true; $('manualBackup').textContent = 'Архивиране…';
    $('manualMessage').textContent = 'Заявката за архив е изпратена.';
    try { await HubServer.send('/api/admin/backup', 'POST', {}); }
    catch (error) { manualError = error.code === 'BACKUP_BUSY' ? 'Вече се изпълнява архив. Изчакай и опресни.' : 'Архивът не може да се стартира. Провери местната настройка.'; }
    finally { manualPending = false; await refresh(); }
  });
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  new MutationObserver(() => {
    if (renderedLanguage !== document.documentElement.lang) { renderedLanguage = document.documentElement.lang; if (current) render(current); }
  }).observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
  window.addEventListener('pagehide', () => { destroyed = true; clearInterval(timer); });
  refresh();
})();
