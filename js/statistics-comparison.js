/* Read-only comparison of the selected month with a base month over the same completed days. Totals only: no ratings of people. */
const StatisticsComparison = (() => {
  const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const shiftInterval = (team, date) => { try { return ShiftSchedule.shiftInterval(team, date); } catch { return null; } };
  const daysIn = month => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const addMonths = (month, count) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + count, 1)).toISOString().slice(0, 7);
  const range = (month, days) => days ? {month, from:`${month}-01`, to:`${month}-${String(days).padStart(2, '0')}`, days} : {month, from:null, to:null, days:0};
  // A production day ends when the next one starts at 06:00, after its night shift.
  const lastDone = now => ShiftSchedule.addDays(StatisticsOverview.productionDay(now), -1);

  // choice: '' = previous month, 'year' = same month last year, or an explicit YYYY-MM.
  const baseMonth = (month, choice) => /^\d{4}-(0[1-9]|1[0-2])$/.test(choice) ? choice : addMonths(month, choice === 'year' ? -12 : -1);

  // Only completed days count, with the same day numbers in both months.
  // An unfinished base month limits both periods to its completed days.
  function ranges(month, base, now = Date.now()) {
    const last = lastDone(now), doneMonth = last.slice(0, 7);
    const done = value => value < doneMonth ? daysIn(value) : value === doneMonth ? Number(last.slice(8)) : 0;
    let days = done(month);
    if (done(base) < daysIn(base)) days = Math.min(days, done(base));
    return {current:range(month, days), base:range(base, Math.min(days, daysIn(base))), partial:days < daysIn(month)};
  }

  // Months with completed days, newest first, without the selected one.
  function options(month, years = [], now = Date.now()) {
    const first = (years.slice().sort()[0] || month.slice(0, 4)) + '-01', result = [];
    for (let value = lastDone(now).slice(0, 7); value >= first; value = addMonths(value, -1)) if (value !== month) result.push(value);
    return result;
  }

  function summarize({from, to, days = 0, production = [], downtime = []}) {
    const inRange = entry => !!from && entry.date >= from && entry.date <= to;
    const rows = production.filter(inRange), stops = downtime.filter(inRange);
    const expected = [];
    for (let date = from; date && date <= to; date = ShiftSchedule.addDays(date, 1))
      for (const team of ShiftSchedule.TEAMS) { const interval = shiftInterval(team, date); if (interval) expected.push({date, team, code:interval.code}); }
    const scheduled = new Set(expected.map(shift => shift.date + '|' + shift.team));
    const reported = new Set(rows.map(entry => entry.date + '|' + entry.shift));
    const missing = expected.filter(shift => !reported.has(shift.date + '|' + shift.team));
    const reportedShifts = expected.length - missing.length;
    const shiftKg = sum(rows.filter(entry => scheduled.has(entry.date + '|' + entry.shift)), 'tonnage');
    const kg = sum(rows, 'tonnage'), brak = sum(rows, 'brak');
    const daily = Array(days).fill(0);
    for (const entry of rows) daily[Number(entry.date.slice(8)) - 1] += Number(entry.tonnage) || 0;
    return {from, to, days, kg, brak, reports:rows.length, daily,
      scrapPct:kg > 0 ? brak / kg * 100 : null,
      kgPerDay:days ? kg / days : null,
      kgPerShift:reportedShifts ? shiftKg / reportedShifts : null,
      downtimeMin:sum(stops, 'durationMin'), downtimeCount:stops.length,
      expectedShifts:expected.length, reportedShifts, missing,
      coveragePct:expected.length ? reportedShifts / expected.length * 100 : null};
  }

  // A zero or missing base has no percentage change; the absolute difference is still exact.
  const change = (current, base) => current === null || base === null ? null : {diff:current - base, pct:base ? (current - base) / Math.abs(base) * 100 : null};

  function compare({month, base = baseMonth(month, ''), production = [], downtime = [], baseProduction = production, baseDowntime = downtime, now = Date.now()}) {
    const periods = ranges(month, base, now);
    const current = summarize({...periods.current, production, downtime});
    const previous = summarize({...periods.base, production:baseProduction, downtime:baseDowntime});
    const changes = Object.fromEntries(['kg', 'kgPerDay', 'kgPerShift', 'brak', 'scrapPct', 'downtimeMin', 'coveragePct'].map(key => [key, change(current[key], previous[key])]));
    return {month, baseMonth:base, partial:periods.partial, current, base:previous, changes, complete:current.missing.length === 0 && previous.missing.length === 0};
  }
  return {baseMonth, ranges, options, summarize, compare};
})();

