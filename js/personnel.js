/* Personnel schema v3: one record per person, active-only headcounts,
 * a single stickers shift, and category-specific role options. */

const SCHEMA_VERSION = 3;
const CATS = [
  {key:'auto', label:'Автоматична линия', short:'Автоматична', teams:['А','Б','В','Г']},
  {key:'manual', label:'Ръчна опаковка', short:'Ръчна', teams:['А','Б','В','Г']},
  {key:'stickers', label:'Стикери', short:'Стикери', teams:['1 смяна']}
];
const CAT_BY_KEY = Object.fromEntries(CATS.map(c=>[c.key,c]));
const MAIN_TEAMS = ['А','Б','В','Г'];

const ROLE_OPTIONS = {
  auto:['Началник смяна','Оператор пулт 1','Оператор пулт 2','Чемберовач','Обслужващ','Опаковчик'],
  manual:['Началник смяна','Кранист/чемберовач','Обслужващ','Опаковчик'],
  stickers:['Началник смяна','Опаковчик']
};

let employees = deepClone(DEFAULT_EMPLOYEES);
let settings = Object.assign({}, DEFAULT_PERSONNEL_SETTINGS);
let moveLog = [];
let activeFilter = 'all';
let searchTerm = '';
let syncStarted = false;
let toastTimer = null;

