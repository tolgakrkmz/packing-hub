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
let instructionsWriting = false;
const profilePageSize = 50;
let profilePage = 1, profileSearchTimer;

const detailsCache = Object.create(null);

function clearDetailsCache() {
  Object.keys(detailsCache).forEach(key => delete detailsCache[key]);
}

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

// Generate an internal identifier when a profile number is unavailable.
function generateUniqueFallbackNumber() {
  let candidate;
  do {
    candidate = 'AUTO' + Math.floor(100000 + Math.random() * 900000);
  } while (Object.hasOwn(dbIndex, candidate));
  return candidate;
}

const sync = createDirectorySync({
  isBusy: () => instructionsWriting,
  dbName: 'portfolio-package-instructions-fs',
  defaultData: () => ({}),
  onConnect: async (data, handle) => {
    rootDirHandle = handle;

    dbIndex = data;
  },
  onRefresh: (data) => {
    dbIndex = data || {};
    clearDetailsCache();
  },
  render: () => {
    renderSearch();
  },
  elements: el
});

sync.init();

async function readIndexFromDisk() {
  const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: false });
  const fileHandle = await dataDir.getFileHandle('package-instructions.json', { create: false });
  const file = await fileHandle.getFile();
  return HubDataValidation.parse('package-instructions',await file.text());
}

// Keep the same file handle so the server checks the revision read here.
async function updateIndexOnDisk(mutatorFn) {
  if (!rootDirHandle) return;
  const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: false });
  const fileHandle = await dataDir.getFileHandle('package-instructions.json', { create: false });
  const file = await fileHandle.getFile();
  const latest = HubDataValidation.parse('package-instructions',await file.text());
  mutatorFn(latest);
  HubDataValidation.validate('package-instructions',latest);

  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(latest, null, 2));
    await writable.close();
  } catch (err) {
    console.error('Грешка при запис на индекса:', err);
    throw err;
  }

  dbIndex = latest;
}

/* Append new folders without replacing another customer's profile. */
async function saveIndexDatabase(numbers) {
  const edits = Object.fromEntries(numbers.map(number => [number, JSON.parse(JSON.stringify(dbIndex[number]))]));
  const previous = {...dbIndex};
  numbers.forEach(number => delete previous[number]);
  try {
    await updateIndexOnDisk((latest) => {
      for (const number of numbers) {
        if (Object.hasOwn(latest, number) || HubInstructionFolders.existingKey(latest, edits[number].folderName) !== undefined) {
          throw new Error('Instruction folder already indexed');
        }
        latest[number] = edits[number];
      }
    });
  } catch (error) {
    dbIndex = await readIndexFromDisk().catch(() => previous);
    throw error;
  }
}

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

