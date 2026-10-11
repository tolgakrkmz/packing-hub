/* Memory only. Sources are accepted snapshots; a replacement invalidates their calculations. */
function createStatisticsCache(limit = 48) {
  const calculations = new Map(), rendered = new Map();
  const same = (a, b) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  function get(name, sources, key, calculate) {
    let bucket = calculations.get(name);
    if (!bucket || !same(bucket.sources, sources)) {
      bucket = {sources: sources.slice(), values: new Map()}; calculations.set(name, bucket);
    }
    if (bucket.values.has(key)) {
      const value = bucket.values.get(key);
      bucket.values.delete(key); bucket.values.set(key, value);
      return value;
    }
    const value = calculate();
    bucket.values.set(key, value);
    if (bucket.values.size > limit) bucket.values.delete(bucket.values.keys().next().value);
    return value;
  }
  function update(name, sources, key, render) {
    const previous = rendered.get(name);
    if (previous && same(previous.sources, sources) && Object.is(previous.key, key)) return;
    render();
    // Remember only the displayed state: returning to an older period must render it again.
    rendered.set(name, {sources: sources.slice(), key});
  }
  return {get, update};
}
