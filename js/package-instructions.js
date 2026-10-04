function applyPackageInstructionsAdminUI(admin) {
  el.addBtn.style.display = admin ? '' : 'none';
  bulkEl.bulkBtn.style.display = admin ? '' : 'none';
}

const el = {
  connDot: document.getElementById('connDot'),
  connText: document.getElementById('connText'),
  openFileBtn: document.getElementById('openFileBtn'),
  createFileBtn: document.getElementById('createFileBtn'),
  reconnectBtn: document.getElementById('reconnectBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  connNote: document.getElementById('connNote'),

  searchInput: document.getElementById('searchInput'),
  addBtn: document.getElementById('addBtn'),
  resultCount: document.getElementById('resultCount'),
  resultsWrap: document.getElementById('resultsWrap'),

  formPanel: document.getElementById('formPanel'),
  formTitle: document.getElementById('formTitle'),
  numberInput: document.getElementById('numberInput'),
  nameInput: document.getElementById('nameInput'),
  clientInput: document.getElementById('clientInput'),
  categoryInput: document.getElementById('categoryInput'),
  textInput: document.getElementById('textInput'),
  imageFileInput: document.getElementById('imageFileInput'),
  thumbGrid: document.getElementById('thumbGrid'),
  formMsg: document.getElementById('formMsg'),
  saveBtn: document.getElementById('saveBtn'),
  cancelBtn: document.getElementById('cancelBtn'),

  lightbox: document.getElementById('lightbox'),
  lightboxImg: document.getElementById('lightboxImg'),
  lightboxCap: document.getElementById('lightboxCap'),
  lightboxClose: document.getElementById('lightboxClose')
};

let dbIndex = {};
let rootDirHandle = null;
let selectedImageFiles = [];

const detailsCache = {};

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];

function isImageName(name) {
  const lower = name.toLowerCase();
  return IMAGE_EXT.some(ext => lower.endsWith(ext));
}

function fileIconFor(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return '📄';
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return '📝';
  return '📎';
}

const CATEGORY_LABELS = {
  standard: 'Стандартен',
  special: 'Специален'
};

function categoryBadgeHtml(category) {
  if (category === 'standard') return `<span class="cat-badge cat-standard">${CATEGORY_LABELS.standard}</span>`;
  if (category === 'special') return `<span class="cat-badge cat-special">${CATEGORY_LABELS.special}</span>`;
  return '<span class="cat-badge cat-none">Некатегоризиран</span>';
}

// Използва се при bulk импорт И при първоначално разпознаване на папките —
// генерира уникален вътрешен идентификатор, когато няма (или не е разпознат) номер.
function generateUniqueFallbackNumber() {
  let candidate;
  do {
    candidate = 'AUTO' + Math.floor(100000 + Math.random() * 900000);
  } while (dbIndex[candidate]);
  return candidate;
}

const sync = createDirectorySync({
  dbName: 'portfolio-package-instructions-fs',
  defaultData: () => ({}),
  onConnect: async (data, handle) => {
    rootDirHandle = handle;

    if (data && Object.keys(data).length) {
      dbIndex = data;
    } else {
      dbIndex = await rebuildIndexFromFolders();
      await saveIndexDatabase();
    }
  },
  onRefresh: (data) => {
    dbIndex = data || {};
    renderSearch();
  },
  render: () => {
    renderSearch();
  },
  elements: el
});

sync.init();

// Безопасен запис: винаги чете НАЙ-АКТУАЛНОТО от диска непосредствено преди запис,
// прилага промяната върху него (не върху евентуално остарялото копие в паметта),
// и чак тогава записва. Това силно смалява прозореца, в който двама души,
// работещи едновременно от различни компютри, биха презаписали промените си взаимно.
async function readIndexFromDisk() {
  try {
    const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
    const fileHandle = await dataDir.getFileHandle('package-instructions.json', { create: true });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text.trim() ? JSON.parse(text) : {};
  } catch (err) {
    console.error('Грешка при четене на индекса от диска:', err);
    return {};
  }
}

