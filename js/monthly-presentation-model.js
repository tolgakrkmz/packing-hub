/* Figures for the monthly presentation. Read-only totals in tonnes and hours; the deck is in English. */
const MonthlyPresentation = (() => {
  const STICKERS = 'СТИКЕРИ', STATIONS = 5;
  const NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  // Manual figures the site does not record; asked in the dialog each month.
  const INPUTS = ['profiles','dispatchedT','extrudedT','realizationT','anodizingT','sawsT','cncT','specialT','stations','trucks','trucksTarget'];
  const addMonths = (month, count) => { const index = +month.slice(0, 4) * 12 + +month.slice(5, 7) - 1 + count; return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`; };
  const daysIn = month => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const workingDays = month => Array.from({length:daysIn(month)}, (_, day) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, day + 1)).getUTCDay()).filter(day => day > 0 && day < 6).length;
  const formats = [0, 1].map(digits => new Intl.NumberFormat('en-US', {minimumFractionDigits:digits, maximumFractionDigits:digits}));
  const num = (value, digits = 0) => Number.isFinite(value) ? formats[digits].format(value) : '—';
  const short = value => num(value, 1).replace(/\.0$/, '');
  const pct = (ratio, digits = 1) => Number.isFinite(ratio) ? `${(ratio * 100).toFixed(digits)}%` : '—';
  const signed = (text, value) => Number.isFinite(value) && value > 0 ? '+' + text : text;
  const finite = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
  const sum = (rows, read) => rows.reduce((total, row) => total + (Number(read(row)) || 0), 0);
  const name = month => NAMES[+month.slice(5, 7) - 1];
  const inMonth = (rows, month) => rows.filter(entry => entry.date?.startsWith(month + '-'));
  // Site figures the user may replace with numbers from company systems; the site value stays the default.
  const EDITABLE = ['autoT','manualT','stickersT','cases','scrapT','downtimeH','goalT','p1AutoT','p1ManualT','p1StickersT','p1ScrapT','p1DowntimeH','p2AutoT','p2ManualT','p2StickersT'];
  const TEAMS = [['А', 'A'], ['Б', 'B'], ['В', 'C'], ['Г', 'D']];
  const SHIFTS = [...TEAMS.map(([team, label]) => [team, 'Team ' + label]), [STICKERS, 'Stickers']];

  // Totals in tonnes. Reports without a breakdown count as manual packing so the routes add up to the total.
  function packing(entries, month) {
    const rows = inMonth(entries, month), line = rows.filter(entry => entry.shift !== STICKERS);
    const total = sum(rows, entry => entry.tonnage) / 1000, stickers = sum(rows.filter(entry => entry.shift === STICKERS), entry => entry.tonnage) / 1000;
    const auto = sum(line, entry => entry.breakdown?.autoKg) / 1000;
    return {name:name(month), rows:rows.length, total, auto, stickers, manual:total - auto - stickers, scrap:sum(rows, entry => entry.brak) / 1000,
      cases:sum(rows, entry => (Number(entry.breakdown?.autoCrates) || 0) + (Number(entry.breakdown?.manCrates) || 0))};
  }

  // Defaults for EDITABLE, rounded as the dialog shows them. goalTons is the production log goal in tonnes.
  function siteFigures({month, production, downtime, goalTons}) {
    const round = value => Math.round(value * 10) / 10, hours = value => round(sum(inMonth(downtime, value), entry => entry.durationMin) / 60);
    const [p2, p1, now] = [addMonths(month, -2), addMonths(month, -1), month].map(value => packing(production, value));
    const figures = {cases:now.cases, scrapT:round(now.scrap), downtimeH:hours(month), goalT:Number(goalTons) || 0, p1ScrapT:round(p1.scrap), p1DowntimeH:hours(addMonths(month, -1))};
    for (const [prefix, row] of [['', now], ['p1', p1], ['p2', p2]]) for (const key of ['auto', 'manual', 'stickers'])
      figures[(prefix ? prefix + key[0].toUpperCase() + key.slice(1) : key) + 'T'] = round(row[key]);
    return figures;
  }

  // Largest downtime reasons of the month, for the automatic line constraints.
  function reasons(rows) {
    const totals = new Map();
    for (const entry of rows) {
      const key = String(entry.reason || '').trim() || 'Other', row = totals.get(key) || {reason:key, minutes:0, stops:0};
      row.minutes += Number(entry.durationMin) || 0; row.stops++; totals.set(key, row);
    }
    return [...totals.values()].sort((a, b) => b.minutes - a.minutes || a.reason.localeCompare(b.reason)).slice(0, 2)
      .map(row => ({reason:row.reason, hours:short(row.minutes / 60), stops:row.stops}));
  }

  // Global problems as they stood at the end of the month: only counts, impact and titles, no authors.
  function problems(items, start, end, now) {
    if (!Array.isArray(items)) return null;
    const until = Math.min(end, now), known = items.filter(item => item.createdAt < end);
    const active = known.filter(item => !item.resolvedAt || item.resolvedAt >= end);
    const proposed = item => (item.proposals || []).some(entry => entry.at < end), rank = {high:0, medium:1, low:2};
    return {active:active.length, proposed:active.filter(proposed).length, open:active.filter(item => !proposed(item)).length,
      created:known.filter(item => item.createdAt >= start).length, resolved:items.filter(item => item.resolvedAt >= start && item.resolvedAt < end).length,
      byImpact:['high', 'medium', 'low'].map(level => ({level, count:active.filter(item => item.impactLevel === level).length})),
      oldest:[...active].sort((a, b) => rank[a.impactLevel] - rank[b.impactLevel] || a.createdAt - b.createdAt).slice(0, 5).map(item => ({
        title:String(item.titleEn || item.title || ''), level:item.impactLevel, days:Math.max(0, Math.floor((until - item.createdAt) / 86400000)), stage:proposed(item) ? 'Solution proposed' : 'Open'}))};
  }

  // Team totals only: today's roster headcount (no dated snapshots exist) against the month's packed tonnage per team.
  // Like the Statistics workforce view, staff is auto + manual + stickers and the stickers shift tonnage counts too.
  function workforce(counts, rows) {
    if (!counts) return null;
    const packedBy = team => sum(rows.filter(entry => entry.shift === team), entry => entry.tonnage) / 1000;
    const row = (team, people, auto, manual, packed) => ({team, people, auto, manual, packedT:num(packed), perPerson:people ? finite(packed / people) : 0, perPersonT:num(people ? packed / people : NaN, 1)});
    const teams = TEAMS.map(([team, label]) => row('Team ' + label, Number(counts.production?.[team]) || 0, Number(counts.auto?.[team]) || 0, Number(counts.manual?.[team]) || 0, packedBy(team)));
    const stickers = Number(counts.stickers) || 0, staff = (Number(counts.productionTotal) || 0) + stickers;
    const packed = sum(rows.filter(entry => entry.shift === STICKERS || TEAMS.some(([team]) => team === entry.shift)), entry => entry.tonnage) / 1000;
    return {active:num(Number(counts.totalActive) || 0), auto:num(Number(counts.autoTotal) || 0), manual:num(Number(counts.manualTotal) || 0), stickers:num(stickers),
      staff:num(staff), packedT:num(packed), perPersonT:num(staff ? packed / staff : NaN, 1), teams:[...teams, row('Stickers', stickers, '—', '—', packedBy(STICKERS))]};
  }

  // Shift tasks and global tasks due in the month; cancelled and not applicable ones are left out.
  function tasks(items, start, end) {
    if (!Array.isArray(items)) return null;
    const due = items.filter(item => item.due >= start && item.due < end && !['cancelled', 'not-applicable'].includes(item.status));
    const completed = due.filter(item => item.status === 'completed'), late = completed.filter(item => item.report?.late).length;
    const notDone = due.filter(item => item.status === 'not-done' || item.displayStatus === 'unreported').length;
    return {total:due.length, completed:completed.length, late, notDone, open:due.length - completed.length - notDone, onTime:pct((completed.length - late) / due.length, 0)};
  }

  // One line per metric: this month against the previous one; lowerBetter flips the colour of the change.
  function change(label, current, previous, unit, lowerBetter = false, digits = 0) {
    const ratio = previous ? (current - previous) / previous : NaN, trend = !Number.isFinite(ratio) || Math.abs(ratio) < 0.0005 ? 'flat' : ratio > 0 ? 'up' : 'down';
    return {label, current:num(current, digits) + ' ' + unit, previous:num(previous, digits) + ' ' + unit, change:Number.isFinite(ratio) ? signed(pct(ratio), ratio) : '—',
      trend, good:trend === 'flat' ? null : (trend === 'down') === lowerBetter};
  }

  // production: entries covering the month and the two before it; downtime: line-downtime entries; inputs: numbers or empty; today: YYYY-MM-DD for the cover.
  // problemItems: /api/problems items or null; period: {start, end, now} instants of the month in Sofia; counts: workforce counts or null.
  // goalTons: production log goal; pairTeams: [{team, reported, achieved, successPct, kgPct}] per team and the stickers shift; taskItems: /api/tasks items or null.
  // EDITABLE inputs replace the site figures; empty ones fall back to them.
  function values({month, production, downtime, inputs = {}, today = '', problemItems = null, period = null, counts = null, goalTons = 0, pairTeams = [], taskItems = null}) {
    const input = key => inputs[key] === '' || inputs[key] === null || inputs[key] === undefined ? NaN : Number(inputs[key]);
    const site = siteFigures({month, production, downtime, goalTons}), pick = key => Number.isFinite(input(key)) ? input(key) : site[key];
    const months = [['p2', addMonths(month, -2)], ['p1', addMonths(month, -1)], ['', month]].map(([prefix, value]) => {
      const key = route => prefix ? prefix + route[0].toUpperCase() + route.slice(1) + 'T' : route + 'T';
      const row = packing(production, value), auto = pick(key('auto')), manual = pick(key('manual')), stickers = pick(key('stickers'));
      return {...row, auto, manual, stickers, total:auto + manual + stickers};
    }), [p2, p1, now] = months;
    now.cases = pick('cases'); now.scrap = pick('scrapT'); p1.scrap = pick('p1ScrapT');
    const goal = pick('goalT'), goalRatio = now.total / goal;
    const days = daysIn(month), weekdays = workingDays(month), stations = input('stations');
    const profiles = input('profiles'), dispatched = input('dispatchedT'), extruded = input('extrudedT');
    const realization = Number.isFinite(input('realizationT')) ? input('realizationT') : now.total;
    const diff = extruded - realization, awaiting = input('anodizingT') + input('sawsT') + input('cncT'), outside = now.scrap + input('specialT');
    const actual = diff - awaiting - outside;
    const stops = inMonth(downtime, month), calendarH = days * 24, downtimeH = pick('downtimeH');
    const runningH = Math.max(calendarH - downtimeH, 0), availability = runningH / calendarH, loading = stations / STATIONS;
    const perHour = runningH ? now.auto / runningH : NaN, perStation = stations ? STATIONS / stations : NaN;
    const trucks = input('trucks'), target = input('trucksTarget'), gap = target - trucks;
    // shortcut: linear scaling by hours and stations, the same assumption the slide states; not OEE.
    const scenarios = [
      {label:`Actual\n${num(runningH)} h × ${short(stations)}`, value:now.auto},
      {label:`Same uptime\n${num(runningH)} h × ${STATIONS}`, value:now.auto * perStation},
      {label:`No downtime\n${num(calendarH)} h × ${short(stations)}`, value:perHour * calendarH},
      {label:`Full calendar\n${num(calendarH)} h × ${STATIONS}`, value:perHour * calendarH * perStation}
    ].map(row => ({...row, value:finite(row.value)}));
    return {
      coverDate:today.split('-').reverse().join('.'), monthName:name(month), monthShort:name(month).slice(0, 3), year:month.slice(0, 4),
      packedT:num(now.total), cases:num(now.cases), profiles:num(profiles), dispatchedT:num(dispatched),
      packedTDay:num(now.total / days, 1), casesDay:num(now.cases / days, 1), profilesDay:num(profiles / days), dispatchDay:num(dispatched / weekdays, 1),
      calendarDays:String(days), workingDays:String(weekdays),
      extrudedT:num(extruded), realizationT:num(realization), diffT:num(diff), anodizingT:num(input('anodizingT')), sawsT:num(input('sawsT')), cncT:num(input('cncT')),
      awaitingT:num(awaiting), scrapT:num(now.scrap), specialT:num(input('specialT')), outsideT:num(outside), actualT:num(actual), actualShare:pct(actual / diff, 0),
      autoT:num(now.auto), manualT:num(now.manual), stickersT:num(now.stickers, 1),
      mix:months.map(row => ({name:row.name, totalT:num(row.total), autoShare:pct(row.auto / row.total), auto:finite(row.auto), manual:finite(row.manual), stickers:finite(row.stickers)})),
      calendarH:num(calendarH), downtimeH:num(downtimeH), runningH:num(runningH), downtimeShare:pct(downtimeH / calendarH),
      availability:pct(availability), stations:short(stations), stationLoading:pct(loading), effectiveUse:pct(availability * loading),
      scenarios, reasons:reasons(stops),
      trucks:short(trucks), trucksTarget:short(target), trucksPerformance:pct(trucks / target, 0),
      trucksRatio:Number.isFinite(trucks / target) ? Math.min(Math.max(trucks / target, 0), 1) : 0,
      trucksGap:signed(short(gap), gap), trucksUplift:signed(pct(gap / trucks), gap),
      problems:period ? problems(problemItems, period.start, period.end, period.now) : null, workforce:workforce(counts, inMonth(production, month)),
      p1Name:p1.name,
      goal:{goalT:num(goal), percent:pct(goalRatio, 0), ratio:Number.isFinite(goalRatio) ? Math.min(Math.max(goalRatio, 0), 1) : 0,
        gap:Number.isFinite(goalRatio) ? `${num(Math.abs(now.total - goal))} t ${now.total >= goal ? 'above' : 'below'} goal` : '—', met:now.total >= goal && goal > 0},
      comparison:[change('Packed tonnage', now.total, p1.total, 't'), change('Automatic line', now.auto, p1.auto, 't'), change('Manual packing', now.manual, p1.manual, 't'),
        change('Stickers', now.stickers, p1.stickers, 't', false, 1), change('Scrap', now.scrap, p1.scrap, 't', true, 1), change('Downtime', downtimeH, pick('p1DowntimeH'), 'h', true)],
      teams:SHIFTS.map(([team, label]) => {
        const pairs = pairTeams.find(row => row.team === team) || {}, finitePct = value => Number.isFinite(value) ? `${Math.round(value)}%` : '—';
        return {team:label, packedT:num(sum(inMonth(production, month).filter(entry => entry.shift === team), entry => entry.tonnage) / 1000),
          pairs:String(pairs.reported || 0), met:finitePct(pairs.successPct), kg:finitePct(pairs.kgPct)};
      }),
      tasks:period ? tasks(taskItems, period.start, period.end) : null,
      empty:{current:!now.rows, previous:!p1.rows || !p2.rows}
    };
  }
  return {INPUTS, EDITABLE, STATIONS, addMonths, workingDays, siteFigures, values};
})();
