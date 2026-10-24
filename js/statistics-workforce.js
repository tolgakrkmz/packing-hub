/* Statistics: workforce and capacity dashboard. */

/* Linear model: tonnage per person per calendar day × staff × days in the month.
 * Staff is auto + manual + stickers, and the stickers shift tonnage counts too.
 * Historical periods use the current roster because dated roster snapshots are not available. */

function getPersonnelSnapshot() {
  return statisticsCache.get('personnel-counts', [personnelEmployees, personnelCounts, personnelLoaded], ShiftSchedule.sofiaDate(), calculatePersonnelSnapshot);
}
function calculatePersonnelSnapshot() {
  if (personnelCounts) return personnelCounts;
  if (!personnelLoaded || !personnelEmployees.length) return null;

  const active = personnelEmployees.filter(p => p && p.active !== false).map(p => PersonnelModel.assignmentAt(p,ShiftSchedule.sofiaDate()));
  const counts = {
    auto: {},
    manual: {},
    production: {},
    autoTotal: 0,
    manualTotal: 0,
    productionTotal: 0,
    stickers: 0,
    additional: personnelEmployees.filter(p => p && p.active === false).length,
    totalActive: active.length
  };

  WF_TEAMS.forEach(team => {
    counts.auto[team] = active.filter(p => p.category === 'auto' && p.team === team).length;
    counts.manual[team] = active.filter(p => p.category === 'manual' && p.team === team).length;
    counts.production[team] = counts.auto[team] + counts.manual[team];
    counts.autoTotal += counts.auto[team];
    counts.manualTotal += counts.manual[team];
    counts.productionTotal += counts.production[team];
  });

  counts.stickers = active.filter(p => p.category === 'stickers').length;
  return counts;
}

function aggregateWorkforceMonth(counts) {
  return statisticsCache.get('workforce-month', [entries, counts], `${selectedYear}-${selectedDashboardMonth}|${statisticsDay()}`, () => calculateWorkforceMonth(counts));
}
function calculateWorkforceMonth(counts) {
  if (!selectedYear || !selectedDashboardMonth || !counts) return null;

  const year = Number(selectedYear);
  const month = Number(selectedDashboardMonth);
  const prefix = `${selectedYear}-${selectedDashboardMonth}-`;
  const shifts = [...WF_TEAMS, ShiftSchedule.STICKERS.team];
  const rows = entries.filter(e => e.date && e.date.startsWith(prefix) && shifts.includes(e.shift));
  const productionKg = rows.reduce((sum, e) => sum + (Number(e.tonnage) || 0), 0);
  const staff = workforceStaff(counts);

  const daysTotal = new Date(year, month, 0).getDate();
  const lastEntryDay = rows.reduce((max, e) => Math.max(max, Number(String(e.date).slice(8,10)) || 0), 0);
  const now = new Date();
  const isPastMonth = new Date(year, month - 1, 1) < new Date(now.getFullYear(), now.getMonth(), 1);
  // The open month is measured up to the last reported day, so late reports do not lower productivity.
  const measurementDays = isPastMonth ? daysTotal : Math.max(1, Math.min(daysTotal, lastEntryDay));

  return {
    year,
    month,
    daysTotal,
    reportCount: rows.length,
    productionKg,
    measurementDays,
    rosterProductivityTonsPerDay: staff > 0 ? (productionKg / 1000) / (staff * measurementDays) : 0
  };
}

