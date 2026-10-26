/* One parser for the Задание preview and the server: pasted rows become orders the same way on both sides. */
((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.HubUrgentOrders = model;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  // A copied report row: order_position, client, profile (500-…), profile variant (A…), then numbers and an optional note.
  // Numbers: ordered, produced, remaining, then in the newer report available kg and the furnace.
  // Matched by field shape, not by column separators: Excel gives tabs, screens give one or more spaces.
  const ROW = /^(\S+)\s+(.+?)\s+(\d+-\d+)\s+([A-Z]\d+)\s+(.+)$/, NUMBER = /^-?\d+(?:[.,]\d+)?$/;
  function row(line) {
    const found = line.match(ROW);
    if (!found) return null;
    const [, order, client, profile, variant, rest] = found, tokens = rest.split(/\s+/), numbers = [];
    while (numbers.length < 5 && NUMBER.test(tokens[0] ?? '')) numbers.push(tokens.shift());
    if (numbers.length < 3) return null;
    // shortcut: a 4-number row is read as the newer report (4th = available kg); an older row ending in a bare furnace number reads the same way.
    return {order, client, profile, variant, quantity: numbers[0], available: numbers[3] ?? '', furnace: numbers[4] ?? '', note: tokens.join(' ').replace(/^[-–—:]+\s*/, '')};
  }
  // When any line is a report row, other lines (headers, totals) are skipped; otherwise each line is one free-text order.
  // One order can sit on several rows with different notes, so only identical rows count as repeats.
  function parse(text, known = []) {
    const lines = String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const parsed = lines.map(line => ({line, fields: row(line)}));
    const report = parsed.some(entry => entry.fields);
    const seen = new Set(known), orders = [];
    let skipped = 0, duplicates = 0;
    for (const {line, fields} of parsed) {
      if (report && !fields) { skipped++; continue; }
      const source = line.replace(/\s+/g, ' ');
      const order = fields ? {...fields, text: [fields.order, fields.profile, fields.variant].join(' · '), source} : {text: line, source};
      const key = keyOf(order);
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key); orders.push(order);
    }
    return {orders, skipped, duplicates};
  }
  // Orders saved before `source` existed fall back to their order number or text.
  const keyOf = order => (order.source || order.order || order.text).toLocaleLowerCase('bg');

  // Shifts that can still pack for a truck: from the running shift to the night shift before the truck day.
  // Trucks carry a date only, so a truck due today gets the rest of today's shifts.
  function slots(schedule, at, truckDate) {
    const list = [], today = schedule.sofiaDate(new Date(at)), last = schedule.addDays(today, 14); // a far-off date never walks more than two weeks
    for (let date = schedule.addDays(today, -1); date <= truckDate && date <= last; date = schedule.addDays(date, 1)) {
      for (const code of [1, 2, 3]) {
        const team = schedule.teamFor(schedule.parseDate(date), code);
        if (team && schedule.shiftInterval(team, date).end > at) list.push({date, code, team});
      }
    }
    const before = list.filter(slot => slot.date < truckDate);
    return before.length ? before : list.filter(slot => slot.date === truckDate);
  }
  const slotKey = slot => slot.date + '/' + slot.code;
  const weight = item => Number(String(item.quantity ?? '').replace(',', '.')) || 500; // free-text orders count as one average order
  const pressing = item => item.available === '0' || /пресова/i.test(item.note || '');
  // An open order keeps its shift while that shift can still pack it; otherwise it is waiting for one.
  const live = (schedule, at, item) => !!item.shift && slots(schedule, at, item.truckDate).some(slot => slotKey(slot) === slotKey(item.shift));
  // Time a shift still has: the running shift counts only from now; MIN_LEFT is the least worth handing new orders to.
  const MIN_LEFT = 3600000;
  function remaining(schedule, at, slot) {
    const {start, end} = schedule.shiftInterval(slot.team, slot.date);
    return {start, end, ms: Math.max(0, end - Math.max(at, start)), share: Math.max(0, end - Math.max(at, start)) / (end - start)};
  }
  // The magic button: split waiting kilograms so each shift's load follows its team's usual output and the time it has left.
  // Earlier trucks and heavier orders go first; orders still to be pressed skip the first shift when there is a later one.
  // Orders with no shift that has an hour left stay without one, so the manager decides.
  function distribute(schedule, at, items, capacity = {}) {
    const open = items.filter(item => item.status === 'open'), loads = new Map();
    const known = Object.values(capacity).filter(value => value > 0);
    const average = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : 1;
    const score = (slot, extra) => ((loads.get(slotKey(slot)) || 0) + extra) / ((capacity[slot.team] > 0 ? capacity[slot.team] : average) * remaining(schedule, at, slot).share);
    for (const item of open) if (live(schedule, at, item)) loads.set(slotKey(item.shift), (loads.get(slotKey(item.shift)) || 0) + weight(item));
    const plan = [];
    for (const item of open.filter(item => !live(schedule, at, item)).sort((a, b) => a.truckDate.localeCompare(b.truckDate) || weight(b) - weight(a))) {
      let options = slots(schedule, at, item.truckDate).filter(slot => remaining(schedule, at, slot).ms >= MIN_LEFT);
      if (!options.length) continue;
      if (pressing(item) && options.length > 1) options = options.slice(1);
      const best = options.reduce((chosen, slot) => score(slot, weight(item)) < score(chosen, weight(item)) ? slot : chosen);
      loads.set(slotKey(best), (loads.get(slotKey(best)) || 0) + weight(item));
      plan.push({id: item.id, shift: best});
    }
    return plan;
  }
  return {parse, keyOf, slots, slotKey, weight, live, remaining, distribute};
});