async function updateIndexOnDisk(mutatorFn) {
  if (!rootDirHandle) return;
  const latest = await readIndexFromDisk();
  mutatorFn(latest);

  try {
    const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
    const fileHandle = await dataDir.getFileHandle('package-instructions.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(latest, null, 2));
    await writable.close();
  } catch (err) {
    console.error('Грешка при запис на индекса:', err);
    throw err;
  }

  dbIndex = latest; // локалната памет вече е синхронизирана с реално записаното
}

// Запазена за съвместимост там, където просто искаме да запишем текущия dbIndex както е.
// НЕ Я използвай за единични промени — предпочитай updateIndexOnDisk(), за да избегнеш
// презаписване на промени от друг компютър.
async function saveIndexDatabase() {
  await updateIndexOnDisk((latest) => {
    Object.assign(latest, dbIndex);
  });
}

// Навигира до подпапка по релативен път, който може да съдържа '/'
async function resolveNestedDirHandle(baseHandle, relativePath, create) {
  const parts = String(relativePath).split('/').filter(Boolean);
  let handle = baseHandle;
  for (const part of parts) {
    handle = await handle.getDirectoryHandle(part, { create: !!create });
  }
  return handle;
}

async function getProfileFolderHandle(folderName) {
  const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
  const profilesDir = await dataDir.getDirectoryHandle('profiles', { create: true });
  return resolveNestedDirHandle(profilesDir, folderName, false);
}

// ------------------------------------------------------------------
// АВТОМАТИЧНО РАЗПОЗНАВАНЕ ПРИ ПЪРВО СВЪРЗВАНЕ (ако няма index файл)
// ------------------------------------------------------------------
// Прескача през data/profiles по същата двустепенна логика като bulk импорта
// и построява целия dbIndex от нулата — без да изисква номер за никой профил.
async function rebuildIndexFromFolders() {
  const freshIndex = {};
  if (!rootDirHandle) return freshIndex;

  try {
    const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
    const profilesDir = await dataDir.getDirectoryHandle('profiles', { create: true });

    const { candidates } = await scanCandidatesFromDir(profilesDir, { copyNeeded: false, skipExisting: false });

    candidates.forEach(c => {
      const number = c.number || ('AUTO' + Math.floor(100000 + Math.random() * 900000));
      freshIndex[number] = {
        number,
        name: c.name,
        client: c.client || '',
        category: c.category || null,
        folderName: c.originalPath,
        images: c.files,
        timestamp: Date.now()
      };
    });
  } catch (err) {
    console.error('Грешка при автоматично разпознаване на папките:', err);
  }

  return freshIndex;
}

el.addBtn.addEventListener('click', () => {
  if (!rootDirHandle) {
    alert("Please connect to the network folder first!");
    return;
  }
  el.formPanel.style.display = 'block';
  el.formTitle.textContent = "Нов профил";
  el.numberInput.value = '';
  el.nameInput.value = '';
  el.clientInput.value = '';
  el.categoryInput.value = '';
  el.textInput.value = '';
  el.imageFileInput.value = '';
  selectedImageFiles = [];
  renderThumbs();
  el.formMsg.textContent = '';
  el.formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

el.cancelBtn.addEventListener('click', () => {
  el.formPanel.style.display = 'none';
});

el.imageFileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  selectedImageFiles = selectedImageFiles.concat(files);
  renderThumbs();
});

function renderThumbs() {
  el.thumbGrid.innerHTML = '';
  selectedImageFiles.forEach((file, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb-item';

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      thumb.appendChild(img);
    } else {
      const fileBox = document.createElement('div');
      fileBox.className = 'thumb-file';
      fileBox.innerHTML = `
        <div class="thumb-file-icon">${fileIconFor(file.name)}</div>
        <div class="thumb-file-name">${escapeHtml(file.name)}</div>
      `;
      thumb.appendChild(fileBox);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'thumb-remove';
    delBtn.textContent = '✕';
    delBtn.onclick = () => {
      selectedImageFiles.splice(index, 1);
      renderThumbs();
    };

    thumb.appendChild(delBtn);
    el.thumbGrid.appendChild(thumb);
  });
}

// Save profile to folder — единично добавяне: номерът тук ОСТАВА като идентификатор,
// но ако е празен, ще му се генерира автоматичен (вместо да блокираме записа).
el.saveBtn.addEventListener('click', async () => {
  let number = el.numberInput.value.trim();
  const name = el.nameInput.value.trim();
  const client = el.clientInput.value.trim();
  const category = el.categoryInput.value;
  const instructions = el.textInput.value.trim();

  if (!category) {
    el.formMsg.textContent = "Избери категория (Стандартен / Специален)!";
    return;
  }

  if (!number) {
    number = generateUniqueFallbackNumber();
  }

  el.saveBtn.disabled = true;
  el.saveBtn.textContent = "Запазване...";
  el.formMsg.textContent = "Създаване на папки и запис на файлове...";

  try {
    const folderName = `${name || 'NoName'} - ${number}`;

    const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
    const profilesDir = await dataDir.getDirectoryHandle('profiles', { create: true });
    const profileFolder = await profilesDir.getDirectoryHandle(folderName, { create: true });

    if (instructions) {
      const textFileHandle = await profileFolder.getFileHandle('instruction.txt', { create: true });
      const textWritable = await textFileHandle.createWritable();
      await textWritable.write(instructions);
      await textWritable.close();
    }

    const savedImageNames = [];
    for (const file of selectedImageFiles) {
      const imgFileHandle = await profileFolder.getFileHandle(file.name, { create: true });
      const imgWritable = await imgFileHandle.createWritable();
      await imgWritable.write(file);
      await imgWritable.close();
      savedImageNames.push(file.name);
    }

    dbIndex[number] = {
      number: number,
      name: name,
      client: client,
      category: category,
      folderName: folderName,
      images: savedImageNames,
      timestamp: Date.now()
    };

    await saveIndexDatabase();
    delete detailsCache[number];

    el.formMsg.style.color = 'green';
    el.formMsg.textContent = "Профилът е записан успешно!";

    setTimeout(() => {
      el.formPanel.style.display = 'none';
      el.saveBtn.disabled = false;
      el.saveBtn.textContent = "Запази";
      renderSearch();
    }, 1500);

  } catch (error) {
    console.error(error);
    el.formMsg.style.color = 'red';
    el.formMsg.textContent = "Възникна грешка при запазването.";
    el.saveBtn.disabled = false;
    el.saveBtn.textContent = "Запази";
  }
});

// ------------------------------------------------------------------
// Търсене и показване на резултати (основно по ИМЕ/КЛИЕНТ, номерът е вторичен)
// ------------------------------------------------------------------

el.searchInput.addEventListener('input', () => {
  renderSearch();
});

const categoryChips = document.querySelectorAll('.chip[data-cat]');
categoryChips.forEach(chip => {
  chip.addEventListener('click', () => {
    activeCategoryFilter = chip.dataset.cat;
    categoryChips.forEach(c => c.classList.toggle('active', c === chip));
    renderSearch();
  });
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

let activeCategoryFilter = '';

function getFilteredProfiles() {
  const query = el.searchInput.value.trim().toLowerCase();
  let all = Object.values(dbIndex).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (activeCategoryFilter === 'none') {
    all = all.filter(p => !p.category);
  } else if (activeCategoryFilter) {
    all = all.filter(p => p.category === activeCategoryFilter);
  }

  if (!query) return all;

  return all.filter(profile => {
    const name = String(profile.name || '').toLowerCase();
    const client = String(profile.client || '').toLowerCase();
    const number = String(profile.number || '').toLowerCase();
    // Претегляме по име/клиент — номерът остава само допълнително съвпадение
    return name.includes(query) || client.includes(query) || number.includes(query);
  });
}

function renderSearch() {
  if (!rootDirHandle) {
    el.resultsWrap.innerHTML = '<div class="empty">Свържете папката с проекта, за да видите профилите.</div>';
    el.resultCount.textContent = '';
    return;
  }

  const profiles = getFilteredProfiles();

  el.resultCount.textContent = profiles.length
    ? `${profiles.length} резултат${profiles.length === 1 ? '' : 'а'}`
    : '';

  if (!profiles.length) {
    el.resultsWrap.innerHTML = '<div class="empty">Няма намерени профили.</div>';
    return;
  }

  el.resultsWrap.innerHTML = '';
  profiles.forEach(profile => {
    el.resultsWrap.appendChild(createResultCard(profile));
  });
}

function createResultCard(profile) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.dataset.number = profile.number;

  const imageCount = (profile.images || []).length;
  const metaText = imageCount ? `${imageCount} файл${imageCount === 1 ? '' : 'а'}` : 'без файлове';
  const clientHtml = profile.client
    ? `<div class="result-client">${escapeHtml(profile.client)}</div>`
    : '';

  card.innerHTML = `
    <div class="result-head">
      <div class="result-name-wrap">
        <div class="result-name">${escapeHtml(profile.name || 'Без име')}</div>
        ${clientHtml}
      </div>
      <div class="result-meta">${metaText}</div>
      ${categoryBadgeHtml(profile.category)}
      <div class="result-chevron">▶</div>
    </div>
    <div class="result-body"></div>
  `;

  const head = card.querySelector('.result-head');
  head.addEventListener('click', () => toggleCard(card, profile));

  return card;
}

async function toggleCard(card, profile) {
  const isOpen = card.classList.contains('open');

  el.resultsWrap.querySelectorAll('.result-card.open').forEach(other => {
    if (other !== card) other.classList.remove('open');
  });

  if (isOpen) {
    card.classList.remove('open');
    return;
  }

  card.classList.add('open');
  const body = card.querySelector('.result-body');

  if (detailsCache[profile.number]) {
    body.innerHTML = detailsCache[profile.number];
    wireGalleryClicks(body);
    wireCategorySelect(body, card, profile);
    return;
  }

  body.innerHTML = '<div class="empty">Зареждане…</div>';

  try {
    const html = await loadProfileDetailsHtml(profile);
    detailsCache[profile.number] = html;
    body.innerHTML = html;
    wireGalleryClicks(body);
    wireCategorySelect(body, card, profile);
  } catch (error) {
    console.error(error);
    body.innerHTML = '<div class="empty">Грешка при зареждане на папката на профила.</div>';
  }
}

function categorySelectHtml(profile) {
  const current = profile.category || '';
  return `
    <div class="cat-edit-row">
      <label for="catSelect-${escapeHtml(profile.number)}">Категория:</label>
      <select class="cat-select" id="catSelect-${escapeHtml(profile.number)}" data-number="${escapeHtml(profile.number)}">
        <option value="" ${current === '' ? 'selected' : ''}>Некатегоризиран</option>
        <option value="standard" ${current === 'standard' ? 'selected' : ''}>Стандартен</option>
        <option value="special" ${current === 'special' ? 'selected' : ''}>Специален</option>
      </select>
    </div>
  `;
}

function wireCategorySelect(body, card, profile) {
  const select = body.querySelector('.cat-select');
  if (!select) return;

  select.addEventListener('change', async (e) => {
    const newCategory = e.target.value || null;
    if (!dbIndex[profile.number]) return;

    dbIndex[profile.number].category = newCategory;
    profile.category = newCategory;
    await saveIndexDatabase();

    const badge = card.querySelector('.cat-badge');
    if (badge) badge.outerHTML = categoryBadgeHtml(newCategory);

    delete detailsCache[profile.number];
  });
}

async function loadProfileDetailsHtml(profile) {
  const profileFolder = await getProfileFolderHandle(profile.folderName);

  const numberHtml = `<div class="result-number-inline">№ ${escapeHtml(profile.number)}</div>`;

  let instructionText = '';
  try {
    const textFileHandle = await profileFolder.getFileHandle('instruction.txt', { create: false });
    const file = await textFileHandle.getFile();
    instructionText = await file.text();
  } catch (err) {
    instructionText = '';
  }

  const textHtml = instructionText
    ? `<div class="result-text">${escapeHtml(instructionText)}</div>`
    : '<div class="result-text empty" style="text-align:left;padding:0;">Няма записан текст с инструкции.</div>';

  const galleryItems = [];
  for (const imgName of (profile.images || [])) {
    try {
      const fileHandle = await profileFolder.getFileHandle(imgName, { create: false });
      const file = await fileHandle.getFile();

      if (isImageName(imgName)) {
        const url = URL.createObjectURL(file);
        galleryItems.push(`
          <figure>
            <img src="${url}" data-full="${url}" data-caption="${escapeHtml(imgName)}" alt="${escapeHtml(imgName)}">
            <figcaption>${escapeHtml(imgName)}</figcaption>
          </figure>
        `);
      } else {
        const url = URL.createObjectURL(file);
        galleryItems.push(`
          <a class="file-tile" href="${url}" download="${escapeHtml(imgName)}">
            <div class="file-tile-icon">${fileIconFor(imgName)}</div>
            <div class="file-tile-name">${escapeHtml(imgName)}</div>
          </a>
        `);
      }
    } catch (err) {
      console.warn('Файлът липсва на диска:', imgName);
    }
  }

  const galleryHtml = galleryItems.length
    ? `<div class="gallery">${galleryItems.join('')}</div>`
    : '';

  return `${numberHtml}${categorySelectHtml(profile)}${textHtml}${galleryHtml}`;
}

function wireGalleryClicks(scopeEl) {
  scopeEl.querySelectorAll('.gallery img').forEach(img => {
    img.addEventListener('click', () => {
      el.lightboxImg.src = img.dataset.full;
      el.lightboxCap.textContent = img.dataset.caption || '';
      el.lightbox.classList.add('open');
    });
  });
}

el.lightboxClose.addEventListener('click', () => {
  el.lightbox.classList.remove('open');
});
el.lightbox.addEventListener('click', (e) => {
  if (e.target === el.lightbox) el.lightbox.classList.remove('open');
});

// ------------------------------------------------------------------
// BULK ИМПОРТ — разпознаване на съществуващи папки и масово добавяне
// ------------------------------------------------------------------

const bulkEl = {
  bulkBtn: document.getElementById('bulkBtn'),
  bulkPanel: document.getElementById('bulkPanel'),
  scanLocalBtn: document.getElementById('scanLocalBtn'),
  scanExternalBtn: document.getElementById('scanExternalBtn'),
  bulkResults: document.getElementById('bulkResults'),
  bulkStatus: document.getElementById('bulkStatus'),
  bulkImportBtn: document.getElementById('bulkImportBtn'),
  bulkCancelBtn: document.getElementById('bulkCancelBtn'),
  bulkSelectAll: document.getElementById('bulkSelectAll')
};

// Сега 'el' и 'bulkEl' вече съществуват — безопасно е да закачим admin режима.
// isAdminMode() / wireAdminToggle() идват от js/file-sync.js (споделени).
wireAdminToggle(document.getElementById('adminToggleBtn'), applyPackageInstructionsAdminUI);

let bulkCandidates = [];

function parseProfileFolderName(folderName) {
  const digitMatches = folderName.match(/\d+/g) || [];
  let longest = '';
  digitMatches.forEach(d => { if (d.length > longest.length) longest = d; });

  const idx = folderName.lastIndexOf(' - ');
  if (idx !== -1) {
    const tail = folderName.slice(idx + 3).trim();
    if (tail === longest) {
      return { name: folderName.slice(0, idx).trim(), number: tail };
    }
  }

  return { name: folderName, number: longest };
}

async function inspectFolderDirect(handle) {
  let instructionText = '';
  try {
    const txtHandle = await handle.getFileHandle('instruction.txt');
    const file = await txtHandle.getFile();
    instructionText = await file.text();
  } catch (e) { /* няма instruction.txt — ОК */ }

  const files = [];
  for await (const [fname, fhandle] of handle.entries()) {
    if (fhandle.kind === 'file' && fname !== 'instruction.txt') {
      files.push(fname);
    }
  }
  return { instructionText, files };
}

async function scanCandidatesFromDir(dirHandle, { copyNeeded, skipExisting }) {
  const results = [];
  let skippedEmpty = 0;

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'directory') continue;

    const direct = await inspectFolderDirect(handle);
    const isProfileItself = direct.instructionText.trim() || direct.files.length > 0;

    if (isProfileItself) {
      const parsed = parseProfileFolderName(name);
      if (skipExisting && parsed.number && dbIndex[parsed.number]) continue;

      results.push({
        client: '',
        originalPath: name,
        sourceHandle: handle,
        name: parsed.name,
        number: parsed.number,
        category: '',
        instructionText: direct.instructionText,
        files: direct.files,
        copyNeeded
      });
      continue;
    }

    let foundAnySubfolder = false;
    for await (const [subName, subHandle] of handle.entries()) {
      if (subHandle.kind !== 'directory') continue;
      foundAnySubfolder = true;

      const subDirect = await inspectFolderDirect(subHandle);
      if (!subDirect.instructionText.trim() && subDirect.files.length === 0) {
        skippedEmpty++;
        continue;
      }

      const parsed = parseProfileFolderName(subName);
      if (skipExisting && parsed.number && dbIndex[parsed.number]) continue;

      results.push({
        client: name,
        originalPath: `${name}/${subName}`,
        sourceHandle: subHandle,
        name: parsed.name,
        number: parsed.number,
        category: '',
        instructionText: subDirect.instructionText,
        files: subDirect.files,
        copyNeeded
      });
    }

    if (!foundAnySubfolder) skippedEmpty++;
  }

  return { candidates: results, skippedEmpty };
}

