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
  return {parse, keyOf};
});
