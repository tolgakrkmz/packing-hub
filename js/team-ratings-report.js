/* Team ratings tab in Statistics, laid out like the pair dashboard. Server version and canViewRatings only; otherwise the tab is removed before navigation starts. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined' || !HubServer.can('canViewRatings')) { $('statsTabRatings').remove(); $('statsRatings').remove(); return; }
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number = new Intl.NumberFormat('bg-BG', {maximumFractionDigits: 0});
  const pct = value => value === null ? '—' : number.format(value) + '%';
  const tone = value => value === null ? 'neutral' : value >= 80 ? 'good' : value >= 50 ? 'warn' : 'bad';
  const poorTone = value => value === null ? 'neutral' : value >= 20 ? 'bad' : value > 0 ? 'warn' : 'good';
  const bar = (value, cls) => `<div class="ps-bar ${cls}" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, value || 0))}%"></span></div>`;
  const low = row => row.lowData ? ' <span class="status-chip neutral">малко данни</span>' : '';
  const counts = row => `👍 ${row.good} · 👌 ${row.ok} · 👎 ${row.poor} · <span>Оценки:</span> ${row.total}`;
  let summary = null, sequence = 0;
  const opened = () => new Set(Array.from($('ratingsBody').querySelectorAll('details[open]')).map(node => node.dataset.group));
  function rankingCard(title, sub, rows, key, cls, label) {
    const list = rows.length ? `<ol class="ps-rank">${rows.map((row, index) => `<li>
      <span class="ps-rank-no ${cls}">${index + 1}</span>
      <div class="ps-rank-main"><div class="ps-rank-name"><span translate="no">${escape(row.name)}</span>${low(row)}</div>
      <div class="ps-rank-meta"><span>Екип</span> ${escape(row.team)} · ${counts(row)}</div>
      ${bar(row[key + 'Pct'], cls)}</div>
      <div class="ps-rank-val ${cls}">${pct(row[key + 'Pct'])}<small>${label}</small></div></li>`).join('')}</ol>` : '<div class="ps-empty">Няма оценки за класиране.</div>';
    return `<div class="wf-card"><div class="wf-card-title">${title}</div><div class="wf-card-sub">${sub}</div>${list}</div>`;
  }
  function peopleTable(rows) {
    return `<div class="pair-stats-scroll"><table class="stats-table"><thead><tr><th>Служител</th><th>👍 Добре</th><th>👌 Нормално</th><th>👎 Слабо</th><th>Оценки</th><th>Постигнати таргети</th><th>Присъствал</th><th>Отсъствал</th></tr></thead><tbody>${rows.map(row => `<tr>
      <td><span translate="no">${escape(row.name)}</span>${low(row)}</td><td class="num">${pct(row.goodPct)}</td><td class="num">${pct(row.okPct)}</td><td class="num">${pct(row.poorPct)}</td>
      <td class="num">${row.total}</td><td class="num">${row.pairs ? row.achieved + ' / ' + row.pairs : '—'}</td><td class="num">${row.present}</td><td class="num">${row.absent}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function render() {
    if (!summary) return;
    const open = opened(), team = $('ratingsTeam').value, result = TeamRatingsStatistics.aggregate(summary, team);
    const details = (key, head, body) => `<details data-group="${escape(key)}"${open.has(key) ? ' open' : ''}><summary>${head}</summary>${body}</details>`;
    const card = (label, value, sub, cls = '') => `<div class="wf-kpi kpi-card ${cls}"><div class="lab">${label}</div><div class="val">${value}</div><div class="sub">${sub}</div></div>`;
    $('ratingsStatus').className = 'status-chip ' + (result.total ? tone(result.goodPct) : 'neutral');
    $('ratingsStatus').textContent = result.total ? `${result.total} оценки` : 'Няма данни';
    if (!result.people) { $('ratingsBody').innerHTML = '<div class="empty">Още няма оценки или отчетени двойки за избрания период и екип.</div>'; return; }
    $('ratingsBody').innerHTML = `<div class="wf-kpis pair-stats-kpis">
      ${card('Оценки', number.format(result.total), `<span>Оценени хора:</span> ${result.rated} / ${result.people}`)}
      ${card('👍 Добре', pct(result.goodPct), `${result.good} <span>оценки</span>`, 'emphasis ' + tone(result.goodPct))}
      ${card('👌 Нормално', pct(result.okPct), `${result.ok} <span>оценки</span>`)}
      ${card('👎 Слабо', pct(result.poorPct), `${result.poor} <span>оценки</span>`, poorTone(result.poorPct))}
      ${card('Постигнати таргети', pct(result.achievedPct), `${result.achieved} / ${result.pairs} <span>отчетени двойки</span>`, tone(result.achievedPct))}
      ${card('Присъствия', number.format(result.present), `<span>Отсъствия:</span> ${result.absent} · <span>без причината</span>`)}
    </div>
    <div class="ps-content">
    <div class="ps-grid ps-rankings">
      ${rankingCard('Топ 5 най-слаби', 'Най-висок дял 👎, после повече оценки.', result.rankings.worst, 'poor', 'bad', 'слабо')}
      ${rankingCard('Топ 5 най-добри', 'Най-висок дял 👍, после повече оценки.', result.rankings.best, 'good', 'good', 'добре')}
    </div>
    <div class="ps-grid ps-analysis">
      <div class="wf-card"><div class="wf-card-title">Сравнение по екипи</div><div class="wf-card-sub">Дял 👍 и 👎 и изпълнение на таргетите за всеки екип.</div>
        <div class="ps-teams">${result.teams.map(group => `<div class="ps-team" data-team="${escape(group.team)}">
          <div class="ps-team-head"><b><span>Екип</span> ${escape(group.team)}</b><span class="status-chip ${tone(group.goodPct)}">${pct(group.goodPct)}</span></div>
          <div class="ps-team-meta"><span>Оценки:</span> ${group.total} · <span>Оценени хора:</span> ${group.rated} / ${group.people}</div>
          ${bar(group.goodPct, tone(group.goodPct))}
          <div class="ps-team-nums"><span>👎 <b>${pct(group.poorPct)}</b></span><span><span>Таргети</span> <b>${group.achieved} / ${group.pairs}</b></span></div>
        </div>`).join('')}</div></div>
      <div class="wf-card"><div class="wf-card-title">Причини към оценките</div><div class="wf-card-sub">Посочените по желание причини, само по екипи, без връзка с отделен човек.</div>
        ${result.reasons.length ? result.reasons.map(reason => `<div class="ratings-reason"><div class="pair-reason-title"><span>${escape(reason.label)}</span><strong>${reason.count} · ${pct(reason.pct)}</strong></div>${bar(reason.pct, 'warn')}</div>`).join('') : '<div class="ps-empty">Няма посочени причини.</div>'}
      </div>
    </div>
    <div class="wf-card"><div class="wf-card-title">Хора по екипи</div><div class="wf-card-sub">Отвори екип, за да видиш всеки човек. Под 5 оценки резултатът е ориентировъчен. Отсъствие означава смяна на екипа без участие в двойка.</div>
    ${result.teams.map(group => details('team-' + group.team, `<span>Екип</span> ${escape(group.team)} · ${group.people} <span>души</span> · ${group.total} <span>оценки</span>`, peopleTable(group.rows))).join('')}
    </div></div>`;
  }
  async function refresh() {
    const ticket = ++sequence;
    try {
      const value = await HubServer.json('/api/team-ratings/summary?days=' + $('ratingsPeriod').value);
      if (ticket !== sequence) return;
      summary = value;
      const teams = [...new Set(value.rows.map(row => row.team))].sort((a, b) => a.localeCompare(b, 'bg')), selected = $('ratingsTeam').value;
      $('ratingsTeam').innerHTML = '<option value="">Всички екипи</option>' + teams.map(team => `<option value="${escape(team)}"${team === selected ? ' selected' : ''}>${escape(team)}</option>`).join('');
      render();
    } catch (error) { if (ticket === sequence) $('ratingsBody').innerHTML = `<div class="empty">${escape(error.message || 'Справката не е заредена.')}</div>`; }
  }
  $('ratingsPeriod').addEventListener('change', refresh);
  $('ratingsTeam').addEventListener('change', render);
  $('statsTabRatings').addEventListener('click', refresh);
  refresh();
})();
