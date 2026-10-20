/* Statistics: monthly presentation built in the browser. Nothing is uploaded; the file is saved on this computer. */
(() => {
  // Only the administrator sees it; the deck holds figures statistics viewers can already read. No accounts offline.
  if (typeof HubServer === 'undefined' || HubServer.user.role !== 'admin') return;
  document.getElementById('presentationBtn').hidden = false;
  const dialog = document.getElementById('presentationDialog'), form = document.getElementById('presentationForm');
  const feedback = document.getElementById('presentationFeedback'), submit = document.getElementById('presentationSubmit');
  // Repeated settings only; monthly figures are entered fresh each time.
  const REMEMBERED = ['specialLabel', 'trucksTarget'], storageKey = 'portfolio-hub-presentation-settings';
  const figures = MonthlyPresentation.EDITABLE.map(key => form.elements[key]);
  let library = null, loaded = null;

  try { const saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); for (const key of REMEMBERED) if (typeof saved[key] === 'string') form.elements[key].value = saved[key]; } catch {}

  // The 470 KB generator loads on first use instead of with every statistics page.
  function loadLibrary() {
    library ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'js/pptxgen-bundle.js';
      script.onload = () => resolve(window.PptxGenJS);
      script.onerror = () => { library = null; script.remove(); reject(new Error('LIBRARY')); };
      document.head.append(script);
    });
    return library;
  }

  const selectedMonth = () => `${selectedYear}-${selectedDashboardMonth}`;
  // The server sends only the selected period, so the two earlier production months and last month's downtime are read separately.
  async function sources(month) {
    const read = (kind, value) => HubServer.json(`/api/statistics/period/${kind}?month=${encodeURIComponent(value)}`).then(result => result.data.entries || []);
    const [p2, p1] = [-2, -1].map(count => MonthlyPresentation.addMonths(month, count));
    const [p2Rows, p1Rows, p1Stops] = await Promise.all([read('production-log', p2), read('production-log', p1), read('line-downtime', p1)]);
    // The downtime read covers a whole year, so entries already loaded for this year appear twice.
    return {month, production:[...productionMonthEntries(), ...p2Rows, ...p1Rows], downtime:[...new Map([...avEntries, ...p1Stops].map(entry => [entry.id, entry])).values()]};
  }
  const markChanged = input => input.classList.toggle('changed', input.value !== input.dataset.site);

  document.getElementById('presentationBtn').addEventListener('click', async () => {
    const month = selectedMonth(), rows = productionMonthEntries();
    document.getElementById('presentationPeriod').textContent = document.getElementById('dashboardTitle').textContent;
    form.elements.realizationT.placeholder = StatisticsUnits.formatKg(rows.reduce((total, entry) => total + (Number(entry.tonnage) || 0), 0));
    feedback.textContent = 'Зареждане на показателите от сайта…';
    loaded = null;
    for (const input of figures) { input.value = ''; input.dataset.site = ''; input.classList.remove('changed'); }
    dialog.showModal();
    try {
      const data = await sources(month);
      if (selectedMonth() !== month || !dialog.open) return;
      const site = MonthlyPresentation.siteFigures({...data, goalTons});
      for (const input of figures) { input.value = input.dataset.site = String(site[input.name]); markChanged(input); }
      loaded = data;
      feedback.textContent = '';
    } catch { feedback.textContent = 'Показателите от сайта не бяха заредени. Затвори и опитай отново.'; }
  });
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  for (const input of figures) input.addEventListener('input', () => markChanged(input));
  dialog.querySelectorAll('[data-reset]').forEach(button => button.addEventListener('click', () => {
    const input = form.elements[button.dataset.reset];
    input.value = input.dataset.site; markChanged(input); input.focus();
  }));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!el.connDot.classList.contains('on') || !el.avConnDot.classList.contains('on')) { feedback.textContent = 'Свържи тонажния дневник и дневника за престои.'; return; }
    const month = selectedMonth();
    if (loaded?.month !== month) { feedback.textContent = 'Показателите от сайта още не са заредени.'; return; }
    submit.disabled = true;
    feedback.textContent = 'Подготовка…';
    try {
      const inputs = Object.fromEntries([...MonthlyPresentation.INPUTS, ...MonthlyPresentation.EDITABLE].map(key => [key, form.elements[key].value]));
      // Problems and tasks are optional for the deck: without access or connection their slide parts say they were not available.
      const [problemItems, taskItems] = await Promise.all(['/api/problems', '/api/tasks'].map(url => HubServer.json(url).then(result => result.items).catch(() => null)));
      const period = {start:ShiftSchedule.sofiaInstant(`${month}-01`, 0), end:ShiftSchedule.sofiaInstant(`${MonthlyPresentation.addMonths(month, 1)}-01`, 0), now:Date.now()};
      const pairTeams = PairTargetsStatistics.aggregate(pairStatistics.getEntries(), month).teams;
      const values = MonthlyPresentation.values({month, production:loaded.production, downtime:loaded.downtime, inputs, today:statisticsDay(),
        problemItems, period, counts:getPersonnelSnapshot(), goalTons, pairTeams, taskItems});
      const deck = MonthlyPresentationDeck.build(await loadLibrary(), values,
        {improvements:form.elements.improvements.value.split('\n'), specialLabel:form.elements.specialLabel.value});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(await deck.write({outputType:'blob'}));
      link.download = `packing-presentation-${month}.pptx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
      try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(REMEMBERED.map(key => [key, form.elements[key].value])))); } catch {}
      feedback.textContent = values.empty.current ? 'Свалено, но за месеца няма производствени отчети.'
        : values.empty.previous ? 'Свалено. За някой от предишните два месеца няма отчети.' : 'Презентацията е свалена.';
    } catch {
      feedback.textContent = 'Презентацията не беше създадена. Опитай отново.';
    } finally { submit.disabled = false; }
  });
})();
