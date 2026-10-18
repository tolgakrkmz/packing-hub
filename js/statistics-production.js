/* Statistics: production tonnage and scrap aggregation, charts and tables. */

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
  return statisticsCache.get('report-years', [productionSummary || entries, downtimeSummary || avEntries], '', calculateReportYears);
}
function calculateReportYears() {
  return [...new Set([
    ...(productionSummary?.availableYears || entries.map(entry => entry.date?.slice(0,4))),
    ...(downtimeSummary?.availableYears || avEntries.map(entry => entry.date?.slice(0,4)))
  ].filter(Boolean))].sort();
}

function aggregateByMonth(year) {
  return statisticsCache.get('production-months', [productionSummary || entries], String(year), () => calculateProductionMonths(year));
}
function calculateProductionMonths(
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
        count: 0,

        byShift:
          emptyShiftMap()
      })
    );

  if(productionSummary) return months.map(row => Object.assign(row,productionSummary.months.find(item => item.key === row.key)));
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

    months[idx].count++;

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
  return statisticsCache.get('production-years', [productionSummary || entries, downtimeSummary || avEntries], '', calculateProductionYears);
}
function calculateProductionYears() {
  if(productionSummary) return getReportYears().map(year => ({key:year,label:year,tonnage:0,brak:0,count:0,byShift:emptyShiftMap(),
    ...productionSummary.years.find(item => item.key === year)}));
  return getReportYears()
    .map(year => {
      const row = {
        key: year,
        label: year,

        tonnage: 0,
        brak: 0,
        count: 0,

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

        row.count++;

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

  const padLeft = 80;
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

  if (!hasProductionReports(rows)) {
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

    '<th style="text-align:right">Тонаж (т)</th>' +

    '<th style="text-align:right">Брак (т)</th>' +

    '<th style="text-align:right">% брак</th>' +

    SHIFT_ORDER
      .map(
        s =>
          `<th style="text-align:right">${escapeHtml(s)} (т)</th>`
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
          ${fmtTons(row.tonnage)} т
        </td>

        <td class="num">
          ${fmtTons(row.brak)} т
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
                    ? fmtTons(row.byShift[s])
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
        ${fmtTons(totalTonnage)} т
      </td>

      <td class="num">
        ${fmtTons(totalBrak)} т
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
                  ? fmtTons(shiftTotals[s])
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

// A saved report with 0 t is a real result; only rows without reports are empty.
function hasProductionReports(rows) {
  return rows.some(row => row.count > 0);
}

function productionShiftTotals(rows) {
  return SHIFT_ORDER.map(shift => ({shift, kg: rows.reduce((sum, row) => sum + (Number(row.byShift?.[shift]) || 0), 0)}));
}

function renderKpis(rows, periodLabel) {
  const active = rows.filter(r => r.tonnage > 0 || r.brak > 0);
  const total = rows.reduce((a, r) => a + r.tonnage, 0);
  const brak = rows.reduce((a, r) => a + r.brak, 0);
  const count = rows.reduce((a, r) => a + (Number(r.count) || 0), 0);
  const brakPct = total > 0 ? brak / total * 100 : 0;
  const avg = active.length ? total / active.length : 0;
  const best = active.reduce((top, r) => !top || r.tonnage > top.tonnage ? r : top, null);
  const lead = productionShiftTotals(rows).reduce((top, r) => r.kg > top.kg ? r : top, {shift: '—', kg: 0});
  const bestLabel = best ? (/^\d{4}-\d{2}$/.test(best.key) ? MONTH_FULL_LABELS[Number(best.key.slice(5)) - 1] : best.label) : '—';
  const card = (lab, val, sub, cls = '') => `<div class="wf-kpi ${cls}"><div class="lab">${lab}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  el.kpiRow.innerHTML =
    card('Общо тонаж', fmtTons(total) + ' т', `${fmt(count)} отчета за смени`, 'emphasis') +
    card(`Среден тонаж / ${escapeHtml(periodLabel)}`, fmtTons(avg) + ' т', `за периодите с отчети: ${active.length}`) +
    card('Най-силен период', best ? fmtTons(best.tonnage) + ' т' : '—', escapeHtml(bestLabel), 'good') +
    card('Средно / отчет', count ? fmtTons(total / count) + ' т' : '—', 'тонаж на един отчет за смяна') +
    card('Общо брак', fmtTons(brak) + ' т', `${brakPct.toFixed(1)}% от тонажа`, 'prod-brak' + (brak ? ' warn' : '')) +
    card('Водещ екип', lead.kg ? escapeHtml(lead.shift) : '—', lead.kg ? `${fmtTons(lead.kg)} т · ${(lead.kg / total * 100).toFixed(1)}% от тонажа` : 'няма тонаж по екипи');
}

function renderTeamShare(rows) {
  const teams = productionShiftTotals(rows).filter(r => r.kg > 0).sort((a, b) => b.kg - a.kg);
  const total = teams.reduce((sum, r) => sum + r.kg, 0);
  el.prodTeamShare.innerHTML = !teams.length ? '<div class="ps-empty">Няма тонаж по екипи.</div>' : `<div class="prod-team-list">${teams.map((r, index) => {
    const share = r.kg / total * 100;
    return `<div class="prod-team"><div class="prod-team-head"><span><span class="prod-team-no">${index + 1}</span><b>${escapeHtml(r.shift)}</b></span><span><b>${fmtTons(r.kg)} т</b> · ${share.toFixed(1)}%</span></div>
      <div class="ps-bar" aria-hidden="true"><span style="width:${share / (teams[0].kg / total * 100) * 100}%;background:${SHIFT_COLORS[r.shift]}"></span></div></div>`;
  }).join('')}</div>`;
}
