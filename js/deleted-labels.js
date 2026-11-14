/* Labels to be deleted, each with a required photo. Kept on the server only; nothing is stored in the browser. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined') { $('labelMessage').textContent = 'Изтрити етикети са достъпни в сървърната версия след вход с личен акаунт.'; return; }
  const manager = HubServer.can('canManageDeletedLabels');
  let state = null, busy = false, requestKey = null, sequence = 0;
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
  function render() {
    if (!state) return;
    const by = status => state.items.filter(item => item.status === status);
    const pending = by('pending').sort((a, b) => a.createdAt - b.createdAt), deleted = by('deleted').sort((a, b) => b.deletedAt - a.deletedAt);
    const heading = el('h2'); heading.append(el('span', 'За изтриване'), el('span', String(pending.length), 'task-badge'));
    $('labelList').replaceChildren(heading, ...(pending.length ? pending.map(card) : [el('div', 'Няма етикети за изтриване.', 'task-empty')]));
    $('deletedSection').hidden = !deleted.length; $('deletedCount').textContent = String(deleted.length);
    $('deletedList').replaceChildren(...deleted.map(card));
  }
  const draftOpen = () => busy || picker.count > 0 || picker.pending || !!$('labelText').value.trim();
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
  $('labelForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (picker.pending) { $('actionFeedback').textContent = 'Изчакай снимката да е готова.'; return; }
    if (picker.failed) { $('actionFeedback').textContent = 'Снимката не е валидна. Избери я отново.'; return; }
    const [photo] = picker.values;
    if (!photo) { $('actionFeedback').textContent = 'Добави снимка на етикета.'; return; }
    busy = true; $('actionFeedback').textContent = '';
    const controls = [...$('labelForm').querySelectorAll('input,button')]; for (const control of controls) control.disabled = true;
    try {
      await HubServer.send('/api/deleted-labels', 'POST', keyed({text: $('labelText').value, photo}));
      requestKey = null; $('labelText').value = ''; picker.reset(); $('labelMessage').textContent = 'Етикетът е добавен.';
    } catch (error) { $('actionFeedback').textContent = failure(error); }
    finally { busy = false; for (const control of controls) control.disabled = false; await refresh(); }
  });
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => $(control.dataset.close).close());
  $('taskPhotoViewer').addEventListener('close', () => $('photoViewerImage').removeAttribute('src'));
  document.addEventListener('click', event => { if (event.target.closest('[data-hub-language]') && !busy) render(); });
  $('labelForm').hidden = false;
  HubServer.watch('deleted-labels', refresh, draftOpen);
  setInterval(() => { if (!draftOpen()) refresh(); }, 60000);
  picker.reset(); refresh();
})();
