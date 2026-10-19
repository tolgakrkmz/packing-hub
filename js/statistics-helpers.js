/* Statistics: shared constants and pure formatting/rotation helpers. Loaded before the other statistics scripts. */

const MONTH_LABELS = ['Яну','Фев','Мар','Апр','Май','Юни','Юли','Авг','Сеп','Окт','Ное','Дек'];
const MONTH_FULL_LABELS = ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'];
const SHIFT_ORDER = ['А','Б','В','Г','СТИКЕРИ'];

const SHIFT_COLORS = {
  'А': '#4a90c4',
  'Б': '#3fbfa0',
  'В': '#9b7bd1',
  'Г': '#e0765a',
  'СТИКЕРИ': '#c26b9e'
};

const HOURS_PER_SHIFT = 8;
// Number#toLocaleString builds a formatter on every call; render loops reuse these.
const BG_INTEGER = new Intl.NumberFormat('bg-BG');
const BG_ONE_DECIMAL = new Intl.NumberFormat('bg-BG', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const BG_FIXED_DIGITS = new Map();

function fmt(n) {
  return BG_INTEGER.format(Math.round(
    Number(n) || 0
  ));
}

function fmtTons(kg) {
  return StatisticsUnits.formatKg(kg);
}

function fmtHoursDecimal(h) {
  return BG_ONE_DECIMAL.format(
    Number(h) || 0
  );
}

function escapeHtml(str) {
  const d =
    document.createElement('div');

  d.textContent =
    str == null
      ? ''
      : String(str);

  return d.innerHTML;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function clamp(v, min, max) {
  return Math.max(
    min,
    Math.min(max, v)
  );
}
function emptyShiftMap() {
  const m = {};

  SHIFT_ORDER.forEach(
    s =>
      m[s] = 0
  );

  return m;
}

function niceChartMax(value) {
  if (
    value <= 0
  ) {
    return 100000;
  }

  const magnitude =
    Math.pow(
      10,
      Math.floor(
        Math.log10(value)
      )
    );

  const normalized =
    value /
    magnitude;

  const nice =
    normalized <= 1
      ? 1
      : (
          normalized <= 2
            ? 2
            : (
                normalized <= 5
                  ? 5
                  : 10
              )
        );

  return nice *
    magnitude;
}

const WF_TEAMS = ['А','Б','В','Г'];
const WF_ROT_PATTERN = [3,3,3,3,'Н',2,2,2,2,'Н',1,1,1,1,'Н','Н'];
const WF_ROT_OFFSETS = {'А':2,'Б':14,'В':6,'Г':10};
const WF_EPOCH_UTC = Date.UTC(2026,11,1);

function wfFmt(value, digits=2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (!BG_FIXED_DIGITS.has(digits)) BG_FIXED_DIGITS.set(digits, new Intl.NumberFormat('bg-BG', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }));
  return BG_FIXED_DIGITS.get(digits).format(n);
}

function wfShiftCodeFor(team, dateObj) {
  const dUTC = Date.UTC(
    dateObj.getFullYear(),
    dateObj.getMonth(),
    dateObj.getDate()
  );
  const d = Math.round((dUTC - WF_EPOCH_UTC) / 86400000);
  const idx = (((d + WF_ROT_OFFSETS[team]) % 16) + 16) % 16;
  return WF_ROT_PATTERN[idx];
}
