/* Presentation only. Stored reports and all entry forms continue to use kg. */
const StatisticsUnits = (() => {
  const formatTons = value => value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('bg-BG', {maximumFractionDigits:3});
  const formatKg = value => value === null || value === undefined ? '—' : formatTons(Number(value) / 1000);
  return {formatKg, formatTons};
})();
