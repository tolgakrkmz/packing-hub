/* Truck orders are typed by shift leads; nothing here is synced from other systems or kept in browser storage. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined') { $('orderMessage').textContent = 'Заданието е достъпно в сървърната версия след вход с личен акаунт.'; $('newOrders').hidden = true; return; }
  const manager = HubServer.can('canManageUrgentOrders');
  let state = null, busy = false, requestKey = null, sequence = 0;
  const today = () => ShiftSchedule.sofiaDate(), tomorrow = () => ShiftSchedule.addDays(today(), 1);
  const english = () => typeof HubI18n !== 'undefined' && HubI18n.language === 'en';
  const shortDate = value => value.slice(8, 10) + '.' + value.slice(5, 7);
  const time = at => new Date(at).toLocaleString(english() ? 'en-GB' : 'bg-BG', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
  function el(tag, text = '', cls = '', custom = false) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; if (custom) node.setAttribute('translate', 'no'); return node; }
  function button(label, fn, cls = 'secondary') { const node = el('button', label, cls); node.type = 'button'; node.addEventListener('click', fn); return node; }
  function dayLabel(date) {
    if (date < today()) return 'Закъсняла · ' + shortDate(date);
    if (date === today()) return 'Камион днес · ' + shortDate(date);
    if (date === tomorrow()) return 'Камион утре · ' + shortDate(date);
    return 'Камион на ' + shortDate(date);
  }
  const SHIFTS = {1: '1-ва', 2: '2-ра', 3: 'Нощна'};
  const slotLabel = slot => SHIFTS[slot.code] + ' · ' + shortDate(slot.date) + ' · Екип ' + slot.team;
  const at = () => Date.now(), live = item => HubUrgentOrders.live(ShiftSchedule, at(), item);
  const options = item => HubUrgentOrders.slots(ShiftSchedule, at(), item.truckDate);
  // The filter key an open order sits under: its live shift, or waiting for one.
  const placeOf = item => live(item) ? HubUrgentOrders.slotKey(item.shift) : 'waiting';
  function shiftLine(item) {
    if (live(item)) return el('p', 'Смяна: ' + slotLabel(item.shift), 'order-shift', true);
    if (item.shift) return el('p', 'Не е опакована от ' + slotLabel(item.shift) + ' · чака нова смяна', 'order-shift is-late', true);
    return el('p', options(item).length ? 'Без смяна' : 'Без смяна · няма време до камиона', 'order-shift is-waiting');
  }
  function shiftPicker(item) {
    const select = el('select', '', 'order-shift-select'); select.setAttribute('aria-label', 'Смяна за ' + item.text);
    select.append(new Option('Без смяна', ''), ...options(item).map(slot => new Option(slotLabel(slot), HubUrgentOrders.slotKey(slot))));
    select.value = live(item) ? HubUrgentOrders.slotKey(item.shift) : '';
    select.addEventListener('change', () => { const [date, code] = select.value.split('/'); act(item, 'assign', {shift: select.value ? {date, code: Number(code)} : null}); });
    return select;
  }
  const figures = item => ['Поръчка ' + item.quantity + ' кг', ...(item.available ? ['Налично ' + item.available + ' кг'] : []), ...(item.furnace ? ['Пещ ' + item.furnace] : [])].join(' · ');
  function card(item) {
    const open = item.status === 'open';
    const node = el('article', '', 'task-card order-card' + (item.status === 'missing' ? ' is-missing' : open && item.truckDate <= tomorrow() ? ' is-alert' : ''));
    const meta = open ? item.createdBy.username + ' · ' + time(item.createdAt) : (item.status === 'packed' ? '✓ ' : '✗ ') + item.markedBy.username + ' · ' + time(item.markedAt) + ' · ' + dayLabel(item.truckDate);
    const actions = el('div', '', 'order-actions');
    if (open) actions.append(button('✓ Опаковано', () => act(item, 'pack'), 'order-done'), button('Не е намерено', () => act(item, 'missing'), 'secondary order-missing'));
    else actions.append(button('Върни', () => act(item, 'reopen')));
    if (manager) actions.append(button('Изтрий', () => { if (confirm('Да се изтрие ли поръчката от списъка?')) act(item, 'remove'); }));
    node.append(el('p', item.text, 'order-text', true), ...(item.client ? [el('p', item.client, 'order-client', true), el('p', figures(item), 'order-detail')] : []), ...(item.note ? [el('p', '⚠ ' + item.note, 'order-note', true)] : []),
      ...(open ? [...(manager && live(item) ? [] : [shiftLine(item)]), ...(manager ? [shiftPicker(item)] : [])] : []), el('p', meta, 'task-meta', true), actions);
    return node;
  }
  function render() {
    if (!state) return;
    const all = state.items.filter(item => item.status === 'open').sort((a, b) => a.truckDate.localeCompare(b.truckDate) || a.createdAt - b.createdAt);
    filterOptions(all);
    const chosen = $('shiftFilter').value, open = all.filter(item => chosen === 'all' || (chosen === 'team' ? live(item) && item.shift.team === HubServer.user.taskTeam : placeOf(item) === chosen));
    const marked = status => state.items.filter(item => item.status === status).sort((a, b) => b.markedAt - a.markedAt);
    const packed = marked('packed'), missing = marked('missing');
    if (!open.length) $('orderList').replaceChildren(el('div', 'Няма чакащи поръчки за камиона.', 'task-empty'));
    else $('orderList').replaceChildren(...[...new Set(open.map(item => item.truckDate))].map(date => {
      const items = open.filter(item => item.truckDate === date), group = el('section', '', 'order-group'), heading = el('h2');
      heading.append(el('span', dayLabel(date)), el('span', String(items.length), 'task-badge'));
      group.append(heading, ...items.map(card));
      return group;
    }));
    $('missingSection').hidden = !missing.length; $('missingCount').textContent = String(missing.length);
    $('missingList').replaceChildren(...missing.map(card));
    $('packedSection').hidden = !packed.length; $('packedCount').textContent = String(packed.length);
    $('packedList').replaceChildren(...packed.map(card));
  }
  // Options list every shift that holds or can still take an open order, with its order count and kilograms.
  function filterOptions(open) {
    const select = $('shiftFilter'), chosen = select.value, shifts = new Map(), kg = list => Math.round(list.reduce((sum, item) => sum + HubUrgentOrders.weight(item), 0)).toLocaleString('bg-BG') + ' кг';
    for (const item of open) for (const slot of options(item)) shifts.set(HubUrgentOrders.slotKey(slot), slot);
    const count = key => open.filter(item => placeOf(item) === key);
    const waiting = count('waiting'), team = HubServer.user.taskTeam && open.filter(item => live(item) && item.shift.team === HubServer.user.taskTeam);
    select.replaceChildren(new Option('Всички (' + open.length + ')', 'all'), ...(team ? [new Option('Моят екип ' + HubServer.user.taskTeam + ' (' + team.length + ')', 'team')] : []),
      new Option('Без смяна (' + waiting.length + ')', 'waiting'),
      ...[...shifts.values()].sort((a, b) => a.date.localeCompare(b.date) || a.code - b.code).map(slot => { const list = count(HubUrgentOrders.slotKey(slot)); return new Option(slotLabel(slot) + ' (' + list.length + ' · ' + kg(list) + ')', HubUrgentOrders.slotKey(slot)); }));
    select.value = [...select.options].some(option => option.value === chosen) ? chosen : 'all';
  }
  async function refresh() {
    if (busy || $('orderEditor').open) return;
    const current = ++sequence;
    try {
      const result = await HubServer.json('/api/urgent-orders');
      if (current !== sequence || busy || $('orderEditor').open) return;
      state = result; if ($('orderMessage').querySelector('button')) $('orderMessage').textContent = ''; render();
    } catch (error) {
      if (current !== sequence) return;
      $('orderMessage').replaceChildren(el('span', (state ? error.message + ' Показани са последно заредените данни. ' : 'Поръчките не могат да се заредят. ' + error.message + ' ')), button('Опитай отново', refresh));
    }
  }
  // A retried save reuses its request id, so a lost response never adds the same orders twice.
  function keyed(payload) {
    const signature = JSON.stringify(payload);
    if (!requestKey || requestKey.signature !== signature) requestKey = {signature, id: crypto.randomUUID()};
    return {...payload, requestId: requestKey.id};
  }
  const failure = error => error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.';
  async function act(item, action, extra = {}) {
    if (busy) return; busy = true;
    try { await HubServer.send('/api/urgent-orders/' + item.id, 'PATCH', keyed({action, ...extra}), {'If-Match': '"' + item.revision + '"'}); requestKey = null; $('orderMessage').textContent = 'Промяната е записана.'; }
    catch (error) { $('orderMessage').textContent = failure(error); }
    finally { busy = false; await refresh(); }
  }
  $('orderForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true; const controls = [...$('orderForm').querySelectorAll('input,textarea,button')]; for (const control of controls) control.disabled = true; $('editorFeedback').textContent = '';
    try {
      const result = await HubServer.send('/api/urgent-orders', 'POST', keyed({text: $('orderText').value, truckDate: $('orderTruckDate').value}));
      requestKey = null; busy = false; $('orderEditor').close();
      $('orderMessage').textContent = 'Добавени поръчки: ' + result.ids.length + (result.duplicates ? ' · вече в списъка: ' + result.duplicates : '') + (result.skipped ? ' · пропуснати редове: ' + result.skipped : '');
    } catch (error) { $('editorFeedback').textContent = failure(error); }
    finally { busy = false; for (const control of controls) control.disabled = false; }
  });
  // The preview uses the server's parser, so what is shown is what will be saved.
  function preview() {
    const known = state ? state.items.map(HubUrgentOrders.keyOf) : [];
    const {orders, skipped, duplicates} = HubUrgentOrders.parse($('orderText').value, known);
    if (!orders.length && !skipped && !duplicates) { $('orderPreview').replaceChildren(); return; }
    const summary = el('p', 'Ще бъдат добавени: ' + orders.length + (duplicates ? ' · вече в списъка: ' + duplicates : '') + (skipped ? ' · пропуснати редове: ' + skipped : ''), 'task-meta');
    const parts = [summary];
    if (orders.some(order => order.client)) {
      const table = el('table', '', 'order-preview-table'), head = el('tr');
      for (const label of ['Поръчка', 'Клиент', 'Профил', 'Вариант', 'Количество', 'Налично', 'Пещ', 'Бележка']) head.append(el('th', label));
      table.append(head, ...orders.slice(0, 50).map(order => { const tr = el('tr'); for (const key of ['order', 'client', 'profile', 'variant', 'quantity', 'available', 'furnace', 'note']) tr.append(el('td', order[key] || '', '', true)); return tr; }));
      const wrap = el('div', '', 'order-preview-scroll'); wrap.append(table); parts.push(wrap);
    }
    $('orderPreview').replaceChildren(...parts);
  }
  $('orderText').addEventListener('input', preview);
  $('newOrders').hidden = !manager; $('distributeOrders').hidden = !manager;
  $('shiftFilter').addEventListener('change', render);
  $('distributeOrders').addEventListener('click', async () => {
    if (busy || !confirm('Поръчките без смяна и тези, чиято смяна е минала, ще се разпределят по смените до камиона според обичайния тонаж на екипите. Продължи?')) return;
    busy = true;
    try { const result = await HubServer.send('/api/urgent-orders/distribute', 'POST', {requestId: crypto.randomUUID()}); $('orderMessage').textContent = 'Разпределени поръчки: ' + result.assigned; }
    catch (error) { $('orderMessage').textContent = failure(error); }
    finally { busy = false; await refresh(); }
  });
  $('newOrders').addEventListener('click', () => {
    $('orderForm').reset(); $('orderPreview').replaceChildren(); requestKey = null; $('editorFeedback').textContent = ''; $('orderTruckDate').value = tomorrow();
    $('orderEditor').showModal(); $('orderText').focus();
  });
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => { if (!busy) $(control.dataset.close).close(); });
  $('orderEditor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('orderEditor').addEventListener('close', refresh);
  document.addEventListener('click', event => { if (event.target.closest('[data-hub-language]') && !busy) render(); });
  const draftOpen = () => busy || $('orderEditor').open;
  HubServer.watch('urgent-orders', refresh, draftOpen);
  setInterval(() => { if (!draftOpen()) refresh(); }, 60000); refresh();
})();
