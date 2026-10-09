(() => {
  if (typeof HubServer === 'undefined' || !HubServer.can('canImportData')) return;
  const file = document.getElementById('importFile'), preview = document.getElementById('previewImport'), apply = document.getElementById('applyImport');
  const summary = document.getElementById('importSummary'), message = document.getElementById('importMessage');
  let input = null, checked = null, sequence = 0;
  const say = value => { message.textContent = value; };
  const labels = {total: 'Записи във файла', added: 'Нови записи', duplicates: 'Вече добавени', conflicts: 'Конфликтни записи', firstDate: 'От дата', lastDate: 'До дата', kg: 'Тонаж (кг)', scrapKg: 'Брак (кг)'};
  function show(result) {
    summary.replaceChildren(); summary.hidden = false;
    for (const [key, label] of Object.entries(labels)) {
      const term = document.createElement('dt'), value = document.createElement('dd');
      term.textContent = label; value.setAttribute('translate', 'no'); value.dataset.field = key; value.textContent = result[key] ?? '—';
      const item = document.createElement('div'); item.append(term, value); summary.append(item);
    }
  }
  file.addEventListener('change', () => { sequence++; input = checked = null; summary.hidden = true; apply.disabled = true; preview.disabled = !file.files.length; say(''); });
  const request = (action, data, revision) => HubServer.send('/api/import/production-log/' + action, 'POST', data, revision ? {'If-Match': '"' + revision + '"'} : {});
  function fail(error) {
    const messages = {REPORT_CONFLICT: 'Базата е променена. Провери файла отново.', BACKUP_FAILED: 'Резервното копие не успя. Нищо не е добавено.', INVALID_DATA: 'Файлът не е валиден. Нищо не е добавено.', TOO_LARGE: 'Файлът е над 2 MB.', FORBIDDEN: 'Акаунтът няма право за тази промяна.'};
    say(messages[error.code || error.message] || 'Няма връзка със сървъра. Провери файла отново преди нов опит.');
  }
  preview.addEventListener('click', async () => {
    const selected = file.files[0]; if (!selected) return;
    const run = ++sequence; checked = null; input = null; apply.disabled = preview.disabled = true; summary.hidden = true; say('Проверка…');
    try {
      if (selected.size > 2 * 1024 * 1024 - 1024) throw new Error('TOO_LARGE');
      let data; try { data = JSON.parse(await selected.text()); } catch { throw new Error('INVALID_DATA'); }
      if (new Blob([JSON.stringify(data)]).size > 2 * 1024 * 1024) throw new Error('TOO_LARGE');
      const result = await request('preview', data);
      if (run !== sequence) return;
      input = data; checked = result; show(result); apply.disabled = result.conflicts > 0 || result.added === 0;
      say(result.conflicts ? 'Има различни записи с еднакъв идентификатор. Импортът е спрян.' : result.added ? 'Файлът е проверен. Потвърди добавянето.' : 'Всички записи вече са добавени.');
    } catch (error) { if (run === sequence) fail(error); }
    finally { if (run === sequence) preview.disabled = false; }
  });
  apply.addEventListener('click', async () => {
    if (!input || !checked || checked.conflicts || !checked.added) return;
    const run = ++sequence; file.disabled = true; apply.disabled = preview.disabled = true; say('Добавяне…');
    try {
      const result = await request('apply', input, checked.revision);
      if (run !== sequence) return;
      show(result); say('Импортът е завършен. Отвори отчетите за проверка.');
    } catch (error) { if (run === sequence) fail(error); }
    finally { if (run === sequence) { checked = null; file.disabled = false; preview.disabled = false; } }
  });
})();
