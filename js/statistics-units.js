/* Presentation only. Stored reports and all entry forms continue to use kg. */
const StatisticsUnits = (() => {
  const tons = new Intl.NumberFormat('bg-BG', {maximumFractionDigits:1});
  const formatTons = value => value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : tons.format(Number(value));
  const formatKg = value => value === null || value === undefined ? '—' : formatTons(Number(value) / 1000);
  return {formatKg, formatTons};
})();
