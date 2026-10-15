const SHIFTS = ["А","Б","В","Г","СТИКЕРИ"];
let selectedShift = null;
let entries = [];
let addedHistoryMonth = null;
let goalTons = 3000;
let goalDraft = false;
let reportDraft = false;
let editingReport = null;
let explicitReportScope=null, scopeLinkError='';
try { if(typeof HubReportScope!=='undefined') explicitReportScope=HubReportScope.parse(location.search); }
catch(error) { scopeLinkError=error.message; }
const canEditReports = typeof HubServer === 'undefined' || HubServer.can('canEditReports');

const dateInput = document.getElementById('dateInput');
const tonInput = document.getElementById('tonInput');
const brakInput = document.getElementById('brakInput');
const saveBtn = document.getElementById('saveBtn');
const msg = document.getElementById('msg');
const goalInput = document.getElementById('goalInput');
const breakdownToggle = document.getElementById('breakdownToggle');
const simpleTonRow = document.getElementById('simpleTonRow');
const breakdownRows = document.getElementById('breakdownRows');
const autoKgInput = document.getElementById('autoKgInput');
const autoCrateInput = document.getElementById('autoCrateInput');
const manKgInput = document.getElementById('manKgInput');
const manCrateInput = document.getElementById('manCrateInput');
const totalReadout = document.getElementById('totalReadout');

function readQuantity(control){
  const value = Number(control.value || '0');
  return !control.validity?.badInput && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function quantityError(){
  msg.textContent = 'Въведи неотрицателни цели числа в допустимия диапазон за количествата и целта.';
  msg.dataset.state = 'error';
}

breakdownToggle.addEventListener('change', ()=>{
  const on = breakdownToggle.checked;
  simpleTonRow.style.display = on ? 'none' : 'flex';
  breakdownRows.style.display = on ? 'block' : 'none';
  updateTotalReadout();
});

function updateTotalReadout(){
  const auto = readQuantity(autoKgInput), manual = readQuantity(manKgInput);
  const total = auto === null || manual === null ? null : auto + manual;
  totalReadout.textContent = Number.isSafeInteger(total) ? fmt(total)+' кг' : '—';
}
[autoKgInput, manKgInput].forEach(inp=>{
  inp.addEventListener('input', updateTotalReadout);
});

function localDateStr(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

const reportDate = createReportDateSelection({
  dateInput,
  dateHint: document.getElementById('dateHint'),
  yesterdayButton: document.getElementById('yesterdayBtn'),
  onChange: renderDayTotal,
  hourOverride: new URLSearchParams(location.search).get('testHour')
});

const writer = createReportWriter({
  sync: () => sync,
  getData: () => ({entries, goalTons}),
  setData(value) { entries = value.entries; goalTons = value.goalTons; },
  render, updateControls: updateSaveEnabled,
  controls: () => Array.from(document.querySelectorAll('input, select, textarea, button, .shift-btn')),
  message: msg, retryButton: document.getElementById('retrySaveBtn')
});
for(const control of [tonInput,brakInput,autoKgInput,autoCrateInput,manKgInput,manCrateInput,breakdownToggle]) {
  for(const event of ['input','change']) control.addEventListener(event, () => { reportDraft = true; });
}
const productionDraft = typeof HubServer === 'undefined' ? null : HubServer.formDraft?.(
  {querySelectorAll:() => [tonInput,brakInput,autoKgInput,autoCrateInput,manKgInput,manCrateInput,breakdownToggle]},
  {extra:() => [selectedShift,editingReport ? dateInput.value : null]});
if(typeof HubServer !== 'undefined') HubServer.guardUpdate?.({isBusy:() => writer.busy,
  hasDraft:() => (productionDraft ? productionDraft.hasDraft() : reportDraft || !!selectedShift || !!editingReport) || goalDraft && goalInput.value !== String(goalTons)});
document.getElementById('yesterdayBtn').addEventListener('click', writer.clearRetry);

goalInput.addEventListener('input', () => { goalDraft = true; });
goalInput.addEventListener('change', async ()=>{
  if(writer.busy || typeof HubServer !== 'undefined' && !HubServer.can('canManageProductionSettings')) return;
  goalDraft = true;
  const v = readQuantity(goalInput);
  if(v === null) { quantityError(); return; }
  await writer.run(current => ({...current,goalTons:v}), () => { goalDraft = false; goalInput.value = v; }, 'Целта е записана.');
});

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
  saveBtn.disabled = writer.busy || !selectedShift || !!scopeLinkError;
  saveBtn.textContent = writer.busy ? 'Записва се...' : editingReport ? 'Запази корекцията' : selectedShift ? 'Запиши смяна ' + selectedShift : 'Изберете смяна за запис';
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
  tonInput.value = entry.tonnage; brakInput.value = entry.brak;
  breakdownToggle.checked = !!entry.breakdown;
  simpleTonRow.style.display = entry.breakdown ? 'none' : 'flex'; breakdownRows.style.display = entry.breakdown ? 'block' : 'none';
  for(const [control,key] of [[autoKgInput,'autoKg'],[autoCrateInput,'autoCrates'],[manKgInput,'manKg'],[manCrateInput,'manCrates']]) control.value = entry.breakdown?.[key] || 0;
  document.querySelectorAll('.shift-btn').forEach(button => { for(const shift of SHIFTS) button.classList.remove('sel-'+shift); if(button.dataset.shift === selectedShift) button.classList.add('sel-'+selectedShift); });
  updateTotalReadout(); updateSaveEnabled(); msg.textContent = 'Редакция на запис. Промените се проверяват спрямо отворената версия.';
  productionDraft?.accept();
  dateInput.scrollIntoView?.({block:'center'});
}

document.querySelectorAll('.stepper button, .quick button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(writer.busy) return;
    writer.clearRetry();
    const target = document.getElementById(btn.dataset.target);
    if(btn.dataset.set !== undefined){
      target.value = btn.dataset.set;
      reportDraft = true;
      updateTotalReadout();
      return;
    }
    const current = readQuantity(target);
    if(current === null) { quantityError(); return; }
    const step = Number(btn.dataset.step);
    let v = current + step;
    if(v < 0) v = 0;
    if(!Number.isSafeInteger(v)) { quantityError(); return; }
    target.value = v;
    reportDraft = true;
    updateTotalReadout();
  });
});

