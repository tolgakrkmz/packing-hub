/* ============================================================
   file-sync.js — Shared logic for File System Access API
   Contains both single-file sync and directory sync logic.
   Existing IndexedDB names and localStorage keys are stable identifiers;
   keep them when renaming module files so saved connections remain available.
   ============================================================ */

const connectionPanels = new WeakMap();

// Един панел може да съдържа няколко независими файла (например в статистиките).
function registerConnectionPanel(connDot){
  const panel = connDot.closest('#connPanel');
  if(!panel) return ()=>{};

  let group = connectionPanels.get(panel);
  if(!group){
    const heading = panel.querySelector('h2');
    const title = heading ? heading.textContent : 'Споделени файлове';
    const states = new Map(Array.from(panel.querySelectorAll('.conn-dot'), dot=>[dot, false]));
    if(heading) heading.remove();

    const body = document.createElement('div');
    body.className = 'conn-panel-body';
    body.id = 'connPanelBody';
    while(panel.firstChild) body.appendChild(panel.firstChild);

    const head = document.createElement('div');
    head.className = 'conn-panel-head';
    const label = document.createElement('h2');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'conn-panel-toggle';
    toggle.setAttribute('aria-controls', body.id);
    const titleText = document.createElement('span');
    titleText.textContent = title;
    const status = document.createElement('span');
    status.className = 'conn-panel-status';
    toggle.appendChild(titleText);
    toggle.appendChild(status);
    label.appendChild(toggle);
    head.appendChild(label);

    // Входът и изходът остават достъпни и при свит панел.
    const actions = document.createElement('div');
    actions.className = 'conn-panel-actions';
    body.querySelectorAll('#adminToggleBtn, #roleToggleBtn').forEach(button=>{
      const parent = button.parentElement;
      actions.appendChild(button);
      if(!parent.children.length && !parent.textContent.trim()) parent.remove();
    });
    if(actions.children.length) head.appendChild(actions);
    panel.appendChild(head);
    panel.appendChild(body);

    function setExpanded(expanded){
      body.hidden = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
    }
    setExpanded(true);
    group = { states, allConnected: false, update };
    connectionPanels.set(panel, group);

    function update(){
      const connected = Array.from(states.values()).filter(Boolean).length;
      const allConnected = states.size > 0 && connected === states.size;
      status.textContent = 'Свързани: ' + connected + '/' + states.size;
      status.classList.toggle('ready', allConnected);
      toggle.disabled = !allConnected;
      if(!allConnected || !group.allConnected) setExpanded(!allConnected);
      group.allConnected = allConnected;
    }
    toggle.addEventListener('click', ()=>{
      if(group.allConnected) setExpanded(body.hidden);
    });
    update();
  }

  group.states.set(connDot, false);
  group.update();
  return connected=>{
    group.states.set(connDot, connected);
    group.update();
  };
}