function deepClone(v){ return JSON.parse(JSON.stringify(v)); }
function localISODate(d=new Date()){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fmtDateBg(str){
  if(!str) return '—';
  const p=String(str).split('-');
  return p.length===3 ? `${p[2]}.${p[1]}.${p[0]}` : str;
}
function escapeHTML(value){
  return String(value ?? '').replace(/[&<>'"]/g, ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[ch]));
}
function teamClass(team){ return 'team-'+String(team).replaceAll(' ','_'); }
function catLabel(key){ return CAT_BY_KEY[key]?.label || key || '—'; }
function normalizeSettings(value){
  const raw=value||{};
  return {
    stickersStage1: Number.isFinite(Number(raw.stickersStage1)) ? Math.max(0,Math.round(Number(raw.stickersStage1))) : DEFAULT_PERSONNEL_SETTINGS.stickersStage1,
    stickersStage2: Number.isFinite(Number(raw.stickersStage2)) ? Math.max(0,Math.round(Number(raw.stickersStage2))) : DEFAULT_PERSONNEL_SETTINGS.stickersStage2
  };
}
function cleanRoleKey(value){
  return String(value||'').trim().toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
}
function normalizeRole(category, role, name=''){
  const allowed=ROLE_OPTIONS[category] || ROLE_OPTIONS.auto;
  const key=cleanRoleKey(role);
  const exact=allowed.find(r=>cleanRoleKey(r)===key);
  if(exact) return exact;

  if(category==='stickers'){
    // Normalize legacy stickers roles to the supported role options.
    return 'Опаковчик';
  }
  if(category==='manual'){
    if(/началник|отговорник/.test(key)) return 'Началник смяна';
    if(/кранист|чембер/.test(key)) return 'Кранист/чемберовач';
    if(/обслужващ/.test(key)) return 'Обслужващ';
    return 'Опаковчик';
  }

  if(/началник|н-к смяна|н к смяна/.test(key)) return 'Началник смяна';
  if(/отговорник\s*1/.test(key) || /оператор\s+пулт\s*1\b/.test(key)) return 'Оператор пулт 1';
  if(/отговорник\s*2/.test(key) || /оператор\s+пулт\s*2\b/.test(key)) return 'Оператор пулт 2';
  if(/чембер/.test(key)) return 'Чемберовач';
  if(/обслужващ/.test(key)) return 'Обслужващ';
  return 'Опаковчик';
}
function normalizeEmployee(p){
  const category=CAT_BY_KEY[p.category] ? p.category : 'auto';
  const allowed=CAT_BY_KEY[category].teams;
  const team=allowed.includes(p.team) ? p.team : allowed[0];
  const name=String(p.name||'').trim();
  return {
    id:String(p.id||''),
    name,
    category,
    team,
    role:normalizeRole(category,p.role,name),
    active:p.active !== false,
    note:String(p.note||'').trim()
  };
}
function createDefaultData(){
  return {
    schemaVersion:SCHEMA_VERSION,
    employees:deepClone(DEFAULT_EMPLOYEES),
    settings:deepClone(DEFAULT_PERSONNEL_SETTINGS),
    moveLog:[]
  };
}
function addLog(entry){
  moveLog.unshift(Object.assign({date:localISODate()},entry));
  moveLog=moveLog.slice(0,300);
}
function loadIncomingData(data, allowMigration){
  const src=HubDataValidation.validate('personnel',data);
  const version=Number(src.schemaVersion||1);

  // Preserve existing records while normalizing teams and category-specific roles.
  employees=src.employees.map(normalizeEmployee).filter(p=>p.id && p.name);
  settings=normalizeSettings(src.settings);
  moveLog=Array.isArray(src.moveLog) ? src.moveLog : [];

  if(version < SCHEMA_VERSION && allowMigration){
    addLog({type:'migration',name:'Система',detail:'Стикери: 1 смяна · фиксирани роли (schema v3)'});
  }
  return version !== SCHEMA_VERSION;
}

const SHIFT_LABELS = ShiftSchedule.LABELS;
const WEEKDAYS_SHORT = ['пн','вт','ср','чт','пт','сб','нд'];
function shiftCodeFor(team,dateObj){
  return ShiftSchedule.shiftCodeFor(team,dateObj);
}
function parseLocalDate(str){
  const [y,m,d]=str.split('-').map(Number);
  return new Date(y,m-1,d);
}

const sync = createFileSync({
  dbName:'portfolio-personnel-fs-db',
  suggestedFileName:'personnel.json',
  localStorageKey:'portfolio-personnel-fallback',
  defaultData:createDefaultData,
  getData:()=>({schemaVersion:SCHEMA_VERSION,employees,settings,moveLog}),
  render:renderAll,
  onConnect:(data)=>{ loadIncomingData(data,true); },
  onRefresh:(data)=>{ loadIncomingData(data,false); },
  elements:{
    connDot:document.getElementById('connDot'),
    connText:document.getElementById('connText'),
    openFileBtn:document.getElementById('openFileBtn'),
    createFileBtn:document.getElementById('createFileBtn'),
    reconnectBtn:document.getElementById('reconnectBtn'),
    refreshBtn:document.getElementById('refreshBtn'),
    importFallback:document.getElementById('importFallback'),
    connNote:document.getElementById('connNote'),
    connRow:document.querySelector('#connPanel .conn-row')
  }
});

function applyAdminGate(admin){
  document.getElementById('lockedBox').style.display=admin?'none':'block';
  document.getElementById('hubContent').style.display=admin?'block':'none';
  document.getElementById('connPanel').style.display=admin?'block':'none';
  if(admin && !syncStarted){ syncStarted=true; sync.init(); }
}
wireAdminToggle(document.getElementById('adminToggleBtn'),applyAdminGate);
const lockedAdminBtn=document.getElementById('lockedAdminBtn');
if(lockedAdminBtn){ lockedAdminBtn.addEventListener('click',()=>document.getElementById('adminToggleBtn').click()); }

function activePeople(category=null,team=null){
  return employees.filter(p=>p.active && (!category || p.category===category) && (!team || p.team===team));
}
function activeCount(category=null,team=null){ return activePeople(category,team).length; }
function inactiveCount(){ return employees.filter(p=>!p.active).length; }
function renderSummary(){
  const total=activeCount();
  const auto=activeCount('auto');
  const manual=activeCount('manual');
  const stickers=activeCount('stickers');
  const inactive=inactiveCount();
  const stage1Gap=Math.max(0,settings.stickersStage1-stickers);
  const stage2Gap=Math.max(0,settings.stickersStage2-stickers);

  document.getElementById('heroSub').textContent=`${total} активни • ${inactive} извън активния състав • броят се обновява автоматично`;

  const teamMinis=(cat,teams)=>teams.map(t=>`<span class="team-mini"><b>${escapeHTML(t.replace('Група ',''))}</b> ${activeCount(cat,t)}</span>`).join('');
  const html=[
    `<div class="summary-card hero-total">
      <div class="summary-kicker">Общо активни</div>
      <div class="summary-value">${total}</div>
      <div class="summary-label">Производствен състав</div>
      <div class="summary-meta">Само хората със статус „Активен състав“.</div>
    </div>`,
    `<div class="summary-card">
      <div class="summary-kicker">Участък</div><div class="summary-value">${auto}</div>
      <div class="summary-label">Автоматична линия</div>
      <div class="team-mini-row">${teamMinis('auto',MAIN_TEAMS)}</div>
    </div>`,
    `<div class="summary-card">
      <div class="summary-kicker">Участък</div><div class="summary-value">${manual}</div>
      <div class="summary-label">Ръчна опаковка</div>
      <div class="team-mini-row">${teamMinis('manual',MAIN_TEAMS)}</div>
    </div>`,
    `<div class="summary-card">
      <div class="summary-kicker">Участък</div><div class="summary-value">${stickers}</div>
      <div class="summary-label">Стикери</div>
      <div class="team-mini-row">${teamMinis('stickers',['1 смяна'])}</div>
      <div class="stage-progress">
        <div class="stage-line"><span>1-ви етап · ${settings.stickersStage1}</span><b class="${stage1Gap?'short':'ok'}">${stage1Gap?'−'+stage1Gap:'готово'}</b></div>
        <div class="stage-line"><span>2-ри етап · ${settings.stickersStage2}</span><b class="${stage2Gap?'short':'ok'}">${stage2Gap?'−'+stage2Gap:'готово'}</b></div>
      </div>
    </div>`,
    `<div class="summary-card">
      <div class="summary-kicker">Допълнителни</div><div class="summary-value">${inactive}</div>
      <div class="summary-label">Извън активния състав</div>
      <div class="summary-meta">ТР, преси, предизвестие, напуснал и други бележки. Записите се пазят и могат да се върнат в състава.</div>
    </div>`
  ].join('');
  document.getElementById('summaryGrid').innerHTML=html;
}

const todayDateInput=document.getElementById('todayDate');
todayDateInput.value=localISODate();
todayDateInput.addEventListener('change',renderToday);
function peopleLines(list){
  if(!list.length) return '<span>—</span>';
  return list.slice().sort(sortPeople).map(p=>`<span translate="no">${escapeHTML(p.name)}</span> <span style="opacity:.58">(${escapeHTML(p.role)})</span>`).join('<br>');
}
function renderToday(){
  const dateObj=parseLocalDate(todayDateInput.value||localISODate());
  const grid=document.getElementById('todayGrid');
  const openTeams=new Set(Array.from(grid.querySelectorAll('.today-card[open]'),card=>card.dataset.team));
  grid.innerHTML=MAIN_TEAMS.map(t=>{
    const code=shiftCodeFor(t,dateObj);
    const auto=activePeople('auto',t);
    const manual=activePeople('manual',t);
    return `<details class="today-card" data-team="${t}"${openTeams.has(t)?' open':''}>
      <summary>
        <div class="tt"><span class="badge ${teamClass(t)}">Екип ${t}</span><span class="badge shift-${code}">${SHIFT_LABELS[code]}</span></div>
        <div class="today-total"><strong>${auto.length+manual.length}</strong><span>души общо</span></div>
        <div class="today-counts"><span class="count-pill">Автоматична <b>${auto.length}</b></span><span class="count-pill">Ръчна <b>${manual.length}</b></span></div>
        <div class="today-details-hint">Състав по имена</div>
      </summary>
      <div class="names">
        <div class="names-group"><div class="names-title">Автоматична линия</div>${peopleLines(auto)}</div>
        <div class="names-group"><div class="names-title">Ръчна опаковка</div>${peopleLines(manual)}</div>
      </div>
    </details>`;
  }).join('');

  const stickers=activeCount('stickers','1 смяна');
  document.getElementById('stickersNote').innerHTML=`<b>Стикери:</b> 1 смяна, фиксиран състав, без автоматична ротация.
    <span class="badge team-1_смяна">1 смяна — ${stickers} души</span>`;
}

const monthNames=['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'];
const schedMonth=document.getElementById('schedMonth');
const schedYear=document.getElementById('schedYear');
schedMonth.innerHTML=monthNames.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
const now=new Date();
schedMonth.value=now.getMonth();
const yearsList=[now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1,now.getFullYear()+2];
schedYear.innerHTML=yearsList.map(y=>`<option value="${y}">${y}</option>`).join('');
schedYear.value=now.getFullYear();
schedMonth.addEventListener('change',renderSchedule);
schedYear.addEventListener('change',renderSchedule);
function renderSchedule(){
  const year=parseInt(schedYear.value,10);
  const month=parseInt(schedMonth.value,10);
  const days=new Date(year,month+1,0).getDate();
  const cols=`76px repeat(${days},31px)`;
  let head=`<div class="schedule-line schedule-head" style="grid-template-columns:${cols}"><div></div>`;
  for(let d=1;d<=days;d++){
    const o=new Date(year,month,d); const wd=(o.getDay()+6)%7; const wk=wd>=5;
    head+=`<div class="schedule-day${wk?' weekend':''}"><b>${d}</b><span>${WEEKDAYS_SHORT[wd]}</span></div>`;
  }
  head+='</div>';
  const rows=MAIN_TEAMS.map(t=>{
    let s=`<div class="schedule-line" style="grid-template-columns:${cols}"><div class="schedule-team-label"><span class="badge ${teamClass(t)}">${t}</span></div>`;
    for(let d=1;d<=days;d++){
      const o=new Date(year,month,d); const wd=(o.getDay()+6)%7; const wk=wd>=5; const code=shiftCodeFor(t,o);
      s+=`<div class="schedule-cell shift-${code}${wk?' weekend':''}" title="${d}.${month+1}.${year} — ${SHIFT_LABELS[code]}">${code}</div>`;
    }
    return s+'</div>';
  }).join('');
  document.getElementById('schedWrap').innerHTML=`<div class="schedule-shell">${head}${rows}</div>`;
}

function roleRank(p){
  const list=ROLE_OPTIONS[p.category] || ROLE_OPTIONS.auto;
  const idx=list.indexOf(p.role);
  return idx===-1?99:idx;
}
function sortPeople(a,b){ return roleRank(a)-roleRank(b) || a.name.localeCompare(b.name,'bg'); }
function matchesSearch(p){
  if(!searchTerm) return true;
  const original = `${p.name} ${p.role} ${p.note} ${p.team} ${catLabel(p.category)}`;
  return `${original} ${HubI18n.t(original)}`.toLowerCase().includes(searchTerm);
}
const catFiltersEl=document.getElementById('catFilters');
function renderCatFilters(){
  const tabs=[
    {key:'all',label:`Всички активни · ${activeCount()}`},
    {key:'auto',label:`Автоматична · ${activeCount('auto')}`},
    {key:'manual',label:`Ръчна · ${activeCount('manual')}`},
    {key:'stickers',label:`Стикери · ${activeCount('stickers')}`},
    {key:'inactive',label:`Допълнителни · ${inactiveCount()}`}
  ];
  catFiltersEl.innerHTML=tabs.map(t=>`<button class="chip${activeFilter===t.key?' active':''}" data-filter="${t.key}">${t.label}</button>`).join('');
  catFiltersEl.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{
    activeFilter=btn.dataset.filter; renderCatFilters(); renderPeople();
  }));
}
document.getElementById('searchInput').addEventListener('input',e=>{ searchTerm=e.target.value.trim().toLowerCase(); renderPeople(); });
function personRow(p){
  const note=p.note?`<span class="badge note-badge" translate="no" title="${escapeHTML(p.note)}">${escapeHTML(p.note)}</span>`:'';
  return `<div class="person-row">
    <div class="person-meta"><div class="person-name" translate="no">${escapeHTML(p.name)}</div><div class="person-role">${escapeHTML(p.role||'Без зададена роля')}</div></div>
    <div class="person-tags">${note}<button class="edit-btn" data-edit-person="${escapeHTML(p.id)}">Промени</button></div>
  </div>`;
}
function renderCategoryBlock(catKey){
  const cat=CAT_BY_KEY[catKey];
  const teams=cat.teams;
  const cards=teams.map(team=>{
    let list=employees.filter(p=>p.active && p.category===catKey && p.team===team && matchesSearch(p)).sort(sortPeople);
    if(searchTerm && !list.length) return '';
    return `<div class="team-card">
      <div class="team-card-head"><div class="team-title"><span class="badge ${teamClass(team)}">${escapeHTML(team)}</span><span>${escapeHTML(cat.short)}</span></div><div class="team-total">${list.length}${searchTerm?' резултата':' души'}</div></div>
      <div class="person-list">${list.length?list.map(personRow).join(''):'<div class="empty">Няма хора.</div>'}</div>
    </div>`;
  }).join('');
  if(searchTerm && !cards) return '';
  const count=employees.filter(p=>p.active && p.category===catKey && matchesSearch(p)).length;
  return `<section class="category-block"><div class="category-heading"><h3>${escapeHTML(cat.label)}</h3><span>${count} ${searchTerm?'съвпадения':'активни'}</span></div><div class="team-board${teams.length===1?' single-team':''}">${cards}</div></section>`;
}
function renderInactive(){
  const list=employees.filter(p=>!p.active && matchesSearch(p)).sort((a,b)=>a.name.localeCompare(b.name,'bg'));
  if(!list.length) return '<div class="empty">Няма съвпадения.</div>';
  return `<section class="category-block">
    <div class="category-heading"><h3>Допълнителна информация</h3><span>${list.length} записа</span></div>
    <div class="inactive-board">${list.map(p=>`<div class="inactive-card">
      <div class="person-meta"><div class="person-name" translate="no">${escapeHTML(p.name)}</div><div class="person-role">${escapeHTML(catLabel(p.category))} · ${escapeHTML(p.team)}${p.role?' · '+escapeHTML(p.role):''}</div>
      <div class="person-tags"><span class="badge status-inactive">Извън състава</span>${p.note?`<span class="badge note-badge" translate="no">${escapeHTML(p.note)}</span>`:''}</div></div>
      <button class="edit-btn" data-edit-person="${escapeHTML(p.id)}">Промени</button>
    </div>`).join('')}</div>
  </section>`;
}
function renderPeople(){
  let html='';
  if(activeFilter==='inactive') html=renderInactive();
  else if(activeFilter==='all') html=CATS.map(c=>renderCategoryBlock(c.key)).join('');
  else html=renderCategoryBlock(activeFilter);
  document.getElementById('peopleWrap').innerHTML=html||'<div class="empty">Няма съвпадения.</div>';
  document.querySelectorAll('[data-edit-person]').forEach(btn=>btn.addEventListener('click',()=>openPersonModal(btn.dataset.editPerson)));
}

const personModal=document.getElementById('personModal');
const personForm=document.getElementById('personForm');
const personCategory=document.getElementById('personCategory');
const personTeam=document.getElementById('personTeam');
const personRole=document.getElementById('personRole');
personCategory.innerHTML=CATS.map(c=>`<option value="${c.key}">${escapeHTML(c.label)}</option>`).join('');
function populateTeams(preferred){
  const cat=CAT_BY_KEY[personCategory.value]||CATS[0];
  personTeam.innerHTML=cat.teams.map(t=>`<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('');
  if(preferred && cat.teams.includes(preferred)) personTeam.value=preferred;
}
function populateRoles(preferred){
  const roles=ROLE_OPTIONS[personCategory.value]||ROLE_OPTIONS.auto;
  personRole.innerHTML=roles.map(r=>`<option value="${escapeHTML(r)}">${escapeHTML(r)}</option>`).join('');
  const normalized=normalizeRole(personCategory.value,preferred,document.getElementById('personName').value);
  if(roles.includes(normalized)) personRole.value=normalized;
}
personCategory.addEventListener('change',()=>{
  const previousRole=personRole.value;
  populateTeams();
  populateRoles(previousRole);
});
function openModal(el){ el.classList.add('open'); el.setAttribute('aria-hidden','false'); }
function closeModal(el){ el.classList.remove('open'); el.setAttribute('aria-hidden','true'); }
document.querySelectorAll('[data-close-modal]').forEach(btn=>btn.addEventListener('click',()=>closeModal(document.getElementById(btn.dataset.closeModal))));
document.querySelectorAll('.modal-backdrop').forEach(modal=>modal.addEventListener('click',e=>{ if(e.target===modal) closeModal(modal); }));
document.addEventListener('keydown',e=>{ if(e.key==='Escape') document.querySelectorAll('.modal-backdrop.open').forEach(closeModal); });
function openPersonModal(id=''){
  const p=id?employees.find(x=>x.id===id):null;
  document.getElementById('personModalTitle').textContent=p?'Редакция на човек':'Нов човек';
  document.getElementById('personId').value=p?.id||'';
  document.getElementById('personName').value=p?.name||'';
  personCategory.value=p?.category||'auto';
  populateTeams(p?.team);
  populateRoles(p?.role||'');
  document.getElementById('personNote').value=p?.note||'';
  document.getElementById('personActive').checked=p ? p.active : true;
  openModal(personModal);
  setTimeout(()=>document.getElementById('personName').focus(),0);
}
document.getElementById('addPersonBtn').addEventListener('click',()=>openPersonModal());
function nextEmployeeId(){
  const max=employees.reduce((m,p)=>Math.max(m,Number(String(p.id).match(/\d+/)?.[0]||0)),0);
  return `e${max+1}`;
}
function locationText(p){
  return `${catLabel(p.category)} / ${p.team} / ${p.active?'активен':'извън състава'}`;
}
async function saveWithFreshData(mutator){
  if(sync.fileHandle) await sync.refreshFromDisk();
  await mutator();
  await sync.commitData();
  renderAll();
}
personForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const id=document.getElementById('personId').value;
  const draft={
    name:document.getElementById('personName').value.trim(),
    category:personCategory.value,
    team:personTeam.value,
    role:normalizeRole(personCategory.value,personRole.value,document.getElementById('personName').value.trim()),
    note:document.getElementById('personNote').value.trim(),
    active:document.getElementById('personActive').checked
  };
  if(!draft.name || !draft.role){ alert('Попълни име и избери роля / позиция.'); return; }
  const duplicate=employees.find(p=>p.id!==id && p.name.localeCompare(draft.name,'bg',{sensitivity:'base'})===0);
  if(duplicate){ alert('Вече има човек с това име. Редактирай съществуващия запис.'); return; }

  await saveWithFreshData(async()=>{
    if(id){
      const p=employees.find(x=>x.id===id);
      if(!p) return;
      const before=deepClone(p);
      Object.assign(p,draft);
      addLog({type:'update',name:p.name,from:locationText(before),to:locationText(p),detail:p.note||''});
    }else{
      const p=Object.assign({id:nextEmployeeId()},draft);
      employees.push(p);
      addLog({type:'create',name:p.name,to:locationText(p),detail:p.note||''});
    }
  });
  closeModal(personModal);
  showToast(id?'Промяната е записана.':'Човекът е добавен.');
});

const settingsModal=document.getElementById('settingsModal');
document.getElementById('settingsBtn').addEventListener('click',()=>{
  document.getElementById('stickersStage1').value=settings.stickersStage1;
  document.getElementById('stickersStage2').value=settings.stickersStage2;
  openModal(settingsModal);
});
document.getElementById('settingsForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const stage1=Math.max(0,parseInt(document.getElementById('stickersStage1').value,10)||0);
  const stage2=Math.max(0,parseInt(document.getElementById('stickersStage2').value,10)||0);
  await saveWithFreshData(async()=>{
    settings={stickersStage1:stage1,stickersStage2:stage2};
    addLog({type:'settings',name:'Стикери',detail:`Етап 1: ${stage1} души · Етап 2: ${stage2} души`});
  });
  closeModal(settingsModal);
  showToast('Настройките са записани.');
});

function renderLog(){
  const el=document.getElementById('logList');
  if(!moveLog.length){ el.innerHTML='<div class="empty">Все още няма промени.</div>'; return; }
  el.innerHTML=moveLog.slice(0,60).map(m=>{
    if(m.type==='migration') return `<div class="log-item"><span class="log-date">${fmtDateBg(m.date)}</span><span><b translate="no">${escapeHTML(m.name||'Система')}</b> — ${escapeHTML(m.detail||'Миграция')}</span></div>`;
    if(m.type==='settings') return `<div class="log-item"><span class="log-date">${fmtDateBg(m.date)}</span><span><b>Настройки:</b> ${escapeHTML(m.detail||'')}</span></div>`;
    if(m.type==='create') return `<div class="log-item"><span class="log-date">${fmtDateBg(m.date)}</span><span><b translate="no">${escapeHTML(m.name)}</b> — добавен → ${escapeHTML(m.to||'')}</span></div>`;
    if(m.type==='update') return `<div class="log-item"><span class="log-date">${fmtDateBg(m.date)}</span><span><b translate="no">${escapeHTML(m.name)}</b>: ${escapeHTML(m.from||'')} → ${escapeHTML(m.to||'')}${m.detail?' · <span translate="no">'+escapeHTML(m.detail)+'</span>':''}</span></div>`;
    // Accept the legacy history shape: {date, name, from, to}.
    return `<div class="log-item"><span class="log-date">${fmtDateBg(m.date)}</span><span><b translate="no">${escapeHTML(m.name||'')}</b>: ${escapeHTML(m.from||'')} → ${escapeHTML(m.to||'')}</span></div>`;
  }).join('');
}

function showToast(message){
  const el=document.getElementById('toast');
  el.textContent=message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2200);
}

function renderAll(){
  renderSummary();
  renderToday();
  renderCatFilters();
  renderPeople();
  renderSchedule();
  renderLog();
}

applyAdminGate(isAdminMode());
