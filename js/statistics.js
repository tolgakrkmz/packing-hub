let entries = [];
let avEntries = [];
let goalTons = 3000;
let productionSummary = null, downtimeSummary = null;
let periodRequest = 0, periodPending = false;
function retainStatisticsSource(previous, incoming) {
  return JSON.stringify(previous) === JSON.stringify(incoming) ? previous : incoming;
}
function acceptProduction(data) {
  entries = retainStatisticsSource(entries,data.entries || []);
  productionSummary = typeof HubServer === 'undefined' ? null : retainStatisticsSource(productionSummary,data.summary || null);
  goalTons = data.goalTons !== undefined ? Number(data.goalTons) || 0 : 3000;
}
function acceptDowntime(data) {
  avEntries = retainStatisticsSource(avEntries,data.entries || []);
  downtimeSummary = typeof HubServer === 'undefined' ? null : retainStatisticsSource(downtimeSummary,data.summary || null);
}
function getStatisticsPeriod() {
  return {month:`${selectedYear}-${selectedDashboardMonth}`,scope:currentView === 'year' ? 'all' : 'year'};
}
async function refreshStatisticsPeriod(scopeOnly = false) {
  if (typeof HubServer === 'undefined') { renderAll(); return; }
  const request = ++periodRequest, status = document.getElementById('statsPeriodStatus');
  periodPending = true; status.hidden = false; status.textContent = 'Обновяване на периода…';
  const reads = [avSync.refreshFromDisk()];
  if (!scopeOnly || !sync.isCurrent) reads.push(sync.refreshFromDisk());
  if (!scopeOnly || !pairStatistics.isCurrent) reads.push(pairStatistics.refresh());
  await Promise.allSettled(reads);
  if (request !== periodRequest) return;
  periodPending = false;
  status.hidden = sync.isCurrent && avSync.isCurrent && pairStatistics.isCurrent;
  if (!status.hidden) status.textContent = 'Периодът не е обновен изцяло. Опитай „Опресни“.';
  renderAll();
}

let personnelEmployees = [];
let personnelCounts = null;
let personnelLoaded = false;

const statisticsCache = createStatisticsCache();
function statisticsDay() { return ShiftSchedule.sofiaDate(); }
function productionMonthEntries() {
  const period = `${selectedYear}-${selectedDashboardMonth}`;
  return statisticsCache.get('month-entries', [entries], period, () => entries.filter(entry => entry.date?.startsWith(period + '-')));
}

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


/* File connections */

const sync = createFileSync({
  getStatisticsPeriod,
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

  onConnect: acceptProduction,
  onRefresh: acceptProduction,

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
  getStatisticsPeriod,
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

  onConnect: acceptDowntime,
  onRefresh: acceptDowntime,

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

        refreshStatisticsPeriod(true);
      }
    );
  });

el.yearSelect.addEventListener('change', () => {
  selectedYear = el.yearSelect.value;
  refreshStatisticsPeriod();
});

el.dashboardMonthSelect.addEventListener('change', () => {
  selectedDashboardMonth = el.dashboardMonthSelect.value;
  refreshStatisticsPeriod();
});


/* Month selection */

function populateMonthSelectors() {
  statisticsCache.update('year-options', [productionSummary || entries, downtimeSummary || avEntries, pairStatistics.getVersion()], selectedYear, () => {
    el.yearSelect.innerHTML = getAvailableYears()
      .map(year => `<option value="${year}">${year}</option>`).join('');
  });
  el.yearSelect.value = selectedYear;
  statisticsCache.update('month-options', [], '', () => {
    el.dashboardMonthSelect.innerHTML = MONTH_FULL_LABELS
      .map((name, index) => `<option value="${pad2(index + 1)}">${name}</option>`).join('');
  });
  el.dashboardMonthSelect.value = selectedDashboardMonth;
}

function selectedPeriodLabel() {
  return `${MONTH_FULL_LABELS[Number(selectedDashboardMonth) - 1]} ${selectedYear}`;
}


/* Dashboard rendering */

function renderAll() {
  if(periodPending) return;
  if(typeof HubServer !== 'undefined' && sync.isCurrent && avSync.isCurrent && pairStatistics.isCurrent)
    document.getElementById('statsPeriodStatus').hidden = true;
  populateMonthSelectors();
  pairStatistics.render();
  const period = `${selectedYear}-${selectedDashboardMonth}`, day = statisticsDay();
  statisticsCache.update('monthly-result', [entries, goalTons, el.connDot.classList.contains('on')], period + '|' + day, renderMonthlyDashboard);
  statisticsCache.update('line-shift-table', [entries], period, renderLineShiftForSelectedMonth);
  statisticsCache.update('workforce-dashboard', [entries, personnelEmployees, personnelCounts, personnelLoaded, goalTons], period + '|' + day, renderWorkforceDashboard);

  const annual = currentView === 'month';
  const scope = annual ? selectedYear : 'all';
  statisticsCache.update('production-breakdown', annual ? [productionSummary || entries, el.connDot.classList.contains('on')] : [productionSummary || entries, downtimeSummary || avEntries, el.connDot.classList.contains('on')], scope, () => {
    const scopeLabel = annual ? `Годишен преглед ${selectedYear}` : 'Всички години';
    document.getElementById('productionScopeTitle').textContent = `Тонаж и брак — ${scopeLabel}`;
    const rows = annual ? aggregateByMonth(selectedYear) : aggregateByYear();
    const hasReports = hasProductionReports(rows), connected = el.connDot.classList.contains('on');
    document.getElementById('productionBody').hidden = !hasReports;
    document.getElementById('productionEmpty').hidden = hasReports;
    document.getElementById('productionEmptyText').textContent = !connected ? 'Няма тонажни записи. Свържете файла от „Тонаж и брак“, за да видите годишния резултат.'
      : annual ? 'Няма тонажни отчети за избраната година.' : 'Още няма тонажни отчети.';
    document.getElementById('productionConnectBtn').hidden = connected;
    document.getElementById('productionAddLink').hidden = !connected || typeof HubServer !== 'undefined' && !HubServer.can('canCreateReports');
    renderKpis(rows, annual ? 'месец' : 'година');
    renderStackedBarChart(el.chartContainer, rows);
    renderLegend();
    renderTable(rows, annual ? `месец (${selectedYear})` : 'година');
  });
  statisticsCache.update('downtime-breakdown', [avEntries, downtimeSummary], scope, () => {
    const scopeLabel = annual ? `Годишен преглед ${selectedYear}` : 'Всички години';
    document.getElementById('downtimeScopeTitle').textContent = `Престой на автоматична линия — ${scopeLabel}`;
    const rows = annual ? aggregateAvByMonth(selectedYear) : aggregateAvByYear();
    renderAvKpis(rows, annual ? 'месец' : 'година');
    renderAvTable(rows, annual ? `месец (${selectedYear})` : 'година');
  });
}

let renderedStatisticsDay=statisticsDay(),statisticsDayRefreshing=false;
async function refreshStatisticsDay(){
  const day=statisticsDay();
  if(day===renderedStatisticsDay || statisticsDayRefreshing || document.hidden || periodPending) return;
  statisticsDayRefreshing=true;
  try {
    if(typeof HubServer !== 'undefined') await personnelSync.refreshFromDisk({fresh:true});
    renderAll();
    renderedStatisticsDay=day;
  } catch { /* Keep the previous day so the next visible refresh retries. */ }
  finally { statisticsDayRefreshing=false; }
}
setInterval(refreshStatisticsDay,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden) refreshStatisticsDay();});
pairStatistics.init();
sync.init();
avSync.init();
personnelSync.init();