function openBulkPanel() {
  if (!rootDirHandle) {
    alert('Свържете папката с проекта първо.');
    return;
  }
  bulkEl.bulkPanel.style.display = 'block';
  bulkEl.bulkResults.innerHTML = '<div class="empty">Избери откъде да сканираме — виж бутоните горе.</div>';
  bulkEl.bulkStatus.textContent = '';
  bulkCandidates = [];
  bulkEl.bulkPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

bulkEl.bulkBtn.addEventListener('click', openBulkPanel);
bulkEl.bulkCancelBtn.addEventListener('click', () => {
  bulkEl.bulkPanel.style.display = 'none';
});

bulkEl.scanLocalBtn.addEventListener('click', async () => {
  try {
    bulkEl.bulkStatus.textContent = 'Сканиране на data/profiles...';
    const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
    const profilesDir = await dataDir.getDirectoryHandle('profiles', { create: true });
    const { candidates, skippedEmpty } = await scanCandidatesFromDir(profilesDir, { copyNeeded: false, skipExisting: true });
    bulkCandidates = candidates;
    renderBulkCandidates(skippedEmpty);
  } catch (error) {
    console.error(error);
    bulkEl.bulkStatus.textContent = 'Грешка при сканиране.';
  }
});

bulkEl.scanExternalBtn.addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    alert('Браузърът не поддържа избор на папка (нужен е Chrome/Edge).');
    return;
  }
  try {
    const externalDir = await window.showDirectoryPicker();
    bulkEl.bulkStatus.textContent = 'Сканиране на избраната папка...';
    const { candidates, skippedEmpty } = await scanCandidatesFromDir(externalDir, { copyNeeded: true, skipExisting: false });
    bulkCandidates = candidates;
    renderBulkCandidates(skippedEmpty);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error(error);
    bulkEl.bulkStatus.textContent = 'Грешка при сканиране.';
  }
});

