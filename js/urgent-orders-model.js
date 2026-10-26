/* One parser for the Задание preview and the server: pasted rows become orders the same way on both sides. */
((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.HubUrgentOrders = model;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  // A copied report row: order_position, client, profile (500-…), profile variant (A…), three quantities, then an optional note.
  // Matched by field shape, not by column separators: Excel gives tabs, screens give one or more spaces.
  const NUMBER = '-?\\d+(?:[.,]\\d+)?';
  const ROW = new RegExp('^(\\S+)\\s+(.+?)\\s+(\\d+-\\d+)\\s+([A-Z]\\d+)\\s+(' + NUMBER + ')\\s+' + NUMBER + '\\s+' + NUMBER + '(?:\\s+(.*))?$');
  function row(line) {
    const found = line.match(ROW);
    if (!found) return null;
    const [, order, client, profile, variant, quantity, note = ''] = found;
    return {order, client, profile, variant, quantity, note: note.trim()};
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
