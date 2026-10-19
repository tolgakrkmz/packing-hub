const SHIFTS = ["А","Б","В","Г","СТИКЕРИ"];
let selectedShift = null;
let entries = [];
let reasons = [];
let editingReport = null;
let reportDraft = false;
const canEditReports = typeof HubServer === 'undefined' || HubServer.can('canEditReports');
const canManageReasons = typeof HubServer === 'undefined' || HubServer.can('canManageDowntimeSettings');

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

const reportDate = createReportDateSelection({
  dateInput,
  dateHint,
  yesterdayButton: document.getElementById('yesterdayBtn'),
  onChange: renderDayTotal,
  hourOverride: new URLSearchParams(location.search).get('testHour')
});

const writer = createReportWriter({
  sync: () => sync,
  getData: () => ({entries, reasons}),
  setData(value) { entries = value.entries; reasons = value.reasons; },
  render, updateControls: updateSaveEnabled,
  controls: () => Array.from(document.querySelectorAll('input, select, textarea, button, .shift-btn')),
  message: msg, retryButton: document.getElementById('retrySaveBtn')
});
for(const control of [startInput,endInput,reasonSelect,otherReasonInput,noteInput]) {
  for(const event of ['input','change']) control.addEventListener(event, () => { reportDraft = true; });
}
const downtimeDraft = typeof HubServer === 'undefined' ? null : HubServer.formDraft?.(
  {querySelectorAll:() => [startInput,endInput,reasonSelect,otherReasonInput,noteInput]},
  {extra:() => [selectedShift,editingReport ? dateInput.value : null]});
if(typeof HubServer !== 'undefined') HubServer.guardUpdate?.({isBusy:() => writer.busy,
  hasDraft:() => (downtimeDraft ? downtimeDraft.hasDraft() : reportDraft || !!selectedShift || !!editingReport) || !!newReasonInput.value.trim()});
document.getElementById('yesterdayBtn').addEventListener('click', writer.clearRetry);

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

const BG_ONE_DECIMAL = new Intl.NumberFormat('bg-BG',{minimumFractionDigits:1,maximumFractionDigits:1});
function fmtHoursDecimal(min){
  return BG_ONE_DECIMAL.format(min/60);
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
  if(writer.busy) return;
  writer.clearRetry();
  const btn = e.target.closest('.shift-btn');
  if(!btn) return;
  selectedShift = btn.dataset.shift;
  reportDate.selectShift(selectedShift);
  document.querySelectorAll('.shift-btn').forEach(b=>{
    b.classList.remove('sel-А','sel-Б','sel-В','sel-Г','sel-СТИКЕРИ');
  });
  btn.classList.add('sel-'+selectedShift);
  updateSaveEnabled();
});

function updateSaveEnabled(){
  const dur = computeDuration(startInput.value, endInput.value);
  const ok = !!selectedShift && dur !== null;
  saveBtn.disabled = writer.busy || !ok;
  saveBtn.textContent = writer.busy ? 'Записва се...' : editingReport ? 'Запази корекцията' : ok ? ('Запиши авария — смяна '+selectedShift) : (selectedShift ? 'Въведете начало и край' : 'Изберете смяна за запис');
  if(typeof HubServer !== 'undefined') saveBtn.hidden = !(editingReport ? canEditReports : HubServer.can('canCreateReports'));
  document.getElementById('cancelReportEdit').hidden = !editingReport;
}
document.getElementById('cancelReportEdit').addEventListener('click', () => {
  if(writer.busy) return;
  editingReport = null; writer.clearRetry(); selectedShift = null; updateSaveEnabled();
});
function editEntry(id) {
  if(!canEditReports || writer.busy || typeof HubServer === 'undefined') return;
  const entry = entries.find(item => item.id === id);
  if(!entry) return;
  writer.clearRetry(); editingReport = {entry:JSON.parse(JSON.stringify(entry)),version:sync.recordVersion(id)};
  selectedShift = entry.shift; dateInput.value = entry.date;
  startInput.value = entry.start; endInput.value = entry.end;
  if(!reasons.includes(entry.reason)) {
    const option = document.createElement('option'); option.value = entry.reason; option.textContent = entry.reason; reasonSelect.append(option);
  }
  reasonSelect.value = entry.reason;
  otherReasonInput.value = entry.reasonNote || '';
  otherReasonRow.style.display = reasonSelect.value === 'Друго' ? 'flex' : 'none'; noteInput.value = entry.note || '';
  durationReadout.textContent = fmtDur(entry.durationMin);
  document.querySelectorAll('.shift-btn').forEach(button => { for(const shift of SHIFTS) button.classList.remove('sel-'+shift); if(button.dataset.shift === selectedShift) button.classList.add('sel-'+selectedShift); });
  updateSaveEnabled(); msg.textContent = 'Редакция на запис. Промените се проверяват спрямо отворената версия.';
  downtimeDraft?.accept();
  dateInput.scrollIntoView?.({block:'center'});
}

