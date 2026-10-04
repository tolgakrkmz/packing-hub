const SHIFTS = ["А","Б","В","Г","СТИКЕРИ"];
let selectedShift = null;
let entries = [];
let reasons = [];
let isAdmin = false;

function defaultReasons(){
  return [
    'Механична повреда',
    'Електрическа повреда',
    'Смяна на артикул / пренастройка',
    'Липса на материал',
    'Качествен проблем / настройка',
    'Спиране на тока',
    'Друго'
  ];
}

const dateInput = document.getElementById('dateInput');
const dateHint = document.getElementById('dateHint');
const startInput = document.getElementById('startInput');
const endInput = document.getElementById('endInput');
const durationReadout = document.getElementById('durationReadout');
const reasonSelect = document.getElementById('reasonSelect');
const otherReasonRow = document.getElementById('otherReasonRow');
const otherReasonInput = document.getElementById('otherReasonInput');
const noteInput = document.getElementById('noteInput');
const saveBtn = document.getElementById('saveBtn');
const msg = document.getElementById('msg');
const reasonsAdminPanel = document.getElementById('reasonsAdminPanel');
const reasonsList = document.getElementById('reasonsList');
const newReasonInput = document.getElementById('newReasonInput');
const addReasonBtn = document.getElementById('addReasonBtn');
const historyMonthInput = document.getElementById('historyMonth');
historyMonthInput.value = currentMonthPrefix();
historyMonthInput.addEventListener('change', renderHistory);


