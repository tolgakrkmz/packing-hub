const SHIFTS = ["А","Б","В","Г","СТИКЕРИ"];
let selectedShift = null;
let entries = [];
let addedHistoryMonth = null;
let goalTons = 3000;
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

breakdownToggle.addEventListener('change', ()=>{
  const on = breakdownToggle.checked;
  simpleTonRow.style.display = on ? 'none' : 'flex';
  breakdownRows.style.display = on ? 'block' : 'none';
  updateTotalReadout();
});

function updateTotalReadout(){
  const total = (parseInt(autoKgInput.value||'0',10)) + (parseInt(manKgInput.value||'0',10));
  totalReadout.textContent = fmt(total)+' кг';
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
document.getElementById('yesterdayBtn').addEventListener('click', writer.clearRetry);

goalInput.addEventListener('change', async ()=>{
  if(writer.busy) return;
  let v = parseInt(goalInput.value || '0', 10);
  if(v < 0) v = 0;
  await writer.run(current => ({...current,goalTons:v}), () => { goalInput.value = v; }, 'Целта е записана.');
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
  saveBtn.disabled = writer.busy || !selectedShift;
  saveBtn.textContent = writer.busy ? 'Записва се...' : selectedShift ? 'Запиши смяна ' + selectedShift : 'Изберете смяна за запис';
}

document.querySelectorAll('.stepper button, .quick button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(writer.busy) return;
    writer.clearRetry();
    const target = document.getElementById(btn.dataset.target);
    if(btn.dataset.set !== undefined){
      target.value = btn.dataset.set;
      updateTotalReadout();
      return;
    }
    const step = parseInt(btn.dataset.step,10);
    let v = parseInt(target.value || '0', 10) + step;
    if(v < 0) v = 0;
    target.value = v;
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
    goalTons = (data.goalTons !== undefined) ? data.goalTons : 3000;
    if(!writer.busy) goalInput.value = goalTons;
  },
  onRefresh: (data)=>{
    entries = data.entries || [];
    goalTons = (data.goalTons !== undefined) ? data.goalTons : 3000;
    if(!writer.busy) goalInput.value = goalTons;
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
  const total = entries.filter(e=>e.date===d).reduce((a,e)=>a+e.tonnage,0);
  document.getElementById('dayLabel').textContent = (d===localDateStr(new Date())) ? 'днес' : fmtDate(d);
  document.getElementById('dayVal').textContent = fmt(total)+' кг';
}

function renderGoal(){
  if(!writer.busy) goalInput.value = goalTons;
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
    const autoKg = parseInt(autoKgInput.value||'0',10);
    const autoCrates = parseInt(autoCrateInput.value||'0',10);
    const manKg = parseInt(manKgInput.value||'0',10);
    const manCrates = parseInt(manCrateInput.value||'0',10);
    tonnage = autoKg + manKg;
    breakdown = { autoKg, autoCrates, manKg, manCrates };
  } else {
    tonnage = parseInt(tonInput.value||'0',10);
  }
  const entry = writer.entry({
    date: dateInput.value,
    shift: selectedShift,
    tonnage: tonnage,
    brak: parseInt(brakInput.value||'0',10),
    breakdown: breakdown
  });
  await writer.run(current => writer.append(current,entry), () => {
    writer.confirmEntry(entry);
    addedHistoryMonth = entry.date.slice(0,7);
    tonInput.value = 0;
    brakInput.value = 0;
    autoKgInput.value = 0;
    autoCrateInput.value = 0;
    manKgInput.value = 0;
    manCrateInput.value = 0;
    updateTotalReadout();
    selectedShift = null;
    document.querySelectorAll('.shift-btn').forEach(b=>{
      b.classList.remove('sel-А','sel-Б','sel-В','sel-Г','sel-СТИКЕРИ');
    });
  }, 'Записано: смяна ' + entry.shift + ', ' + fmt(entry.tonnage) + ' кг тонаж, ' + fmt(entry.brak) + ' кг брак.');
});

async function deleteEntry(id){
  if(!canEditReports || writer.busy) return;
  const original = entries.find(entry => entry.id === id);
  if(!original) return;
  await writer.run(current => writer.remove(current,original), () => {}, 'Записът е изтрит.');
}

function render(){
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
    wrap.innerHTML = '<div class="empty">Все още няма записи.</div>';
    return;
  }
  // Reports are appended on save; show the latest addition first, including backdated reports.
  const sorted = [...entries].reverse();
  const months = new Map();
  sorted.forEach(entry=>{
    const monthKey = entry.date ? entry.date.slice(0,7) : '';
    if(!months.has(monthKey)) months.set(monthKey, []);
    months.get(monthKey).push(entry);
  });
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
      + '<div class="history-month-table"><table><thead><tr>'
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
        ? '<td style="text-align:right"><button class="del-btn" data-id="'+e.id+'" title="Изтрий">✕</button></td>'
        : '<td></td>';
      html += '<tr>'
        + '<td>'+e.date+'</td>'
        + '<td><span class="tag tag-'+e.shift+'">'+e.shift+'</span></td>'
        + '<td class="num">'+fmt(e.tonnage)+' кг</td>'
        + '<td class="num">'+(crates!==null ? fmt(crates) : '—')+'</td>'
        + '<td class="num brak">'+fmt(e.brak)+' кг</td>'
        + delCell
        + '</tr>'
        + detailRow;
    });
    html += '</tbody></table></div></details>';
  });
  wrap.innerHTML = html;
  addedHistoryMonth = null;

  if(canEditReports){
    wrap.querySelectorAll('.del-btn').forEach(b=>{
      b.addEventListener('click', ()=>deleteEntry(b.dataset.id));
    });
  }
}

sync.init();