function comparisonMonthLabel(month) {
  return `${MONTH_FULL_LABELS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}

function renderStatisticsComparison({result, connected, downtimeConnected, error}) {
  const $ = id => document.getElementById(id);
  const number = (value, digits = 1) => value === null ? '—' : Number(value).toLocaleString('bg-BG', {maximumFractionDigits:digits});
  const date = value => value.split('-').reverse().join('.');
  const label = range => range.from ? `${date(range.from)} – ${date(range.to)}` : '—';
  $('comparisonPeriods').textContent = result ? `${label(result.current)} спрямо ${label(result.base)}` : '';
  if (!connected || error || !result.current.from) {
    $('comparisonBody').innerHTML = `<div class="wf-no-data">${!connected ? 'Свържете тонажния дневник, за да сравните периоди.'
      : error ? 'Сравнителният период не е зареден. Опитай „Опресни“.' : 'Няма завършени дни за сравнение в избраните месеци.'}</div>`;
    return;
  }
  const {current, base, changes} = result, currentName = comparisonMonthLabel(result.month), baseName = comparisonMonthLabel(result.baseMonth);
  const tons = StatisticsUnits.formatKg, signed = (value, text) => (value > 0 ? '+' : '') + text;
  // [label, key, format, unit, higher is better, formula]
  const metrics = [
    ['Тонаж', 'kg', tons, ' т', true, 'Сбор на тонажа от всички отчети в периода.'],
    ['Средно на ден', 'kgPerDay', tons, ' т', true, 'Тонаж ÷ брой дни в периода.'],
    ['Средно на отчетена смяна', 'kgPerShift', tons, ' т', true, 'Тонаж на екипите в смени по график ÷ отчетени смени по график.'],
    ['Брак', 'brak', tons, ' т', false, 'Сбор на брака от всички отчети в периода.'],
    ['Брак от тонажа', 'scrapPct', number, '%', false, 'Брак ÷ тонаж × 100. Разликата е в процентни пунктове.'],
    ...(downtimeConnected ? [['Престои', 'downtimeMin', value => number(value, 0), ' мин', false, 'Сбор на минутите престой на автоматичната линия.']] : []),
    ['Пълнота на отчетите', 'coveragePct', number, '%', true, 'Отчетени смени ÷ смени по график × 100.']
  ];
  const value = (format, unit, amount) => amount === null ? '—' : format(amount) + unit;
  const card = ([name, key, format, unit, higherBetter]) => {
    const item = changes[key], points = key === 'scrapPct' || key === 'coveragePct';
    const tone = !item || !item.diff ? '' : item.diff > 0 === higherBetter ? 'good' : 'bad';
    const delta = !item ? '—' : signed(item.diff, format(item.diff) + (points ? ' п.п.' : unit)) + (points || item.pct === null ? '' : ` (${signed(item.pct, number(item.pct))}%)`);
    const top = Math.max(current[key] || 0, base[key] || 0), width = amount => top ? Math.max(0, (amount || 0) / top * 100) : 0;
    return `<div class="wf-kpi cmp-kpi" data-metric="${key}"><div class="lab">${name}</div><div class="val">${value(format, unit, current[key])}</div>
      <div class="sub">спрямо <b class="cmp-base">${value(format, unit, base[key])}</b> · <span class="cmp-delta ${tone}">${delta}</span></div>
      <div class="cmp-bars" aria-hidden="true"><div class="ps-bar cmp-current"><span style="width:${width(current[key])}%"></span></div><div class="ps-bar cmp-previous"><span style="width:${width(base[key])}%"></span></div></div></div>`;
  };
  const coverage = (title, period) => {
    const shown = period.missing.slice(0, 8).map(shift => `<li>${date(shift.date)} · ${ShiftSchedule.LABELS[shift.code] || ''} · Екип ${shift.team}</li>`).join('');
    const more = period.missing.length > 8 ? `<li>Още: ${period.missing.length - 8}</li>` : '';
    const tone = !period.expectedShifts ? '' : period.missing.length ? 'warn' : 'good';
    return `<div class="wf-kpi ${tone}"><div class="lab">${title}</div><div class="val">${period.reportedShifts} / ${period.expectedShifts}</div>
      <div class="sub">отчетени смени · ${period.days} дни · ${period.reports} отчета</div>${shown ? `<ul class="cmp-missing">${shown}${more}</ul>` : ''}</div>`;
  };
  const warnings = [
    ...(result.partial ? [`Сравняват се само завършените дни: 1–${current.days}.`] : []),
    ...(current.days !== base.days ? ['Периодите имат различен брой дни; сравнявай средните стойности.'] : []),
    ...(!result.complete ? ['Има смени без отчет. Сравнението може да е подвеждащо, докато не се допълнят.'] : []),
    ...(!base.reports ? ['Няма отчети в сравнителния период.'] : [])
  ];
  const legend = `<div class="trend-legend cmp-legend"><span class="trend-key"><i></i> ${currentName}</span><span class="trend-key plan"><i></i> ${baseName}</span></div>`;
  $('comparisonBody').innerHTML = `${warnings.length ? `<ul class="ov-attention cmp-warnings">${warnings.map(text => `<li><span>${text}</span></li>`).join('')}</ul>` : ''}
    <div class="cmp-legend-row">${legend}</div>
    <div class="wf-kpis cmp-kpis">${metrics.map(card).join('')}</div>
    <div class="trend-card cmp-trend"><div class="trend-head"><div><div class="trend-title">Натрупан тонаж по дни</div>
      <div class="trend-subtitle">Ден от месеца · еднакви дни в двата месеца</div></div>${legend}</div>
      <div class="monthly-chart cmp-chart">${comparisonChart(current.daily, base.daily, currentName, baseName)}</div></div>
    <div class="wf-kpis cmp-coverage">${coverage('Пълнота · ' + currentName, current)}${coverage('Пълнота · ' + baseName, base)}</div>
    <details class="stats-details cmp-formulas"><summary>Как се изчислява</summary><ul>${metrics.map(([name, , , , , formula]) => `<li><b>${name}:</b> ${formula}</li>`).join('')}
      <li>Двойките и таргетите не се включват: те са отделни отчети и не се сумират с тонажа.</li></ul></details>`;
}

// Cumulative output by day of month, drawn like the monthly trend chart.
function comparisonChart(currentDaily, baseDaily, currentName, baseName) {
  const W = 920, H = 235, pL = 64, pR = 16, pT = 14, pB = 30, cW = W - pL - pR, cH = H - pT - pB;
  const cumulative = daily => daily.reduce((rows, kg) => (rows.push((rows.at(-1) || 0) + kg), rows), []);
  const current = cumulative(currentDaily), base = cumulative(baseDaily), days = Math.max(current.length, base.length, 1);
  const top = niceChartMax(Math.max(current.at(-1) || 0, base.at(-1) || 0));
  const x = day => pL + (days === 1 ? cW / 2 : (day - 1) / (days - 1) * cW), y = kg => pT + cH - kg / top * cH;
  const points = rows => rows.map((kg, index) => `${x(index + 1).toFixed(1)},${y(kg).toFixed(1)}`).join(' ');
  let grid = '';
  for (let step = 0; step <= 4; step++) {
    const kg = top / 4 * step;
    grid += `<line x1="${pL}" y1="${y(kg)}" x2="${W - pR}" y2="${y(kg)}" stroke="var(--border)" stroke-width="1" opacity=".78"/>
      <text x="${pL - 8}" y="${y(kg) + 4}" text-anchor="end" font-size="9" fill="var(--text-muted)">${fmtTons(kg)}т</text>`;
  }
  const ticks = [1, 5, 10, 15, 20, 25, days].filter((day, index, all) => day <= days && all.indexOf(day) === index)
    .map(day => `<text x="${x(day)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${day}</text>`).join('');
  const line = (rows, cls, color, width) => rows.length > 1 ? `<polyline class="${cls}" points="${points(rows)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
    : rows.length ? `<circle cx="${x(1)}" cy="${y(rows[0])}" r="4" fill="${color}"/>` : '';
  const summary = `${currentName}: ${fmtTons(current.at(-1) || 0)} т; ${baseName}: ${fmtTons(base.at(-1) || 0)} т`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Натрупан тонаж по дни. ${summary}">
    ${grid}${ticks}${line(base, 'plan-line', 'var(--purple)', 2)}${line(current, 'actual-line', 'var(--teal)', 3)}</svg>`;
}