// Roster line assignments change often, so the line split uses live data: people from that
// shift's pairs (a mixed pair counts half of its people on each line) and tonnage from the
// shift's auto/manual breakdown. Shifts missing either side are left out.
function liveLineProductivity(production, pairs, prefix) {
  const people = new Map(), tonnage = new Map();
  pairs.forEach(pair => {
    if (!pair.date || !pair.date.startsWith(prefix) || !WF_TEAMS.includes(pair.team) || pair.cancellation || !pair.areas?.length) return;
    const key = `${pair.date}|${pair.team}`, row = people.get(key) || {auto:0, manual:0};
    pair.areas.forEach(area => { if (area in row) row[area] += pair.members.length / pair.areas.length; });
    people.set(key, row);
  });
  production.forEach(e => {
    if (!e.breakdown || !e.date || !e.date.startsWith(prefix) || !WF_TEAMS.includes(e.shift)) return;
    const key = `${e.date}|${e.shift}`, row = tonnage.get(key) || {auto:0, manual:0};
    row.auto += Number(e.breakdown.autoKg) || 0;
    row.manual += Number(e.breakdown.manKg) || 0;
    tonnage.set(key, row);
  });
  const result = {auto:{kg:0, people:0, shifts:0}, manual:{kg:0, people:0, shifts:0}};
  tonnage.forEach((kg, key) => {
    const row = people.get(key);
    if (!row) return;
    for (const line of ['auto', 'manual']) {
      if (!row[line]) continue;
      result[line].kg += kg[line];
      result[line].people += row[line];
      result[line].shifts += 1;
    }
  });
  for (const line of ['auto', 'manual']) {
    const r = result[line];
    r.tonsPerPerson = r.people ? r.kg / 1000 / r.people : null;
  }
  return result;
}

function workforceStaff(counts) {
  return (Number(counts.productionTotal) || 0) + (Number(counts.stickers) || 0);
}

function workforceScenario(monthData, counts) {
  const staff = counts ? workforceStaff(counts) : 0;
  if (!monthData || !staff) return null;

  const target = Math.max(0, Number(goalTons) || 0);
  const productivity = Math.max(0, Number(monthData.rosterProductivityTonsPerDay) || 0);
  if (!target || !productivity || !monthData.daysTotal) return {target, productivity, staff, valid: false};

  const capacity = productivity * staff * monthData.daysTotal;
  const requiredRaw = target / (productivity * monthData.daysTotal);
  const required = Math.ceil(requiredRaw);
  return {
    target,
    productivity,
    staff,
    capacity,
    requiredRaw,
    required,
    gap: required - staff,
    requiredProductivity: target / (staff * monthData.daysTotal),
    valid: true
  };
}

function renderWorkforceCapacityChart(monthData, scenario) {
  if (!el.wfCapacityChart) return;
  if (!scenario || !scenario.valid) {
    el.wfCapacityChart.innerHTML = '<div class="wf-chart-empty">Нужни са данни за тонаж и производителност, за да се изчертае капацитетът.</div>';
    return;
  }

  const current = scenario.staff;
  const maxStaff = Math.max(40, Math.ceil(Math.max(current, scenario.required) * 1.18 / 10) * 10);
  const yMax = Math.max(scenario.target * 1.18, scenario.productivity * monthData.daysTotal * maxStaff);

  const W = 760, H = 285;
  const L = 80, R = 24, T = 24, B = 42;
  const PW = W - L - R, PH = H - T - B;
  const x = n => L + (n / maxStaff) * PW;
  const y = tons => T + PH - (tons / yMax) * PH;
  const capAt = staff => staff * scenario.productivity * monthData.daysTotal;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const tons = yMax * i / 4;
    const yy = y(tons);
    grid += `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="rgba(255,255,255,.055)" stroke-width="1"/>`;
    grid += `<text x="${L-9}" y="${yy+4}" fill="#8b929e" font-size="9" text-anchor="end">${StatisticsUnits.formatTons(tons)} т</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const staff = maxStaff * i / 4;
    grid += `<text x="${x(staff)}" y="${H-16}" fill="#8b929e" font-size="9" text-anchor="middle">${Math.round(staff)}</text>`;
  }

  const targetY = y(scenario.target);
  const currentX = x(current), currentY = y(capAt(current));
  const reqX = x(scenario.requiredRaw), reqY = y(scenario.target);
  const lineEndY = y(capAt(maxStaff));
  const capColor = scenario.capacity >= scenario.target ? '#3fbfa0' : '#9b7bd1';

  el.wfCapacityChart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Месечен тонаж според броя хора">
      <defs>
        <linearGradient id="wfAreaGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${capColor}" stop-opacity=".18"/>
          <stop offset="100%" stop-color="${capColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <line x1="${L}" y1="${targetY}" x2="${W-R}" y2="${targetY}" stroke="#f5a623" stroke-width="1.5" stroke-dasharray="6 5" opacity=".9"/>
      <text x="${W-R}" y="${Math.max(T+10,targetY-7)}" fill="#f5a623" font-size="10" text-anchor="end" font-weight="700">Цел ${StatisticsUnits.formatTons(scenario.target)} т</text>
      <path d="M ${x(0)} ${y(0)} L ${x(maxStaff)} ${lineEndY} L ${x(maxStaff)} ${y(0)} Z" fill="url(#wfAreaGradient)"/>
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(maxStaff)}" y2="${lineEndY}" stroke="${capColor}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${currentX}" y1="${T}" x2="${currentX}" y2="${H-B}" stroke="rgba(255,255,255,.13)" stroke-width="1" stroke-dasharray="3 5"/>
      <circle cx="${currentX}" cy="${currentY}" r="5.5" fill="${capColor}" stroke="#1a1d22" stroke-width="3"/>
      <text x="${currentX}" y="${Math.max(T+11,currentY-11)}" fill="#e6e9ee" font-size="10" text-anchor="middle" font-weight="800">Текущ щат ${current}</text>
      <circle cx="${reqX}" cy="${reqY}" r="5.5" fill="#f5a623" stroke="#1a1d22" stroke-width="3"/>
      ${Math.abs(reqX - currentX) < 70 ? '' : `<text x="${reqX}" y="${Math.min(H-B-10,reqY+20)}" fill="#f5a623" font-size="10" text-anchor="middle" font-weight="800">Нужен щат ${scenario.required}</text>`}
      <text x="${L}" y="12" fill="#8b929e" font-size="9">Месечен тонаж</text>
      <text x="${W-R}" y="${H-2}" fill="#8b929e" font-size="9" text-anchor="end">Брой хора в щата</text>
    </svg>`;
}

