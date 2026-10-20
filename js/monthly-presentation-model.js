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

  // Totals in tonnes. Reports without a breakdown count as manual packing so the routes add up to the total.
  function packing(entries, month) {
    const rows = inMonth(entries, month), line = rows.filter(entry => entry.shift !== STICKERS);
    const total = sum(rows, entry => entry.tonnage) / 1000, stickers = sum(rows.filter(entry => entry.shift === STICKERS), entry => entry.tonnage) / 1000;
    const auto = sum(line, entry => entry.breakdown?.autoKg) / 1000;
    return {name:name(month), rows:rows.length, total, auto, stickers, manual:total - auto - stickers, scrap:sum(rows, entry => entry.brak) / 1000,
      cases:sum(rows, entry => (Number(entry.breakdown?.autoCrates) || 0) + (Number(entry.breakdown?.manCrates) || 0))};
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

  // production: entries covering the month and the two before it; downtime: line-downtime entries; inputs: numbers or empty; today: YYYY-MM-DD for the cover.
  function values({month, production, downtime, inputs = {}, today = ''}) {
    const input = key => inputs[key] === '' || inputs[key] === null || inputs[key] === undefined ? NaN : Number(inputs[key]);
    const months = [addMonths(month, -2), addMonths(month, -1), month].map(value => packing(production, value)), [p2, p1, now] = months;
    const days = daysIn(month), weekdays = workingDays(month), stations = input('stations');
    const profiles = input('profiles'), dispatched = input('dispatchedT'), extruded = input('extrudedT');
    const realization = Number.isFinite(input('realizationT')) ? input('realizationT') : now.total;
    const diff = extruded - realization, awaiting = input('anodizingT') + input('sawsT') + input('cncT'), outside = now.scrap + input('specialT');
    const actual = diff - awaiting - outside;
    const stops = inMonth(downtime, month), calendarH = days * 24, downtimeH = sum(stops, entry => entry.durationMin) / 60;
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
      empty:{current:!now.rows, previous:!p1.rows || !p2.rows}
    };
  }
  return {INPUTS, STATIONS, addMonths, workingDays, values};
})();
