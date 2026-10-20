/* Team ratings tab in Statistics. Server version and canViewRatings only; otherwise the tab is removed before navigation starts. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined' || !HubServer.can('canViewRatings')) { $('statsTabRatings').remove(); $('statsRatings').remove(); return; }
  function el(tag, text = '', cls = '') { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
  const percent = (part, total) => total ? Math.round(part * 100 / total) + ' %' : '—';
  let sequence = 0;
  async function refresh() {
    const ticket = ++sequence, body = $('ratingsRows'), note = $('ratingsNote');
    try {
      const {rows} = await HubServer.json('/api/team-ratings/summary?days=' + $('ratingsPeriod').value);
      if (ticket !== sequence) return;
      body.replaceChildren();
      note.textContent = rows.length ? 'Под 5 оценки резултатът е ориентировъчен. Отсъствие означава смяна на екипа без участие в двойка; причината не се записва.' : 'Още няма оценки или отчетени двойки за периода.';
      for (const row of rows) {
        const line = el('tr'), name = el('td'), person = el('span', row.name); person.setAttribute('translate', 'no'); name.append(person);
        if (row.lowData) name.append(' ', el('span', 'малко данни', 'status-chip neutral'));
        line.append(name, el('td', row.team));
        for (const value of [percent(row.good, row.total), percent(row.ok, row.total), percent(row.poor, row.total), String(row.total), row.pairs ? row.achieved + ' / ' + row.pairs : '—', String(row.present), String(row.absent)]) line.append(el('td', value, 'num'));
        body.append(line);
      }
    } catch (error) { if (ticket === sequence) note.textContent = error.message || 'Справката не е заредена.'; }
  }
  $('ratingsPeriod').addEventListener('change', refresh);
  $('statsTabRatings').addEventListener('click', refresh);
  refresh();
})();
