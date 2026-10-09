/* One permission-aware screen; import state lives in the existing controllers. */
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined') {
    $('transferOffline').hidden = false;
    return;
  }
  const allowed = {export:HubServer.can('canExportReports'), production:HubServer.can('canImportData'), modules:HubServer.can('canImportData')};
  const tabs = [...document.querySelectorAll('[data-transfer-tab]')];
  const available = tabs.filter(tab => allowed[tab.dataset.transferTab]);
  for (const tab of tabs) tab.hidden = !allowed[tab.dataset.transferTab];
  for (const fieldset of document.querySelectorAll('[data-transfer-controls]')) fieldset.disabled = !allowed[fieldset.dataset.transferControls];
  $('transferNavigation').hidden = !available.length;
  $('transferIntro').textContent = allowed.production ? 'Сваляй отчети или добавяй проверени данни към общата база.' : 'Сваляй текущите отчети от общата база.';

  function select(section) {
    if (!Object.hasOwn(allowed, section) || !allowed[section]) section = available[0]?.dataset.transferTab;
    tabs.forEach(tab => {
      const selected = tab.dataset.transferTab === section;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-transfer-panel]').forEach(panel => { panel.hidden = panel.dataset.transferPanel !== section; });
    // Updating the URL never navigates away or resets selected files and previews.
    history.replaceState(null, '', location.pathname + location.search + '#' + section);
  }
  available.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.transferTab));
    tab.addEventListener('keydown', event => {
      const position = {ArrowRight:(index + 1) % available.length, ArrowLeft:(index + available.length - 1) % available.length, Home:0, End:available.length - 1}[event.key];
      if (position === undefined) return;
      event.preventDefault(); available[position].focus(); select(available[position].dataset.transferTab);
    });
  });
  window.addEventListener('hashchange', () => select(location.hash.slice(1)));
  select(location.hash.slice(1));

  if (allowed.export) {
    const module = new URLSearchParams(location.search).get('module');
    const kind = $('reportExportKind');
    if ([...kind.options].some(option => option.value === module)) kind.value = module;
    const update = () => { $('reportExport').href = '/api/export/' + kind.value; $('reportExport').download = kind.value + '.json'; };
    kind.addEventListener('change', update); update();
  }
});
