/* Read-only monthly dashboard; it can render without production or personnel files. */
function createPairTargetsStatistics({dbName, localStorageKey, getPeriod, onDataChange}) {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt = value => value === null ? '—' : Number(value).toLocaleString('bg-BG', {maximumFractionDigits: 2});
  const fmtTons = StatisticsUnits.formatKg;
  const pct = value => value === null ? '—' : fmt(value) + '%';
  const monthLabel = month => new Date(Number(month.slice(0,4)), Number(month.slice(5,7)) - 1, 1).toLocaleDateString('bg-BG', {month:'long', year:'numeric'});
  const statusLabels = {pending:'Очаква отчет', achieved:'Постигнат', missed:'Непостигнат', cancelled:'Отменена'};
  let data = PairTargets.emptyData(), loaded = false, started = false;
  let version = 0;
  const cache = createStatisticsCache();
  const elements = Object.fromEntries(['connDot','connText','openFileBtn','createFileBtn','reconnectBtn','refreshBtn','connRow','connNote','importFallback'].map(key => [key, $('pairStats' + key[0].toUpperCase() + key.slice(1))]));
  const accept = value => { data = PairTargets.validateData(value); loaded = true; version++; };
  const sync = createFileSync({
    getStatisticsPeriod:() => ({month:getPeriod(),scope:'year'}),
    dbName, localStorageKey, suggestedFileName:'pair-targets.json', readOnly:true, strictJson:true,
    defaultData:PairTargets.emptyData, getData:() => data, onConnect:accept, onRefresh:accept, render:onDataChange, elements
  });
  $('pairStatsTeam').innerHTML = '<option value="">Всички екипи</option>' + PairTargets.TEAMS.map(team => `<option value="${escape(team)}">${escape(team)}</option>`).join('');
  $('pairStatsTeam').addEventListener('change', render);

  function reportsTable(records) {
    return `<div class="pair-stats-scroll"><table class="stats-table"><thead><tr><th>Дата / смяна</th><th>Двойка / опаковка</th><th>Тонове реално / цел</th><th>Каси реално / цел</th><th>Статус</th><th>Причина / бележка</th></tr></thead><tbody>${records.slice().sort((a,b) => a.date.localeCompare(b.date) || a.shiftCode - b.shiftCode || a.id.localeCompare(b.id)).map(entry => {
      const state = PairTargets.status(entry);
      const area = entry.areas.length === 2 ? 'Смесена опаковка' : entry.areas[0] === 'auto' ? 'Автоматична опаковка' : 'Ръчна опаковка';
      const explanation = entry.cancellation || entry.result;
      const reason = state === 'cancelled' ? PairTargets.CANCELLATION_REASONS.find(item => item.key === explanation.reasonKey) : state === 'missed' ? PairTargets.REASONS.find(item => item.key === explanation.reasonKey) || PairTargets.REASONS.find(item => item.key === 'other') : null;
      return `<tr><td>${escape(entry.date.split('-').reverse().join('.'))}<br>${entry.shiftCode} смяна · ${escape(entry.team)}</td><td><span translate="no">${entry.members.map(person => escape(person.name)).join(' + ')}</span><br><span class="conn-note">${area}</span></td><td class="num">${entry.result ? fmtTons(entry.result.kg) : '—'} / ${fmtTons(entry.targetKg)}</td><td class="num">${entry.result ? fmt(entry.result.crates) : '—'} / ${fmt(entry.targetCrates)}</td><td class="pair-state-${state}">${statusLabels[state]}</td><td class="pair-report-note">${reason ? escape(reason.label) : ''}${explanation?.reasonText ? ' · <span translate="no">' + escape(explanation.reasonText) + '</span>' : reason ? '' : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  const tone = value => value === null ? 'neutral' : value >= 80 ? 'good' : value >= 50 ? 'warn' : 'bad';
  const bar = (value, cls) => `<div class="ps-bar ${cls}" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, value || 0))}%"></span></div>`;
  function rankingCard(title, sub, rows, cls, empty = 'Няма отчети за класиране.') {
    const list = rows.length ? `<ol class="ps-rank">${rows.map((row, index) => `<li>
      <span class="ps-rank-no ${cls}">${index + 1}</span>
      <div class="ps-rank-main"><div class="ps-rank-name" translate="no">${escape(row.name)}</div>
      <div class="ps-rank-meta">Постигнати: ${row.achieved} / ${row.reported} · Тонаж ${pct(row.kgPct)} (${fmtTons(row.actualKg)} / ${fmtTons(row.reportedTargetKg)} т)</div>
      ${bar(row.successPct, tone(row.successPct))}</div>
      <div class="ps-rank-val ${cls}">${pct(row.successPct)}<small>успеваемост</small></div></li>`).join('')}</ol>` : `<div class="ps-empty">${empty}</div>`;
    return `<div class="wf-card"><div class="wf-card-title">${title}</div><div class="wf-card-sub">${sub}</div>${list}</div>`;
  }

  function render() {
    cache.update('dashboard', [data, loaded], getPeriod() + '|' + $('pairStatsTeam').value, renderDashboard);
  }
  function renderDashboard() {
    const openGroups = new Set(Array.from($('pairStatsBody').querySelectorAll('details[open]')).map(node => node.dataset.group));
    const selectedMonth = getPeriod();
    $('pairStatsPeriod').textContent = monthLabel(selectedMonth);
    $('pairStatsHint').textContent = !loaded
      ? globalThis.HUB_SERVER_BOOT
        ? 'Провери връзката с общата база и натисни „Опресни“ от панела за връзка.'
        : 'Свържете pair-targets.json от панела за файловете. Статистиката само чете отчетите.'
      : 'Изпълнението е спрямо целите на отчетените двойки. Неотчетените планове се показват отделно. Количествата на двойките не се добавят към „Тонаж и брак“.';
    const team = $('pairStatsTeam').value;
    const result = cache.get('pairs', [data], selectedMonth + '|' + team, () => PairTargetsStatistics.aggregate(data.entries, selectedMonth, team));
    if (!result.planned && !result.cancelled) {
      $('pairStatsStatus').className = 'status-chip neutral';
      $('pairStatsStatus').textContent = 'Няма данни';
      $('pairStatsBody').innerHTML = `<div class="empty">${!loaded ? globalThis.HUB_SERVER_BOOT ? 'Данните за двойките още не са заредени.' : 'Няма свързан файл за двойките.' : 'Няма двойки за избрания месец и екип.'}</div>`;
      return;
    }
    const card = (label, value, sub, cls = '') => `<div class="wf-kpi kpi-card ${cls}"><div class="lab">${label}</div><div class="val">${value}</div><div class="sub">${sub}</div></div>`;
    const details = (key, summary, body) => `<details data-group="${escape(key)}"${openGroups.has(key) ? ' open' : ''}><summary>${summary}</summary>${body}</details>`;
    const success = tone(result.successPct);
    $('pairStatsStatus').className = 'status-chip ' + success;
    $('pairStatsStatus').textContent = result.reported ? `${result.achieved} от ${result.reported} постигнати` : 'Няма отчети';
    const {worstPairs, worstPeople, bestPairs, bestPeople} = result.rankings;
    $('pairStatsBody').innerHTML = `<div class="wf-kpis pair-stats-kpis">
      ${card('Планирани двойки', fmt(result.planned), `Отчетени: ${result.reported} · Очакват отчет: ${result.pending}${result.cancelled ? `<br>Отменени двойки: ${result.cancelled}` : ''}`)}
      ${card('Постигнати таргети', pct(result.successPct), `Постигнати: ${result.achieved} · Непостигнати: ${result.missed}<br>И двете цели трябва да са изпълнени.`, 'emphasis ' + success)}
      ${card('Изпълнение · тонове', pct(result.kgPct), `${fmtTons(result.actualKg)} / ${fmtTons(result.reportedTargetKg)} т по отчетените двойки<br>Общ план: ${fmtTons(result.plannedKg)} т`, tone(result.kgPct))}
      ${card('Изпълнение · каси', pct(result.cratesPct), `${fmt(result.actualCrates)} / ${fmt(result.reportedTargetCrates)} каси по отчетените двойки<br>Общ план: ${fmt(result.plannedCrates)} каси`, tone(result.cratesPct))}
      ${card('Недостиг по отчетите', fmtTons(result.deficitKg) + ' т', `${fmt(result.deficitCrates)} каси · преизпълнението не го компенсира.`, result.deficitKg ? 'bad' : 'good')}
      ${card('Средно / отчетена двойка', result.averageKg === null ? '—' : fmtTons(result.averageKg) + ' т', 'Средно количество за отчетена двойка и смяна.')}
    </div>
    <div class="ps-content">
    <div class="ps-grid ps-rankings">
      ${rankingCard('Топ 5 несправили се двойки', 'Най-ниска успеваемост, после най-нисък тонаж спрямо целта.', worstPairs, 'bad')}
      ${rankingCard('Топ 5 най-добри двойки', 'Най-висока успеваемост, после най-висок тонаж спрямо целта.', bestPairs, 'good', 'Няма други двойки с постигнат таргет.')}
      ${rankingCard('Топ 5 несправили се хора', 'Всеки човек поотделно, по всички двойки, в които е участвал.', worstPeople, 'bad')}
      ${rankingCard('Топ 5 най-добри хора', 'Всеки човек поотделно, по всички двойки, в които е участвал.', bestPeople, 'good', 'Няма други хора с постигнат таргет.')}
    </div>
    <div class="ps-grid ps-analysis">
      <div class="wf-card"><div class="wf-card-title">Сравнение по екипи</div><div class="wf-card-sub">Успеваемост и изпълнение по тонаж за всеки екип.</div>
        <div class="ps-teams">${result.teams.map(group => `<div class="ps-team" data-team="${escape(group.team)}">
          <div class="ps-team-head"><b>Екип ${escape(group.team)}</b><span class="status-chip ${tone(group.successPct)}">${pct(group.successPct)}</span></div>
          <div class="ps-team-meta">Постигнати: ${group.achieved} / ${group.reported} · Очакват отчет: ${group.pending}</div>
          ${bar(group.successPct, tone(group.successPct))}
          <div class="ps-team-nums"><span>Тонаж <b>${fmtTons(group.actualKg)} т · ${pct(group.kgPct)}</b></span><span>Каси <b>${fmt(group.actualCrates)} · ${pct(group.cratesPct)}</b></span></div>
        </div>`).join('')}</div></div>
      <div class="wf-card"><div class="wf-card-title">Причини за неизпълнение</div><div class="wf-card-sub">Дял от ${result.missed} непостигнати отчета. Това са посочените причини, а не измерени минути престой.</div>
        ${result.reasons.length ? result.reasons.map(reason => details('reason-' + reason.key, `<div class="pair-reason-title"><span>${escape(reason.label)}</span><strong>${reason.count} · ${pct(reason.count / result.missed * 100)}</strong></div>${bar(reason.count / result.missed * 100, 'warn')}`, reportsTable(reason.entries))).join('') : '<div class="ps-empty">Няма отчетени непостигнати таргети.</div>'}
      </div>
    </div>
    <div class="wf-card"><div class="wf-card-title">Двойки и отчети</div><div class="wf-card-sub">Всички отчети по екипи. Отвори екип, за да видиш всяка двойка и причината.</div>
    ${result.teams.map(group => details('team-' + group.team, `Екип ${escape(group.team)} · ${group.planned} двойки · ${group.pending} очакват отчет${group.cancelled ? ' · '+group.cancelled+' отменени' : ''}`, reportsTable(group.entries))).join('')}
    </div></div>`;
  }
  return {
    init() { if (!started) { started = true; sync.init(); } render(); },
    render,
    refresh:() => sync.refreshFromDisk(),
    get isCurrent() { return sync.isCurrent; },
    getYears() { return cache.get('years', [data], '', () => typeof HubServer !== 'undefined' && data.availableYears ? data.availableYears : data.entries.map(entry => entry.date.slice(0, 4))); },
    getVersion() { return version; }
  };
}
