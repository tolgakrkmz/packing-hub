/* Statistics: automatic line downtime aggregation and tables. */

/* Downtime aggregation */

function aggregateAvByMonth(year) {
  return statisticsCache.get('downtime-months', [downtimeSummary || avEntries], String(year), () => calculateDowntimeMonths(year));
}
function calculateDowntimeMonths(
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

  if(downtimeSummary) return months.map(row => Object.assign(row,downtimeSummary.months.find(item => item.key === row.key)));
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
  return statisticsCache.get('downtime-years', [downtimeSummary || avEntries], '', calculateDowntimeYears);
}
function calculateDowntimeYears() {
  if(downtimeSummary) return downtimeSummary.years.map(row => ({...row,label:row.key}));
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
      : globalThis.HUB_SERVER_BOOT
        ? 'Данните за престои още не са заредени. Провери връзката с общата база и натисни „Опресни“ от панела за връзка.'
        : 'Свържи файла на авариите отгоре ("Аварии на автоматична линия"), за да видиш реални данни.';
}

function calculateDowntimeReasons(periodKey) {
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
  return sorted;
}

function renderAvReasons(periodKey, openStates) {
  const sorted = statisticsCache.get('downtime-reasons', [avEntries], periodKey, () => calculateDowntimeReasons(periodKey));
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