reasonSelect.addEventListener('change', ()=>{
  otherReasonRow.style.display = (reasonSelect.value === 'Друго') ? 'flex' : 'none';
});

function renderReasonSelect(){
  const prev = reasonSelect.value;
  const choices = prev && !reasons.includes(prev) ? [...reasons,prev] : reasons;
  reasonSelect.innerHTML = choices.map(r=>'<option data-i18n-exact value="'+escapeDowntimeText(r)+'">'+escapeDowntimeText(r)+'</option>').join('');
  if(prev) reasonSelect.value = prev;
  otherReasonRow.style.display = (reasonSelect.value === 'Друго') ? 'flex' : 'none';
  if(!reportDraft && !editingReport && !selectedShift) downtimeDraft?.accept();
}

function escapeDowntimeText(value){
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}

function renderReasonsAdmin(){
  if(!canManageReasons){
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
  if(!canManageReasons || writer.busy) return;
  const val = newReasonInput.value.trim();
  if(!val) return;
  await writer.run(current => {
    if(current.reasons.includes(val)) return null;
    const next = [...current.reasons];
    next.splice(Math.max(next.indexOf('Друго'),0),0,val);
    return {...current,reasons:next};
  }, () => { newReasonInput.value = ''; }, 'Причината е добавена.');
});

async function removeReason(r){
  if(!canManageReasons || writer.busy) return;
  if(!confirm('Да изтрия причина "'+r+'"? Стари записи с нея остават непроменени.')) return;
  await writer.run(current => ({...current,reasons:current.reasons.filter(value => value !== r)}), () => {}, 'Причината е изтрита.');
}

