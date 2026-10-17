/* Statistics: workforce and capacity dashboard. */

/* Workforce capacity assumes three operating shifts per day. Stickers are
 * excluded from production headcount. Historical periods use the current roster
 * because dated roster snapshots are not available. */

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
  const groups = new Map();

  entries.forEach(e => {
    if (!e.date || !e.date.startsWith(prefix) || !WF_TEAMS.includes(e.shift)) return;
    const key = `${e.date}|${e.shift}`;
    if (!groups.has(key)) {
      groups.set(key, {
        date: e.date,
        shift: e.shift,
        kg: 0,
        autoKg: 0,
        manKg: 0,
        hasBreakdown: false
      });
    }
    const g = groups.get(key);
    g.kg += Number(e.tonnage) || 0;
    if (e.breakdown && typeof e.breakdown === 'object') {
      g.autoKg += Number(e.breakdown.autoKg) || 0;
      g.manKg += Number(e.breakdown.manKg) || 0;
      g.hasBreakdown = true;
    }
  });

  const shifts = Array.from(groups.values());
  const productionKg = shifts.reduce((sum, r) => sum + r.kg, 0);
  const loggedPersonShifts = shifts.reduce(
    (sum, r) => sum + (counts.production[r.shift] || 0),
    0
  );

  let autoKg = 0;
  let manKg = 0;
  let autoPersonShifts = 0;
  let manPersonShifts = 0;

  shifts.forEach(r => {
    if (!r.hasBreakdown) return;
    autoKg += r.autoKg;
    manKg += r.manKg;
    autoPersonShifts += counts.auto[r.shift] || 0;
    manPersonShifts += counts.manual[r.shift] || 0;
  });

  const daysTotal = new Date(year, month, 0).getDate();
  const lastEntryDay = shifts.reduce((max, r) => {
    const day = Number(String(r.date).slice(8,10)) || 0;
    return Math.max(max, day);
  }, 0);
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  const selectedStart = new Date(year, month - 1, 1);
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const isPastMonth = selectedStart < currentStart;
  const measurementDays = isPastMonth
    ? daysTotal
    : Math.max(1, Math.min(daysTotal, isCurrentMonth ? Math.max(lastEntryDay, now.getDate()) : lastEntryDay));

  let scheduledPersonShifts = 0;
  let scheduledTeamShifts = 0;

  for (let day = 1; day <= daysTotal; day++) {
    const date = new Date(year, month - 1, day);
    WF_TEAMS.forEach(team => {
      if (wfShiftCodeFor(team, date) !== 'Н') {
        scheduledTeamShifts += 1;
        scheduledPersonShifts += counts.production[team] || 0;
      }
    });
  }

  return {
    year,
    month,
    daysTotal,
    loggedTeamShifts: shifts.length,
    productionKg,
    loggedPersonShifts,
    measuredProductivityTons: loggedPersonShifts > 0
      ? (productionKg / 1000) / loggedPersonShifts
      : 0,
    measurementDays,
    rosterProductivityTonsPerDay: counts.productionTotal > 0 && measurementDays > 0
      ? (productionKg / 1000) / (counts.productionTotal * measurementDays)
      : 0,
    autoProductivityTons: autoPersonShifts > 0
      ? (autoKg / 1000) / autoPersonShifts
      : 0,
    manualProductivityTons: manPersonShifts > 0
      ? (manKg / 1000) / manPersonShifts
      : 0,
    scheduledPersonShifts,
    scheduledTeamShifts,
    shiftsPerRosterHead: counts.productionTotal > 0
      ? scheduledPersonShifts / counts.productionTotal
      : 0,
    avgPeoplePerOperatingShift: scheduledTeamShifts > 0
      ? scheduledPersonShifts / scheduledTeamShifts
      : 0
  };
}

function workforceScenario(monthData, counts) {
  if (!monthData || !counts || !counts.productionTotal) return null;

  // Use the production goal and reserve headcount from their source files.
  // Productivity is output divided by active production headcount and calendar days.
  const target = Math.max(0, Number(goalTons) || 0);
  const reservePeople = Math.max(0, Number(counts.additional) || 0);
  const reservePct = counts.productionTotal > 0
    ? reservePeople / counts.productionTotal * 100
    : 0;
  const productivity = Math.max(0, Number(monthData.rosterProductivityTonsPerDay) || 0);
  const measured = productivity;

  if (!target || !productivity || !monthData.daysTotal) {
    return {
      target,
      reservePeople,
      reservePct,
      productivity,
      measured,
      valid: false
    };
  }

  const capacity = productivity * counts.productionTotal * monthData.daysTotal;
  const baseRequiredRaw = target / (productivity * monthData.daysTotal);
  const baseRequired = Math.ceil(baseRequiredRaw);
  const reserveRequired = baseRequired + reservePeople;
  const gap = reserveRequired - counts.productionTotal;
  const targetPerShift = monthData.scheduledTeamShifts > 0
    ? target / monthData.scheduledTeamShifts
    : 0;
  const requiredPerShift = baseRequiredRaw / 4;
  const requiredProductivityAtCurrentStaff = monthData.scheduledPersonShifts > 0
    ? target / monthData.scheduledPersonShifts
    : 0;
  const avgRosterTonsPerCalendarDay = counts.productionTotal > 0 && monthData.daysTotal > 0
    ? target / (counts.productionTotal * monthData.daysTotal)
    : 0;

  return {
    target,
    reservePeople,
    reservePct,
    productivity,
    measured,
    capacity,
    baseRequiredRaw,
    baseRequired,
    reserveRequired,
    gap,
    targetPerShift,
    requiredPerShift,
    requiredProductivityAtCurrentStaff,
    avgRosterTonsPerCalendarDay,
    valid: true
  };
}