function localDateStr(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

const now = new Date();
const debugHour = new URLSearchParams(location.search).get('testHour');
const todayStr = localDateStr(now);
const yesterdayObj = new Date(now);
yesterdayObj.setDate(yesterdayObj.getDate()-1);
const yesterdayStr = localDateStr(yesterdayObj);

// Match the production log's delayed night-shift reporting date.
const effectiveHour = debugHour !== null ? parseInt(debugHour,10) : now.getHours();
const isLikelyNightReport = effectiveHour < 10;
dateInput.value = isLikelyNightReport ? yesterdayStr : todayStr;

if(isLikelyNightReport){
  dateHint.textContent = '🌙 Избрана е вчерашна дата (нощна смяна) — провери дали е вярно.';
}

document.getElementById('yesterdayBtn').addEventListener('click', ()=>{
  dateInput.value = yesterdayStr;
  dateHint.textContent = '';
  renderDayTotal();
});

dateInput.addEventListener('change', ()=>{
  dateHint.textContent = '';
  renderDayTotal();
});


function timeToMin(t){
  const [h,m] = t.split(':').map(Number);
  return h*60+m;
}

// Missing or equal times leave the duration unspecified; earlier end times wrap past midnight.
function computeDuration(start, end){
  if(!start || !end) return null;
  const s = timeToMin(start), e = timeToMin(end);
  if(s === e) return null;
  let diff = e - s;
  if(diff < 0) diff += 24*60;
  return diff;
}

function fmtDur(min){
  if(min < 60) return min+' мин';
  const h = Math.floor(min/60);
  const rem = min % 60;
  return h+'ч' + (rem ? ' '+rem+'мин' : '');
}

function fmtHoursDecimal(min){
  return (min/60).toLocaleString('bg-BG',{minimumFractionDigits:1,maximumFractionDigits:1});
}

function updateDurationReadout(){
  const dur = computeDuration(startInput.value, endInput.value);
  if(dur === null){
    durationReadout.textContent = (startInput.value && endInput.value) ? 'еднакви часове' : '—';
    durationReadout.classList.toggle('warn', !!(startInput.value && endInput.value));
  } else {
    durationReadout.textContent = fmtDur(dur);
    durationReadout.classList.remove('warn');
  }
  updateSaveEnabled();
}
startInput.addEventListener('input', updateDurationReadout);
endInput.addEventListener('input', updateDurationReadout);


document.getElementById('shiftGrid').addEventListener('click', (e)=>{
  const btn = e.target.closest('.shift-btn');
  if(!btn) return;
  selectedShift = btn.dataset.shift;
  document.querySelectorAll('.shift-btn').forEach(b=>{
    b.classList.remove('sel-А','sel-Б','sel-В','sel-Г','sel-СТИКЕРИ');
  });
  btn.classList.add('sel-'+selectedShift);
  updateSaveEnabled();
});

function updateSaveEnabled(){
  const dur = computeDuration(startInput.value, endInput.value);
  const ok = !!selectedShift && dur !== null;
  saveBtn.disabled = !ok;
  saveBtn.textContent = ok ? ('Запиши авария — смяна '+selectedShift) : (selectedShift ? 'Въведете начало и край' : 'Изберете смяна за запис');
}


reasonSelect.addEventListener('change', ()=>{
  otherReasonRow.style.display = (reasonSelect.value === 'Друго') ? 'flex' : 'none';
});

function renderReasonSelect(){
  const prev = reasonSelect.value;
  reasonSelect.innerHTML = reasons.map(r=>'<option data-i18n-exact value="'+escapeDowntimeText(r)+'">'+escapeDowntimeText(r)+'</option>').join('');
  if(reasons.includes(prev)) reasonSelect.value = prev;
  otherReasonRow.style.display = (reasonSelect.value === 'Друго') ? 'flex' : 'none';
}

function escapeDowntimeText(value){
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}

function renderReasonsAdmin(){
  if(!isAdmin){
    reasonsAdminPanel.style.display = 'none';
    return;
  }
  reasonsAdminPanel.style.display = 'block';
  reasonsList.innerHTML = reasons.filter(r=>r!=='Друго').map(r=>
    '<span class="reason-chip" data-i18n-exact>'+escapeDowntimeText(r)+'<button data-reason="'+escapeDowntimeText(r)+'" title="Изтрий">✕</button></span>'
  ).join('') || '<span class="note-inline">Все още няма добавени причини.</span>';
  reasonsList.querySelectorAll('button[data-reason]').forEach(b=>{
    b.addEventListener('click', ()=>removeReason(b.dataset.reason));
  });
}

addReasonBtn.addEventListener('click', async ()=>{
  const val = newReasonInput.value.trim();
  if(!val) return;
  if(reasons.includes(val)){
    alert('Вече съществува такава причина.');
    return;
  }
  if(sync.fileHandle){ await sync.refreshFromDisk(); }
  reasons.splice(reasons.length-1, 0, val); // Keep the free-text reason as the final option.
  await sync.commitData();
  newReasonInput.value = '';
  render();
});

async function removeReason(r){
  if(!isAdmin) return;
  if(!confirm('Да изтрия причина "'+r+'"? Стари записи с нея остават непроменени.')) return;
  if(sync.fileHandle){ await sync.refreshFromDisk(); }
  reasons = reasons.filter(x=>x!==r);
  await sync.commitData();
  render();
}


const sync = createFileSync({
  dbName: 'portfolio-downtime-fs-db',
  suggestedFileName: 'line-downtime.json',
  localStorageKey: 'portfolio-downtime-fallback',
  defaultData: () => ({ entries: [], reasons: defaultReasons() }),
  getData: () => ({ entries, reasons }),
  render: render,
  onConnect: (data)=>{
    entries = data.entries || [];
    reasons = (data.reasons && data.reasons.length) ? data.reasons : defaultReasons();
    if(!reasons.includes('Друго')) reasons.push('Друго');
    renderReasonSelect();
  },
  onRefresh: (data)=>{
    entries = data.entries || [];
    reasons = (data.reasons && data.reasons.length) ? data.reasons : defaultReasons();
    if(!reasons.includes('Друго')) reasons.push('Друго');
    renderReasonSelect();
  },
  elements: {
    connDot: document.getElementById('connDot'),
    connText: document.getElementById('connText'),
    openFileBtn: document.getElementById('openFileBtn'),
    createFileBtn: document.getElementById('createFileBtn'),
    reconnectBtn: document.getElementById('reconnectBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    importFallback: document.getElementById('importFallback'),
    connNote: document.getElementById('connNote'),
    connRow: document.querySelector('#connPanel .conn-row')
  }
});

wireAdminToggle(document.getElementById('adminToggleBtn'), (admin)=>{
  isAdmin = admin;
  render();
});


saveBtn.addEventListener('click', async ()=>{
  const dur = computeDuration(startInput.value, endInput.value);
  if(!selectedShift || dur === null) return;

  const reason = reasonSelect.value;
  const reasonNote = otherReasonInput.value.trim();
  if(reason === 'Друго' && !reasonNote){
    msg.textContent = 'Опиши накратко причината при избор на "Друго".';
    return;
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    date: dateInput.value,
    shift: selectedShift,
    start: startInput.value,
    end: endInput.value,
    durationMin: dur,
    reason: reason,
    reasonNote: (reason === 'Друго') ? reasonNote : '',
    note: noteInput.value.trim()
  };

  saveBtn.disabled = true;
  saveBtn.textContent = 'Записва се...';
  if(sync.fileHandle){ await sync.refreshFromDisk(); }
  entries.push(entry);
  await sync.commitData();
  render();

  msg.textContent = 'Записано: смяна '+entry.shift+', '+fmtDur(entry.durationMin)+' престой, причина: '+entry.reason+(entry.reasonNote ? ' – '+entry.reasonNote : '')+'.';

  startInput.value = '';
  endInput.value = '';
  noteInput.value = '';
  otherReasonInput.value = '';
  durationReadout.textContent = '—';
  durationReadout.classList.remove('warn');
  selectedShift = null;
  document.querySelectorAll('.shift-btn').forEach(b=>{
    b.classList.remove('sel-А','sel-Б','sel-В','sel-Г','sel-СТИКЕРИ');
  });
  updateSaveEnabled();
});

async function deleteEntry(id){
  if(!isAdmin) return;
  if(sync.fileHandle){ await sync.refreshFromDisk(); }
  entries = entries.filter(e=>e.id !== id);
  await sync.commitData();
  render();
}


function fmtDate(d){
  const [y,m,day] = d.split('-');
  return day+'.'+m+'.'+y;
}

function renderDayTotal(){
  const d = dateInput.value;
  const totalMin = entries.filter(e=>e.date===d).reduce((a,e)=>a+e.durationMin,0);
  document.getElementById('dayLabel').textContent = (d===todayStr) ? 'днес' : fmtDate(d);
  document.getElementById('dayVal').textContent = fmtDur(totalMin);
}

function currentMonthPrefix(){
  const n = new Date();
  return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0');
}

function renderMonthSummary(){
  const prefix = currentMonthPrefix();
  const grid = document.getElementById('summaryGrid');
  grid.innerHTML = SHIFTS.map(s=>{
    const rows = entries.filter(e=>e.shift===s && e.date && e.date.startsWith(prefix));
    const totalMin = rows.reduce((a,e)=>a+e.durationMin,0);
    return '<div class="sum-card sum-'+s+'">'
      + '<div class="lab">'+s+'</div>'
      + '<div class="val">'+fmtHoursDecimal(totalMin)+' ч</div>'
      + '<div class="sub">'+rows.length+' авар.</div>'
      + '</div>';
  }).join('');
}

function renderReasonBars(){
  const prefix = currentMonthPrefix();
  const rows = entries.filter(e=>e.date && e.date.startsWith(prefix));
  const byReason = {};
  rows.forEach(e=>{ byReason[e.reason] = (byReason[e.reason]||0) + e.durationMin; });
  const sorted = Object.entries(byReason).sort((a,b)=>b[1]-a[1]);
  const wrap = document.getElementById('reasonBars');
  if(sorted.length === 0){
    wrap.innerHTML = '<div class="empty">Няма аварии този месец.</div>';
    return;
  }
  const max = sorted[0][1];
  wrap.innerHTML = sorted.map(([reason,min])=>{
    const pct = max > 0 ? Math.round(min/max*100) : 0;
    return '<div class="reason-row">'
      + '<div class="lab" data-i18n-exact title="'+escapeDowntimeText(reason)+'">'+escapeDowntimeText(reason)+'</div>'
      + '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div>'
      + '<div class="val">'+fmtDur(min)+'</div>'
      + '</div>';
  }).join('');
}

function renderHistory(){
  const wrap = document.getElementById('historyWrap');
  const month = historyMonthInput.value || currentMonthPrefix();
  historyMonthInput.value = month;
  const monthEntries = entries.filter(e=>e.date && e.date.startsWith(month+'-'));
  if(monthEntries.length === 0){
    wrap.innerHTML = '<div class="empty">Няма аварии за избрания месец.</div>';
    return;
  }
  const sorted = [...monthEntries].sort((a,b)=>{
    if(a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.id.localeCompare(a.id);
  });
  let html = '<table><thead><tr>'
    + '<th>Дата</th><th>Смяна</th><th>Час</th><th style="text-align:right">Продълж.</th><th>Причина</th><th></th>'
    + '</tr></thead><tbody>';
  sorted.forEach(e=>{
    const reasonText = '<span data-i18n-exact>'+escapeDowntimeText(e.reason)+'</span>' + (e.reasonNote ? ' <span class="note-inline" translate="no">– '+escapeDowntimeText(e.reasonNote)+'</span>' : '');
    const delCell = isAdmin
      ? '<td style="text-align:right"><button class="del-btn" data-id="'+e.id+'" title="Изтрий">✕</button></td>'
      : '<td></td>';
    html += '<tr>'
      + '<td>'+e.date+'</td>'
      + '<td><span class="tag tag-'+e.shift+'">'+e.shift+'</span></td>'
      + '<td>'+e.start+'–'+e.end+'</td>'
      + '<td class="num dur">'+fmtDur(e.durationMin)+'</td>'
      + '<td>'+reasonText+(e.note ? '<br><span class="note-inline" translate="no">'+escapeDowntimeText(e.note)+'</span>' : '')+'</td>'
      + delCell
      + '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  if(isAdmin){
    wrap.querySelectorAll('.del-btn').forEach(b=>{
      b.addEventListener('click', ()=>deleteEntry(b.dataset.id));
    });
  }
}

function render(){
  renderDayTotal();
  renderMonthSummary();
  renderReasonBars();
  renderHistory();
  renderReasonsAdmin();
}

sync.init();