const sync = createFileSync({
  dbName: 'portfolio-downtime-fs-db',
  suggestedFileName: 'line-downtime.json',
  localStorageKey: 'portfolio-downtime-fallback',
  defaultData: () => ({ entries: [], reasons: defaultReasons() }),
  isBusy: () => writer.busy,
  getData: () => ({ entries, reasons }),
  render: render,
  onConnect: (data)=>{
    entries = data.entries || [];
    globalThis.HubNotificationTarget?.select(entries, entry => entry.id, entry => { historyMonthInput.value = entry.date.slice(0,7); dateInput.value = entry.date; dateInput.dispatchEvent(new Event('change')); });
    reasons = (data.reasons && data.reasons.length) ? data.reasons : defaultReasons();
    if(!reasons.includes('Друго')) reasons.push('Друго');
    if(!writer.busy) renderReasonSelect();
  },
  onRefresh: (data)=>{
    entries = data.entries || [];
    globalThis.HubNotificationTarget?.select(entries, entry => entry.id, entry => { historyMonthInput.value = entry.date.slice(0,7); dateInput.value = entry.date; dateInput.dispatchEvent(new Event('change')); });
    reasons = (data.reasons && data.reasons.length) ? data.reasons : defaultReasons();
    if(!reasons.includes('Друго')) reasons.push('Друго');
    if(!writer.busy) renderReasonSelect();
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


saveBtn.addEventListener('click', async ()=>{
  const dur = computeDuration(startInput.value, endInput.value);
  if(writer.busy || !selectedShift || dur === null) return;

  const reason = reasonSelect.value;
  const reasonNote = otherReasonInput.value.trim();
  if(reason === 'Друго' && !reasonNote){
    msg.textContent = 'Опиши накратко причината при избор на "Друго".';
    return;
  }

  const draft = {
    date: dateInput.value,
    shift: selectedShift,
    start: startInput.value,
    end: endInput.value,
    durationMin: dur,
    reason: reason,
    reasonNote: (reason === 'Друго') ? reasonNote : '',
    note: noteInput.value.trim()
  };
  const entry = editingReport ? {...editingReport.entry,...draft} : writer.entry(draft);
  const operation = writer.operation(editingReport ? 'update' : 'create',entry,editingReport?.version);

  await writer.run(current => writer.append(current,entry), () => {
    writer.confirmEntry(entry);
    reportDraft = false;
    editingReport = null;
    startInput.value = '';
    endInput.value = '';
    noteInput.value = '';
    otherReasonInput.value = '';
    durationReadout.textContent = '—';
    durationReadout.classList.remove('warn');
    selectedShift = null;
    downtimeDraft?.accept();
    document.querySelectorAll('.shift-btn').forEach(b=>{
      b.classList.remove('sel-А','sel-Б','sel-В','sel-Г','sel-СТИКЕРИ');
    });
  }, 'Записано: смяна '+entry.shift+', '+fmtDur(entry.durationMin)+' престой, причина: '+entry.reason+(entry.reasonNote ? ' – '+entry.reasonNote : '')+'.',operation);
});

async function deleteEntry(id){
  if(!canEditReports || writer.busy) return;
  const original = entries.find(entry => entry.id === id);
  if(!original) return;
  await writer.run(current => writer.remove(current,original), () => {}, 'Записът е изтрит.',writer.operation('delete',original));
}

function fmtDate(d){
  const [y,m,day] = d.split('-');
  return day+'.'+m+'.'+y;
}

function renderDayTotal(){
  const d = dateInput.value;
  const totalMin = entries.filter(e=>e.date===d).reduce((a,e)=>a+e.durationMin,0);
  document.getElementById('dayLabel').textContent = (d===localDateStr(new Date())) ? 'днес' : fmtDate(d);
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
  // Reports are appended to entries; reverse them before the stable date sort.
  const sorted = monthEntries.reverse().sort((a,b)=>{
    if(a.date !== b.date) return a.date < b.date ? 1 : -1;
    return 0;
  });
  let html = '<table><thead><tr>'
    + '<th>Дата</th><th>Смяна</th><th>Час</th><th style="text-align:right">Продълж.</th><th>Причина</th><th></th>'
    + '</tr></thead><tbody>';
  sorted.forEach(e=>{
    const reasonText = '<span data-i18n-exact>'+escapeDowntimeText(e.reason)+'</span>' + (e.reasonNote ? ' <span class="note-inline" translate="no">– '+escapeDowntimeText(e.reasonNote)+'</span>' : '');
    const delCell = canEditReports
      ? '<td style="text-align:right">'+(typeof HubServer !== 'undefined' ? '<button class="edit-report-btn" data-id="'+escapeDowntimeText(e.id)+'">Редактирай</button>' : '')+'<button class="del-btn" data-id="'+escapeDowntimeText(e.id)+'" title="Изтрий">✕</button></td>'
      : '<td></td>';
    html += '<tr data-notification-target="'+escapeDowntimeText(e.id)+'">'
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
  globalThis.HubNotificationTarget?.reveal(wrap);

  if(canEditReports){
    wrap.querySelectorAll('.edit-report-btn').forEach(button => button.addEventListener('click', () => editEntry(button.dataset.id)));
    wrap.querySelectorAll('.del-btn').forEach(b=>{
      b.addEventListener('click', ()=>deleteEntry(b.dataset.id));
    });
  }
}

function render(){
  updateSaveEnabled();
  renderReasonSelect();
  renderDayTotal();
  renderMonthSummary();
  renderReasonBars();
  renderHistory();
  renderReasonsAdmin();
}

sync.init();