function renderBulkCandidates(skippedEmpty) {
  skippedEmpty = skippedEmpty || 0;
  const skippedNote = skippedEmpty
    ? ` 🗑️ ${skippedEmpty} празни папки бяха пропуснати автоматично.`
    : '';

  if (!bulkCandidates.length) {
    bulkEl.bulkResults.innerHTML = '<div class="empty">Няма намерени папки за импортиране.</div>';
    bulkEl.bulkStatus.textContent = skippedNote.trim();
    return;
  }

  bulkEl.bulkStatus.textContent = `Намерени ${bulkCandidates.length} папки.${skippedNote}`;

  bulkEl.bulkResults.innerHTML = bulkCandidates.map((c, i) => {
    const conflict = c.number && dbIndex[c.number];
    return `
      <div class="bulk-row" data-idx="${i}">
        <input type="checkbox" class="bulk-check" ${conflict ? '' : 'checked'} data-idx="${i}">
        <input type="text" class="bulk-number" placeholder="номер (по избор)" value="${escapeHtml(c.number)}" data-idx="${i}">
        <div class="bulk-name-col">
          <input type="text" class="bulk-name" placeholder="име" value="${escapeHtml(c.name)}" data-idx="${i}">
          <input type="text" class="bulk-client" placeholder="клиент (по избор)" value="${escapeHtml(c.client)}" data-idx="${i}">
        </div>
        <select class="bulk-category" data-idx="${i}">
          <option value="" ${!c.category ? 'selected' : ''}>Некатегоризиран</option>
          <option value="standard" ${c.category === 'standard' ? 'selected' : ''}>Стандартен</option>
          <option value="special" ${c.category === 'special' ? 'selected' : ''}>Специален</option>
        </select>
        <span class="bulk-filecount">${c.files.length} файл${c.files.length === 1 ? '' : 'а'}${c.instructionText ? ', текст ✓' : ''}</span>
        ${conflict ? '<span class="bulk-conflict">⚠ номерът вече съществува</span>' : ''}
      </div>
    `;
  }).join('');

  bulkEl.bulkResults.querySelectorAll('.bulk-number').forEach(input => {
    input.addEventListener('input', (e) => {
      bulkCandidates[e.target.dataset.idx].number = e.target.value.trim();
      refreshConflictBadge(e.target.dataset.idx);
    });
  });
  bulkEl.bulkResults.querySelectorAll('.bulk-name').forEach(input => {
    input.addEventListener('input', (e) => {
      bulkCandidates[e.target.dataset.idx].name = e.target.value.trim();
    });
  });
  bulkEl.bulkResults.querySelectorAll('.bulk-client').forEach(input => {
    input.addEventListener('input', (e) => {
      bulkCandidates[e.target.dataset.idx].client = e.target.value.trim();
    });
  });
  bulkEl.bulkResults.querySelectorAll('.bulk-category').forEach(select => {
    select.addEventListener('change', (e) => {
      bulkCandidates[e.target.dataset.idx].category = e.target.value;
    });
  });
}

