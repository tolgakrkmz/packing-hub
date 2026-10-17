/* Statistics: monthly trend chart for the production result. */

function renderMonthlyTrendChart(
  d
) {
  const host =
    el.monthlyTrendChart;

  const W = 920;
  const H = 235;

  const pL = 80;
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