document.getElementById('addAttachmentBtn').addEventListener('click', () => el.imageFileInput.click());

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
        <div class="thumb-file-name" translate="no">${escapeHtml(file.name)}</div>
      `;
      thumb.appendChild(fileBox);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'thumb-remove';
    delBtn.type = 'button';
    delBtn.textContent = '✕';
    delBtn.setAttribute('aria-label', 'Премахни файл');
    delBtn.onclick = () => {
      selectedImageFiles.splice(index, 1);
      renderThumbs();
    };

    thumb.appendChild(delBtn);
    el.thumbGrid.appendChild(thumb);
  });
}

// Retain supplied profile numbers; generate an identifier when none is supplied.
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
  instructionsWriting = true;
  el.saveBtn.textContent = "Запазване...";
  el.formMsg.textContent = "Създаване на папки и запис на файлове...";

  try {
    dbIndex = await readIndexFromDisk();
    const key = HubInstructionFolders.allocateKey(dbIndex, number);
    const folderName = [client, `${name || 'NoName'} - ${number}`].filter(Boolean).join('/');
    if (HubInstructionFolders.existingKey(dbIndex, folderName) !== undefined) {
      el.formMsg.textContent = 'Папката вече е в индекса. Избери друго име.';
      el.saveBtn.disabled = false; el.saveBtn.textContent = 'Запази';
      return;
    }

    const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
    const profilesDir = await dataDir.getDirectoryHandle('profiles', { create: true });
    const profileFolder = await resolveNestedDirHandle(profilesDir, folderName, true);

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

    dbIndex[key] = {
      number: number,
      name: name,
      client: client,
      category: category,
      folderName: folderName,
      images: savedImageNames,
      timestamp: Date.now()
    };

    await saveIndexDatabase([key]);
    delete detailsCache[folderName];

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
  } finally { instructionsWriting = false; }
});


el.searchInput.addEventListener('input', () => {
  profilePage = 1;
  clearTimeout(profileSearchTimer);
  el.resultsWrap.setAttribute('aria-busy', 'true');
  profileSearchTimer = setTimeout(renderSearch, 150);
});

const categoryChips = document.querySelectorAll('.chip[data-cat]');
categoryChips.forEach(chip => {
  chip.addEventListener('click', () => {
    activeCategoryFilter = chip.dataset.cat;
    profilePage = 1;
    categoryChips.forEach(c => c.classList.toggle('active', c === chip));
    renderSearch();
  });
});

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
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
    const files = (profile.images || []).join(' ').toLowerCase();
    return name.includes(query) || client.includes(query) || number.includes(query) || files.includes(query);
  });
}

function renderSearch() {
  clearTimeout(profileSearchTimer);
  profileSearchTimer = null;
  el.resultsWrap.removeAttribute('aria-busy');
  if (!rootDirHandle) {
    el.resultsWrap.innerHTML = '<div class="empty">Свържете папката с проекта, за да видите профилите.</div>';
    el.resultCount.textContent = '';
    return;
  }

  globalThis.HubNotificationTarget?.select(Object.values(dbIndex), profile => profile.folderName, profile => {
    el.searchInput.value = ''; activeCategoryFilter = '';
    categoryChips.forEach(chip => chip.classList.toggle('active', !chip.dataset.cat));
    profilePage = Math.floor(getFilteredProfiles().indexOf(profile) / profilePageSize) + 1;
  });
  const profiles = getFilteredProfiles();
  profilePage = HubListPagination.clamp(profilePage, profiles.length, profilePageSize);

  el.resultCount.textContent = profiles.length
    ? `${profiles.length} резултат${profiles.length === 1 ? '' : 'а'}`
    : '';

  if (!profiles.length) {
    el.resultsWrap.innerHTML = '<div class="empty">Няма намерени профили.</div>';
    return;
  }

  el.resultsWrap.innerHTML = '';
  profiles.slice((profilePage - 1) * profilePageSize, profilePage * profilePageSize).forEach(profile => {
    el.resultsWrap.appendChild(createResultCard(profile));
  });
  el.resultsWrap.appendChild(profilePagination(profiles.length));
  const target = globalThis.HubNotificationTarget;
  if (target?.id) {
    const profile = profiles.find(value => value.folderName === target.id);
    const card = [...el.resultsWrap.querySelectorAll('.result-card')].find(value => value.dataset.folder === target.id);
    if (profile && card) { toggleCard(card, profile); target.reveal(el.resultsWrap); }
  }
}

function profilePagination(total) {
  return HubListPagination.create({id: 'profilePagination', page: profilePage,
    total, size: profilePageSize, onChange: page => { profilePage = page; renderSearch(); }});
}
document.addEventListener('click', event => {
  const pager = document.getElementById('profilePagination');
  if (pager && event.target.closest('[data-hub-language]')) pager.replaceWith(profilePagination(Number(pager.dataset.total)));
});

function createResultCard(profile) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.dataset.number = profile.number;
  card.dataset.folder = profile.folderName;
  card.dataset.notificationTarget = profile.folderName;

  const imageCount = (profile.images || []).length;
  const metaText = imageCount ? `${imageCount} файл${imageCount === 1 ? '' : 'а'}` : 'без файлове';
  const clientHtml = profile.client
    ? `<div class="result-client" translate="no">${escapeHtml(profile.client)}</div>`
    : '';

  card.innerHTML = `
    <div class="result-head">
      <div class="result-name-wrap">
        <div class="result-name" ${profile.name ? 'translate="no"' : ''}>${escapeHtml(profile.name || 'Без име')}</div>
        ${clientHtml}
      </div>
      <div class="result-meta">${metaText}</div>
      ${categoryBadgeHtml(profile.category)}
      <div class="result-chevron">▶</div>
    </div>
    <div class="result-body"></div>
  `;

  const head = card.querySelector('.result-head');
  head.addEventListener('click', () => {
    // Apply a pending search before opening details, so its timer cannot remove the preview.
    if (profileSearchTimer) {
      renderSearch();
      const current = [...el.resultsWrap.querySelectorAll('.result-card')].find(node => node.dataset.folder === profile.folderName);
      if (current) toggleCard(current, profile);
    } else toggleCard(card, profile);
  });

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

  if (detailsCache[profile.folderName]) {
    body.innerHTML = detailsCache[profile.folderName];
    wireGalleryClicks(body);
    wireCategorySelect(body, card, profile);
    return;
  }

  body.innerHTML = '<div class="empty">Зареждане…</div>';

  try {
    const html = await loadProfileDetailsHtml(profile);
    detailsCache[profile.folderName] = html;
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
  const selectId = 'catSelect-' + encodeURIComponent(profile.folderName);
  return `
    <div class="cat-edit-row">
      <label for="${escapeHtml(selectId)}">Категория:</label>
      <select class="cat-select" id="${escapeHtml(selectId)}" data-number="${escapeHtml(profile.number)}">
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
    const key = HubInstructionFolders.existingKey(dbIndex, profile.folderName);
    if (key === undefined) return;

    const previous = profile.category;
    instructionsWriting = true; select.disabled = true;
    try {
      await updateIndexOnDisk(latest => {
        if(!Object.hasOwn(latest, key) || latest[key].folderName !== profile.folderName) throw new Error('Profile unavailable');
        latest[key].category = newCategory;
      });
      profile.category = newCategory;
      const badge = card.querySelector('.cat-badge');
      if (badge) badge.outerHTML = categoryBadgeHtml(newCategory);
      delete detailsCache[profile.folderName];
    } catch {
      select.value = previous || '';
      el.resultCount.textContent = 'Записът не е направен. Опитай отново.';
    } finally { instructionsWriting = false; select.disabled = false; }
  });
}

