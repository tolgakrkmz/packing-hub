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

let entries = [];
let avEntries = [];
let goalTons = 3000;

let personnelEmployees = [];
let personnelCounts = null;
let personnelLoaded = false;

let currentView = 'month';
const initialPeriod = new Date();
let selectedYear = String(initialPeriod.getFullYear());
let selectedDashboardMonth = pad2(initialPeriod.getMonth() + 1);

const el = {
  connPanel: document.getElementById('connPanel'),
  connDot: document.getElementById('connDot'),
  connText: document.getElementById('connText'),
  openFileBtn: document.getElementById('openFileBtn'),
  createFileBtn: document.getElementById('createFileBtn'),
  reconnectBtn: document.getElementById('reconnectBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  importFallback: document.getElementById('importFallback'),
  connNote: document.getElementById('connNote'),

  avConnDot: document.getElementById('avConnDot'),
  avConnText: document.getElementById('avConnText'),
  avOpenFileBtn: document.getElementById('avOpenFileBtn'),
  avCreateFileBtn: document.getElementById('avCreateFileBtn'),
  avReconnectBtn: document.getElementById('avReconnectBtn'),
  avRefreshBtn: document.getElementById('avRefreshBtn'),
  avImportFallback: document.getElementById('avImportFallback'),
  avConnNote: document.getElementById('avConnNote'),
  avKpiRow: document.getElementById('avKpiRow'),
  avHint: document.getElementById('avHint'),
  avTableTitle: document.getElementById('avTableTitle'),
  avTableContainer: document.getElementById('avTableContainer'),

  personnelConnDot: document.getElementById('personnelConnDot'),
  personnelConnText: document.getElementById('personnelConnText'),
  personnelOpenFileBtn: document.getElementById('personnelOpenFileBtn'),
  personnelCreateFileBtn: document.getElementById('personnelCreateFileBtn'),
  personnelReconnectBtn: document.getElementById('personnelReconnectBtn'),
  personnelRefreshBtn: document.getElementById('personnelRefreshBtn'),
  personnelImportFallback: document.getElementById('personnelImportFallback'),
  personnelConnNote: document.getElementById('personnelConnNote'),

  yearSelectRow: document.getElementById('yearSelectRow'),
  yearSelect: document.getElementById('yearSelect'),

  kpiRow: document.getElementById('kpiRow'),
  chartContainer: document.getElementById('chartContainer'),
  chartLegend: document.getElementById('chartLegend'),

  tableTitle: document.getElementById('tableTitle'),
  tableContainer: document.getElementById('tableContainer'),

  monthDashboard: document.getElementById('monthDashboard'),
  dashboardTitle: document.getElementById('dashboardTitle'),
  dashboardStatus: document.getElementById('dashboardStatus'),
  dashboardMonthSelect: document.getElementById('dashboardMonthSelect'),

  goalRing: document.getElementById('goalRing'),
  goalRingPct: document.getElementById('goalRingPct'),

  dashboardActual: document.getElementById('dashboardActual'),
  dashboardBrak: document.getElementById('dashboardBrak'),
  dashboardBrakKg: document.getElementById('dashboardBrakKg'),
  dashboardGoal: document.getElementById('dashboardGoal'),
  dashboardRemaining: document.getElementById('dashboardRemaining'),

  dashboardAvg: document.getElementById('dashboardAvg'),
  dashboardAvgSub: document.getElementById('dashboardAvgSub'),

  dashboardRequired: document.getElementById('dashboardRequired'),
  dashboardRequiredSub: document.getElementById('dashboardRequiredSub'),

  dashboardForecast: document.getElementById('dashboardForecast'),
  dashboardForecastSub: document.getElementById('dashboardForecastSub'),

  dashboardDelta: document.getElementById('dashboardDelta'),
  dashboardDeltaSub: document.getElementById('dashboardDeltaSub'),

  paceFill: document.getElementById('paceFill'),
  paceLeft: document.getElementById('paceLeft'),
  paceRight: document.getElementById('paceRight'),

  trendSubtitle: document.getElementById('trendSubtitle'),
  monthlyTrendChart: document.getElementById('monthlyTrendChart'),
  monthlyChartTooltip: document.getElementById('monthlyChartTooltip'),

  lineShiftTitle: document.getElementById('lineShiftTitle'),
  lineShiftHint: document.getElementById('lineShiftHint'),
  lineShiftContainer: document.getElementById('lineShiftContainer'),

  workforceDashboard: document.getElementById('workforceDashboard'),
  wfSubtitle: document.getElementById('wfSubtitle'),
  wfStaffSource: document.getElementById('wfStaffSource'),
  wfStatus: document.getElementById('wfStatus'),
  wfNoData: document.getElementById('wfNoData'),
  wfBody: document.getElementById('wfBody'),
  wfCurrentStaff: document.getElementById('wfCurrentStaff'),
  wfCurrentStaffSub: document.getElementById('wfCurrentStaffSub'),
  wfMeasuredProductivity: document.getElementById('wfMeasuredProductivity'),
  wfMeasuredProductivitySub: document.getElementById('wfMeasuredProductivitySub'),
  wfRequiredProductivity: document.getElementById('wfRequiredProductivity'),
  wfTargetPerShift: document.getElementById('wfTargetPerShift'),
  wfCapacityKpi: document.getElementById('wfCapacityKpi'),
  wfCurrentCapacity: document.getElementById('wfCurrentCapacity'),
  wfCurrentCapacitySub: document.getElementById('wfCurrentCapacitySub'),
  wfGapKpi: document.getElementById('wfGapKpi'),
  wfGap: document.getElementById('wfGap'),
  wfGapSub: document.getElementById('wfGapSub'),
  wfCapacityChart: document.getElementById('wfCapacityChart'),
  wfAutoProd: document.getElementById('wfAutoProd'),
  wfManualProd: document.getElementById('wfManualProd'),
  wfStickersCount: document.getElementById('wfStickersCount'),
  wfCalcTarget: document.getElementById('wfCalcTarget'),
  wfCalcReserve: document.getElementById('wfCalcReserve'),
  wfCalcReserveSub: document.getElementById('wfCalcReserveSub'),
  wfCalcProductivity: document.getElementById('wfCalcProductivity'),
  wfRequiredBase: document.getElementById('wfRequiredBase'),
  wfRequiredReserve: document.getElementById('wfRequiredReserve'),
  wfResultGapRow: document.getElementById('wfResultGapRow'),
  wfResultGap: document.getElementById('wfResultGap'),
  wfRequiredPerShift: document.getElementById('wfRequiredPerShift'),
  wfCalcNote: document.getElementById('wfCalcNote')
};

function fmt(n) {
  return Math.round(
    Number(n) || 0
  ).toLocaleString('bg-BG');
}

function fmtTons(kg) {
  return (
    (Number(kg) || 0) / 1000
  ).toLocaleString('bg-BG', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function fmtHoursDecimal(h) {
  return (
    Number(h) || 0
  ).toLocaleString('bg-BG', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
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

/* File connections */

const sync = createFileSync({
  dbName: 'portfolio-tonnage-fs-db',

  suggestedFileName:
    'production-log.json',

  localStorageKey:
    'portfolio-tonnage-fallback',

  defaultData: () => ({
    entries: [],
    goalTons: 3000
  }),

  getData: () => ({
    entries,
    goalTons
  }),

  render: renderAll,

  onConnect: (data) => {
    entries =
      data.entries || [];

    goalTons =
      data.goalTons !== undefined
        ? Number(data.goalTons) || 0
        : 3000;
  },

  onRefresh: (data) => {
    entries =
      data.entries || [];

    goalTons =
      data.goalTons !== undefined
        ? Number(data.goalTons) || 0
        : 3000;
  },

  elements: {
    connDot: el.connDot,
    connText: el.connText,
    openFileBtn: el.openFileBtn,
    createFileBtn: el.createFileBtn,
    reconnectBtn: el.reconnectBtn,
    refreshBtn: el.refreshBtn,
    importFallback: el.importFallback,
    connNote: el.connNote,
    connRow:
      document.querySelector(
        '#connPanel .conn-row'
      )
  }
});

const avSync = createFileSync({
  dbName: 'portfolio-downtime-fs-db',

  suggestedFileName:
    'line-downtime.json',

  localStorageKey:
    'portfolio-downtime-fallback',

  defaultData: () => ({
    entries: [],
    reasons: []
  }),

  getData: () => ({
    entries: avEntries,
    reasons: []
  }),

  render: renderAll,

  onConnect: (data) => {
    avEntries =
      data.entries || [];
  },

  onRefresh: (data) => {
    avEntries =
      data.entries || [];
  },

  elements: {
    connDot: el.avConnDot,
    connText: el.avConnText,
    openFileBtn: el.avOpenFileBtn,
    createFileBtn: el.avCreateFileBtn,
    reconnectBtn: el.avReconnectBtn,
    refreshBtn: el.avRefreshBtn,
    importFallback: el.avImportFallback,
    connNote: el.avConnNote,
    connRow:
      document.getElementById(
        'avConnRow'
      )
  }
});


const personnelSync = createFileSync({
  readOnly: true,
  dbName: 'portfolio-personnel-fs-db',
  suggestedFileName: 'personnel.json',
  localStorageKey: 'portfolio-personnel-fallback',
  defaultData: () => ({ employees: [] }),
  getData: () => ({ employees: personnelEmployees }),
  render: renderAll,
  onConnect: (data) => {
    personnelCounts = data?.counts || null;
    personnelEmployees = Array.isArray(data && data.employees)
      ? data.employees
      : [];
    personnelLoaded = true;
  },
  onRefresh: (data) => {
    personnelCounts = data?.counts || null;
    personnelEmployees = Array.isArray(data && data.employees)
      ? data.employees
      : [];
    personnelLoaded = true;
  },
  elements: {
    connDot: el.personnelConnDot,
    connText: el.personnelConnText,
    openFileBtn: el.personnelOpenFileBtn,
    createFileBtn: el.personnelCreateFileBtn,
    reconnectBtn: el.personnelReconnectBtn,
    refreshBtn: el.personnelRefreshBtn,
    importFallback: el.personnelImportFallback,
    connNote: el.personnelConnNote,
    connRow: document.getElementById('personnelConnRow')
  }
});

const pairStatistics = createPairTargetsStatistics({
  dbName: 'portfolio-pair-targets-fs-db',
  localStorageKey: 'portfolio-pair-targets-fallback',
  getPeriod: () => `${selectedYear}-${selectedDashboardMonth}`,
  onDataChange: renderAll
});

createStatisticsNavigation({
  storageKey: 'portfolio-statistics-section',
  onChange: renderAll
});

/* Dashboard controls */

document
  .querySelectorAll(
    '.view-toggle button'
  )
  .forEach(btn => {
    btn.addEventListener(
      'click',
      () => {
        currentView =
          btn.dataset.view;

        document
          .querySelectorAll(
            '.view-toggle button'
          )
          .forEach(b => {
            b.classList.toggle(
              'active',
              b === btn
            );
          });

        renderAll();
      }
    );
  });

el.yearSelect.addEventListener('change', () => {
  selectedYear = el.yearSelect.value;
  renderAll();
});

el.dashboardMonthSelect.addEventListener('change', () => {
  selectedDashboardMonth = el.dashboardMonthSelect.value;
  renderAll();
});


/* Production aggregation */

function getAvailableYears() {
  // Optional sources may arrive in any order. Keep the chosen period even when
  // its records disappear or a newly connected module has only older reports.
  return [...new Set([
    String(initialPeriod.getFullYear()), selectedYear,
    ...getReportYears(),
    ...pairStatistics.getYears()
  ].filter(Boolean))].sort();
}

function getReportYears() {
  return [...new Set(entries.concat(avEntries)
    .map(entry => entry.date?.slice(0, 4)).filter(Boolean))].sort();
}

function emptyShiftMap() {
  const m = {};

  SHIFT_ORDER.forEach(
    s =>
      m[s] = 0
  );

  return m;
}

function aggregateByMonth(
  year
) {
  const months =
    MONTH_LABELS.map(
      (label, i) => ({
        key:
          `${year}-${pad2(i + 1)}`,

        label,

        tonnage: 0,
        brak: 0,

        byShift:
          emptyShiftMap()
      })
    );

  entries.forEach(e => {
    if (
      !e.date ||
      !e.date.startsWith(
        year + '-'
      )
    ) {
      return;
    }

    const idx =
      parseInt(
        e.date.slice(5, 7),
        10
      ) - 1;

    if (
      idx < 0 ||
      idx > 11
    ) {
      return;
    }

    const ton =
      Number(e.tonnage) || 0;

    const brak =
      Number(e.brak) || 0;

    months[idx].tonnage +=
      ton;

    months[idx].brak +=
      brak;

    if (
      months[idx]
        .byShift[e.shift] !==
      undefined
    ) {
      months[idx]
        .byShift[e.shift] +=
        ton;
    }
  });

  return months;
}

function aggregateByYear() {
  return getReportYears()
    .map(year => {
      const row = {
        key: year,
        label: year,

        tonnage: 0,
        brak: 0,

        byShift:
          emptyShiftMap()
      };

      entries.forEach(e => {
        if (
          !e.date ||
          !e.date.startsWith(
            year + '-'
          )
        ) {
          return;
        }

        const ton =
          Number(
            e.tonnage
          ) || 0;

        const brak =
          Number(
            e.brak
          ) || 0;

        row.tonnage +=
          ton;

        row.brak +=
          brak;

        if (
          row.byShift[
            e.shift
          ] !== undefined
        ) {
          row.byShift[
            e.shift
          ] += ton;
        }
      });

      return row;
    });
}

/* Month selection */

function populateMonthSelectors() {
  el.yearSelect.innerHTML = getAvailableYears()
    .map(year => `<option value="${year}">${year}</option>`).join('');
  el.yearSelect.value = selectedYear;
  el.dashboardMonthSelect.innerHTML = MONTH_FULL_LABELS
    .map((name, index) => `<option value="${pad2(index + 1)}">${name}</option>`).join('');
  el.dashboardMonthSelect.value = selectedDashboardMonth;
}

function selectedPeriodLabel() {
  return `${MONTH_FULL_LABELS[Number(selectedDashboardMonth) - 1]} ${selectedYear}`;
}

/* Monthly production result */

function getMonthlyDashboardData() {
  if (
    !selectedYear ||
    !selectedDashboardMonth
  ) {
    return null;
  }

  const year =
    Number(selectedYear);

  const month =
    Number(
      selectedDashboardMonth
    );

  const prefix =
    `${selectedYear}-${selectedDashboardMonth}-`;

  const rows =
    entries.filter(
      e =>
        e.date &&
        e.date.startsWith(
          prefix
        )
    );

  if (!rows.length) return null;

  const daysTotal =
    new Date(
      year,
      month,
      0
    ).getDate();

  const daily =
    Array.from(
      {
        length:
          daysTotal
      },
      (_, i) => ({
        day: i + 1,
        kg: 0,
        cumulative: 0,
        target: 0
      })
    );

  rows.forEach(e => {
    const day =
      Number(
        e.date.slice(8, 10)
      );

    if (
      day >= 1 &&
      day <= daysTotal
    ) {
      daily[
        day - 1
      ].kg +=
        Number(
          e.tonnage
        ) || 0;
    }
  });

  let cumulative = 0;

  daily.forEach(d => {
    cumulative += d.kg;

    d.cumulative =
      cumulative;
  });

  const now =
    new Date();

  const isCurrent =
    now.getFullYear() ===
      year &&
    now.getMonth() + 1 ===
      month;

  const selectedMonthStart =
    new Date(
      year,
      month - 1,
      1
    );

  const currentMonthStart =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );

  const isPast =
    selectedMonthStart <
    currentMonthStart;

  const isFuture =
    selectedMonthStart >
    currentMonthStart;

  const elapsedDays =
    isCurrent
      ? now.getDate()
      : (
          isPast
            ? daysTotal
            : 0
        );

  const lastEntryDay =
    rows.reduce(
      (max, e) =>
        Math.max(
          max,
          Number(
            e.date.slice(
              8,
              10
            )
          ) || 0
        ),
      0
    );

  const actualThroughDay =
    isCurrent
      ? Math.max(
          Math.min(
            now.getDate(),
            daysTotal
          ),
          lastEntryDay
        )
      : (
          isPast
            ? daysTotal
            : lastEntryDay
        );

  const totalKg =
    rows.reduce(
      (a, e) =>
        a +
        (
          Number(
            e.tonnage
          ) || 0
        ),
      0
    );

  const totalBrakKg = rows.reduce(
    (sum, entry) => sum + (Number(entry.brak) || 0),
    0
  );

  const goalKg =
    Math.max(
      0,
      goalTons * 1000
    );

  daily.forEach(d => {
    d.target =
      goalKg > 0
        ? goalKg *
          (
            d.day /
            daysTotal
          )
        : 0;
  });

  const effectiveElapsed =
    Math.max(
      elapsedDays,
      1
    );

  const avgKg =
    elapsedDays > 0
      ? totalKg /
        effectiveElapsed
      : 0;

  const remainingKg =
    Math.max(
      goalKg -
      totalKg,
      0
    );

  const remainingDays =
    isCurrent
      ? Math.max(
          daysTotal -
          now.getDate(),
          0
        )
      : (
          isFuture
            ? daysTotal
            : 0
        );

  const requiredKg =
    goalKg > 0 &&
    remainingKg > 0 &&
    remainingDays > 0
      ? remainingKg /
        remainingDays
      : 0;

  const forecastKg =
    isCurrent
      ? avgKg *
        daysTotal
      : (
          isPast
            ? totalKg
            : 0
        );

  const planToDate =
    goalKg > 0 &&
    elapsedDays > 0
      ? goalKg *
        (
          elapsedDays /
          daysTotal
        )
      : 0;

  const deltaKg =
    totalKg -
    planToDate;

  const deltaPct =
    planToDate > 0
      ? deltaKg /
        planToDate *
        100
      : 0;

  const goalPct =
    goalKg > 0
      ? totalKg /
        goalKg *
        100
      : 0;

  return {
    year,
    month,
    rows,
    daily,
    daysTotal,
    isCurrent,
    isPast,
    isFuture,
    elapsedDays,
    actualThroughDay,
    totalKg,
    totalBrakKg,
    goalKg,
    avgKg,
    remainingKg,
    remainingDays,
    requiredKg,
    forecastKg,
    planToDate,
    deltaKg,
    deltaPct,
    goalPct,
    lastEntryDay
  };
}

function getDashboardStatus(d) {
  if (
    !d ||
    !d.rows.length
  ) {
    return {
      cls: 'neutral',
      text: 'Няма данни',
      ring: 'var(--purple)'
    };
  }

  if (
    d.goalKg <= 0
  ) {
    return {
      cls: 'neutral',
      text: 'Няма зададена цел',
      ring: 'var(--purple)'
    };
  }

  if (
    d.totalKg >=
    d.goalKg
  ) {
    return {
      cls: 'done',
      text:
        'Целта е постигната',
      ring: 'var(--teal)'
    };
  }

  if (
    d.elapsedDays <= 0
  ) {
    return {
      cls: 'neutral',
      text:
        'Предстоящ месец',
      ring: 'var(--purple)'
    };
  }

  if (
    d.deltaPct >= 2
  ) {
    return {
      cls: 'good',

      text:
        `Над план ${
          Math.abs(
            d.deltaPct
          ).toFixed(1)
        }%`,

      ring: 'var(--teal)'
    };
  }

  if (
    d.deltaPct >= -3
  ) {
    return {
      cls: 'good',
      text: 'В темпо',
      ring: 'var(--teal)'
    };
  }

  if (
    d.deltaPct >= -12
  ) {
    return {
      cls: 'warn',

      text:
        `Под план ${
          Math.abs(
            d.deltaPct
          ).toFixed(1)
        }%`,

      ring: 'var(--amber)'
    };
  }

  return {
    cls: 'bad',

    text:
      `Под план ${
        Math.abs(
          d.deltaPct
        ).toFixed(1)
      }%`,

    ring: 'var(--red)'
  };
}

function renderMonthlyDashboard() {
  const d =
    getMonthlyDashboardData();

  document.getElementById('monthlyResultBody').hidden = !d;
  document.getElementById('monthlyResultEmpty').hidden = !!d;
  document.getElementById('monthlyConnectBtn').hidden = el.connDot.classList.contains('on');
  el.dashboardTitle.textContent = selectedPeriodLabel();

  if (!d) {
    el.dashboardStatus.className =
      'status-chip neutral';

    el.dashboardStatus.textContent =
      'Няма данни';

    el.monthlyTrendChart.innerHTML =
      '<div class="empty">Няма месечни данни.</div><div class="chart-tooltip" id="monthlyChartTooltip"></div>';

    return;
  }

  const status =
    getDashboardStatus(d);

  const monthName =
    MONTH_FULL_LABELS[
      d.month - 1
    ];

  el.dashboardTitle.textContent =
    `${monthName} ${d.year}`;

  el.dashboardStatus.className =
    `status-chip ${status.cls}`;

  el.dashboardStatus.textContent =
    status.text;

  const pct =
    d.goalKg > 0
      ? d.goalPct
      : 0;

  el.goalRing.style.setProperty(
    '--progress',
    `${
      clamp(
        pct,
        0,
        100
      ) * 3.6
    }deg`
  );

  el.goalRing.style.setProperty(
    '--ring-color',
    status.ring
  );

  el.goalRingPct.textContent =
    d.goalKg > 0
      ? `${
          pct.toFixed(
            pct >= 100
              ? 0
              : 1
          )
        }%`
      : '—';

  el.dashboardActual.textContent =
    `${fmtTons(
      d.totalKg
    )} т`;

  el.dashboardBrak.textContent = `${fmtTons(d.totalBrakKg)} т`;
  el.dashboardBrakKg.textContent = `${fmt(d.totalBrakKg)} кг`;

  el.dashboardGoal.textContent =
    d.goalKg > 0
      ? `от ${fmtTons(
          d.goalKg
        )} т цел`
      : 'няма зададена месечна цел';

  if (
    d.goalKg <= 0
  ) {
    el.dashboardRemaining.innerHTML =
      'Задай месечна цел от <strong>Тонажен дневник</strong>, за да активираш прогноза и план.';
  } else if (
    d.totalKg >=
    d.goalKg
  ) {
    el.dashboardRemaining.innerHTML =
      `Целта е премината с <strong>${
        fmtTons(
          d.totalKg -
          d.goalKg
        )
      } т</strong>.`;
  } else {
    el.dashboardRemaining.innerHTML =
      `Остават <strong>${
        fmtTons(
          d.remainingKg
        )
      } т</strong> до месечната цел.`;
  }

  el.dashboardAvg.textContent =
    d.elapsedDays > 0
      ? `${fmtTons(
          d.avgKg
        )} т`
      : '—';

  el.dashboardAvgSub.textContent =
    d.isCurrent
      ? `за ${
          d.elapsedDays
        } календарни дни`
      : (
          d.isPast
            ? 'средно за целия месец'
            : 'месецът не е започнал'
        );

  if (
    d.goalKg <= 0
  ) {
    el.dashboardRequired.textContent =
      '—';

    el.dashboardRequiredSub.textContent =
      'няма зададена цел';
  } else if (
    d.totalKg >=
    d.goalKg
  ) {
    el.dashboardRequired.textContent =
      '0.0 т';

    el.dashboardRequiredSub.textContent =
      'целта вече е постигната';
  } else if (
    d.isCurrent &&
    d.remainingDays > 0
  ) {
    el.dashboardRequired.textContent =
      `${fmtTons(
        d.requiredKg
      )} т`;

    el.dashboardRequiredSub.textContent =
      `за оставащите ${
        d.remainingDays
      } дни`;
  } else if (
    d.isPast
  ) {
    el.dashboardRequired.textContent =
      '—';

    el.dashboardRequiredSub.textContent =
      'приключил месец';
  } else {
    el.dashboardRequired.textContent =
      `${fmtTons(
        d.goalKg /
        d.daysTotal
      )} т`;

    el.dashboardRequiredSub.textContent =
      'среден план / ден';
  }

  el.dashboardForecast.textContent =
    d.isCurrent
      ? `${fmtTons(
          d.forecastKg
        )} т`
      : (
          d.isPast
            ? `${fmtTons(
                d.totalKg
              )} т`
            : '—'
        );

  el.dashboardForecastSub.textContent =
    d.isCurrent
      ? 'при сегашния календарен темп'
      : (
          d.isPast
            ? 'финален резултат'
            : 'няма текущ темп'
        );

  if (
    d.goalKg <= 0 ||
    d.elapsedDays <= 0
  ) {
    el.dashboardDelta.textContent =
      '—';

    el.dashboardDeltaSub.textContent =
      'няма база за сравнение';
  } else {
    const sign =
      d.deltaKg >= 0
        ? '+'
        : '−';

    el.dashboardDelta.textContent =
      `${sign}${
        fmtTons(
          Math.abs(
            d.deltaKg
          )
        )
      } т`;

    el.dashboardDeltaSub.textContent =
      `${
        d.deltaPct >= 0
          ? '+'
          : ''
      }${
        d.deltaPct.toFixed(
          1
        )
      }% към плана`;
  }

  el.paceFill.style.width =
    `${
      clamp(
        pct,
        0,
        100
      )
    }%`;

  el.paceLeft.innerHTML =
    `<strong>${
      fmtTons(
        d.totalKg
      )
    } т</strong> произведени`;

  el.paceRight.innerHTML =
    d.goalKg > 0
      ? `Цел: <strong>${
          fmtTons(
            d.goalKg
          )
        } т</strong>`
      : 'Цел: <strong>—</strong>';

  if (
    d.isCurrent
  ) {
    el.trendSubtitle.textContent =
      `Ден ${
        d.elapsedDays
      } от ${
        d.daysTotal
      } · hover върху графиката за детайл`;
  } else if (
    d.isPast
  ) {
    el.trendSubtitle.textContent =
      `Финален резултат за ${
        monthName.toLowerCase()
      } · hover върху графиката за детайл`;
  } else {
    el.trendSubtitle.textContent =
      'Предстоящ месец';
  }

  renderMonthlyTrendChart(
    d
  );
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

function renderMonthlyTrendChart(
  d
) {
  const host =
    el.monthlyTrendChart;

  const W = 920;
  const H = 235;

  const pL = 52;
  const pR = 16;
  const pT = 14;
  const pB = 30;

  const cW =
    W -
    pL -
    pR;

  const cH =
    H -
    pT -
    pB;

  const actualEnd =
    d.isCurrent
      ? Math.min(
          d.elapsedDays,
          d.daysTotal
        )
      : (
          d.isPast
            ? d.daysTotal
            : 0
        );

  const maxActual =
    d.daily.reduce(
      (m, x) =>
        Math.max(
          m,
          x.cumulative
        ),
      0
    );

  const maxVal =
    niceChartMax(
      Math.max(
        maxActual,
        d.goalKg,
        1
      ) * 1.04
    );

  const x =
    day =>
      pL +
      (
        (day - 1) /
        Math.max(
          d.daysTotal - 1,
          1
        )
      ) *
      cW;

  const y =
    kg =>
      pT +
      cH -
      (
        kg /
        maxVal
      ) *
      cH;

  const gridSteps = 4;

  let grid = '';

  for (
    let i = 0;
    i <= gridSteps;
    i++
  ) {
    const val =
      maxVal /
      gridSteps *
      i;

    const yy =
      y(val);

    grid += `
      <line
        x1="${pL}"
        y1="${yy}"
        x2="${W - pR}"
        y2="${yy}"
        stroke="var(--border)"
        stroke-width="1"
        opacity=".78"
      />
    `;

    grid += `
      <text
        x="${pL - 8}"
        y="${yy + 4}"
        text-anchor="end"
        font-size="9"
        fill="var(--text-muted)"
      >${fmtTons(val)}т</text>
    `;
  }

  const ticks =
    [
      1,
      5,
      10,
      15,
      20,
      25,
      d.daysTotal
    ].filter(
      (v, i, a) =>
        v <=
          d.daysTotal &&
        a.indexOf(v) === i
    );

  let tickHtml =
    ticks
      .map(
        day =>
          `<text
            x="${x(day)}"
            y="${H - 8}"
            text-anchor="middle"
            font-size="9"
            fill="var(--text-muted)"
          >${day}</text>`
      )
      .join('');

  const planPoints =
    d.daily
      .map(
        pt =>
          `${x(pt.day)},${y(pt.target)}`
      )
      .join(' ');

  const actualRows =
    d.daily.filter(
      pt =>
        pt.day <=
        actualEnd
    );

  const actualPoints =
    actualRows
      .map(
        pt =>
          `${x(pt.day)},${y(pt.cumulative)}`
      )
      .join(' ');

  let actualArea = '';

  if (
    actualRows.length
  ) {
    const first =
      actualRows[0];

    const last =
      actualRows[
        actualRows.length -
        1
      ];

    actualArea =
      `M ${
        x(first.day)
      } ${
        y(0)
      } ` +
      actualRows
        .map(
          pt =>
            `L ${
              x(pt.day)
            } ${
              y(pt.cumulative)
            }`
        )
        .join(' ') +
      ` L ${
        x(last.day)
      } ${
        y(0)
      } Z`;
  }

  const svg = `
    <svg
      viewBox="0 0 ${W} ${H}"
      preserveAspectRatio="none"
      aria-label="Натрупан тонаж спрямо план"
    >

      <defs>
        <linearGradient
          id="actualAreaGradient"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0%"
            stop-color="#3fbfa0"
            stop-opacity=".22"
          />

          <stop
            offset="100%"
            stop-color="#3fbfa0"
            stop-opacity="0"
          />
        </linearGradient>
      </defs>

      ${grid}

      ${tickHtml}

      ${
        d.goalKg > 0
          ? `
            <polyline
              class="plan-line"
              points="${planPoints}"
              fill="none"
              stroke="var(--purple)"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              opacity=".8"
            />
          `
          : ''
      }

      ${
        actualRows.length
          ? `
            <path
              class="actual-area"
              d="${actualArea}"
              fill="url(#actualAreaGradient)"
            />
          `
          : ''
      }

      ${
        actualRows.length
          ? `
            <polyline
              class="actual-line"
              points="${actualPoints}"
              fill="none"
              stroke="var(--teal)"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          `
          : ''
      }

      <g
        class="chart-guide"
        id="chartGuide"
      >
        <line
          id="chartGuideLine"
          x1="0"
          y1="${pT}"
          x2="0"
          y2="${pT + cH}"
          stroke="rgba(237,235,227,.28)"
          stroke-width="1"
          stroke-dasharray="3 4"
          vector-effect="non-scaling-stroke"
        />

        <circle
          id="chartActualDot"
          cx="0"
          cy="0"
          r="4.5"
          fill="var(--teal)"
          stroke="#15171b"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />

        <circle
          id="chartPlanDot"
          cx="0"
          cy="0"
          r="4"
          fill="var(--purple)"
          stroke="#15171b"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
      </g>

      <rect
        id="chartHoverLayer"
        x="${pL}"
        y="${pT}"
        width="${cW}"
        height="${cH}"
        fill="transparent"
        style="cursor:crosshair"
      />

    </svg>

    <div
      class="chart-tooltip"
      id="monthlyChartTooltip"
    ></div>
  `;

  host.innerHTML =
    svg;

  const hover =
    host.querySelector(
      '#chartHoverLayer'
    );

  const guide =
    host.querySelector(
      '#chartGuide'
    );

  const guideLine =
    host.querySelector(
      '#chartGuideLine'
    );

  const actualDot =
    host.querySelector(
      '#chartActualDot'
    );

  const planDot =
    host.querySelector(
      '#chartPlanDot'
    );

  const tooltip =
    host.querySelector(
      '#monthlyChartTooltip'
    );

  hover.addEventListener(
    'pointermove',
    ev => {
      const svgEl =
        host.querySelector(
          'svg'
        );

      const rect =
        svgEl.getBoundingClientRect();

      const svgX =
        (
          ev.clientX -
          rect.left
        ) /
        rect.width *
        W;

      const raw =
        1 +
        (
          (
            svgX -
            pL
          ) /
          cW
        ) *
        (
          d.daysTotal -
          1
        );

      const day =
        clamp(
          Math.round(raw),
          1,
          d.daysTotal
        );

      const point =
        d.daily[
          day - 1
        ];

      const gx =
        x(day);

      const actualY =
        y(
          point.cumulative
        );

      const planY =
        y(
          point.target
        );

      guide.classList.add(
        'active'
      );

      guideLine.setAttribute(
        'x1',
        gx
      );

      guideLine.setAttribute(
        'x2',
        gx
      );

      planDot.setAttribute(
        'cx',
        gx
      );

      planDot.setAttribute(
        'cy',
        planY
      );

      const showActual =
        day <=
        actualEnd;

      actualDot.style.display =
        showActual
          ? ''
          : 'none';

      if (
        showActual
      ) {
        actualDot.setAttribute(
          'cx',
          gx
        );

        actualDot.setAttribute(
          'cy',
          actualY
        );
      }

      const diff =
        point.cumulative -
        point.target;

      tooltip.style.display =
        'block';

      tooltip.innerHTML = `
        <strong>
          ${day}
          ${
            MONTH_FULL_LABELS[
              d.month - 1
            ].toLowerCase()
          }
        </strong>

        <div class="tt-row">
          <span>Реално</span>

          <b>
            ${
              showActual
                ? fmtTons(
                    point.cumulative
                  ) + ' т'
                : '—'
            }
          </b>
        </div>

        <div class="tt-row">
          <span>План</span>

          <b>
            ${
              d.goalKg > 0
                ? fmtTons(
                    point.target
                  ) + ' т'
                : '—'
            }
          </b>
        </div>

        <div class="tt-row">
          <span>Разлика</span>

          <b>
            ${
              showActual &&
              d.goalKg > 0
                ? (
                    diff >= 0
                      ? '+'
                      : '−'
                  ) +
                  fmtTons(
                    Math.abs(
                      diff
                    )
                  ) +
                  ' т'
                : '—'
            }
          </b>
        </div>
      `;

      const left =
        (
          gx /
          W
        ) *
        rect.width;

      const top =
        (
          (
            showActual
              ? actualY
              : planY
          ) /
          H
        ) *
        rect.height;

      tooltip.style.left =
        `${left}px`;

      tooltip.style.top =
        `${top}px`;
    }
  );

  hover.addEventListener(
    'pointerleave',
    () => {
      guide.classList.remove(
        'active'
      );

      tooltip.style.display =
        'none';
    }
  );
}

/* Downtime aggregation */

function aggregateAvByMonth(
  year
) {
  const months =
    MONTH_LABELS.map(
      (label, i) => ({
        key:
          `${year}-${pad2(i + 1)}`,

        label,

        durationMin: 0,
        count: 0
      })
    );

  avEntries.forEach(e => {
    if (
      !e.date ||
      !e.date.startsWith(
        year + '-'
      )
    ) {
      return;
    }

    const idx =
      parseInt(
        e.date.slice(5, 7),
        10
      ) - 1;

    if (
      idx < 0 ||
      idx > 11
    ) {
      return;
    }

    months[
      idx
    ].durationMin +=
      Number(
        e.durationMin
      ) || 0;

    months[
      idx
    ].count += 1;
  });

  return months;
}

function aggregateAvByYear() {
  const years =
    Array.from(
      new Set(
        avEntries
          .map(
            e =>
              e.date
                ? e.date.slice(
                    0,
                    4
                  )
                : null
          )
          .filter(Boolean)
      )
    ).sort();

  return years.map(
    year => {
      const row = {
        key: year,
        label: year,

        durationMin: 0,
        count: 0
      };

      avEntries.forEach(
        e => {
          if (
            e.date &&
            e.date.startsWith(
              year + '-'
            )
          ) {
            row.durationMin +=
              Number(
                e.durationMin
              ) || 0;

            row.count += 1;
          }
        }
      );

      return row;
    }
  );
}

function renderAvKpis(
  rows,
  periodLabel
) {
  const totalMin =
    rows.reduce(
      (a, r) =>
        a +
        r.durationMin,
      0
    );

  const totalHours =
    totalMin / 60;

  const shiftsEquivalent =
    totalHours /
    HOURS_PER_SHIFT;

  const activeRows =
    rows.filter(
      r =>
        r.durationMin > 0
    );

  const avg =
    activeRows.length
      ? (
          totalMin /
          activeRows.length
        ) /
        60
      : 0;

  el.avKpiRow.innerHTML = `
    <div class="kpi-card">
      <div class="lab">
        Общо престой
      </div>

      <div class="val">
        ${fmtHoursDecimal(totalHours)} ч
      </div>
    </div>

    <div class="kpi-card">
      <div class="lab">
        Равнява се на
      </div>

      <div class="val">
        ${fmtHoursDecimal(shiftsEquivalent)} смени
      </div>
    </div>

    <div class="kpi-card">
      <div class="lab">
        Среден престой / ${escapeHtml(periodLabel)}
      </div>

      <div class="val">
        ${fmtHoursDecimal(avg)} ч
      </div>
    </div>
  `;

  el.avHint.textContent =
    avSync.fileHandle
      ? (
          'При 8 ч./смяна.' +
          (
            totalMin === 0
              ? ' Няма аварии за избрания период.'
              : ''
          )
        )
      : 'Свържи файла на авариите отгоре ("Аварии на автоматична линия"), за да видиш реални данни.';
}

function renderAvReasons(periodKey, openStates) {
  const groups = new Map();

  avEntries.forEach(entry => {
    if (!entry.date || !entry.date.startsWith(periodKey + '-')) return;

    const reason = String(entry.reason || '').trim() || 'Без посочена причина';
    const reasonNote = String(entry.reasonNote || '').trim();
    const label = reasonNote ? reason + ' — ' + reasonNote : reason;

    if (!groups.has(label)) {
      groups.set(label, { label, durationMin: 0, entries: [] });
    }

    const group = groups.get(label);
    group.durationMin += Number(entry.durationMin) || 0;
    group.entries.push(entry);
  });

  const sorted = Array.from(groups.values()).sort((a, b) =>
    b.durationMin - a.durationMin || b.entries.length - a.entries.length || a.label.localeCompare(b.label, 'bg')
  );
  if (!sorted.length) return '';

  const periodStateKey = 'period:' + periodKey;
  const reasonCount = sorted.length;
  const reasonLabelHtml = group => {
    const first = group.entries[0];
    return `<span data-i18n-exact>${escapeHtml(String(first.reason || '').trim() || 'Без посочена причина')}</span>` +
      (first.reasonNote ? ` — <span translate="no">${escapeHtml(first.reasonNote)}</span>` : '');
  };
  const reasonsHtml = sorted.map(group => {
    const stateKey = 'reason:' + periodKey + ':' + encodeURIComponent(group.label);
    const records = [...group.entries].sort((a, b) =>
      b.date.localeCompare(a.date) || String(b.start || '').localeCompare(String(a.start || ''))
    );
    const recordsHtml = records.map(entry => {
      const date = entry.date.split('-').reverse().join('.');
      const time = entry.start && entry.end ? entry.start + '–' + entry.end : '';
      const note = String(entry.note || '').trim();
      return `<li>
        <div class="av-record-meta">${escapeHtml(date)} · Смяна ${escapeHtml(entry.shift || '—')}${time ? ' · ' + escapeHtml(time) : ''} · <b>${fmt(entry.durationMin)} мин</b></div>
        ${note ? '<div class="av-record-note" translate="no">' + escapeHtml(note) + '</div>' : ''}
      </li>`;
    }).join('');

    return `<details class="av-reason-group" data-av-key="${stateKey}"${openStates.get(stateKey) ? ' open' : ''}>
      <summary>
        <span class="av-reason-label">${reasonLabelHtml(group)}</span>
        <span class="av-reason-metrics">${group.entries.length} ${group.entries.length === 1 ? 'случай' : 'случая'} · <b>${fmt(group.durationMin)} мин</b></span>
      </summary>
      <ul class="av-reason-records">${recordsHtml}</ul>
    </details>`;
  }).join('');

  return `<tr class="av-reasons-row"><td colspan="4">
    <details class="av-reasons" data-av-key="${periodStateKey}"${openStates.get(periodStateKey) ? ' open' : ''}>
      <summary>
        <span class="av-reasons-preview">Причини: <strong>${reasonLabelHtml(sorted[0])}</strong>${reasonCount > 1 ? ' · още ' + (reasonCount - 1) : ''}</span>
        <span class="av-reasons-action">Разгъни / свий</span>
      </summary>
      <div class="av-reasons-list">${reasonsHtml}</div>
    </details>
  </td></tr>`;
}

function renderAvTable(
  rows,
  periodLabel
) {
  el.avTableTitle.textContent =
    `Разбивка по ${periodLabel}`;

  const openStates = new Map(Array.from(
    el.avTableContainer.querySelectorAll('details[data-av-key]'),
    section => [section.dataset.avKey, section.open]
  ));

  if (
    !rows.some(
      r =>
        r.count > 0
    )
  ) {
    el.avTableContainer.innerHTML =
      '<div class="empty">Няма аварии за този период.</div>';

    return;
  }

  let totalMin = 0;
  let totalCount = 0;

  let html =
    '<table class="stats-table">' +
    '<thead>' +
    '<tr>' +

    `<th>${escapeHtml(periodLabel)}</th>` +

    '<th style="text-align:right">Часове престой</th>' +

    '<th style="text-align:right">Смени</th>' +

    '<th style="text-align:right">Брой аварии</th>' +

    '</tr>' +
    '</thead>' +
    '<tbody>';

  rows.forEach(row => {
    if (
      row.durationMin === 0 &&
      row.count === 0
    ) {
      return;
    }

    totalMin +=
      row.durationMin;

    totalCount +=
      row.count;

    html += `
      <tr>
        <td>
          ${escapeHtml(row.label)}
        </td>

        <td class="num">
          ${fmtHoursDecimal(row.durationMin / 60)} ч
        </td>

        <td class="num">
          ${fmtHoursDecimal(
            (row.durationMin / 60) /
            HOURS_PER_SHIFT
          )}
        </td>

        <td class="num">
          ${row.count}
        </td>
      </tr>
    `;

    html += renderAvReasons(row.key, openStates);
  });

  html += `
    <tr class="total-row">
      <td>
        Общо
      </td>

      <td class="num">
        ${fmtHoursDecimal(totalMin / 60)} ч
      </td>

      <td class="num">
        ${fmtHoursDecimal(
          (totalMin / 60) /
          HOURS_PER_SHIFT
        )}
      </td>

      <td class="num">
        ${totalCount}
      </td>
    </tr>
  `;

  html +=
    '</tbody></table>';

  el.avTableContainer.innerHTML =
    html;
}

/* Production charts and tables */

function renderStackedBarChart(
  container,
  rows
) {
  const W =
    Math.max(
      560,
      rows.length * 70
    );

  const H = 260;

  const padLeft = 50;
  const padBottom = 34;
  const padTop = 14;
  const padRight = 10;

  const chartW =
    W -
    padLeft -
    padRight;

  const chartH =
    H -
    padTop -
    padBottom;

  const maxVal =
    Math.max(
      1,
      ...rows.map(
        r =>
          r.tonnage
      )
    );

  const niceMax =
    Math.ceil(
      maxVal / 1000
    ) *
    1000 ||
    1000;

  const barSlot =
    chartW /
    rows.length;

  const barW =
    Math.min(
      48,
      barSlot * 0.6
    );

  let svg =
    `<svg
      viewBox="0 0 ${W} ${H}"
      width="100%"
      style="max-width:${W}px;"
    >`;

  for (
    let i = 0;
    i <= 4;
    i++
  ) {
    const val =
      niceMax /
      4 *
      i;

    const y =
      padTop +
      chartH -
      (
        val /
        niceMax
      ) *
      chartH;

    svg += `
      <line
        x1="${padLeft}"
        y1="${y}"
        x2="${W - padRight}"
        y2="${y}"
        stroke="var(--border)"
        stroke-width="1"
      />

      <text
        x="${padLeft - 8}"
        y="${y + 4}"
        text-anchor="end"
        font-size="10"
        fill="var(--text-muted)"
      >
        ${fmtTons(val)}т
      </text>
    `;
  }

  rows.forEach(
    (row, i) => {
      const x =
        padLeft +
        i * barSlot +
        (
          barSlot -
          barW
        ) /
        2;

      let yCursor =
        padTop +
        chartH;

      SHIFT_ORDER.forEach(
        shift => {
          const val =
            row.byShift[
              shift
            ] || 0;

          if (
            val <= 0
          ) {
            return;
          }

          const segH =
            val /
            niceMax *
            chartH;

          yCursor -=
            segH;

          svg += `
            <rect
              x="${x}"
              y="${yCursor}"
              width="${barW}"
              height="${segH}"
              fill="${SHIFT_COLORS[shift]}"
              rx="1.5"
            />
          `;
        }
      );

      svg += `
        <text
          x="${x + barW / 2}"
          y="${H - padBottom + 16}"
          text-anchor="middle"
          font-size="11"
          fill="var(--text-muted)"
        >
          ${escapeHtml(row.label)}
        </text>
      `;

      if (
        row.tonnage > 0
      ) {
        const topY =
          padTop +
          chartH -
          (
            row.tonnage /
            niceMax
          ) *
          chartH;

        svg += `
          <text
            x="${x + barW / 2}"
            y="${topY - 6}"
            text-anchor="middle"
            font-size="10"
            font-weight="700"
            fill="var(--text)"
          >
            ${fmtTons(row.tonnage)}
          </text>
        `;
      }
    }
  );

  svg +=
    '</svg>';

  container.innerHTML =
    svg;
}

function renderLegend() {
  el.chartLegend.innerHTML =
    SHIFT_ORDER
      .map(
        s => `
          <span>
            <span
              class="legend-dot"
              style="background:${SHIFT_COLORS[s]}"
            ></span>

            ${escapeHtml(s)}
          </span>
        `
      )
      .join('');
}

function renderTable(
  rows,
  periodLabel
) {
  el.tableTitle.textContent =
    `Разбивка по ${periodLabel}`;

  if (
    !rows.some(
      r =>
        r.tonnage > 0 ||
        r.brak > 0
    )
  ) {
    el.tableContainer.innerHTML =
      '<div class="empty">Няма данни за този период.</div>';

    return;
  }

  let totalTonnage = 0;
  let totalBrak = 0;

  const shiftTotals =
    emptyShiftMap();

  let html =
    '<table class="stats-table">' +
    '<thead>' +
    '<tr>' +

    `<th>${escapeHtml(periodLabel)}</th>` +

    '<th style="text-align:right">Тонаж</th>' +

    '<th style="text-align:right">Брак</th>' +

    '<th style="text-align:right">% брак</th>' +

    SHIFT_ORDER
      .map(
        s =>
          `<th style="text-align:right">${escapeHtml(s)}</th>`
      )
      .join('') +

    '</tr>' +
    '</thead>' +
    '<tbody>';

  rows.forEach(row => {
    if (
      row.tonnage === 0 &&
      row.brak === 0
    ) {
      return;
    }

    totalTonnage +=
      row.tonnage;

    totalBrak +=
      row.brak;

    SHIFT_ORDER.forEach(
      s =>
        shiftTotals[s] +=
          row.byShift[s] ||
          0
    );

    const brakPct =
      row.tonnage > 0
        ? row.brak /
          row.tonnage *
          100
        : 0;

    html += `
      <tr>

        <td>
          ${escapeHtml(row.label)}
        </td>

        <td class="num">
          ${fmt(row.tonnage)} кг
        </td>

        <td class="num">
          ${fmt(row.brak)} кг
        </td>

        <td class="num">
          ${brakPct.toFixed(1)}%
        </td>

        ${
          SHIFT_ORDER
            .map(
              s =>
                `<td class="num">${
                  row.byShift[s]
                    ? fmt(
                        row.byShift[s]
                      )
                    : '—'
                }</td>`
            )
            .join('')
        }

      </tr>
    `;
  });

  const totalBrakPct =
    totalTonnage > 0
      ? totalBrak /
        totalTonnage *
        100
      : 0;

  html += `
    <tr class="total-row">

      <td>
        Общо
      </td>

      <td class="num">
        ${fmt(totalTonnage)} кг
      </td>

      <td class="num">
        ${fmt(totalBrak)} кг
      </td>

      <td class="num">
        ${totalBrakPct.toFixed(1)}%
      </td>

      ${
        SHIFT_ORDER
          .map(
            s =>
              `<td class="num">${
                shiftTotals[s]
                  ? fmt(
                      shiftTotals[s]
                    )
                  : '—'
              }</td>`
          )
          .join('')
      }

    </tr>
  `;

  html +=
    '</tbody></table>';

  el.tableContainer.innerHTML =
    html;
}

function renderKpis(
  rows,
  periodLabel
) {
  const active =
    rows.filter(
      r =>
        r.tonnage > 0 ||
        r.brak > 0
    );

  const total =
    rows.reduce(
      (a, r) =>
        a +
        r.tonnage,
      0
    );

  const brak =
    rows.reduce(
      (a, r) =>
        a +
        r.brak,
      0
    );

  const brakPct =
    total > 0
      ? brak /
        total *
        100
      : 0;

  const avg =
    active.length
      ? total /
        active.length
      : 0;

  el.kpiRow.innerHTML = `
    <div class="kpi-card">

      <div class="lab">
        Общо тонаж
      </div>

      <div class="val">
        ${fmtTons(total)} т
      </div>

    </div>

    <div class="kpi-card">

      <div class="lab">
        Общо брак
      </div>

      <div class="val">
        ${fmt(brak)} кг
      </div>

    </div>

    <div class="kpi-card">

      <div class="lab">
        % брак
      </div>

      <div class="val">
        ${brakPct.toFixed(1)}%
      </div>

    </div>

    <div class="kpi-card">

      <div class="lab">
        Среден тонаж / ${escapeHtml(periodLabel)}
      </div>

      <div class="val">
        ${fmtTons(avg)} т
      </div>

    </div>
  `;
}

/* Workforce capacity assumes three operating shifts per day. Stickers are
 * excluded from production headcount. Historical periods use the current roster
 * because dated roster snapshots are not available. */

const WF_TEAMS = ['А','Б','В','Г'];
const WF_ROT_PATTERN = [3,3,3,3,'Н',2,2,2,2,'Н',1,1,1,1,'Н','Н'];
const WF_ROT_OFFSETS = {'А':2,'Б':14,'В':6,'Г':10};
const WF_EPOCH_UTC = Date.UTC(2026,11,1);

function wfFmt(value, digits=2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('bg-BG', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
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

function getPersonnelSnapshot() {
  if (personnelCounts) return personnelCounts;
  if (!personnelLoaded || !personnelEmployees.length) return null;

  const active = personnelEmployees.filter(p => p && p.active !== false);
  const counts = {
    auto: {},
    manual: {},
    production: {},
    autoTotal: 0,
    manualTotal: 0,
    productionTotal: 0,
    stickers: 0,
    additional: personnelEmployees.filter(p => p && p.active === false).length,
    totalActive: active.length
  };

  WF_TEAMS.forEach(team => {
    counts.auto[team] = active.filter(p => p.category === 'auto' && p.team === team).length;
    counts.manual[team] = active.filter(p => p.category === 'manual' && p.team === team).length;
    counts.production[team] = counts.auto[team] + counts.manual[team];
    counts.autoTotal += counts.auto[team];
    counts.manualTotal += counts.manual[team];
    counts.productionTotal += counts.production[team];
  });

  counts.stickers = active.filter(p => p.category === 'stickers').length;
  return counts;
}

function aggregateWorkforceMonth(counts) {
  if (!selectedYear || !selectedDashboardMonth || !counts) return null;

  const year = Number(selectedYear);
  const month = Number(selectedDashboardMonth);
  const prefix = `${selectedYear}-${selectedDashboardMonth}-`;
  const groups = new Map();

  entries.forEach(e => {
    if (!e.date || !e.date.startsWith(prefix) || !WF_TEAMS.includes(e.shift)) return;
    const key = `${e.date}|${e.shift}`;
    if (!groups.has(key)) {
      groups.set(key, {
        date: e.date,
        shift: e.shift,
        kg: 0,
        autoKg: 0,
        manKg: 0,
        hasBreakdown: false
      });
    }
    const g = groups.get(key);
    g.kg += Number(e.tonnage) || 0;
    if (e.breakdown && typeof e.breakdown === 'object') {
      g.autoKg += Number(e.breakdown.autoKg) || 0;
      g.manKg += Number(e.breakdown.manKg) || 0;
      g.hasBreakdown = true;
    }
  });

  const shifts = Array.from(groups.values());
  const productionKg = shifts.reduce((sum, r) => sum + r.kg, 0);
  const loggedPersonShifts = shifts.reduce(
    (sum, r) => sum + (counts.production[r.shift] || 0),
    0
  );

  let autoKg = 0;
  let manKg = 0;
  let autoPersonShifts = 0;
  let manPersonShifts = 0;

  shifts.forEach(r => {
    if (!r.hasBreakdown) return;
    autoKg += r.autoKg;
    manKg += r.manKg;
    autoPersonShifts += counts.auto[r.shift] || 0;
    manPersonShifts += counts.manual[r.shift] || 0;
  });

  const daysTotal = new Date(year, month, 0).getDate();
  const lastEntryDay = shifts.reduce((max, r) => {
    const day = Number(String(r.date).slice(8,10)) || 0;
    return Math.max(max, day);
  }, 0);
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  const selectedStart = new Date(year, month - 1, 1);
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const isPastMonth = selectedStart < currentStart;
  const measurementDays = isPastMonth
    ? daysTotal
    : Math.max(1, Math.min(daysTotal, isCurrentMonth ? Math.max(lastEntryDay, now.getDate()) : lastEntryDay));

  let scheduledPersonShifts = 0;
  let scheduledTeamShifts = 0;

  for (let day = 1; day <= daysTotal; day++) {
    const date = new Date(year, month - 1, day);
    WF_TEAMS.forEach(team => {
      if (wfShiftCodeFor(team, date) !== 'Н') {
        scheduledTeamShifts += 1;
        scheduledPersonShifts += counts.production[team] || 0;
      }
    });
  }

  return {
    year,
    month,
    daysTotal,
    loggedTeamShifts: shifts.length,
    productionKg,
    loggedPersonShifts,
    measuredProductivityTons: loggedPersonShifts > 0
      ? (productionKg / 1000) / loggedPersonShifts
      : 0,
    measurementDays,
    rosterProductivityTonsPerDay: counts.productionTotal > 0 && measurementDays > 0
      ? (productionKg / 1000) / (counts.productionTotal * measurementDays)
      : 0,
    autoProductivityTons: autoPersonShifts > 0
      ? (autoKg / 1000) / autoPersonShifts
      : 0,
    manualProductivityTons: manPersonShifts > 0
      ? (manKg / 1000) / manPersonShifts
      : 0,
    scheduledPersonShifts,
    scheduledTeamShifts,
    shiftsPerRosterHead: counts.productionTotal > 0
      ? scheduledPersonShifts / counts.productionTotal
      : 0,
    avgPeoplePerOperatingShift: scheduledTeamShifts > 0
      ? scheduledPersonShifts / scheduledTeamShifts
      : 0
  };
}

function workforceScenario(monthData, counts) {
  if (!monthData || !counts || !counts.productionTotal) return null;

  // Use the production goal and reserve headcount from their source files.
  // Productivity is output divided by active production headcount and calendar days.
  const target = Math.max(0, Number(goalTons) || 0);
  const reservePeople = Math.max(0, Number(counts.additional) || 0);
  const reservePct = counts.productionTotal > 0
    ? reservePeople / counts.productionTotal * 100
    : 0;
  const productivity = Math.max(0, Number(monthData.rosterProductivityTonsPerDay) || 0);
  const measured = productivity;

  if (!target || !productivity || !monthData.daysTotal) {
    return {
      target,
      reservePeople,
      reservePct,
      productivity,
      measured,
      valid: false
    };
  }

  const capacity = productivity * counts.productionTotal * monthData.daysTotal;
  const baseRequiredRaw = target / (productivity * monthData.daysTotal);
  const baseRequired = Math.ceil(baseRequiredRaw);
  const reserveRequired = baseRequired + reservePeople;
  const gap = reserveRequired - counts.productionTotal;
  const targetPerShift = monthData.scheduledTeamShifts > 0
    ? target / monthData.scheduledTeamShifts
    : 0;
  const requiredPerShift = baseRequiredRaw / 4;
  const requiredProductivityAtCurrentStaff = monthData.scheduledPersonShifts > 0
    ? target / monthData.scheduledPersonShifts
    : 0;
  const avgRosterTonsPerCalendarDay = counts.productionTotal > 0 && monthData.daysTotal > 0
    ? target / (counts.productionTotal * monthData.daysTotal)
    : 0;

  return {
    target,
    reservePeople,
    reservePct,
    productivity,
    measured,
    capacity,
    baseRequiredRaw,
    baseRequired,
    reserveRequired,
    gap,
    targetPerShift,
    requiredPerShift,
    requiredProductivityAtCurrentStaff,
    avgRosterTonsPerCalendarDay,
    valid: true
  };
}

function renderWorkforceCapacityChart(monthData, counts, scenario) {
  if (!el.wfCapacityChart) return;
  if (!scenario || !scenario.valid) {
    el.wfCapacityChart.innerHTML = '<div class="wf-chart-empty">Нужни са данни за тонаж и производителност, за да се изчертае капацитетът.</div>';
    return;
  }

  const current = counts.productionTotal;
  const required = scenario.baseRequired;
  const reserve = scenario.reserveRequired;
  const maxStaff = Math.max(40, Math.ceil(Math.max(current, required, reserve) * 1.18 / 10) * 10);
  const yMax = Math.max(scenario.target * 1.18, scenario.productivity * monthData.daysTotal * maxStaff);

  const W = 760, H = 285;
  const L = 56, R = 24, T = 24, B = 42;
  const PW = W - L - R, PH = H - T - B;
  const x = n => L + (n / maxStaff) * PW;
  const y = tons => T + PH - (tons / yMax) * PH;
  const capAt = staff => staff * scenario.productivity * monthData.daysTotal;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const tons = yMax * i / 4;
    const yy = y(tons);
    grid += `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="rgba(255,255,255,.055)" stroke-width="1"/>`;
    grid += `<text x="${L-9}" y="${yy+4}" fill="#8b929e" font-size="9" text-anchor="end">${Math.round(tons)} т</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const staff = maxStaff * i / 4;
    const xx = x(staff);
    grid += `<text x="${xx}" y="${H-16}" fill="#8b929e" font-size="9" text-anchor="middle">${Math.round(staff)}</text>`;
  }

  const targetY = y(scenario.target);
  const currentX = x(current), currentY = y(capAt(current));
  const reqX = x(scenario.baseRequiredRaw), reqY = y(scenario.target);
  const lineEndY = y(capAt(maxStaff));
  const capColor = scenario.capacity >= scenario.target ? '#3fbfa0' : '#9b7bd1';

  el.wfCapacityChart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Капацитет спрямо активния щат">
      <defs>
        <linearGradient id="wfAreaGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${capColor}" stop-opacity=".18"/>
          <stop offset="100%" stop-color="${capColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <line x1="${L}" y1="${targetY}" x2="${W-R}" y2="${targetY}" stroke="#f5a623" stroke-width="1.5" stroke-dasharray="6 5" opacity=".9"/>
      <text x="${W-R}" y="${Math.max(T+10,targetY-7)}" fill="#f5a623" font-size="10" text-anchor="end" font-weight="700">Цел ${Math.round(scenario.target)} т</text>
      <path d="M ${x(0)} ${y(0)} L ${x(maxStaff)} ${lineEndY} L ${x(maxStaff)} ${y(0)} Z" fill="url(#wfAreaGradient)"/>
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(maxStaff)}" y2="${lineEndY}" stroke="${capColor}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${currentX}" y1="${T}" x2="${currentX}" y2="${H-B}" stroke="rgba(255,255,255,.13)" stroke-width="1" stroke-dasharray="3 5"/>
      <circle cx="${currentX}" cy="${currentY}" r="5.5" fill="${capColor}" stroke="#1a1d22" stroke-width="3"/>
      <text x="${currentX}" y="${Math.max(T+11,currentY-11)}" fill="#e6e9ee" font-size="10" text-anchor="middle" font-weight="800">Текущ ${current}</text>
      <circle cx="${reqX}" cy="${reqY}" r="5.5" fill="#f5a623" stroke="#1a1d22" stroke-width="3"/>
      <text x="${reqX}" y="${Math.min(H-B-10,reqY+20)}" fill="#f5a623" font-size="10" text-anchor="middle" font-weight="800">База ${scenario.baseRequired}</text>
      <text x="${L}" y="12" fill="#8b929e" font-size="9">Месечен капацитет</text>
      <text x="${W-R}" y="${H-2}" fill="#8b929e" font-size="9" text-anchor="end">Активен производствен щат</text>
    </svg>`;
}

function setWfKpiClass(node, cls) {
  if (!node) return;
  node.classList.remove('good','warn','bad');
  if (cls) node.classList.add(cls);
}

function renderWorkforceDashboard() {
  if (!el.workforceDashboard) return;

  el.wfSubtitle.textContent = selectedPeriodLabel();
  const counts = getPersonnelSnapshot();
  if (!counts) {
    el.wfNoData.style.display = 'block';
    el.wfBody.style.display = 'none';
    el.wfNoData.innerHTML = '<strong>Няма свързан файл за състава.</strong> Свържи <b>personnel.json</b> от панела „Споделени файлове“. Ако вече е отварян в Personnel / Shift на този компютър, връзката обикновено се възстановява автоматично.';
    el.wfStaffSource.textContent = 'не е свързан';
    el.wfStatus.className = 'status-chip neutral';
    el.wfStatus.textContent = 'Няма personnel данни';
    return;
  }

  const monthData = aggregateWorkforceMonth(counts);
  if (!monthData || !monthData.loggedTeamShifts || !monthData.measuredProductivityTons) {
    el.wfNoData.style.display = 'block';
    el.wfBody.style.display = 'none';
    el.wfNoData.innerHTML = '<strong>Няма достатъчно тонажни записи за избрания месец.</strong> Капацитетът се изчислява от реалните записи А / Б / В / Г и текущия активен състав.';
    el.wfStaffSource.textContent = `${counts.productionTotal} производствени`;
    el.wfStatus.className = 'status-chip neutral';
    el.wfStatus.textContent = 'Няма база за изчисление';
    return;
  }

  el.wfNoData.style.display = 'none';
  el.wfBody.style.display = 'block';

  const scenario = workforceScenario(monthData, counts);
  const monthName = MONTH_FULL_LABELS[monthData.month - 1];
  el.wfStaffSource.textContent = `${counts.productionTotal} производствени + ${counts.additional} допълнителни`;
  el.wfSubtitle.textContent = `${monthName} ${monthData.year}: цел ${wfFmt(goalTons,0)} т от „Тонаж и брак“, производителност от реалния тонаж и текущия активен състав, резерв от ${counts.additional} души в „Допълнителни“. Историческият щат по дата не се пази.`;

  el.wfCurrentStaff.textContent = `${counts.productionTotal}`;
  el.wfCurrentStaffSub.textContent = `Автоматична ${counts.autoTotal} + Ръчна ${counts.manualTotal}`;
  el.wfMeasuredProductivity.textContent = `${wfFmt(monthData.rosterProductivityTonsPerDay, 2)} т`;
  el.wfMeasuredProductivitySub.textContent = `${fmtTons(monthData.productionKg)} т / (${counts.productionTotal} души × ${monthData.measurementDays} дни)`;
  el.wfAutoProd.textContent = monthData.autoProductivityTons > 0 ? `${wfFmt(monthData.autoProductivityTons,2)} т / човек-смяна` : 'няма breakdown';
  el.wfManualProd.textContent = monthData.manualProductivityTons > 0 ? `${wfFmt(monthData.manualProductivityTons,2)} т / човек-смяна` : 'няма breakdown';
  el.wfStickersCount.textContent = `${counts.stickers} души`;

  if (el.wfCalcTarget) el.wfCalcTarget.textContent = `${wfFmt(goalTons,0)} т`;
  if (el.wfCalcReserve) el.wfCalcReserve.textContent = `${counts.additional} души`;
  if (el.wfCalcReserveSub) {
    const reserveEq = counts.productionTotal > 0 ? counts.additional / counts.productionTotal * 100 : 0;
    el.wfCalcReserveSub.textContent = `от „Допълнителни“ · ${wfFmt(reserveEq,1)}% спрямо производствения щат`;
  }
  if (el.wfCalcProductivity) el.wfCalcProductivity.textContent = `${wfFmt(monthData.rosterProductivityTonsPerDay,2)} т`;

  if (!scenario || !scenario.valid) {
    el.wfRequiredProductivity.textContent = '—';
    el.wfTargetPerShift.textContent = '—';
    el.wfCurrentCapacity.textContent = '—';
    el.wfGap.textContent = '—';
    el.wfRequiredBase.textContent = '—';
    el.wfRequiredReserve.textContent = '—';
    el.wfResultGap.textContent = '—';
    el.wfRequiredPerShift.textContent = '—';
    el.wfCalcNote.textContent = 'Нужни са валидна месечна цел, Personnel данни и реален тонаж за избрания месец, за да изчислим необходимия щат.';
    el.wfStatus.className = 'status-chip neutral';
    el.wfStatus.textContent = 'Недостатъчно данни';
    renderWorkforceCapacityChart(monthData, counts, scenario);
    return;
  }

  const coverage = scenario.target > 0 ? scenario.capacity / scenario.target : 0;
  let statusCls = 'good';
  let statusText = 'Капацитетът покрива целта';
  if (scenario.gap > 0) {
    statusCls = coverage >= .9 ? 'warn' : 'bad';
    statusText = `Нужни още ${scenario.gap} с резерв`;
  } else if (scenario.gap < 0) {
    statusText = `Резерв ${Math.abs(scenario.gap)} души`;
  }
  el.wfStatus.className = `status-chip ${statusCls}`;
  el.wfStatus.textContent = statusText;

  el.wfRequiredProductivity.textContent = `${wfFmt(scenario.avgRosterTonsPerCalendarDay,2)} т`;
  el.wfTargetPerShift.textContent = `${wfFmt(scenario.targetPerShift,1)} т`;
  el.wfCurrentCapacity.textContent = `${wfFmt(scenario.capacity,0)} т`;
  el.wfCurrentCapacitySub.textContent = `${wfFmt(coverage*100,0)}% от целта ${wfFmt(scenario.target,0)} т`;
  el.wfGap.textContent = scenario.gap > 0 ? `+${scenario.gap}` : String(scenario.gap);
  el.wfGapSub.textContent = `база ${scenario.baseRequired} + ${scenario.reservePeople} допълнителни → ${scenario.reserveRequired}`;

  setWfKpiClass(el.wfCapacityKpi, coverage >= 1 ? 'good' : (coverage >= .9 ? 'warn' : 'bad'));
  setWfKpiClass(el.wfGapKpi, scenario.gap <= 0 ? 'good' : (scenario.gap <= 5 ? 'warn' : 'bad'));

  el.wfRequiredBase.textContent = `${scenario.baseRequired} души`;
  el.wfRequiredReserve.textContent = `${scenario.reserveRequired} души`;
  el.wfResultGap.textContent = scenario.gap === 0
    ? 'точно'
    : (scenario.gap > 0 ? `+${scenario.gap} души` : `${scenario.gap} души`);
  el.wfRequiredPerShift.textContent = `${wfFmt(scenario.requiredPerShift,1)} души`;
  el.wfResultGapRow.className = `wf-result ${scenario.gap <= 0 ? 'good' : (scenario.gap <= 5 ? 'warn' : 'bad')}`;

  el.wfCalcNote.innerHTML = `Всичко се смята автоматично: целта <strong>${wfFmt(scenario.target,0)} т</strong> идва от „Тонаж и брак“; измерената производителност е <strong>${wfFmt(scenario.productivity,2)} т / щатен човек / ден</strong> за ${monthData.measurementDays} дни; резервът е <strong>${scenario.reservePeople} души</strong> — текущият брой в „Допълнителни“ (${wfFmt(scenario.reservePct,1)}% спрямо активния производствен щат). За целта са нужни средно <strong>${wfFmt(scenario.targetPerShift,1)} т на работна смяна</strong>. Базов необходим щат: <strong>${scenario.baseRequired}</strong>; с текущия резерв: <strong>${scenario.reserveRequired}</strong>.`;

  renderWorkforceCapacityChart(monthData, counts, scenario);
}

/* Line and shift breakdown */

function aggregateLineByShift(
  scopeEntries
) {
  const byShift = {};

  SHIFT_ORDER.forEach(
    shift =>
      byShift[shift] = {
        shift,
        autoKg: 0,
        autoCrates: 0,
        manKg: 0,
        manCrates: 0
      }
  );

  scopeEntries.forEach(e => {
    if (
      !byShift[e.shift] ||
      !e.breakdown ||
      typeof e.breakdown !==
        'object'
    ) {
      return;
    }

    byShift[
      e.shift
    ].autoKg +=
      Number(
        e.breakdown.autoKg
      ) || 0;

    byShift[
      e.shift
    ].autoCrates +=
      Number(
        e.breakdown.autoCrates
      ) || 0;

    byShift[
      e.shift
    ].manKg +=
      Number(
        e.breakdown.manKg
      ) || 0;

    byShift[
      e.shift
    ].manCrates +=
      Number(
        e.breakdown.manCrates
      ) || 0;
  });

  return SHIFT_ORDER
    .map(
      s =>
        byShift[s]
    )
    .filter(
      r =>
        r.autoKg ||
        r.autoCrates ||
        r.manKg ||
        r.manCrates
    );
}

function renderLineShiftForSelectedMonth() {
  const prefix = `${selectedYear}-${selectedDashboardMonth}-`;
  renderLineShiftTable(
    entries.filter(entry => entry.date?.startsWith(prefix)),
    selectedPeriodLabel()
  );
}

function renderLineShiftTable(
  scopeEntries,
  label
) {
  el.lineShiftTitle.textContent =
    `Ръчна / автоматична линия по смяна — ${label}`;

  const rows =
    aggregateLineByShift(
      scopeEntries
    );

  el.lineShiftHint.textContent =
    'Само записи с реална разбивка между автоматична и ръчна линия.';

  if (!rows.length) {
    el.lineShiftContainer.innerHTML =
      '<div class="empty">Няма данни с разбивка за избрания месец.</div>';

    return;
  }

  const t = {
    autoKg: 0,
    autoCrates: 0,
    manKg: 0,
    manCrates: 0
  };

  let html =
    '<table class="stats-table">' +
    '<thead>' +
    '<tr>' +

    '<th>Смяна</th>' +

    '<th style="text-align:right">Автоматична</th>' +

    '<th style="text-align:right">Ръчна</th>' +

    '<th style="text-align:right">Авт. каси</th>' +

    '<th style="text-align:right">Ръчни каси</th>' +

    '</tr>' +
    '</thead>' +
    '<tbody>';

  rows.forEach(r => {
    t.autoKg +=
      r.autoKg;

    t.autoCrates +=
      r.autoCrates;

    t.manKg +=
      r.manKg;

    t.manCrates +=
      r.manCrates;

    html += `
      <tr>

        <td>
          <strong>
            ${escapeHtml(r.shift)}
          </strong>
        </td>

        <td class="num">
          ${
            r.autoKg
              ? fmt(r.autoKg) +
                ' кг'
              : '—'
          }
        </td>

        <td class="num">
          ${
            r.manKg
              ? fmt(r.manKg) +
                ' кг'
              : '—'
          }
        </td>

        <td class="num">
          ${
            r.autoCrates
              ? fmt(
                  r.autoCrates
                )
              : '—'
          }
        </td>

        <td class="num">
          ${
            r.manCrates
              ? fmt(
                  r.manCrates
                )
              : '—'
          }
        </td>

      </tr>
    `;
  });

  html += `
    <tr class="total-row">

      <td>
        Общо
      </td>

      <td class="num">
        ${
          t.autoKg
            ? fmt(t.autoKg) +
              ' кг'
            : '—'
        }
      </td>

      <td class="num">
        ${
          t.manKg
            ? fmt(t.manKg) +
              ' кг'
            : '—'
        }
      </td>

      <td class="num">
        ${
          t.autoCrates
            ? fmt(
                t.autoCrates
              )
            : '—'
        }
      </td>

      <td class="num">
        ${
          t.manCrates
            ? fmt(
                t.manCrates
              )
            : '—'
        }
      </td>

    </tr>
  `;

  html +=
    '</tbody></table>';

  el.lineShiftContainer.innerHTML =
    html;
}

/* Dashboard rendering */

function renderAll() {
  populateMonthSelectors();
  pairStatistics.render();
  renderMonthlyDashboard();
  renderLineShiftForSelectedMonth();

  const annual = currentView === 'month';
  const scopeLabel = annual ? `Годишен преглед ${selectedYear}` : 'Всички години';
  document.getElementById('productionScopeTitle').textContent = `Тонаж и брак — ${scopeLabel}`;
  document.getElementById('downtimeScopeTitle').textContent = `Престой на автоматична линия — ${scopeLabel}`;
  const rows = annual ? aggregateByMonth(selectedYear) : aggregateByYear();
  renderKpis(rows, annual ? 'месец' : 'година');
  renderStackedBarChart(el.chartContainer, rows);
  renderLegend();
  renderTable(rows, annual ? `месец (${selectedYear})` : 'година');

  renderWorkforceDashboard();

  const avYear =
    selectedYear ||
    String(
      new Date()
        .getFullYear()
    );

  if (
    currentView === 'month'
  ) {
    const avRows =
      aggregateAvByMonth(
        avYear
      );

    renderAvKpis(
      avRows,
      'месец'
    );

    renderAvTable(
      avRows,
      `месец (${avYear})`
    );
  } else {
    const avRows =
      aggregateAvByYear();

    renderAvKpis(
      avRows,
      'година'
    );

    renderAvTable(
      avRows,
      'година'
    );
  }
}

pairStatistics.init();
sync.init();
avSync.init();
personnelSync.init();
