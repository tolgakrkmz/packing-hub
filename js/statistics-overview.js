/* Read-only summary of one production day (shift date) from the sources the statistics page already loaded. */
const StatisticsOverview = (() => {
  const SHIFT_GOAL_KG = 30000;
  // shortcut: fixed thresholds, make them settings if the plant asks for different limits.
  const LONG_DOWNTIME_MIN = 60, HIGH_SCRAP_FACTOR = 1.5;
  const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  // A month without reports has no day, and old records may hold unknown teams: neither may break the page.
  const shiftInterval = (team, date) => { try { return ShiftSchedule.shiftInterval(team, date); } catch { return null; } };
  const scrapPct = rows => { const kg = sum(rows, 'tonnage'); return kg > 0 ? sum(rows, 'brak') / kg * 100 : null; };

  // The production day starts at 06:00 Sofia time; the night shift belongs to the day it started.
  function productionDay(at = Date.now()) {
    const calendar = ShiftSchedule.sofiaDate(new Date(at));
    return at < ShiftSchedule.sofiaInstant(calendar, 6) ? ShiftSchedule.addDays(calendar, -1) : calendar;
  }
  // Current month: like the report form, until 10:00 the previous day stays in view (the night shift reports until then).
  // Other months: the last reported day of that month.
  // shortcut: on the 1st before 10:00 the previous day is in last month, which the server may not have sent; load it if that matters.
  function pickDay(period, production, at = Date.now()) {
    const calendar = ShiftSchedule.sofiaDate(new Date(at));
    if (calendar.startsWith(period + '-')) return at < ShiftSchedule.sofiaInstant(calendar, 10) ? ShiftSchedule.addDays(calendar, -1) : calendar;
    return production.map(entry => entry.date).filter(date => date?.startsWith(period + '-')).sort().at(-1) || null;
  }

  function summarize({day, production = [], downtime = [], pairs = [], now = Date.now()}) {
    const rows = production.filter(entry => entry.date === day);
    // The stickers shift has no tonnage goal and is listed last, after the rotating teams.
    const shifts = [...ShiftSchedule.TEAMS, ShiftSchedule.STICKERS.team].map(team => {
      const interval = shiftInterval(team, day), records = rows.filter(entry => entry.shift === team);
      const kg = sum(records, 'tonnage'), stickers = team === ShiftSchedule.STICKERS.team;
      return {team, stickers, code:interval?.code ?? null, kg, brak:sum(records, 'brak'), reported:records.length > 0,
        ended:!!interval && now >= interval.end, goalKg:stickers ? null : SHIFT_GOAL_KG, pct:stickers ? null : kg / SHIFT_GOAL_KG * 100};
    }).filter(shift => shift.code !== null || shift.reported).sort((a, b) => a.stickers - b.stickers || (a.code ?? 9) - (b.code ?? 9));

    const dayPairs = pairs.filter(entry => entry.date === day && !entry.cancellation);
    const pairCounts = {planned:dayPairs.length, achieved:0, missed:0, pending:0, overdue:0};
    for (const entry of dayPairs) {
      const state = PairTargets.status(entry);
      pairCounts[state]++;
      const interval = state === 'pending' && shiftInterval(entry.team, entry.date);
      if (interval && now >= interval.end) pairCounts.overdue++;
    }

    const stops = downtime.filter(entry => entry.date === day);
    const byReason = new Map();
    for (const stop of stops) byReason.set(stop.reason || '—', (byReason.get(stop.reason || '—') || 0) + (Number(stop.durationMin) || 0));
    const topReason = Array.from(byReason).sort((a, b) => b[1] - a[1])[0] || null;

    const dayScrap = scrapPct(rows), monthScrap = day ? scrapPct(production.filter(entry => entry.date?.startsWith(day.slice(0, 7) + '-'))) : null;
    const attention = [
      ...shifts.filter(shift => !shift.stickers && shift.ended && !shift.reported).map(shift => ({type:'missingShift', team:shift.team, code:shift.code})),
      ...(pairCounts.overdue ? [{type:'overduePairs', count:pairCounts.overdue}] : []),
      ...(dayScrap !== null && monthScrap > 0 && dayScrap > monthScrap * HIGH_SCRAP_FACTOR ? [{type:'highScrap', pct:dayScrap, average:monthScrap}] : []),
      ...stops.filter(stop => Number(stop.durationMin) >= LONG_DOWNTIME_MIN).map(stop => ({type:'longDowntime', minutes:Number(stop.durationMin), reason:stop.reason || '—', team:stop.shift}))
    ];
    return {day, shifts, attention, pairs:pairCounts,
      kg:sum(rows, 'tonnage'), brak:sum(rows, 'brak'), scrapPct:dayScrap, monthScrapPct:monthScrap,
      downtime:{minutes:sum(stops, 'durationMin'), count:stops.length, topReason:topReason && {reason:topReason[0], minutes:topReason[1]}}};
  }
  return {SHIFT_GOAL_KG, LONG_DOWNTIME_MIN, productionDay, pickDay, summarize};
})();

