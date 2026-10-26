/* One parser for the Задание preview and the server: pasted rows become orders the same way on both sides. */
((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.HubUrgentOrders = model;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
  // A copied report row: order_position, client, profile, profile variant, then three quantities; Excel gives tabs, screens give runs of spaces.
  function row(line) {
    const cells = line.split(/\t|\s{2,}/).map(cell => cell.trim()).filter(Boolean);
    // Screen copies can join client and profile with one space; the profile is then the client's last word.
    const joined = cells.length === 6 && cells[1].match(/^(.+)\s(\S+)$/);
    if (joined) cells.splice(1, 1, joined[1], joined[2]);
    if (cells.length !== 7 || !cells.slice(4).every(cell => NUMBER.test(cell))) return null;
    const [order, client, profile, variant, quantity] = cells;
    return {order, client, profile, variant, quantity};
  }
  // When any line is a report row, other lines (headers, totals) are skipped; otherwise each line is one free-text order.
  function parse(text, known = []) {
    const lines = String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const parsed = lines.map(line => ({line, fields: row(line)}));
    const report = parsed.some(entry => entry.fields);
    const seen = new Set(known), orders = [];
    let skipped = 0, duplicates = 0;
    for (const {line, fields} of parsed) {
      if (report && !fields) { skipped++; continue; }
      const order = fields ? {...fields, text: [fields.order, fields.profile, fields.variant].join(' · ')} : {text: line};
      const key = keyOf(order);
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key); orders.push(order);
    }
    return {orders, skipped, duplicates};
  }
  const keyOf = order => (order.order || order.text).toLocaleLowerCase('bg');
  return {parse, keyOf};
});
