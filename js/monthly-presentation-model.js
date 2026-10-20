/* Values for the monthly presentation template. Read-only totals in tonnes and hours; the deck is in English. */
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
  const pct = (ratio, digits = 1) => Number.isFinite(ratio) ? `${(ratio * 100).toFixed(digits)}%` : '—';
  const signed = (text, value) => Number.isFinite(value) && value > 0 ? '+' + text : text;
  const chart = value => Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '0';
  const sum = (rows, read) => rows.reduce((total, row) => total + (Number(read(row)) || 0), 0);
  const name = month => NAMES[+month.slice(5, 7) - 1];

  // Totals in tonnes. Reports without a breakdown count as manual packing so the routes add up to the total.
  function packing(entries, month) {
    const rows = entries.filter(entry => entry.date?.startsWith(month + '-')), line = rows.filter(entry => entry.shift !== STICKERS);
    const total = sum(rows, entry => entry.tonnage) / 1000, stickers = sum(rows.filter(entry => entry.shift === STICKERS), entry => entry.tonnage) / 1000;
    const auto = sum(line, entry => entry.breakdown?.autoKg) / 1000;
    return {rows:rows.length, total, auto, stickers, manual:total - auto - stickers, scrap:sum(rows, entry => entry.brak) / 1000,
      cases:sum(rows, entry => (Number(entry.breakdown?.autoCrates) || 0) + (Number(entry.breakdown?.manCrates) || 0))};
  }

  // production: entries covering the month and the two before it; downtime: line-downtime entries; inputs: numbers or empty.
  function values({month, production, downtime, inputs = {}}) {
    const input = key => inputs[key] === '' || inputs[key] === null || inputs[key] === undefined ? NaN : Number(inputs[key]);
    const p2Month = addMonths(month, -2), p1Month = addMonths(month, -1);
    const [p2, p1, now] = [p2Month, p1Month, month].map(value => packing(production, value));
    const days = daysIn(month), weekdays = workingDays(month), stations = input('stations');
    const profiles = input('profiles'), dispatched = input('dispatchedT'), extruded = input('extrudedT');
    const realization = Number.isFinite(input('realizationT')) ? input('realizationT') : now.total;
    const diff = extruded - realization, awaiting = input('anodizingT') + input('sawsT') + input('cncT'), outside = now.scrap + input('specialT');
    const actual = diff - awaiting - outside;
    const calendarH = days * 24, downtimeH = sum(downtime.filter(entry => entry.date?.startsWith(month + '-')), entry => entry.durationMin) / 60;
    const runningH = Math.max(calendarH - downtimeH, 0), availability = runningH / calendarH, loading = stations / STATIONS;
    const perHour = runningH ? now.auto / runningH : NaN, perStation = stations ? STATIONS / stations : NaN;
    const trucks = input('trucks'), target = input('trucksTarget'), gap = target - trucks;
    return {
      monthName:name(month), monthNameUpper:name(month).toUpperCase(), monthShort:name(month).slice(0, 3), year:month.slice(0, 4),
      p1Name:name(p1Month), p1NameUpper:name(p1Month).toUpperCase(), p2Name:name(p2Month), p2NameUpper:name(p2Month).toUpperCase(), p2Short:name(p2Month).slice(0, 3),
      packedT:num(now.total), cases:num(now.cases), profiles:num(profiles), dispatchedT:num(dispatched),
      packedTDay:num(now.total / days, 1), casesDay:num(now.cases / days, 1), profilesDay:num(profiles / days), dispatchDay:num(dispatched / weekdays, 1),
      calendarDays:String(days), workingDays:String(weekdays),
      extrudedT:num(extruded), realizationT:num(realization), diffT:num(diff), anodizingT:num(input('anodizingT')), sawsT:num(input('sawsT')), cncT:num(input('cncT')),
      awaitingT:num(awaiting), scrapT:num(now.scrap), specialT:num(input('specialT')), outsideT:num(outside), actualT:num(actual), actualShare:pct(actual / diff, 0),
      autoT:num(now.auto), manualT:num(now.manual), stickersT:num(now.stickers, 1), p1PackedT:num(p1.total), p2PackedT:num(p2.total),
      autoShare:pct(now.auto / now.total), p1AutoShare:pct(p1.auto / p1.total), p2AutoShare:pct(p2.auto / p2.total),
      'chart.auto':chart(now.auto), 'chart.manual':chart(now.manual), 'chart.stickers':chart(now.stickers),
      'chart.p1Auto':chart(p1.auto), 'chart.p1Manual':chart(p1.manual), 'chart.p1Stickers':chart(p1.stickers),
      'chart.p2Auto':chart(p2.auto), 'chart.p2Manual':chart(p2.manual), 'chart.p2Stickers':chart(p2.stickers),
      calendarH:num(calendarH), downtimeH:num(downtimeH), runningH:num(runningH), downtimeShare:pct(downtimeH / calendarH),
      availability:pct(availability), stations:num(stations, 1).replace(/\.0$/, ''), stationLoading:pct(loading), effectiveUse:pct(availability * loading),
      // shortcut: linear scaling by hours and stations, the same assumption the slide states; not OEE.
      'chart.actual':chart(now.auto), 'chart.sameUptime':chart(now.auto * perStation), 'chart.noDowntime':chart(perHour * calendarH),
      'chart.full':chart(perHour * calendarH * perStation),
      trucks:num(trucks, 1).replace(/\.0$/, ''), trucksTarget:num(target, 1).replace(/\.0$/, ''), trucksPerformance:pct(trucks / target, 0),
      trucksGap:signed(num(gap, 1).replace(/\.0$/, ''), gap), trucksUplift:signed(pct(gap / trucks), gap),
      _empty:{current:!now.rows, previous:!p1.rows || !p2.rows}
    };
  }
  return {INPUTS, STATIONS, addMonths, workingDays, values};
})();