async function loadProfileDetailsHtml(profile) {
  const profileFolder = await getProfileFolderHandle(profile.folderName);

  const numberHtml = `<div class="result-number-inline" translate="no">№ ${escapeHtml(profile.number)}</div>`;

  let instructionText = '';
  try {
    const textFileHandle = await profileFolder.getFileHandle('instruction.txt', { create: false });
    const file = await textFileHandle.getFile();
    instructionText = await file.text();
  } catch (err) {
    instructionText = '';
  }

  const textHtml = instructionText
    ? `<div class="result-text" translate="no">${escapeHtml(instructionText)}</div>`
    : '<div class="result-text empty" style="text-align:left;padding:0;">Няма записан текст с инструкции.</div>';

  const galleryItems = [];
  for (const imgName of (profile.images || [])) {
    try {
      const fileHandle = await HubInstructionFolders.fileHandle(profileFolder, imgName);
      const file = await fileHandle.getFile();

      if (isImageName(imgName)) {
        const url = URL.createObjectURL(file);
        galleryItems.push(`
          <figure>
            <img translate="no" src="${url}" data-full="${url}" data-caption="${escapeHtml(imgName)}" alt="${escapeHtml(imgName)}">
            <figcaption translate="no">${escapeHtml(imgName)}</figcaption>
          </figure>
        `);
      } else {
        const url = URL.createObjectURL(file);
        galleryItems.push(`
          <a class="file-tile" href="${url}" download="${escapeHtml(imgName.split('/').pop())}">
            <div class="file-tile-icon">${fileIconFor(imgName)}</div>
            <div class="file-tile-name" translate="no">${escapeHtml(imgName)}</div>
          </a>
        `);
      }
    } catch (err) {
      console.warn('Приложението не може да бъде заредено.');
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


const bulkEl = {
  bulkBtn: document.getElementById('bulkBtn'),
  bulkPanel: document.getElementById('bulkPanel'),
  scanLocalBtn: document.getElementById('scanLocalBtn'),
  scanExternalBtn: document.getElementById('scanExternalBtn'),
  importLayout: document.getElementById('importLayout'),
  bulkResults: document.getElementById('bulkResults'),
  bulkStatus: document.getElementById('bulkStatus'),
  bulkImportBtn: document.getElementById('bulkImportBtn'),
  bulkCancelBtn: document.getElementById('bulkCancelBtn'),
  bulkSelectAll: document.getElementById('bulkSelectAll')
};

// Initialize the admin UI after both control groups exist.
applyPackageInstructionsAdminUI(typeof HubServer === 'undefined' || HubServer.can('canManageInstructions'));

let bulkCandidates = [];
let bulkCloseTimer = null;

async function scanCandidatesFromDir(dirHandle, options) {
  return HubInstructionFolders.scan(dirHandle, {...options, index: dbIndex});
}

function openBulkPanel() {
  clearTimeout(bulkCloseTimer);
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
  clearTimeout(bulkCloseTimer);
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
    const { candidates, skippedEmpty } = await scanCandidatesFromDir(externalDir, { copyNeeded: true, skipExisting: false, layout: bulkEl.importLayout.value });
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
    const conflict = HubInstructionFolders.existingKey(dbIndex, HubInstructionFolders.destinationPath(c)) !== undefined;
    return `
      <div class="bulk-row" data-idx="${i}">
        <input type="checkbox" class="bulk-check" ${conflict ? '' : 'checked'} data-idx="${i}">
        <input type="text" class="bulk-number" placeholder="номер (по избор)" value="${escapeHtml(c.number)}" data-idx="${i}">
        <div class="bulk-name-col">
          <input type="text" class="bulk-name" placeholder="име" value="${escapeHtml(c.name)}" data-idx="${i}">
          <input type="text" class="bulk-client" placeholder="клиент (по избор)" value="${escapeHtml(c.client)}" data-idx="${i}">
          <span class="bulk-path" translate="no">${escapeHtml(c.originalPath)}</span>
        </div>
        <select class="bulk-category" data-idx="${i}">
          <option value="" ${!c.category ? 'selected' : ''}>Некатегоризиран</option>
          <option value="standard" ${c.category === 'standard' ? 'selected' : ''}>Стандартен</option>
          <option value="special" ${c.category === 'special' ? 'selected' : ''}>Специален</option>
        </select>
        <span class="bulk-filecount">${c.files.length} файл${c.files.length === 1 ? '' : 'а'}${c.instructionText ? ', текст ✓' : ''}</span>
        ${conflict ? '<span class="bulk-conflict">⚠ папката вече е в индекса</span>' : ''}
      </div>
    `;
  }).join('');

  const updateSelection = () => {
    const checks = Array.from(bulkEl.bulkResults.querySelectorAll('.bulk-check'));
    const selected = checks.filter(cb => cb.checked).length;
    bulkEl.bulkSelectAll.checked = selected === checks.length;
    bulkEl.bulkSelectAll.indeterminate = selected > 0 && selected < checks.length;
  };
  bulkEl.bulkResults.querySelectorAll('.bulk-check').forEach(cb => cb.addEventListener('change', updateSelection));
  updateSelection();

  bulkEl.bulkResults.querySelectorAll('.bulk-number').forEach(input => {
    input.addEventListener('input', (e) => {
      bulkCandidates[e.target.dataset.idx].number = e.target.value.trim();
    });
  });
  bulkEl.bulkResults.querySelectorAll('.bulk-name').forEach(input => {
    input.addEventListener('input', (e) => {
      bulkCandidates[e.target.dataset.idx].name = e.target.value.trim();
    });
  });
  bulkEl.bulkResults.querySelectorAll('.bulk-client').forEach(input => {
    input.addEventListener('input', (e) => {
      const candidate = bulkCandidates[e.target.dataset.idx];
      candidate.client = e.target.value.trim();
      const row = e.target.closest('.bulk-row');
      const conflict = HubInstructionFolders.existingKey(dbIndex, HubInstructionFolders.destinationPath(candidate)) !== undefined;
      row.querySelector('.bulk-conflict')?.remove();
      if (conflict) {
        row.insertAdjacentHTML('beforeend', '<span class="bulk-conflict">⚠ папката вече е в индекса</span>');
        row.querySelector('.bulk-check').checked = false;
        updateSelection();
      }
    });
  });
  bulkEl.bulkResults.querySelectorAll('.bulk-category').forEach(select => {
    select.addEventListener('change', (e) => {
      bulkCandidates[e.target.dataset.idx].category = e.target.value;
    });
  });
}

bulkEl.bulkSelectAll.addEventListener('change', (e) => {
  bulkEl.bulkSelectAll.indeterminate = false;
  bulkEl.bulkResults.querySelectorAll('.bulk-check').forEach(cb => { cb.checked = e.target.checked; });
});

bulkEl.bulkImportBtn.addEventListener('click', async () => {
  const checkedIdxs = Array.from(bulkEl.bulkResults.querySelectorAll('.bulk-check:checked'))
    .map(cb => parseInt(cb.dataset.idx, 10));

  if (!checkedIdxs.length) {
    bulkEl.bulkStatus.textContent = 'Няма избрани папки за импорт.';
    return;
  }

  bulkEl.bulkImportBtn.disabled = true;
  instructionsWriting = true;
  try {
  dbIndex = await readIndexFromDisk();
  const dataDir = await rootDirHandle.getDirectoryHandle('data', { create: true });
  const profilesDir = await dataDir.getDirectoryHandle('profiles', { create: true });

  let done = 0;
  const completedNumbers = [];
  for (const idx of checkedIdxs) {
    const c = bulkCandidates[idx];
    const destPath = HubInstructionFolders.destinationPath(c);
    if (HubInstructionFolders.existingKey(dbIndex, destPath) !== undefined) continue;
    if (!c.number) c.number = generateUniqueFallbackNumber();
    const key = HubInstructionFolders.allocateKey(dbIndex, c.number);

    bulkEl.bulkStatus.innerHTML = `Импортиране ${done + 1} от ${checkedIdxs.length}: <span translate="no">${escapeHtml(c.name || c.number)}</span>...`;

    try {
      let savedImageNames = c.files;

      if (c.copyNeeded) {
        const destFolderHandle = await resolveNestedDirHandle(profilesDir, destPath, true);

        if (c.instructionText) {
          const txtHandle = await destFolderHandle.getFileHandle('instruction.txt', { create: true });
          const w = await txtHandle.createWritable();
          await w.write(c.instructionText);
          await w.close();
        }

        savedImageNames = [];
        for (const fname of c.files) {
          const srcFileHandle = await HubInstructionFolders.fileHandle(c.sourceHandle, fname);
          const srcFile = await srcFileHandle.getFile();
          const destFileHandle = await HubInstructionFolders.fileHandle(destFolderHandle, fname, true);
          const w = await destFileHandle.createWritable();
          await w.write(srcFile);
          await w.close();
          savedImageNames.push(fname);
        }
      }

      dbIndex[key] = {
        number: c.number,
        name: c.name,
        client: c.client || '',
        category: c.category || null,
        folderName: destPath,
        images: savedImageNames,
        timestamp: Date.now()
      };
      delete detailsCache[destPath];
      completedNumbers.push(key);
      done++;
    } catch (error) {
      console.error('Грешка при импорт на инструкция.');
    }
  }

  if(completedNumbers.length) await saveIndexDatabase(completedNumbers);
  bulkEl.bulkStatus.textContent = `Готово — импортирани ${done} от ${checkedIdxs.length}.`;
  bulkEl.bulkImportBtn.disabled = false;

  bulkCloseTimer = setTimeout(() => {
    bulkEl.bulkPanel.style.display = 'none';
    renderSearch();
  }, 1200);
  } catch {
    bulkEl.bulkStatus.textContent = 'Записът не е направен. Опитай отново.';
  } finally { instructionsWriting = false; bulkEl.bulkImportBtn.disabled = false; }
});