function fmt(n){
  return Math.round(n).toLocaleString('bg-BG');
}

const sync = createFileSync({
  dbName: 'portfolio-tonnage-fs-db',
  suggestedFileName: 'production-log.json',
  localStorageKey: 'portfolio-tonnage-fallback',
  defaultData: () => ({ entries: [], goalTons: 3000 }),
  isBusy: () => writer.busy,
  getData: () => ({ entries, goalTons }),
  render: render,
  onConnect: (data)=>{
    entries = data.entries || [];
    globalThis.HubNotificationTarget?.select(entries, entry => entry.id, entry => { addedHistoryMonth = entry.date.slice(0,7); dateInput.value = entry.date; dateInput.dispatchEvent(new Event('change')); });
    goalTons = (data.goalTons !== undefined) ? data.goalTons : 3000;
    if(!writer.busy && !goalDraft) goalInput.value = goalTons;
  },
  onRefresh: (data)=>{
    entries = data.entries || [];
    globalThis.HubNotificationTarget?.select(entries, entry => entry.id, entry => { addedHistoryMonth = entry.date.slice(0,7); dateInput.value = entry.date; dateInput.dispatchEvent(new Event('change')); });
    goalTons = (data.goalTons !== undefined) ? data.goalTons : 3000;
    if(!writer.busy && !goalDraft) goalInput.value = goalTons;
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

function fmtTons(kg){
  return (kg/1000).toLocaleString('bg-BG',{minimumFractionDigits:1,maximumFractionDigits:1});
}

function fmtDate(d){
  const [y,m,day] = d.split('-');
  return day+'.'+m+'.'+y;
}

function renderDayTotal(){
  const d = dateInput.value;
  const rows = entries.filter(e=>e.date===d);
  const total = rows.reduce((a,e)=>a+e.tonnage,0);
  const brak = rows.reduce((a,e)=>a+e.brak,0);
  document.getElementById('dayLabel').textContent = (d===localDateStr(new Date())) ? 'днес' : fmtDate(d);
  document.getElementById('dayVal').textContent = fmt(total)+' кг';
  document.getElementById('dayBrakVal').textContent = fmt(brak)+' кг';
}

function renderGoal(){
  if(!writer.busy && !goalDraft) goalInput.value = goalTons;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysTotal = new Date(year, month+1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysRemaining = Math.max(daysTotal - dayOfMonth + 1, 0);
  const monthPrefix = year + '-' + String(month+1).padStart(2,'0');

  const monthKg = entries.filter(e=>e.date && e.date.startsWith(monthPrefix))
    .reduce((a,e)=>a+e.tonnage,0);
  const goalKg = goalTons * 1000;

  document.getElementById('goalCur').textContent = fmtTons(monthKg)+' т';
  document.getElementById('goalTgt').textContent = 'от '+fmtTons(goalKg)+' т';

  const pct = goalKg > 0 ? (monthKg/goalKg*100) : 0;
  const fill = document.getElementById('progressFill');
  fill.style.width = Math.min(pct,100)+'%';

  const statusEl = document.getElementById('goalStatus');
  const currentDailyAvg = monthKg / dayOfMonth;
  const remainingKg = Math.max(goalKg - monthKg, 0);
  const requiredDailyAvg = daysRemaining > 0 ? remainingKg / daysRemaining : 0;
  const projectedKg = currentDailyAvg * daysTotal;

  let cls, text;
  if(monthKg >= goalKg){
    cls = 'status-done';
    text = '<b>Целта е постигната.</b> Изработени '+fmtTons(monthKg)+' т при цел '+fmtTons(goalKg)+' т за месеца.';
    fill.style.background = 'var(--teal)';
  } else if(daysRemaining <= 0){
    cls = 'status-bad';
    text = '<b>Месецът приключи</b> без постигане на целта — '+fmtTons(monthKg)+' от '+fmtTons(goalKg)+' т.';
    fill.style.background = 'var(--red)';
  } else if(projectedKg >= goalKg * 0.98){
    cls = 'status-ok';
    text = '<b>По план сте.</b> Остават '+daysRemaining+' дни. При сегашния темп (~'+fmtTons(currentDailyAvg)+' т/ден) прогнозата е '+fmtTons(projectedKg)+' т до края на месеца.';
    fill.style.background = 'var(--teal)';
  } else if(projectedKg >= goalKg * 0.85){
    cls = 'status-warn';
    text = '<b>Леко изоставане.</b> Остават '+daysRemaining+' дни. Нужен среден темп ~'+fmtTons(requiredDailyAvg)+' т/ден, за да стигнете целта (сегашен темп: ~'+fmtTons(currentDailyAvg)+' т/ден).';
    fill.style.background = 'var(--amber)';
  } else {
    cls = 'status-bad';
    text = '<b>Изоставане от плана.</b> Остават '+daysRemaining+' дни, а трябва средно ~'+fmtTons(requiredDailyAvg)+' т/ден — доста над сегашния темп от ~'+fmtTons(currentDailyAvg)+' т/ден.';
    fill.style.background = 'var(--red)';
  }
  statusEl.className = 'status '+cls;
  statusEl.innerHTML = text;
}

saveBtn.addEventListener('click', async ()=>{
  if(writer.busy || !selectedShift) return;
  const useBreakdown = breakdownToggle.checked;
  let tonnage, breakdown = null;
  if(useBreakdown){
    const autoKg = readQuantity(autoKgInput);
    const autoCrates = readQuantity(autoCrateInput);
    const manKg = readQuantity(manKgInput);
    const manCrates = readQuantity(manCrateInput);
    if([autoKg,autoCrates,manKg,manCrates].includes(null)) { quantityError(); return; }
    tonnage = autoKg + manKg;
    breakdown = { autoKg, autoCrates, manKg, manCrates };
  } else {
    tonnage = readQuantity(tonInput);
  }
  const brak = readQuantity(brakInput);
  if(!Number.isSafeInteger(tonnage) || brak === null) { quantityError(); return; }
  const draft = {
    date: dateInput.value,
    shift: selectedShift,
    tonnage: tonnage,
    brak: brak,
    breakdown: breakdown
  };
  const entry = editingReport ? {...editingReport.entry,...draft} : writer.entry(draft);
  const operation = writer.operation(editingReport ? 'update' : 'create',entry,editingReport?.version);
  await writer.run(current => writer.append(current,entry), () => {
    writer.confirmEntry(entry);
    reportDraft = false;
    editingReport = null;
    addedHistoryMonth = entry.date.slice(0,7);
    tonInput.value = 0;
    brakInput.value = 0;
    autoKgInput.value = 0;
    autoCrateInput.value = 0;
    manKgInput.value = 0;
    manCrateInput.value = 0;
    updateTotalReadout();
    selectedShift = null;
    productionDraft?.accept();
    document.querySelectorAll('.shift-btn').forEach(b=>{
      b.classList.remove('sel-А','sel-Б','sel-В','sel-Г','sel-СТИКЕРИ');
    });
  }, 'Записано: смяна ' + entry.shift + ', ' + fmt(entry.tonnage) + ' кг тонаж, ' + fmt(entry.brak) + ' кг брак.',operation);
});

async function deleteEntry(id){
  if(!canEditReports || writer.busy) return;
  const original = entries.find(entry => entry.id === id);
  if(!original) return;
  await writer.run(current => writer.remove(current,original), () => {}, 'Записът е изтрит.',writer.operation('delete',original));
}

let historyMonths = new Map();
function historyTable(rows) {
  let html = '<table><thead><tr>'
    + '<th>Дата</th><th>Смяна</th><th style="text-align:right">Тонаж</th><th style="text-align:right">Каси</th><th style="text-align:right">Брак</th><th></th>'
    + '</tr></thead><tbody>';
    rows.forEach(e=>{
      const bd = e.breakdown;
      const crates = bd ? (bd.autoCrates + bd.manCrates) : null;
      let detailRow = '';
      if(bd){
        detailRow = '<tr class="bd-detail"><td></td><td colspan="5" style="padding:0 8px 9px;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border);">'
          + 'Авт. машина: '+fmt(bd.autoKg)+' кг ('+fmt(bd.autoCrates)+' каси) · Ръчна опаковка: '+fmt(bd.manKg)+' кг ('+fmt(bd.manCrates)+' каси)'
          + '</td></tr>';
      }
      const delCell = canEditReports
        ? '<td style="text-align:right">'+(typeof HubServer !== 'undefined' ? '<button class="edit-report-btn" data-id="'+escapeReportId(e.id)+'">Редактирай</button>' : '')+'<button class="del-btn" data-id="'+escapeReportId(e.id)+'" title="Изтрий">✕</button></td>'
        : '<td></td>';
      html += '<tr data-notification-target="'+escapeReportId(e.id)+'">'
        + '<td>'+e.date+'</td>'
        + '<td><span class="tag tag-'+e.shift+'">'+e.shift+'</span></td>'
        + '<td class="num">'+fmt(e.tonnage)+' кг</td>'
        + '<td class="num">'+(crates!==null ? fmt(crates) : '—')+'</td>'
        + '<td class="num brak">'+fmt(e.brak)+' кг</td>'
        + delCell
        + '</tr>'
        + detailRow;
    });
  return html + '</tbody></table>';
}

const historyWrap = document.getElementById('historyWrap');
// Toggle does not bubble. Capture it once for both initial and refreshed groups.
historyWrap.addEventListener('toggle', event => {
  const section = event.target;
  if (!section.matches('.history-month') || !historyWrap.contains(section)) return;
  const table = section.querySelector('.history-month-table');
  if (!section.open) table.replaceChildren();
  else if (!table.hasChildNodes()) table.innerHTML = historyTable(historyMonths.get(section.dataset.month) || []);
}, true);
historyWrap.addEventListener('click', event => {
  if (!canEditReports) return;
  const button = event.target.closest('.edit-report-btn, .del-btn');
  if (!button || !historyWrap.contains(button)) return;
  if (button.classList.contains('edit-report-btn')) editEntry(button.dataset.id);
  else deleteEntry(button.dataset.id);
});

function render(){
  updateSaveEnabled();
  renderDayTotal();
  renderGoal();

const grid = document.getElementById('summaryGrid');
const nowMonthPrefix = new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0');
grid.innerHTML = SHIFTS.map(s=>{
  const rows = entries.filter(e=>e.shift===s && e.date && e.date.startsWith(nowMonthPrefix));
  const ton = rows.reduce((a,e)=>a+e.tonnage,0);
  const brak = rows.reduce((a,e)=>a+e.brak,0);
  return '<div class="sum-card sum-'+s+'">'
    + '<div class="lab">'+s+'</div>'
    + '<div class="val">'+fmt(ton)+' кг</div>'
    + '<div class="sub">брак: '+fmt(brak)+' кг</div>'
    + '</div>';
}).join('');

  // Preserve expanded history groups during automatic refreshes.
  const wrap = document.getElementById('historyWrap');
  const monthOpenStates = new Map(Array.from(wrap.querySelectorAll('.history-month'), section=>[
    section.dataset.month, section.open
  ]));
  if(entries.length === 0){
    historyMonths = new Map();
    addedHistoryMonth = null;
    wrap.innerHTML = '<div class="empty">Все още няма записи.</div>';
    return;
  }
  // Newest report dates first; preserve newest additions first within the same day.
  const sorted = [...entries].reverse().sort((a,b)=>(b.date || '').localeCompare(a.date || ''));
  const months = new Map();
  sorted.forEach(entry=>{
    const monthKey = entry.date ? entry.date.slice(0,7) : '';
    if(!months.has(monthKey)) months.set(monthKey, []);
    months.get(monthKey).push(entry);
  });
  historyMonths = months;
  const monthNames = ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'];
  const latestMonth = months.keys().next().value;
  let html = '';
  months.forEach((rows, monthKey)=>{
    const [year, month] = monthKey.split('-');
    const label = monthKey ? monthNames[Number(month)-1]+' '+year : 'Без дата';
    const tonnage = rows.reduce((total, entry)=>total+entry.tonnage, 0);
    const isOpen = monthKey === addedHistoryMonth || (monthOpenStates.has(monthKey) ? monthOpenStates.get(monthKey) : monthKey === latestMonth);
    html += '<details class="history-month" data-month="'+monthKey+'"'+(isOpen ? ' open' : '')+'>'
      + '<summary><span class="history-month-title">'+label+'</span>'
      + '<span class="history-month-stats"><b>'+fmt(tonnage)+' кг</b> · '+rows.length+' '+(rows.length===1 ? 'запис' : 'записа')+'</span></summary>'
      + '<div class="history-month-table">'+(isOpen ? historyTable(rows) : '')+'</div></details>';
  });
  wrap.innerHTML = html;
  addedHistoryMonth = null;
  globalThis.HubNotificationTarget?.reveal(wrap);
}
function escapeReportId(value) { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }

if(explicitReportScope) {
  dateInput.value=explicitReportScope.date;
  dateInput.dispatchEvent(new Event('input',{bubbles:true}));
  selectedShift=explicitReportScope.team;
  document.querySelectorAll('.shift-btn').forEach(button=>button.classList.toggle('sel-'+selectedShift,button.dataset.shift===selectedShift));
  updateSaveEnabled();productionDraft?.accept();
}
if(scopeLinkError) {msg.textContent=scopeLinkError;msg.dataset.state='error';updateSaveEnabled();}
sync.init();
