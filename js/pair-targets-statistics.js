/* Read-only monthly dashboard; it can render without production or personnel files. */
function createPairTargetsStatistics({dbName, localStorageKey, getPeriod, onDataChange}) {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt = value => value === null ? '—' : Number(value).toLocaleString('bg-BG', {maximumFractionDigits: 2});
  const pct = value => value === null ? '—' : fmt(value) + '%';
  const monthLabel = month => new Date(Number(month.slice(0,4)), Number(month.slice(5,7)) - 1, 1).toLocaleDateString('bg-BG', {month:'long', year:'numeric'});
  const statusLabels = {pending:'Очаква отчет', achieved:'Постигнат', missed:'Непостигнат'};
  let data = PairTargets.emptyData(), loaded = false, started = false;
  const elements = Object.fromEntries(['connDot','connText','openFileBtn','createFileBtn','reconnectBtn','refreshBtn','connRow','connNote','importFallback'].map(key => [key, $('pairStats' + key[0].toUpperCase() + key.slice(1))]));
  const accept = value => { data = PairTargets.validateData(value); loaded = true; };
  const sync = createFileSync({
    dbName, localStorageKey, suggestedFileName:'pair-targets.json', readOnly:true, strictJson:true,
    defaultData:PairTargets.emptyData, getData:() => data, onConnect:accept, onRefresh:accept, render:onDataChange, elements
  });
  $('pairStatsTeam').innerHTML = '<option value="">Всички екипи</option>' + PairTargets.TEAMS.map(team => `<option value="${escape(team)}">${escape(team)}</option>`).join('');
  $('pairStatsTeam').addEventListener('change', render);

  function reportsTable(records) {
    return `<div class="pair-stats-scroll"><table class="stats-table"><thead><tr><th>Дата / смяна</th><th>Двойка / опаковка</th><th>Кг реално / цел</th><th>Каси реално / цел</th><th>Статус</th><th>Причина / бележка</th></tr></thead><tbody>${records.slice().sort((a,b) => a.date.localeCompare(b.date) || a.shiftCode - b.shiftCode || a.id.localeCompare(b.id)).map(entry => {
      const state = PairTargets.status(entry);
      const area = entry.areas.length === 2 ? 'Смесена опаковка' : entry.areas[0] === 'auto' ? 'Автоматична опаковка' : 'Ръчна опаковка';
      const reason = state === 'missed' ? PairTargets.REASONS.find(item => item.key === entry.result.reasonKey) || PairTargets.REASONS.find(item => item.key === 'other') : null;
      return `<tr><td>${escape(entry.date.split('-').reverse().join('.'))}<br>${entry.shiftCode} смяна · ${escape(entry.team)}</td><td><span translate="no">${entry.members.map(person => escape(person.name)).join(' + ')}</span><br><span class="conn-note">${area}</span></td><td class="num">${entry.result ? fmt(entry.result.kg) : '—'} / ${fmt(entry.targetKg)}</td><td class="num">${entry.result ? fmt(entry.result.crates) : '—'} / ${fmt(entry.targetCrates)}</td><td class="pair-state-${state}">${statusLabels[state]}</td><td class="pair-report-note">${reason ? escape(reason.label) : ''}${entry.result?.reasonText ? ' · <span translate="no">' + escape(entry.result.reasonText) + '</span>' : reason ? '' : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function render() {
    const openGroups = new Set(Array.from($('pairStatsBody').querySelectorAll('details[open]')).map(node => node.dataset.group));
    const selectedMonth = getPeriod();
    $('pairStatsPeriod').textContent = monthLabel(selectedMonth);
    $('pairStatsHint').textContent = !loaded ? 'Свържете pair-targets.json от панела за файловете. Статистиката само чете отчетите.' : 'Изпълнението е спрямо целите на отчетените двойки. Неотчетените планове се показват отделно. Килограмите не се добавят към „Тонаж и брак“.';
    const result = PairTargetsStatistics.aggregate(data.entries, selectedMonth, $('pairStatsTeam').value);
    if (!result.planned) {
      $('pairStatsBody').innerHTML = `<div class="empty">${!loaded ? 'Няма свързан файл за двойките.' : 'Няма двойки за избрания месец и екип.'}</div>`;
      return;
    }
    const card = (label, value, sub) => `<div class="kpi-card"><div class="lab">${label}</div><div class="val">${value}</div><div class="sub">${sub}</div></div>`;
    const details = (key, summary, body) => `<details data-group="${escape(key)}"${openGroups.has(key) ? ' open' : ''}><summary>${summary}</summary>${body}</details>`;
    $('pairStatsBody').innerHTML = `<div class="pair-stats-kpis">
      ${card('Планирани двойки', fmt(result.planned), `Отчетени: ${result.reported} · Очакват отчет: ${result.pending}`)}
      ${card('Постигнати таргети', pct(result.successPct), `Постигнати: ${result.achieved} · Непостигнати: ${result.missed}<br>И двете цели трябва да са изпълнени.`)}
      ${card('Изпълнение · килограми', pct(result.kgPct), `${fmt(result.actualKg)} / ${fmt(result.reportedTargetKg)} кг по отчетените двойки<br>Общ план: ${fmt(result.plannedKg)} кг`)}
      ${card('Изпълнение · каси', pct(result.cratesPct), `${fmt(result.actualCrates)} / ${fmt(result.reportedTargetCrates)} каси по отчетените двойки<br>Общ план: ${fmt(result.plannedCrates)} каси`)}
      ${card('Недостиг по отчетите', fmt(result.deficitKg) + ' кг', `${fmt(result.deficitCrates)} каси<br>Сбор на недостига на всяка двойка; преизпълнението не го компенсира.`)}
      ${card('Средно / отчетена двойка', result.averageKg === null ? '—' : fmt(result.averageKg) + ' кг', 'Средно количество за отчетена двойка и смяна.')}
    </div>
    <details class="stats-details" data-group="analysis"${openGroups.has('analysis') ? ' open' : ''}>
    <summary>Покажи сравнение по екипи и причини</summary>
    <h3>Сравнение по екипи</h3>
    <div class="pair-stats-scroll"><table class="stats-table"><thead><tr><th>Екип</th><th>План / отчети / чакащи</th><th>Постигнати / отчети</th><th>Успеваемост</th><th>Реално кг</th><th>Изпълнение кг</th><th>Реално каси</th><th>Изпълнение каси</th></tr></thead><tbody>${result.teams.map(group => `<tr><td>${escape(group.team)}</td><td class="num">${group.planned} / ${group.reported} / ${group.pending}</td><td class="num">${group.achieved} / ${group.reported}</td><td class="num">${pct(group.successPct)}</td><td class="num">${fmt(group.actualKg)}</td><td class="num">${pct(group.kgPct)}</td><td class="num">${fmt(group.actualCrates)}</td><td class="num">${pct(group.cratesPct)}</td></tr>`).join('')}</tbody></table></div>
    <h3>Причини за неизпълнение</h3>
    <p class="conn-note">Дял от ${result.missed} непостигнати отчета. Това са посочените причини, а не измерени минути престой.</p>
    ${result.reasons.length ? result.reasons.map(reason => details('reason-' + reason.key, `<div class="pair-reason-title"><span>${escape(reason.label)}</span><strong>${reason.count} · ${pct(reason.count / result.missed * 100)}</strong></div><div class="pair-reason-bar" aria-hidden="true"><span style="width:${reason.count / result.missed * 100}%"></span></div>`, reportsTable(reason.entries))).join('') : '<div class="conn-note">Няма отчетени непостигнати таргети.</div>'}
    </details>
    <h3>Двойки и отчети</h3>
    ${result.teams.map(group => details('team-' + group.team, `Екип ${escape(group.team)} · ${group.planned} двойки · ${group.pending} очакват отчет`, reportsTable(group.entries))).join('')}`;
  }
  return {
    init() { if (!started) { started = true; sync.init(); } render(); },
    render,
    getYears() { return data.entries.map(entry => entry.date.slice(0, 4)); }
  };
}