function createFileSync(cfg){
  const {
    dbName, suggestedFileName, localStorageKey,
    defaultData, onConnect, onRefresh, getData, render, elements: el
  } = cfg;

  let fileHandle = null;
  let pollTimer = null;
  let readRevision = 0;
  const supportsFS = 'showOpenFilePicker' in window;
  const accessMode = cfg.readOnly ? 'read' : 'readwrite';
  if(cfg.readOnly && el.createFileBtn) el.createFileBtn.hidden = true;
  const updatePanel = registerConnectionPanel(el.connDot);

  function setConn(state, text){
    el.connDot.className = 'conn-dot ' + state;
    el.connText.textContent = text;
    updatePanel(state === 'on' && supportsFS && !!fileHandle);
  }

  function connectionLost(error){
    setConn('off', cfg.strictJson && error ? error.message : 'Връзката с файла е прекъсната — свържете отново или отворете файла.');
    el.openFileBtn.style.display = 'inline-block';
    el.reconnectBtn.style.display = fileHandle ? 'inline-block' : 'none';
  }

  function idbOp(mode, fn){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = ()=>{ req.result.createObjectStore('handles'); };
      req.onsuccess = ()=>{
        const db = req.result;
        const tx = db.transaction('handles', mode);
        fn(tx.objectStore('handles'), resolve, reject);
      };
      req.onerror = ()=>reject(req.error);
    });
  }
  const idbGet = (key)=> idbOp('readonly', (s,res,rej)=>{ const r=s.get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  const idbSet = (key,val)=> idbOp('readwrite', (s,res)=>{ s.put(val,key); res(); });

  async function readFileData(){
    const file = await fileHandle.getFile();
    const text = await file.text();
    if(!text.trim()) {
      if(cfg.strictJson) throw new Error('Файлът е празен. Изберете валиден JSON файл.');
      return defaultData();
    }
    try{ return JSON.parse(text); }catch(e){
      if(cfg.strictJson) throw new Error('Файлът не съдържа валиден JSON.');
      return defaultData();
    }
  }

  async function writeFileData(){
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(getData(), null, 2));
    await writable.close();
  }

  async function refreshFromDisk(){
    if(!fileHandle) return;
    const revision = ++readRevision;
    try{
      const data = await readFileData();
      if(revision !== readRevision) return;
      await onRefresh(data);
      setConn('on', 'Свързан с: ' + (fileHandle.name || 'мрежов файл'));
      el.openFileBtn.style.display = 'none';
      if(el.createFileBtn) el.createFileBtn.style.display = 'none';
      el.reconnectBtn.style.display = 'none';
    }catch(e){
      if(revision !== readRevision) return;
      connectionLost(e);
      throw e;
    }
  }

  async function connectAndLoad(handle){
    ++readRevision;
    fileHandle = handle;
    setConn('off', 'Свързване с файла…');
    await idbSet('mainFile', handle);
    const data = await readFileData();
    await onConnect(data);
    render();
    setConn('on', 'Свързан с: ' + (handle.name || 'мрежов файл'));
    el.openFileBtn.style.display = 'none';
    el.createFileBtn.style.display = 'none';
    el.reconnectBtn.style.display = 'none';
    el.refreshBtn.style.display = 'inline-block';
    el.connNote.textContent = cfg.readOnly
      ? 'Файлът се използва само за четене. Автоматично опресняване на всеки 20 сек.'
      : 'Записва се направо във файла. Другите компютри виждат промените след опресняване (автоматично на всеки 20 сек.).';
    startPolling();
  }

  function startPolling(){
    if(pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async ()=>{
      if(cfg.isBusy && cfg.isBusy()) return;
      try{ await refreshFromDisk(); render(); }catch(e){}
    }, 20000);
  }

  async function commitData(){
    if(cfg.readOnly) throw new Error('Файлът се използва само за четене.');
    ++readRevision;
    if(fileHandle){
      try{ await writeFileData(); }
      catch(e){ connectionLost(e); throw e; }
    } else if(!supportsFS){
      saveLocalFallback();
    }
  }

  el.openFileBtn.addEventListener('click', async ()=>{
    try{
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
      await connectAndLoad(handle);
    }catch(e){
      if(e.name !== 'AbortError') connectionLost(e);
    }
  });

  if(el.createFileBtn && !cfg.readOnly){
    el.createFileBtn.addEventListener('click', async ()=>{
      try{
        const handle = await window.showSaveFilePicker({
          suggestedName: suggestedFileName,
          types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
        });
        fileHandle = handle;
        await onConnect(defaultData());
        await writeFileData();
        await connectAndLoad(handle);
      }catch(e){
        if(e.name !== 'AbortError') connectionLost(e);
      }
    });
  }

  // ПОПРАВЕНО: преди това ползваше несъществуваща променлива 'saved' и никога
  // не стигаше до реалния reconnect опит — при всяко изтекло разрешение падаше
  // директно в catch и връщаше целия "Отвори файл" диалог отначало.
  // fileHandle вече е наличен тук (init() го подготвя, преди да покаже бутона).
  el.reconnectBtn.addEventListener('click', async ()=>{
    try{
      const perm = await fileHandle.requestPermission({ mode: accessMode });
      if(perm === 'granted'){
        await connectAndLoad(fileHandle);
      } else {
        setConn('off', 'Няма разрешение за достъп до файла.');
      }
    }catch(e){
      setConn('off', 'Не може да се възстанови връзката — отворете файла отново.');
      el.openFileBtn.style.display = 'inline-block';
      if(el.createFileBtn) el.createFileBtn.style.display = 'inline-block';
      el.reconnectBtn.style.display = 'none';
    }
  });

  el.refreshBtn.addEventListener('click', async ()=>{
    try{ await refreshFromDisk(); render(); }catch(e){}
  });

  function setupFallback(){
    el.openFileBtn.textContent = 'Импортирай файл';
    if(el.createFileBtn) el.createFileBtn.style.display = 'none';
    el.reconnectBtn.style.display = 'none';
    el.refreshBtn.style.display = 'none';
    setConn('off', 'Този браузър не поддържа директен достъп до файл — ползвайте Chrome/Edge за автоматична синхронизация, или експорт/импорт.');
    el.connNote.innerHTML = 'Данните ще се пазят само в този браузър, докато не ги изтриете. Използвайте бутоните долу, за да обменяте .json файл през мрежовата папка ръчно.';

    const exportBtn = document.createElement('button');
    exportBtn.className = 'conn-btn';
    exportBtn.textContent = 'Свали .json';
    exportBtn.addEventListener('click', ()=>{
      const blob = new Blob([JSON.stringify(getData(), null, 2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = suggestedFileName;
      a.click();
    });
    if(!cfg.readOnly) el.connRow.appendChild(exportBtn);

    el.openFileBtn.addEventListener('click', ()=> el.importFallback.click());
    el.importFallback.addEventListener('change', async ()=>{
      const f = el.importFallback.files[0];
      if(!f) return;
      try{
        const data = JSON.parse(await f.text());
        await onConnect(data);
        render();
        setConn('on', 'Импортирани данни от файл (запазете отново след нови записи).');
      }catch(e){
        setConn('off', 'Невалиден файл.');
      }
    });

    loadLocalFallback();
  }

  async function loadLocalFallback(){
    try{
      const raw = localStorage.getItem(localStorageKey);
      if(raw){ await onConnect(JSON.parse(raw)); }
    }catch(e){}
    render();
  }

  function saveLocalFallback(){
    try{ localStorage.setItem(localStorageKey, JSON.stringify(getData())); }catch(e){ if(cfg.strictJson) throw e; }
  }

  async function init(){
    if(!supportsFS){ setupFallback(); return; }
    const saved = await idbGet('mainFile').catch(()=>null);
    if(saved){
      try{
        const perm = await saved.queryPermission({ mode: accessMode });
        if(perm === 'granted'){ await connectAndLoad(saved); return; }
        fileHandle = saved;
        setConn('off', 'Свързан преди с "' + (saved.name || 'файл') + '" — трябва повторно разрешение.');
        el.openFileBtn.style.display = 'none';
        if(el.createFileBtn) el.createFileBtn.style.display = 'none';
        el.reconnectBtn.style.display = 'inline-block';
        render();
        return;
      }catch(e){}
    }
    setConn('off', 'Все още не сте свързани с общия файл.');
    render();
  }

  return {
    init,
    commitData,
    refreshFromDisk,
    get fileHandle(){ return fileHandle; }
  };
}

/* ============================================================
   Directory Sync — New logic for Package Instructions
   Requests permission for a full directory instead of a file.
   ============================================================ */

function createDirectorySync(cfg){
  const {
    dbName, defaultData, onConnect, onRefresh, render, elements: el
  } = cfg;

  let dirHandle = null;
  const supportsFS = 'showDirectoryPicker' in window;
  const updatePanel = registerConnectionPanel(el.connDot);

  function setConn(state, text){
    el.connDot.className = 'conn-dot ' + state;
    el.connText.textContent = text;
    updatePanel(state === 'on' && supportsFS && !!dirHandle);
  }

  function connectionLost(){
    setConn('off', 'Връзката с папката е прекъсната — свържете отново или изберете папката.');
    el.openFileBtn.style.display = 'inline-block';
    el.reconnectBtn.style.display = dirHandle ? 'inline-block' : 'none';
  }

  function idbOp(mode, fn){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = ()=>{ req.result.createObjectStore('handles'); };
      req.onsuccess = ()=>{
        const db = req.result;
        const tx = db.transaction('handles', mode);
        fn(tx.objectStore('handles'), resolve, reject);
      };
      req.onerror = ()=>reject(req.error);
    });
  }
  const idbGet = (key)=> idbOp('readonly', (s,res,rej)=>{ const r=s.get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  const idbSet = (key,val)=> idbOp('readwrite', (s,res)=>{ s.put(val,key); res(); });

  async function readIndexData(){
    const dataDir = await dirHandle.getDirectoryHandle('data', { create: true });
    const fileHandle = await dataDir.getFileHandle('package-instructions.json', { create: true });
    const file = await fileHandle.getFile();
    const text = await file.text();
    if(!text.trim()) return defaultData();
    return JSON.parse(text);
  }

  async function refreshFromDisk(){
    if(!dirHandle) return;
    try{
      const data = await readIndexData();
      await onRefresh(data);
      setConn('on', 'Свързан с папка: ' + dirHandle.name);
      el.openFileBtn.style.display = 'none';
      el.reconnectBtn.style.display = 'none';
    }catch(e){
      connectionLost();
      throw e;
    }
  }

  async function connectAndLoad(handle){
    dirHandle = handle;
    setConn('off', 'Свързване с папката…');
    await idbSet('mainDir', handle);
    const data = await readIndexData();

    // Pass both the loaded JSON data and the root folder handle to the module
    await onConnect(data, handle);
    render();

    setConn('on', 'Свързан с папка: ' + handle.name);
    el.openFileBtn.style.display = 'none';
    if(el.createFileBtn) el.createFileBtn.style.display = 'none';
    el.reconnectBtn.style.display = 'none';
    el.refreshBtn.style.display = 'inline-block';
    el.connNote.textContent = 'Данните и снимките се записват директно в мрежовата папка.';
  }

  el.openFileBtn.addEventListener('click', async ()=>{
    try{
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await connectAndLoad(handle);
    }catch(e){
      if(e.name !== 'AbortError') connectionLost();
    }
  });

  // Not needed for directory structure
  if(el.createFileBtn) el.createFileBtn.style.display = 'none';

  el.reconnectBtn.addEventListener('click', async ()=>{
    try{
      const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
      if(perm === 'granted'){ await connectAndLoad(dirHandle); }
      else{ setConn('off', 'Няма разрешение за достъп до папката.'); }
    }catch(e){
      setConn('off', 'Не може да се възстанови връзката — изберете папката отново.');
      el.openFileBtn.style.display = 'inline-block';
      el.reconnectBtn.style.display = 'none';
    }
  });

  el.refreshBtn.addEventListener('click', async ()=>{
    try{ await refreshFromDisk(); render(); }catch(e){}
  });

  async function init(){
    if(!supportsFS){
      setConn('off', 'Браузърът не поддържа директен достъп до папки. Моля, използвайте Chrome/Edge.');
      return;
    }
    const saved = await idbGet('mainDir').catch(()=>null);
    if(saved){
      try{
        const perm = await saved.queryPermission({ mode: 'readwrite' });
        if(perm === 'granted'){ await connectAndLoad(saved); return; }
        dirHandle = saved;
        setConn('off', 'Свързан преди с папка "' + saved.name + '" — трябва повторно разрешение.');
        el.openFileBtn.style.display = 'none';
        if(el.createFileBtn) el.createFileBtn.style.display = 'none';
        el.reconnectBtn.style.display = 'inline-block';
        render();
        return;
      }catch(e){}
    }
    setConn('off', 'Все още не сте свързани с основната мрежова папка.');
    // Keep button label accurate
    el.openFileBtn.textContent = "Избери основна папка";
    render();
  }

  return {
    init,
    refreshFromDisk,
    get dirHandle(){ return dirHandle; }
  };
}

/* ============================================================
   Admin Mode — споделена UI бариера за ВСИЧКИ инструменти в хъба.
   НЕ Е истинска защита (само клиентска страна, без сървър) — просто
   пази от случайно/непреднамерено добавяне, bulk импорт или триене
   от хора, които не би трябвало да пипат тези операции.
   Входът важи, докато е отворен браузърът (sessionStorage) —
   при затваряне на браузъра (всички прозорци) admin режимът
   автоматично излиза, за да не остане включен на чужд компютър.
   Затваряне само на таба и връщане към него в СЪЩИЯ отворен
   браузър обичайно пази сесията; пълно затваряне на браузъра — не.
   ============================================================ */

const ADMIN_STORAGE_KEY = 'portfolioHubAdminMode';
const ADMIN_PASSWORD = 'demo-admin';

function isAdminMode(){
  return sessionStorage.getItem(ADMIN_STORAGE_KEY) === 'true';
}

// buttonEl: бутонът "🔒 Admin" на съответната страница.
// onChange(isAdmin): извиква се веднага при wire-ване и при всяка промяна,
// за да могат страниците да показват/скриват каквото им трябва.
function wireAdminToggle(buttonEl, onChange){
  if(!buttonEl) return;

  function refresh(){
    const admin = isAdminMode();
    buttonEl.textContent = admin ? '🔓 Admin (изход)' : '🔒 Admin';
    if(onChange) onChange(admin);
  }

  buttonEl.addEventListener('click', ()=>{
    if(isAdminMode()){
      sessionStorage.removeItem(ADMIN_STORAGE_KEY);
      refresh();
      return;
    }
    const pass = prompt('Admin парола:');
    if(pass === null) return; // отказал е диалога
    if(pass === ADMIN_PASSWORD){
      sessionStorage.setItem(ADMIN_STORAGE_KEY, 'true');
      refresh();
    } else {
      alert('Грешна парола.');
    }
  });

  refresh();
}

/* ============================================================
   Legacy Role Login — запазени помощни функции за вход по роля.
   Разширява admin бариерата с по-фина роля: началник на смяна.
   Един и същ вход (парола) разпознава дали е Admin (мениджър —
   вижда и сверява всички смени) или началник на конкретна смяна
   (вижда и въвежда само за своя екип). Паролите са отделни за
   всяка смяна, за да не могат смените да влизат в чужди данни.
   Входът е в sessionStorage — излиза автоматично при затваряне
   на браузъра, за да не остане включен на чужд компютър.

   ВАЖНО: смени паролите тук преди реално ползване във фабриката.
   ============================================================ */

const SHIFT_TEAMS = ['А', 'Б', 'В', 'Г', 'СТИКЕРИ'];

const SHIFT_PASSWORDS = {}; // Role login is unused in this demo.

const ROLE_STORAGE_KEY = 'portfolioHubRole';

// Връща null (не е влязъл) или { type: 'admin' } или { type: 'shift', team: 'А' }
function getCurrentRole(){
  try{
    const raw = sessionStorage.getItem(ROLE_STORAGE_KEY);
    if(!raw) return null;
    const role = JSON.parse(raw);
    if(role && role.type === 'admin') return role;
    if(role && role.type === 'shift' && SHIFT_TEAMS.includes(role.team)) return role;
    return null;
  }catch(e){ return null; }
}

function clearCurrentRole(){
  sessionStorage.removeItem(ROLE_STORAGE_KEY);
}

// buttonEl: бутонът за вход/изход.
// onChange(role): извиква се веднага при wire-ване и при всяка промяна на ролята.
// role е null, {type:'admin'} или {type:'shift', team:'...'}
function wireRoleLogin(buttonEl, onChange){
  if(!buttonEl) return;

  function refresh(){
    const role = getCurrentRole();
    if(!role){
      buttonEl.textContent = '🔒 Вход';
    } else if(role.type === 'admin'){
      buttonEl.textContent = '🔓 Мениджър (изход)';
    } else {
      buttonEl.textContent = '🔓 Смяна ' + role.team + ' (изход)';
    }
    if(onChange) onChange(role);
  }

  buttonEl.addEventListener('click', ()=>{
    const role = getCurrentRole();
    if(role){
      clearCurrentRole();
      refresh();
      return;
    }
    const pass = prompt('Парола (мениджър или на твоята смяна):');
    if(pass === null) return;
    if(pass === ADMIN_PASSWORD){
      sessionStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify({ type: 'admin' }));
      refresh();
      return;
    }
    const team = Object.keys(SHIFT_PASSWORDS).find(t => SHIFT_PASSWORDS[t] === pass);
    if(team){
      sessionStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify({ type: 'shift', team }));
      refresh();
    } else {
      alert('Грешна парола.');
    }
  });

  refresh();
}
