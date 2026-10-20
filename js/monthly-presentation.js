/* Statistics: monthly presentation built in the browser. Nothing is uploaded; the file is saved on this computer. */
(() => {
  // Only the administrator sees it; the deck holds figures statistics viewers can already read. No accounts offline.
  if (typeof HubServer === 'undefined' || HubServer.user.role !== 'admin') return;
  document.getElementById('presentationBtn').hidden = false;
  const dialog = document.getElementById('presentationDialog'), form = document.getElementById('presentationForm');
  const feedback = document.getElementById('presentationFeedback'), submit = document.getElementById('presentationSubmit');
  // Repeated settings only; monthly figures are entered fresh each time.
  const REMEMBERED = ['specialLabel', 'trucksTarget'], storageKey = 'portfolio-hub-presentation-settings';
  let library = null;

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

  document.getElementById('presentationBtn').addEventListener('click', () => {
    const rows = productionMonthEntries();
    document.getElementById('presentationPeriod').textContent = document.getElementById('dashboardTitle').textContent;
    form.elements.realizationT.placeholder = StatisticsUnits.formatKg(rows.reduce((total, entry) => total + (Number(entry.tonnage) || 0), 0));
    feedback.textContent = '';
    dialog.showModal();
  });
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));

  // The server sends only the selected month, so the two earlier months for the packing mix are read separately.
  async function production(month) {
    const read = value => HubServer.json(`/api/statistics/period/production-log?month=${encodeURIComponent(value)}`).then(result => result.data.entries || []);
    return [...productionMonthEntries(), ...(await Promise.all([-2, -1].map(count => read(MonthlyPresentation.addMonths(month, count))))).flat()];
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!el.connDot.classList.contains('on') || !el.avConnDot.classList.contains('on')) { feedback.textContent = 'Свържи тонажния дневник и дневника за престои.'; return; }
    submit.disabled = true;
    feedback.textContent = 'Подготовка…';
    try {
      const month = `${selectedYear}-${selectedDashboardMonth}`;
      const inputs = Object.fromEntries(MonthlyPresentation.INPUTS.map(key => [key, form.elements[key].value]));
      const values = MonthlyPresentation.values({month, production:await production(month), downtime:avEntries, inputs, today:statisticsDay()});
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