function refreshConflictBadge(idx) {
  const row = bulkEl.bulkResults.querySelector(`.bulk-row[data-idx="${idx}"]`);
  if (!row) return;
  const c = bulkCandidates[idx];
  const existingBadge = row.querySelector('.bulk-conflict');
  const conflict = c.number && dbIndex[c.number];
  if (conflict && !existingBadge) {
    row.insertAdjacentHTML('beforeend', '<span class="bulk-conflict">⚠ номерът вече съществува</span>');
  } else if (!conflict && existingBadge) {
    existingBadge.remove();
  }
}

bulkEl.bulkSelectAll.addEventListener('change', (e) => {
  bulkEl.bulkResults.querySelectorAll('.bulk-check').forEach(cb => { cb.checked = e.target.checked; });
});

// Импортиране — номерът вече НЕ Е задължителен. Ако е празен, всеки избран
// кандидат получава автоматично генериран уникален идентификатор.
bulkEl.bulkImportBtn.addEventListener('click', async () => {
  const checkedIdxs = Array.from(bulkEl.bulkResults.querySelectorAll('.bulk-check:checked'))
    .map(cb => parseInt(cb.dataset.idx, 10));

  if (!checkedIdxs.length) {
    bulkEl.bulkStatus.textContent = 'Няма избрани папки за импорт.';
    return;
  }

  bulkEl.bulkImportBtn.disabled = true;
  const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
  const profilesDir = await dataDir.getDirectoryHandle('profiles', { create: true });

  let done = 0;
  for (const idx of checkedIdxs) {
    const c = bulkCandidates[idx];
    if (!c.number) c.number = generateUniqueFallbackNumber();

    bulkEl.bulkStatus.textContent = `Импортиране ${done + 1} от ${checkedIdxs.length}: ${c.name || c.number}...`;

    try {
      let destPath;
      let savedImageNames = c.files;

      if (c.copyNeeded) {
        destPath = c.originalPath;
        const destFolderHandle = await resolveNestedDirHandle(profilesDir, destPath, true);

        if (c.instructionText) {
          const txtHandle = await destFolderHandle.getFileHandle('instruction.txt', { create: true });
          const w = await txtHandle.createWritable();
          await w.write(c.instructionText);
          await w.close();
        }

        savedImageNames = [];
        for (const fname of c.files) {
          const srcFileHandle = await c.sourceHandle.getFileHandle(fname);
          const srcFile = await srcFileHandle.getFile();
          const destFileHandle = await destFolderHandle.getFileHandle(fname, { create: true });
          const w = await destFileHandle.createWritable();
          await w.write(srcFile);
          await w.close();
          savedImageNames.push(fname);
        }
      } else {
        destPath = c.originalPath;
      }

      dbIndex[c.number] = {
        number: c.number,
        name: c.name,
        client: c.client || '',
        category: c.category || null,
        folderName: destPath,
        images: savedImageNames,
        timestamp: Date.now()
      };
      delete detailsCache[c.number];

      done++;
    } catch (error) {
      console.error(`Грешка при импорт на ${c.number}:`, error);
    }
  }

  await saveIndexDatabase();
  bulkEl.bulkStatus.textContent = `Готово — импортирани ${done} от ${checkedIdxs.length}.`;
  bulkEl.bulkImportBtn.disabled = false;

  setTimeout(() => {
    bulkEl.bulkPanel.style.display = 'none';
    renderSearch();
  }, 1200);
});