function renderWorkforceCapacityChart(monthData, counts, scenario) {
  if (!el.wfCapacityChart) return;
  if (!scenario || !scenario.valid) {
    el.wfCapacityChart.innerHTML = '<div class="wf-chart-empty">Нужни са данни за тонаж и производителност, за да се изчертае капацитетът.</div>';
    return;
  }

  const current = counts.productionTotal;
  const required = scenario.baseRequired;
  const reserve = scenario.reserveRequired;
  const maxStaff = Math.max(40, Math.ceil(Math.max(current, required, reserve) * 1.18 / 10) * 10);
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
    const xx = x(staff);
    grid += `<text x="${xx}" y="${H-16}" fill="#8b929e" font-size="9" text-anchor="middle">${Math.round(staff)}</text>`;
  }

  const targetY = y(scenario.target);
  const currentX = x(current), currentY = y(capAt(current));
  const reqX = x(scenario.baseRequiredRaw), reqY = y(scenario.target);
  const lineEndY = y(capAt(maxStaff));
  const capColor = scenario.capacity >= scenario.target ? '#3fbfa0' : '#9b7bd1';

  el.wfCapacityChart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Капацитет спрямо активния щат">
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
      <text x="${currentX}" y="${Math.max(T+11,currentY-11)}" fill="#e6e9ee" font-size="10" text-anchor="middle" font-weight="800">Текущ ${current}</text>
      <circle cx="${reqX}" cy="${reqY}" r="5.5" fill="#f5a623" stroke="#1a1d22" stroke-width="3"/>
      <text x="${reqX}" y="${Math.min(H-B-10,reqY+20)}" fill="#f5a623" font-size="10" text-anchor="middle" font-weight="800">База ${scenario.baseRequired}</text>
      <text x="${L}" y="12" fill="#8b929e" font-size="9">Месечен капацитет</text>
      <text x="${W-R}" y="${H-2}" fill="#8b929e" font-size="9" text-anchor="end">Активен производствен щат</text>
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

  const monthData = aggregateWorkforceMonth(counts);
  if (!monthData || !monthData.loggedTeamShifts || !monthData.measuredProductivityTons) {
    el.wfNoData.style.display = 'block';
    el.wfBody.style.display = 'none';
    el.wfNoData.innerHTML = '<strong>Няма достатъчно тонажни записи за избрания месец.</strong> Капацитетът се изчислява от реалните записи А / Б / В / Г и текущия активен състав.';
    el.wfStaffSource.textContent = `${counts.productionTotal} производствени`;
    el.wfStatus.className = 'status-chip neutral';
    el.wfStatus.textContent = 'Няма база за изчисление';
    return;
  }

  el.wfNoData.style.display = 'none';
  el.wfBody.style.display = 'block';

  const scenario = workforceScenario(monthData, counts);
  const monthName = MONTH_FULL_LABELS[monthData.month - 1];
  el.wfStaffSource.textContent = `${counts.productionTotal} производствени + ${counts.additional} допълнителни`;
  el.wfSubtitle.textContent = `${monthName} ${monthData.year}: цел ${StatisticsUnits.formatTons(goalTons)} т от „Тонаж и брак“, производителност от реалния тонаж и текущия активен състав, резерв от ${counts.additional} души в „Допълнителни“. Изчислението използва текущия активен състав.`;

  el.wfCurrentStaff.textContent = `${counts.productionTotal}`;
  el.wfCurrentStaffSub.textContent = `Автоматична ${counts.autoTotal} + Ръчна ${counts.manualTotal}`;
  el.wfMeasuredProductivity.textContent = `${StatisticsUnits.formatTons(monthData.rosterProductivityTonsPerDay)} т`;
  el.wfMeasuredProductivitySub.textContent = `${fmtTons(monthData.productionKg)} т / (${counts.productionTotal} души × ${monthData.measurementDays} дни)`;
  el.wfAutoProd.textContent = monthData.autoProductivityTons > 0 ? `${StatisticsUnits.formatTons(monthData.autoProductivityTons)} т / човек-смяна` : 'няма breakdown';
  el.wfManualProd.textContent = monthData.manualProductivityTons > 0 ? `${StatisticsUnits.formatTons(monthData.manualProductivityTons)} т / човек-смяна` : 'няма breakdown';
  el.wfStickersCount.textContent = `${counts.stickers} души`;

  if (el.wfCalcTarget) el.wfCalcTarget.textContent = `${StatisticsUnits.formatTons(goalTons)} т`;
  if (el.wfCalcReserve) el.wfCalcReserve.textContent = `${counts.additional} души`;
  if (el.wfCalcReserveSub) {
    const reserveEq = counts.productionTotal > 0 ? counts.additional / counts.productionTotal * 100 : 0;
    el.wfCalcReserveSub.textContent = `от „Допълнителни“ · ${wfFmt(reserveEq,1)}% спрямо производствения щат`;
  }
  if (el.wfCalcProductivity) el.wfCalcProductivity.textContent = `${StatisticsUnits.formatTons(monthData.rosterProductivityTonsPerDay)} т`;

  if (!scenario || !scenario.valid) {
    el.wfRequiredProductivity.textContent = '—';
    el.wfTargetPerShift.textContent = '—';
    el.wfCurrentCapacity.textContent = '—';
    el.wfGap.textContent = '—';
    el.wfRequiredBase.textContent = '—';
    el.wfRequiredReserve.textContent = '—';
    el.wfResultGap.textContent = '—';
    el.wfRequiredPerShift.textContent = '—';
    el.wfCalcNote.textContent = 'Нужни са валидна месечна цел, Personnel данни и реален тонаж за избрания месец, за да изчислим необходимия щат.';
    el.wfStatus.className = 'status-chip neutral';
    el.wfStatus.textContent = 'Недостатъчно данни';
    renderWorkforceCapacityChart(monthData, counts, scenario);
    return;
  }

  const coverage = scenario.target > 0 ? scenario.capacity / scenario.target : 0;
  let statusCls = 'good';
  let statusText = 'Капацитетът покрива целта';
  if (scenario.gap > 0) {
    statusCls = coverage >= .9 ? 'warn' : 'bad';
    statusText = `Нужни още ${scenario.gap} с резерв`;
  } else if (scenario.gap < 0) {
    statusText = `Резерв ${Math.abs(scenario.gap)} души`;
  }
  el.wfStatus.className = `status-chip ${statusCls}`;
  el.wfStatus.textContent = statusText;

  el.wfRequiredProductivity.textContent = `${StatisticsUnits.formatTons(scenario.avgRosterTonsPerCalendarDay)} т`;
  el.wfTargetPerShift.textContent = `${StatisticsUnits.formatTons(scenario.targetPerShift)} т`;
  el.wfCurrentCapacity.textContent = `${StatisticsUnits.formatTons(scenario.capacity)} т`;
  el.wfCurrentCapacitySub.textContent = `${wfFmt(coverage*100,0)}% от целта ${StatisticsUnits.formatTons(scenario.target)} т`;
  el.wfGap.textContent = scenario.gap > 0 ? `+${scenario.gap}` : String(scenario.gap);
  el.wfGapSub.textContent = `база ${scenario.baseRequired} + ${scenario.reservePeople} допълнителни → ${scenario.reserveRequired}`;

  setWfKpiClass(el.wfCapacityKpi, coverage >= 1 ? 'good' : (coverage >= .9 ? 'warn' : 'bad'));
  setWfKpiClass(el.wfGapKpi, scenario.gap <= 0 ? 'good' : (scenario.gap <= 5 ? 'warn' : 'bad'));

  el.wfRequiredBase.textContent = `${scenario.baseRequired} души`;
  el.wfRequiredReserve.textContent = `${scenario.reserveRequired} души`;
  el.wfResultGap.textContent = scenario.gap === 0
    ? 'точно'
    : (scenario.gap > 0 ? `+${scenario.gap} души` : `${scenario.gap} души`);
  el.wfRequiredPerShift.textContent = `${wfFmt(scenario.requiredPerShift,1)} души`;
  el.wfResultGapRow.className = `wf-result ${scenario.gap <= 0 ? 'good' : (scenario.gap <= 5 ? 'warn' : 'bad')}`;

  el.wfCalcNote.innerHTML = `Всичко се смята автоматично: целта <strong>${StatisticsUnits.formatTons(scenario.target)} т</strong> идва от „Тонаж и брак“; измерената производителност е <strong>${StatisticsUnits.formatTons(scenario.productivity)} т / щатен човек / ден</strong> за ${monthData.measurementDays} дни; резервът е <strong>${scenario.reservePeople} души</strong> — текущият брой в „Допълнителни“ (${wfFmt(scenario.reservePct,1)}% спрямо активния производствен щат). За целта са нужни средно <strong>${StatisticsUnits.formatTons(scenario.targetPerShift)} т на работна смяна</strong>. Базов необходим щат: <strong>${scenario.baseRequired}</strong>; с текущия резерв: <strong>${scenario.reserveRequired}</strong>.`;

  renderWorkforceCapacityChart(monthData, counts, scenario);
}
