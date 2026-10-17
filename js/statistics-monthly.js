/* Statistics: monthly production result dashboard. */

/* Monthly production result */

function getMonthlyDashboardData() {
  return statisticsCache.get('monthly-dashboard', [entries, goalTons], `${selectedYear}-${selectedDashboardMonth}|${statisticsDay()}`, calculateMonthlyDashboardData);
}
function calculateMonthlyDashboardData() {
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

  const rows = productionMonthEntries();

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
      '0 т';

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
