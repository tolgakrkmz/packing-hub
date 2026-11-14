/* Labels to be deleted: the photo is read on the server, the lead checks only the Pallet No. Nothing is stored in the browser. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined') { $('labelMessage').textContent = 'Изтрити етикети са достъпни в сървърната версия след вход с личен акаунт.'; return; }
  const manager = HubServer.can('canManageDeletedLabels');
  let state = null, busy = false, requestKey = null, sequence = 0, reading = null, readFields = null;
  function el(tag, text = '', cls = '', custom = false) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; if (custom) node.setAttribute('translate', 'no'); return node; }
  function button(label, fn, cls = 'secondary') { const node = el('button', label, cls); node.type = 'button'; node.addEventListener('click', fn); return node; }
  const {photoPicker} = createTaskPhotos({$, el, button, photoObserver: null, observePhotos() {}, forgetPhotos() {}, getState: () => state, isBusy: () => busy});
  const picker = photoPicker('label');
  const english = () => typeof HubI18n !== 'undefined' && HubI18n.language === 'en';
  const time = at => new Date(at).toLocaleString(english() ? 'en-GB' : 'bg-BG', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
  const stamp = at => new Date(at).toLocaleString(english() ? 'en-GB' : 'bg-BG', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
  // How long a label has waited; the list refreshes every minute, so this stays current.
  function age(at) {
    const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000)), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
    const parts = english() ? [days && days + ' d', (days || hours) && hours + ' h', !days && minutes % 60 + ' min'] : [days && days + ' д', (days || hours) && hours + ' ч', !days && minutes % 60 + ' мин'];
    return (english() ? 'waiting ' : 'чака ') + parts.filter(Boolean).join(' ');
  }
  const failure = error => error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.';
  // A retried save reuses its request id, so a lost response never adds the same label twice.
  function keyed(payload) {
    const signature = JSON.stringify(payload);
    if (!requestKey || requestKey.signature !== signature) requestKey = {signature, id: crypto.randomUUID()};
    return {...payload, requestId: requestKey.id};
  }
  function card(item) {
    const node = el('article', '', 'task-card label-card'), pending = item.status === 'pending';
    if (item.photo.available) {
      const url = '/api/deleted-labels/' + item.id + '/photos/' + item.photo.id, img = el('img'), open = button('', () => { $('photoViewerImage').alt = img.alt; $('photoViewerImage').src = url; $('taskPhotoViewer').showModal(); }, 'label-photo');
      img.alt = 'Снимка на етикет'; img.loading = 'lazy'; img.width = item.photo.width; img.height = item.photo.height; img.src = url;
      open.setAttribute('aria-label', 'Отвори снимката'); open.append(img); node.append(open);
    }
    // Date and waiting time first: the oldest label should be deleted first.
    const when = el('p', '', 'label-age' + (pending && Date.now() - item.createdAt > 86400000 ? ' is-old' : ''), true);
    when.append(el('strong', '📅 ' + stamp(item.createdAt)), ...(pending ? [el('span', age(item.createdAt))] : []));
    node.append(when);
    const f = item.fields || {};
    if (f.palletNo) node.append(el('p', f.palletNo, 'label-pallet', true));
    const info = [f.productionOrder, f.customer].filter(Boolean).join(' · ');
    if (info) node.append(el('p', info, 'label-text', true));
    if (item.text) node.append(el('p', item.text, 'label-text', true));
    node.append(el('p', item.createdBy.username + (pending ? '' : ' · ✓ ' + item.deletedBy.username + ' · ' + time(item.deletedAt)), 'task-meta', true));
    if (manager) {
      const actions = el('div', '', 'label-actions');
      actions.append(pending ? button('✓ Изтрит', () => act(item, 'delete'), '') : button('Върни', () => act(item, 'reopen')),
        button('Премахни', () => { if (confirm(english() ? HubI18n.t('Да се премахне ли етикетът от списъка?') : 'Да се премахне ли етикетът от списъка?')) act(item, 'remove'); }));
      node.append(actions);
    }
    return node;
  }
  const COLUMNS = ['palletNo', 'productionOrder', 'customer', 'grossWt', 'netWt', 'length', 'pieces'];
  function records() {
    const query = $('recordSearch').value.trim().toLocaleLowerCase('bg');
    const all = [...state.items].sort((a, b) => b.createdAt - a.createdAt);
    const found = query ? all.filter(item => [...COLUMNS.map(key => item.fields?.[key]), item.text, item.createdBy.username].some(value => String(value || '').toLocaleLowerCase('bg').includes(query))) : all;
    $('recordCount').textContent = String(all.length);
    $('recordEmpty').hidden = !!found.length;
    // shortcut: at most 300 rows are drawn; a search narrows the rest.
    $('recordList').replaceChildren(...found.slice(0, 300).map(item => {
      const row = el('tr');
      for (const key of COLUMNS) row.append(el('td', item.fields?.[key] || '—', '', true));
      row.append(el('td', stamp(item.createdAt), '', true));
      const status = el('td');
      status.append(el('span', item.status === 'pending' ? 'За изтриване' : '✓ ' + stamp(item.deletedAt), item.status === 'pending' ? 'label-status is-pending' : 'label-status', item.status !== 'pending'));
      if (manager && item.status !== 'pending') status.append(' ', button('Върни', () => act(item, 'reopen')));
      row.append(status);
      return row;
    }));
  }
  function render() {
    if (!state) return;
    const pending = state.items.filter(item => item.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    const heading = el('h2'); heading.append(el('span', 'За изтриване'), el('span', String(pending.length), 'task-badge'));
    $('labelList').replaceChildren(heading, ...(pending.length ? pending.map(card) : [el('div', 'Няма етикети за изтриване.', 'task-empty')]));
    records();
  }
  const draftOpen = () => busy || picker.count > 0 || picker.pending || !!reading;
  async function refresh() {
    if (busy) return;
    const current = ++sequence;
    try {
      const result = await HubServer.json('/api/deleted-labels');
      if (current !== sequence || busy) return;
      state = result; if ($('labelMessage').querySelector('button')) $('labelMessage').textContent = ''; render();
    } catch (error) {
      if (current === sequence) $('labelMessage').replaceChildren(el('span', 'Етикетите не могат да се заредят. ' + failure(error) + ' '), button('Опитай отново', refresh));
    }
  }
  async function act(item, action) {
    if (busy) return; busy = true;
    try { await HubServer.send('/api/deleted-labels/' + item.id, 'PATCH', keyed({action}), {'If-Match': '"' + item.revision + '"'}); requestKey = null; $('labelMessage').textContent = 'Промяната е записана.'; }
    catch (error) { $('labelMessage').textContent = failure(error); }
    finally { busy = false; await refresh(); }
  }
  // When the photo is ready the server reads it; the lead then checks only the Pallet No.
  async function readPhoto() {
    const [photo] = picker.values;
    if (picker.pending) return;
    if (typeof photo !== 'string') { reading = null; readFields = null; $('labelRead').hidden = true; $('labelReadInfo').textContent = ''; return; }
    if (reading === photo || readFields?.photo === photo) return;
    reading = photo; $('labelRead').hidden = false; $('labelPallet').value = ''; $('labelPallet').disabled = true; $('labelReadInfo').textContent = 'Четене на етикета…';
    let fields = {}, problem = '';
    try { fields = (await HubServer.send('/api/deleted-labels/read', 'POST', {photo})).fields; } catch (error) { problem = failure(error); }
    if (reading !== photo) return;
    reading = null; readFields = {photo, fields}; $('labelPallet').disabled = false; $('labelPallet').value = fields.palletNo || '';
    const others = [fields.productionOrder, fields.customer].filter(Boolean).join(' · ');
    $('labelReadInfo').textContent = fields.palletNo ? 'Прочетено от снимката' + (others ? ': ' + others : '.') : problem || 'Pallet No не се прочете. Въведи го от етикета.';
    if (!fields.palletNo) $('labelPallet').focus();
  }
  new MutationObserver(readPhoto).observe($('labelPhotoInfo'), {childList: true, characterData: true, subtree: true});
  $('labelForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (picker.pending) { $('actionFeedback').textContent = 'Изчакай снимката да е готова.'; return; }
    if (picker.failed) { $('actionFeedback').textContent = 'Снимката не е валидна. Избери я отново.'; return; }
    const [photo] = picker.values;
    if (!photo) { $('actionFeedback').textContent = 'Добави снимка на етикета.'; return; }
    if (reading || readFields?.photo !== photo) { $('actionFeedback').textContent = 'Изчакай етикетът да се прочете.'; return; }
    if (!$('labelPallet').value.trim()) { $('actionFeedback').textContent = 'Въведи Pallet No от етикета.'; $('labelPallet').focus(); return; }
    busy = true; $('actionFeedback').textContent = '';
    const controls = [...$('labelForm').querySelectorAll('input,button')]; for (const control of controls) control.disabled = true;
    try {
      await HubServer.send('/api/deleted-labels', 'POST', keyed({photo, fields: {...readFields.fields, palletNo: $('labelPallet').value.trim()}}));
      requestKey = null; picker.reset(); $('labelMessage').textContent = 'Етикетът е добавен.';
    } catch (error) { $('actionFeedback').textContent = failure(error); }
    finally { busy = false; for (const control of controls) control.disabled = false; await refresh(); }
  });
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => $(control.dataset.close).close());
  $('taskPhotoViewer').addEventListener('close', () => $('photoViewerImage').removeAttribute('src'));
  document.addEventListener('click', event => { if (event.target.closest('[data-hub-language]') && !busy) render(); });
  $('recordSearch').addEventListener('input', () => { if (state) records(); });
  $('labelForm').hidden = false;
  HubServer.watch('deleted-labels', refresh, draftOpen);
  setInterval(() => { if (!draftOpen()) refresh(); }, 60000);
  picker.reset(); refresh();
})();