function renderStatisticsOverview({summary, liveDay, connected}) {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const tons = StatisticsUnits.formatKg, percent = new Intl.NumberFormat('bg-BG', {maximumFractionDigits:1}), pct = value => value === null ? '—' : percent.format(Number(value)) + '%';
  const shiftLabel = code => ShiftSchedule.LABELS[code] || 'Извън график';
  const link = (tab, label) => `<button type="button" class="ov-link" data-overview-tab="${tab}">${label} →</button>`;
  const label = summary.day === liveDay ? 'Текущо денонощие' : summary.day === ShiftSchedule.addDays(liveDay, -1) ? 'Предишно денонощие' : 'Последен отчетен ден';
  $('overviewDay').textContent = summary.day ? label + ' · ' + summary.day.split('-').reverse().join('.') : '';
  if (!summary.day || !connected) {
    $('overviewStatus').className = 'status-chip neutral';
    $('overviewStatus').textContent = 'Няма данни';
    $('overviewBody').innerHTML = `<div class="wf-no-data">${connected ? 'Няма тонажни отчети за избрания месец.' : 'Свържете тонажния дневник, за да видите денонощния обзор.'}</div>`;
    return;
  }
  const items = summary.attention;
  const tone = {missingShift:'bad', overduePairs:'warn', highScrap:'warn', longDowntime:'bad'};
  $('overviewStatus').className = 'status-chip ' + (items.some(item => tone[item.type] === 'bad') ? 'bad' : items.length ? 'warn' : 'good');
  $('overviewStatus').textContent = items.length ? `${items.length} за внимание` : 'Всичко е наред';
  const card = (label, value, sub, cls = '') => `<div class="wf-kpi ${cls}"><div class="lab">${label}</div><div class="val">${value}</div><div class="sub">${sub}</div></div>`;
  const planKg = summary.shifts.filter(shift => shift.goalKg && shift.code !== null).length * StatisticsOverview.SHIFT_GOAL_KG;
  const pairs = summary.pairs, down = summary.downtime;
  const gap = $('wfGap')?.textContent || '—', gapTone = ['good', 'warn', 'bad'].find(tone => $('wfGapKpi')?.classList.contains(tone)) || '';
  const text = item => item.type === 'missingShift' ? [`Няма въведен тонаж: ${shiftLabel(item.code)} · Екип ${escape(item.team)}`, 'production', 'Производство']
    : item.type === 'overduePairs' ? [`Двойки без отчет след края на смяната: ${item.count}`, 'pairs', 'Двойки и таргети']
    : item.type === 'highScrap' ? [`Брак ${pct(item.pct)} при средно ${pct(item.average)} за месеца`, 'production', 'Производство']
    : [`Дълъг престой: ${item.minutes} мин · ${escape(item.reason)}${item.team ? ' · Екип ' + escape(item.team) : ''}`, 'downtime', 'Престои'];
  $('overviewBody').innerHTML = `<div class="wf-kpis ov-kpis">
    ${card('Тонаж за денонощието', tons(summary.kg) + ' т', `от ${tons(planKg)} т цел по смени · ${pct(planKg ? summary.kg / planKg * 100 : null)}`, 'emphasis')}
    ${card('Брак', tons(summary.brak) + ' т', `${pct(summary.scrapPct)} от тонажа · месец ${pct(summary.monthScrapPct)}`, items.some(item => item.type === 'highScrap') ? 'warn' : '')}
    ${card('Двойки', pairs.planned ? `${pairs.achieved} / ${pairs.planned}` : '—', pairs.planned ? `постигнати · ${pairs.pending} очакват отчет` : 'Няма планирани двойки.', pairs.overdue ? 'warn' : pairs.planned && pairs.achieved === pairs.planned ? 'good' : '')}
    ${card('Престои', down.minutes + ' мин', down.topReason ? `${down.count} престоя · най-много: <span translate="no">${escape(down.topReason.reason)}</span>` : 'Няма престои.', items.some(item => item.type === 'longDowntime') ? 'bad' : down.minutes ? 'warn' : 'good')}
    ${card('Разлика в щата', escape(gap), 'спрямо нужния щат за месечната цел', gapTone)}
  </div>
  <div class="ov-grid">
    <div class="wf-card"><div class="wf-card-head"><div><div class="wf-card-title">По смени</div><div class="wf-card-sub">Цел ${tons(StatisticsOverview.SHIFT_GOAL_KG)} т на смяна.</div></div>${link('production', 'Производство')}</div>
      <div class="ov-shifts">${summary.shifts.map(shift => {
        if (shift.stickers) return `<div class="ov-shift"><div class="ov-shift-head"><b><span>Смяна стикери</span> · ${ShiftSchedule.STICKERS.hours}</b><span>${tons(shift.kg)} т</span></div>
          <div class="ov-shift-note">${shift.reported ? `<span>Без цел за тонаж</span> · брак ${tons(shift.brak)} т` : shift.ended ? 'Няма въведен тонаж' : 'Смяната не е приключила'}</div></div>`;
        const state = shift.reported ? (shift.pct >= 100 ? 'good' : shift.ended ? 'warn' : '') : shift.ended ? 'bad' : '';
        const note = shift.reported ? `${pct(shift.pct)} от целта · брак ${tons(shift.brak)} т` : shift.ended ? 'Няма въведен тонаж' : 'Смяната не е приключила';
        return `<div class="ov-shift ${state}"><div class="ov-shift-head"><b>${shiftLabel(shift.code)} · Екип ${escape(shift.team)}</b><span>${tons(shift.kg)} / ${tons(shift.goalKg)} т</span></div>
          <div class="ps-bar ${state || 'neutral'}" aria-hidden="true"><span style="width:${Math.min(100, shift.pct)}%"></span></div><div class="ov-shift-note">${note}</div></div>`;
      }).join('')}</div></div>
    <div class="wf-card"><div class="wf-card-title">Изисква внимание</div><div class="wf-card-sub">Липсващи отчети, висок брак и дълги престои за денонощието.</div>
      ${items.length ? `<ul class="ov-attention">${items.map(item => { const [message, tab, label] = text(item); return `<li class="${tone[item.type]}"><span>${message}</span>${link(tab, label)}</li>`; }).join('')}</ul>`
        : '<div class="ov-ok">Всичко е наред за денонощието.</div>'}
    </div>
  </div>`;
}
