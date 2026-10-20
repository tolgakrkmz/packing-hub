/* Statistics: monthly presentation from a local .pptx template. The template and the deck never leave the browser. */
(() => {
  const dialog = document.getElementById('presentationDialog'), form = document.getElementById('presentationForm');
  const feedback = document.getElementById('presentationFeedback'), submit = document.getElementById('presentationSubmit');
  const selectedMonth = () => `${selectedYear}-${selectedDashboardMonth}`;

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
    if (typeof HubServer === 'undefined') return entries;
    const read = value => HubServer.json(`/api/statistics/period/production-log?month=${encodeURIComponent(value)}`).then(result => result.data.entries || []);
    return [...productionMonthEntries(), ...(await Promise.all([-2, -1].map(count => read(MonthlyPresentation.addMonths(month, count))))).flat()];
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const file = form.elements.template.files[0];
    if (!el.connDot.classList.contains('on') || !el.avConnDot.classList.contains('on')) { feedback.textContent = 'Свържи тонажния дневник и дневника за престои.'; return; }
    if (!file) { feedback.textContent = 'Избери шаблона (.pptx).'; return; }
    submit.disabled = true;
    feedback.textContent = 'Подготовка…';
    try {
      const month = selectedMonth();
      const inputs = Object.fromEntries(MonthlyPresentation.INPUTS.map(key => [key, form.elements[key].value]));
      const values = MonthlyPresentation.values({month, production:await production(month), downtime:avEntries, inputs});
      const {blob, missing} = await PptxTemplate.fill(await file.arrayBuffer(), values);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `packing-presentation-${month}.pptx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
      feedback.textContent = values._empty.current ? 'Свалено, но за месеца няма производствени отчети.'
        : missing.length ? 'Свалено. Непознати полета в шаблона: ' + missing.join(', ')
        : values._empty.previous ? 'Свалено. За някой от предишните два месеца няма отчети.' : 'Презентацията е свалена.';
    } catch (error) {
      feedback.textContent = ['NOT_PPTX', 'NO_TOKENS'].includes(error.message)
        ? 'Файлът не е шаблон за презентация с полета {{…}}.' : 'Презентацията не беше създадена. Опитай отново.';
    } finally { submit.disabled = false; }
  });
})();
