/* Navigation only controls visibility. Existing statistics retain their calculations. */
function createStatisticsNavigation({storageKey, onChange}) {
  const $ = id => document.getElementById(id);
  const tabs = Array.from(document.querySelectorAll('[data-stats-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-stats-panel]'));
  let selected = 'overview', admin = false, filesOpen = false;
  try {
    const saved = localStorage.getItem(storageKey);
    if (tabs.some(tab => tab.dataset.statsTab === saved)) selected = saved;
  } catch (error) { /* Navigation works when browser storage is unavailable. */ }

  function select(section, notify = true) {
    if (!tabs.some(tab => tab.dataset.statsTab === section)) return;
    selected = section;
    tabs.forEach(tab => {
      const active = tab.dataset.statsTab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => { panel.hidden = panel.dataset.statsPanel !== selected; });
    $('statsBreakdownControls').hidden = !['production', 'downtime'].includes(selected);
    try { localStorage.setItem(storageKey, selected); } catch (error) {}
    if (notify) onChange();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.statsTab));
    tab.addEventListener('keydown', event => {
      const position = {ArrowRight:(index + 1) % tabs.length, ArrowLeft:(index + tabs.length - 1) % tabs.length, Home:0, End:tabs.length - 1}[event.key];
      if (position === undefined) return;
      event.preventDefault();
      tabs[position].focus();
      select(tabs[position].dataset.statsTab);
    });
  });

  function showFiles(open) {
    filesOpen = open;
    $('connPanel').style.display = admin && filesOpen ? 'block' : 'none';
    $('statsFilesBtn').setAttribute('aria-expanded', String(admin && filesOpen));
    // The outer Files button gives access even when optional sources are disconnected.
    if (admin && filesOpen) {
      const body = $('connPanel').querySelector('.conn-panel-body');
      const toggle = $('connPanel').querySelector('.conn-panel-toggle');
      if (body) body.hidden = false;
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }
  }
  $('statsFilesBtn').addEventListener('click', () => showFiles(!filesOpen));
  $('monthlyConnectBtn').addEventListener('click', () => { showFiles(true); $('openFileBtn').focus(); });
  function updateConnections() {
    const dots = Array.from($('connPanel').querySelectorAll('.conn-dot'));
    const connected = dots.filter(dot => dot.classList.contains('on')).length;
    $('statsFilesStatus').textContent = `${connected}/${dots.length} свързани`;
    $('statsFilesStatus').classList.toggle('ready', connected === dots.length && dots.length > 0);
  }
  new MutationObserver(updateConnections).observe($('connPanel'), {subtree:true, attributes:true, attributeFilter:['class']});
  updateConnections();
  select(selected, false);
  return {
    setAdmin(value) {
      admin = value;
      $('statsFilesBtn').hidden = !admin;
      if (!admin) filesOpen = false;
      showFiles(filesOpen);
    }
  };
}
