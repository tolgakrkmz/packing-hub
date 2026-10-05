/* File contents go only to the authenticated private server, never into browser storage. */
(() => {
  const modules = {'production-log': 'Тонаж и брак', 'line-downtime': 'Престои', personnel: 'Смени и хора', 'pair-targets': 'Двойки и таргети', 'package-instructions': 'Инструкции за опаковка'};
  const fileInput = document.getElementById('moduleFiles'), folderInput = document.getElementById('legacyFolder'), settings = document.getElementById('includeSettings');
  const check = document.getElementById('checkDataImport'), confirm = document.getElementById('confirmDataImport'), cancel = document.getElementById('cancelDataImport');
  const message = document.getElementById('dataImportMessage'), progress = document.getElementById('importProgress'), rows = document.getElementById('dataImportRows');
  let batch = null, prepared = null, checked = null, busy = false, controller = null, sequence = 0;
  const uploaded = new Set();
  const say = value => { message.textContent = value; };
  const request = (url, method, value, binary = false) => HubServer.json(url, {method, signal: controller?.signal, headers: {'Content-Type': binary ? 'application/octet-stream' : 'application/json'}, body: binary ? value : JSON.stringify(value)});
  const route = action => '/api/import/batches/' + batch + '/' + action;
  function lock(value) {
    busy = value; fileInput.disabled = folderInput.disabled = settings.disabled = value;
    check.disabled = value || !(fileInput.files.length || folderInput.files.length);
    confirm.disabled = value || !checked?.canApply;
    cancel.disabled = value || !batch;
  }
  function table(result = {}) {
    rows.replaceChildren();
    for (const [kind, label] of Object.entries(modules)) {
      const value = result.documents?.[kind], tr = document.createElement('tr'); tr.dataset.module = kind;
      const cells = [label, kind + '.json', value?.added ?? '—', value?.duplicates ?? '—', value?.conflicts ?? '—', value?.settingsChanges ?? '—', value?.historyAdded ?? '—'];
      for (const [index, text] of cells.entries()) { const td = document.createElement('td'); td.textContent = text; if (index) td.setAttribute('translate', 'no'); tr.append(td); }
      rows.append(tr);
    }
    const files = result.files, tr = document.createElement('tr'); tr.dataset.module = 'attachments';
    for (const [index, text] of ['Снимки и приложения', 'data/profiles', files?.added ?? '—', files?.duplicates ?? '—', files?.conflicts ?? '—', '—', '—'].entries()) { const td = document.createElement('td'); td.textContent = text; if (index) td.setAttribute('translate', 'no'); tr.append(td); } rows.append(tr);
    document.getElementById('missingCount').textContent = files?.missing || 0;
    document.getElementById('missingAttachments').hidden = !files?.missing;
  }
  async function discard() {
    const id = batch; batch = prepared = checked = null; uploaded.clear(); confirm.disabled = true;
    if (id) await HubServer.send('/api/import/batches/' + id, 'DELETE', {}).catch(() => {});
  }
  for (const input of [fileInput, folderInput, settings]) input.addEventListener('change', () => { sequence++; discard(); progress.hidden = true; table(); say(''); lock(false); });
  async function prepare() {
    const candidates = [...fileInput.files];
    const attachments = new Map();
    for (const file of folderInput.files) {
      const relative = file.webkitRelativePath || file.name, parts = relative.split('/'), root = parts.shift(), tail = parts.join('/');
      if (/^(?:data\/)?[a-z-]+\.json$/.test(tail) && Object.hasOwn(modules, file.name.replace(/\.json$/, ''))) candidates.push(file);
      let name;
      if (root === 'profiles') name = 'data/profiles/' + tail;
      else if (tail.startsWith('profiles/')) name = 'data/' + tail;
      else if (tail.startsWith('data/profiles/')) name = tail;
      if (name) { if (attachments.has(name)) throw new Error('IMPORT_DUPLICATE_FILES'); attachments.set(name, file); }
    }
    const documents = {}; let bytes = 0;
    for (const file of candidates) {
      const kind = file.name.replace(/\.json$/, '');
      if (!Object.hasOwn(modules, kind)) throw new Error('IMPORT_UNKNOWN_FILE');
      if (file.size > 20 * 1024 * 1024) throw new Error('TOO_LARGE');
      let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('INVALID_DATA'); }
      if (Object.hasOwn(documents, kind)) {
        // The same file may be selected explicitly and found in the chosen folder.
        if (JSON.stringify(documents[kind]) !== JSON.stringify(data)) throw new Error('IMPORT_DUPLICATE_FILES');
      } else { bytes += file.size; if (bytes > 20 * 1024 * 1024) throw new Error('TOO_LARGE'); documents[kind] = data; }
    }
    if (!Object.keys(documents).length) throw new Error('IMPORT_NO_MODULES');
    const selected = new Map();
    const index = documents['package-instructions'];
    if (index && typeof index === 'object' && !Array.isArray(index)) {
      if (Object.keys(index).length && !folderInput.files.length) throw new Error('IMPORT_FOLDER_REQUIRED');
      for (const profile of Object.values(index)) {
        if (!profile || typeof profile.folderName !== 'string' || !Array.isArray(profile.images)) throw new Error('INVALID_DATA');
        const prefix = 'data/profiles/' + profile.folderName + '/';
        for (const leaf of ['instruction.txt', ...profile.images]) if (attachments.has(prefix + leaf)) selected.set(prefix + leaf, attachments.get(prefix + leaf));
      }
    }
    let total = 0; const files = [], metadata = [];
    for (const [name, file] of selected) {
      total += file.size;
      if (file.size > 20 * 1024 * 1024 || total > 1024 * 1024 * 1024 || files.length >= 5000) throw new Error('TOO_LARGE');
      files.push(file); metadata.push({path: name, size: file.size, mime: file.type || 'application/octet-stream'});
    }
    const payload = {id: crypto.randomUUID(), documents, files: metadata, includeSettings: settings.checked};
    if (new Blob([JSON.stringify(payload)]).size > 20 * 1024 * 1024) throw new Error('TOO_LARGE');
    return {payload, files};
  }
  function fail(error) {
    const messages = {
      REPORT_CONFLICT: 'Данните са променени или има конфликт. Провери импорта отново.',
      INVALID_DATA: 'Невалиден файл или структура. Данните в сайта не са променени.',
      INVALID_PATH: 'Невалиден път на приложение. Данните в сайта не са променени.',
      IMPORT_FILES_MISSING: 'Липсват посочени приложения. Избери и папката с инструкциите.',
      IMPORT_FOLDER_REQUIRED: 'За импорта на инструкции избери и папката с профилите.',
      IMPORT_DUPLICATE_FILES: 'Избрани са различни копия на един и същ файл. Остави само актуалното копие.',
      IMPORT_UNKNOWN_FILE: 'Избери JSON файлове с имената, показани в таблицата.',
      IMPORT_NO_MODULES: 'Не са избрани файлове за модулите.',
      IMPORT_EXPIRED: 'Подготвеният импорт е изтекъл. Провери избраните файлове отново.',
      IMPORT_LIMIT: 'Има твърде много незавършени импорти. Откажи стария импорт или опитай след 4 часа.',
      TOO_LARGE: 'Избраните файлове надвишават показаните ограничения.',
      BACKUP_FAILED: 'Резервното копие не успя. Нищо не е добавено.',
      FORBIDDEN: 'Акаунтът няма право за тази промяна.'
    };
    say(messages[error.code || error.message] || 'Връзката е прекъсната. Провери импорта отново преди нов опит.');
    if (error.code === 'IMPORT_EXPIRED') { batch = prepared = null; uploaded.clear(); }
  }
  document.getElementById('dataImportForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const run = ++sequence; checked = null; controller = new AbortController(); lock(true); say('Подготовка и качване…');
    try {
      if (!prepared) prepared = await prepare();
      if (!batch) { const created = await request('/api/import/batches', 'POST', prepared.payload); batch = created.id; }
      progress.hidden = false; progress.max = Math.max(1, prepared.files.length); progress.value = uploaded.size;
      for (const [index, file] of prepared.files.entries()) {
        if (!uploaded.has(index)) { await request(route('files/' + index), 'PUT', file, true); uploaded.add(index); progress.value = uploaded.size; }
      }
      const result = await request(route('preview'), 'POST', {});
      if (run !== sequence) return;
      checked = result; table(result); progress.value = progress.max;
      say(result.conflicts ? 'Има конфликти. Нищо няма да бъде добавено.' : result.files.missing ? 'Липсват посочени приложения. Избери и папката с инструкциите.' : result.canApply ? 'Данните са проверени. Потвърди общото добавяне.' : 'Избраните данни вече са добавени.');
    } catch (error) { if (run === sequence) fail(error); }
    finally { if (run === sequence) { controller = null; lock(false); } }
  });
  confirm.addEventListener('click', async () => {
    if (busy || !checked?.canApply) return;
    const run = ++sequence; controller = new AbortController(); lock(true); say('Добавяне…');
    try {
      const result = await request(route('apply'), 'POST', {token: checked.token});
      if (run !== sequence) return;
      table(result); batch = prepared = checked = null; uploaded.clear();
      say('Всички избрани данни са добавени. Провери модулите и отчетите.');
    } catch (error) { if (run === sequence) { checked = null; fail(error); } }
    finally { if (run === sequence) { controller = null; lock(false); } }
  });
  cancel.addEventListener('click', async () => { if (busy) return; lock(true); await discard(); table(); progress.hidden = true; say('Импортът е отказан. Данните в сайта не са променени.'); lock(false); });
  table();
})();
