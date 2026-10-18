/* Statistics: line and shift breakdown. */

/* Line and shift breakdown */

function aggregateLineByShift(scopeEntries) {
  return statisticsCache.get('line-shifts', [scopeEntries], '', () => calculateLineShifts(scopeEntries));
}
function calculateLineShifts(
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
  const byShift = emptyShiftMap();
  productionMonthEntries().forEach(e => { if (byShift[e.shift] !== undefined) byShift[e.shift] += Number(e.tonnage) || 0; });
  document.getElementById('prodTeamShareTitle').textContent = `Дял по екипи — ${selectedPeriodLabel()}`;
  renderTeamShare([{byShift}]);
  renderLineShiftTable(
    productionMonthEntries(),
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

  renderLineShiftSummary(rows);

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

    '<th style="text-align:right">Автоматична (т)</th>' +

    '<th style="text-align:right">Ръчна (т)</th>' +

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
              ? fmtTons(r.autoKg) +
                ' т'
              : '—'
          }
        </td>

        <td class="num">
          ${
            r.manKg
              ? fmtTons(r.manKg) +
                ' т'
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
            ? fmtTons(t.autoKg) +
              ' т'
            : '—'
        }
      </td>

      <td class="num">
        ${
          t.manKg
            ? fmtTons(t.manKg) +
              ' т'
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

function renderLineShiftSummary(rows) {
  const t = rows.reduce((sum, r) => ({autoKg: sum.autoKg + r.autoKg, autoCrates: sum.autoCrates + r.autoCrates, manKg: sum.manKg + r.manKg, manCrates: sum.manCrates + r.manCrates}), {autoKg: 0, autoCrates: 0, manKg: 0, manCrates: 0});
  const total = t.autoKg + t.manKg;
  if (!total) { el.lineShiftSummary.innerHTML = ''; return; }
  const autoPct = t.autoKg / total * 100;
  const tile = (cls, name, kg, crates, pct) => `<div class="prod-line ${cls}"><div class="l">${name}</div><div class="v">${fmtTons(kg)} т</div><div class="s">${pct.toFixed(1)}% от тонажа · ${fmt(crates)} каси</div></div>`;
  el.lineShiftSummary.innerHTML = `<div class="prod-line-split" aria-hidden="true"><span class="auto" style="width:${autoPct}%"></span><span class="manual" style="width:${100 - autoPct}%"></span></div>
    <div class="prod-lines">${tile('auto', 'Автоматична линия', t.autoKg, t.autoCrates, autoPct)}${tile('manual', 'Ръчна линия', t.manKg, t.manCrates, 100 - autoPct)}</div>`;
}
