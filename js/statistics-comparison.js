/* Read-only comparison of the selected month with a base month over the same completed days. Totals only: no ratings of people. */
const StatisticsComparison = (() => {
  const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const shiftInterval = (team, date) => { try { return ShiftSchedule.shiftInterval(team, date); } catch { return null; } };
  const daysIn = month => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const addMonths = (month, count) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + count, 1)).toISOString().slice(0, 7);
  const range = (month, days) => days ? {month, from:`${month}-01`, to:`${month}-${String(days).padStart(2, '0')}`, days} : {month, from:null, to:null, days:0};

  // Only completed production days count: a day ends when the next one starts at 06:00, after its night shift.
  // The base month uses the same day numbers, capped at its own length.
  function ranges(month, mode, now = Date.now()) {
    const lastDone = ShiftSchedule.addDays(StatisticsOverview.productionDay(now), -1), doneMonth = lastDone.slice(0, 7);
    const days = month < doneMonth ? daysIn(month) : month === doneMonth ? Number(lastDone.slice(8)) : 0;
    const base = addMonths(month, mode === 'year' ? -12 : -1);
    return {current:range(month, days), base:range(base, Math.min(days, daysIn(base))), partial:days < daysIn(month)};
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
    return {from, to, days, kg, brak, reports:rows.length,
      scrapPct:kg > 0 ? brak / kg * 100 : null,
      kgPerDay:days ? kg / days : null,
      kgPerShift:reportedShifts ? shiftKg / reportedShifts : null,
      downtimeMin:sum(stops, 'durationMin'), downtimeCount:stops.length,
      expectedShifts:expected.length, reportedShifts, missing,
      coveragePct:expected.length ? reportedShifts / expected.length * 100 : null};
  }

  // A zero or missing base has no percentage change; the absolute difference is still exact.
  const change = (current, base) => current === null || base === null ? null : {diff:current - base, pct:base ? (current - base) / Math.abs(base) * 100 : null};

  function compare({month, mode = 'month', production = [], downtime = [], baseProduction = production, baseDowntime = downtime, now = Date.now()}) {
    const periods = ranges(month, mode, now);
    const current = summarize({...periods.current, production, downtime});
    const base = summarize({...periods.base, production:baseProduction, downtime:baseDowntime});
    const changes = Object.fromEntries(['kg', 'kgPerDay', 'kgPerShift', 'brak', 'scrapPct', 'downtimeMin', 'coveragePct'].map(key => [key, change(current[key], base[key])]));
    return {mode, partial:periods.partial, current, base, changes, complete:current.missing.length === 0 && base.missing.length === 0};
  }
  return {ranges, summarize, compare};
})();

function renderStatisticsComparison({result, connected, downtimeConnected, error}) {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number = (value, digits = 1) => value === null ? '—' : Number(value).toLocaleString('bg-BG', {maximumFractionDigits:digits});
  const date = value => value.split('-').reverse().join('.');
  const label = range => range.from ? `${date(range.from)} – ${date(range.to)}` : '—';
  $('comparisonPeriods').textContent = result ? `${label(result.current)} спрямо ${label(result.base)}` : '';
  if (!connected || error || !result.current.from) {
    $('comparisonBody').innerHTML = `<div class="wf-no-data">${!connected ? 'Свържете тонажния дневник, за да сравните периоди.'
      : error ? 'Сравнителният период не е зареден. Опитай „Опресни“.' : 'Няма завършени дни в избрания месец.'}</div>`;
    return;
  }
  const {current, base, changes} = result;
  const tons = StatisticsUnits.formatKg, signed = (value, text) => (value > 0 ? '+' : '') + text;
  const metrics = [
    ['Тонаж', 'kg', tons, ' т', 'Сбор на тонажа от всички отчети в периода.'],
    ['Средно на ден', 'kgPerDay', tons, ' т', 'Тонаж ÷ брой дни в периода.'],
    ['Средно на отчетена смяна', 'kgPerShift', tons, ' т', 'Тонаж на екипите в смени по график ÷ отчетени смени по график.'],
    ['Брак', 'brak', tons, ' т', 'Сбор на брака от всички отчети в периода.'],
    ['Брак от тонажа', 'scrapPct', number, '%', 'Брак ÷ тонаж × 100. Разликата е в процентни пунктове.'],
    ...(downtimeConnected ? [['Престои', 'downtimeMin', value => number(value, 0), ' мин', 'Сбор на минутите престой на автоматичната линия.']] : []),
    ['Пълнота на отчетите', 'coveragePct', number, '%', 'Отчетени смени ÷ смени по график × 100.']
  ];
  const cell = (format, unit, value) => value === null ? '—' : format(value) + unit;
  const delta = (key, format, unit) => {
    const item = changes[key];
    if (!item) return '—';
    const points = key === 'scrapPct' || key === 'coveragePct';
    return signed(item.diff, format(item.diff) + (points ? ' п.п.' : unit)) + (points || item.pct === null ? '' : ` (${signed(item.pct, number(item.pct))}%)`);
  };
  const coverage = (title, period) => {
    const shown = period.missing.slice(0, 8).map(shift => `<li>${date(shift.date)} · ${ShiftSchedule.LABELS[shift.code] || ''} · Екип ${escape(shift.team)}</li>`).join('');
    const more = period.missing.length > 8 ? `<li>Още: ${period.missing.length - 8}</li>` : '';
    const tone = !period.expectedShifts ? '' : period.missing.length ? 'warn' : 'good';
    return `<div class="wf-kpi ${tone}"><div class="lab">${title}</div><div class="val">${period.reportedShifts} / ${period.expectedShifts}</div>
      <div class="sub">отчетени смени · ${period.days} дни · ${period.reports} отчета</div>${shown ? `<ul class="cmp-missing">${shown}${more}</ul>` : ''}</div>`;
  };
  const warnings = [
    ...(result.partial ? ['Месецът не е приключил: сравняват се само завършените дни.'] : []),
    ...(current.days !== base.days ? ['Периодите имат различен брой дни; сравнявай средните стойности.'] : []),
    ...(!result.complete ? ['Има смени без отчет. Сравнението може да е подвеждащо, докато не се допълнят.'] : []),
    ...(!base.reports ? ['Няма отчети в сравнителния период.'] : [])
  ];
  $('comparisonBody').innerHTML = `${warnings.length ? `<ul class="ov-attention cmp-warnings">${warnings.map(text => `<li><span>${text}</span></li>`).join('')}</ul>` : ''}
    <div class="wf-kpis cmp-coverage">${coverage('Текущ период', current)}${coverage('Сравнителен период', base)}</div>
    <div class="pair-stats-scroll"><table class="stats-table cmp-table"><thead><tr><th>Показател</th><th>Текущ</th><th>Сравнителен</th><th>Разлика</th></tr></thead>
      <tbody>${metrics.map(([name, key, format, unit]) => `<tr data-metric="${key}"><td>${name}</td><td>${cell(format, unit, current[key])}</td><td>${cell(format, unit, base[key])}</td><td>${delta(key, format, unit)}</td></tr>`).join('')}</tbody></table></div>
    <details class="stats-details cmp-formulas"><summary>Как се изчислява</summary><ul>${metrics.map(([name, , , , formula]) => `<li><b>${name}:</b> ${formula}</li>`).join('')}
      <li>Двойките и таргетите не се включват: те са отделни отчети и не се сумират с тонажа.</li></ul></details>`;
}