function setWfKpiClass(node, cls) {
  if (!node) return;
  node.classList.remove('good','warn','bad');
  if (cls) node.classList.add(cls);
}

function renderWorkforceDashboard() {
  if (!el.workforceDashboard) return;

  el.wfSubtitle.textContent = selectedPeriodLabel();
  const counts = getPersonnelSnapshot();
  if (!counts) {
    el.wfNoData.style.display = 'block';
    el.wfBody.style.display = 'none';
    el.wfNoData.innerHTML = globalThis.HUB_SERVER_BOOT
      ? personnelLoaded
        ? '<strong>Съставът в общата база е празен.</strong> За статистиката е нужен въведен активен състав.'
        : '<strong>Данните за състава още не са заредени.</strong> Провери връзката с общата база и натисни „Опресни“ от панела за връзка.'
      : '<strong>Няма свързан файл за състава.</strong> Свържи <b>personnel.json</b> от панела „Споделени файлове“. Ако вече е отварян в Personnel / Shift на този компютър, връзката обикновено се възстановява автоматично.';
    el.wfStaffSource.textContent = globalThis.HUB_SERVER_BOOT && personnelLoaded ? 'празен' : 'не е свързан';
    el.wfStatus.className = 'status-chip neutral';
    el.wfStatus.textContent = 'Няма personnel данни';
    return;
  }

  const staff = workforceStaff(counts);
  const monthData = aggregateWorkforceMonth(counts);
  if (!monthData || !monthData.reportCount || !monthData.rosterProductivityTonsPerDay) {
    el.wfNoData.style.display = 'block';
    el.wfBody.style.display = 'none';
    el.wfNoData.innerHTML = '<strong>Няма достатъчно тонажни записи за избрания месец.</strong> Капацитетът се изчислява от реалните записи А / Б / В / Г / Стикери и текущия активен състав.';
    el.wfStaffSource.textContent = `${staff} души`;
    el.wfStatus.className = 'status-chip neutral';
    el.wfStatus.textContent = 'Няма база за изчисление';
    return;
  }

  el.wfNoData.style.display = 'none';
  el.wfBody.style.display = 'block';

  const scenario = workforceScenario(monthData, counts);
  const tons = StatisticsUnits.formatTons;
  el.wfStaffSource.textContent = `${staff} души`;
  el.wfSubtitle.textContent = `${MONTH_FULL_LABELS[monthData.month - 1]} ${monthData.year}: колко хора са нужни за месечната цел при реалния тонаж на човек.`;

  el.wfCurrentStaff.textContent = `${staff}`;
  const prefix = `${monthData.year}-${String(monthData.month).padStart(2,'0')}-`;
  const live = statisticsCache.get('workforce-lines', [entries, pairStatistics.getVersion()], prefix, () => liveLineProductivity(entries, pairStatistics.getEntries(), prefix));
  for (const [line, value, sub] of [['auto', el.wfAutoLive, el.wfAutoLiveSub], ['manual', el.wfManualLive, el.wfManualLiveSub]]) {
    const r = live[line];
    value.textContent = r.tonsPerPerson === null ? '—' : `${tons(r.tonsPerPerson)} т`;
    sub.textContent = r.tonsPerPerson === null ? 'няма смени с двойки и разбивка' : `${fmtTons(r.kg)} т ÷ ${wfFmt(r.people,1)} души-смени · ${r.shifts} ${r.shifts === 1 ? 'смяна' : 'смени'}`;
  }
  el.wfStickersCount.textContent = `${counts.stickers} души`;
  el.wfMeasuredProductivity.textContent = `${tons(monthData.rosterProductivityTonsPerDay)} т`;
  el.wfMeasuredProductivitySub.textContent = `${fmtTons(monthData.productionKg)} т ÷ (${staff} души × ${monthData.measurementDays} дни)`;
  el.wfCalcTarget.textContent = `${tons(goalTons)} т`;
  el.wfAdditionalNote.textContent = `„Допълнителни“ (${counts.additional} души) не влизат в щата.`;
  el.wfStepProductivity.innerHTML = `${fmtTons(monthData.productionKg)} т ÷ (${staff} души × ${monthData.measurementDays} дни) = <b>${tons(monthData.rosterProductivityTonsPerDay)} т</b>`;

  if (!scenario || !scenario.valid) {
    for (const node of [el.wfRequiredProductivity, el.wfRequiredProductivitySub, el.wfCurrentCapacity, el.wfCurrentCapacitySub, el.wfRequiredBase, el.wfRequiredBaseSub, el.wfGap, el.wfStepRequired, el.wfStepGap]) node.textContent = '—';
    setWfKpiClass(el.wfCapacityKpi, '');
    setWfKpiClass(el.wfGapKpi, '');
    el.wfStatus.className = 'status-chip neutral';
    el.wfStatus.textContent = 'Няма месечна цел';
    renderWorkforceCapacityChart(monthData, scenario);
    return;
  }

  const coverage = scenario.capacity / scenario.target;
  const gapText = scenario.gap > 0 ? `+${scenario.gap}` : String(scenario.gap);
  const gapCls = scenario.gap <= 0 ? 'good' : (scenario.gap <= 5 ? 'warn' : 'bad');
  el.wfStatus.className = `status-chip ${scenario.gap <= 0 ? 'good' : (coverage >= .9 ? 'warn' : 'bad')}`;
  el.wfStatus.textContent = scenario.gap > 0 ? `Не достигат ${scenario.gap} души` : 'Щатът покрива целта';

  el.wfRequiredProductivity.textContent = `${tons(scenario.requiredProductivity)} т`;
  el.wfRequiredProductivitySub.textContent = `${tons(scenario.target)} т ÷ (${staff} души × ${monthData.daysTotal} дни)`;
  el.wfCurrentCapacity.textContent = `${tons(scenario.capacity)} т`;
  el.wfCurrentCapacitySub.textContent = `${wfFmt(coverage*100,0)}% от целта ${tons(scenario.target)} т`;
  el.wfRequiredBase.textContent = `${scenario.required}`;
  el.wfRequiredBaseSub.textContent = `души за ${tons(scenario.target)} т`;
  el.wfGap.textContent = gapText;
  el.wfGapSub.textContent = `${scenario.required} нужни − ${staff} в щата`;
  setWfKpiClass(el.wfCapacityKpi, coverage >= 1 ? 'good' : (coverage >= .9 ? 'warn' : 'bad'));
  setWfKpiClass(el.wfGapKpi, gapCls);

  el.wfStepRequired.innerHTML = `${tons(scenario.target)} т ÷ (${tons(scenario.productivity)} т × ${monthData.daysTotal} дни) = <b>${scenario.required} души</b>`;
  el.wfStepGap.innerHTML = `${scenario.required} − ${staff} = <b>${gapText} души</b>`;

  renderWorkforceCapacityChart(monthData, scenario);
}
