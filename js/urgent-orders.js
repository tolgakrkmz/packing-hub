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
  function card(item) {
    const open = item.status === 'open';
    const node = el('article', '', 'task-card order-card' + (item.status === 'missing' ? ' is-missing' : open && item.truckDate <= tomorrow() ? ' is-alert' : ''));
    const meta = open ? item.createdBy.username + ' · ' + time(item.createdAt) : (item.status === 'packed' ? '✓ ' : '✗ ') + item.markedBy.username + ' · ' + time(item.markedAt) + ' · ' + dayLabel(item.truckDate);
    const actions = el('div', '', 'order-actions');
    if (open) actions.append(button('✓ Опаковано', () => act(item, 'pack'), 'order-done'), button('Не е намерено', () => act(item, 'missing'), 'secondary order-missing'));
    else actions.append(button('Върни', () => act(item, 'reopen')));
    if (manager) actions.append(button('Изтрий', () => { if (confirm('Да се изтрие ли поръчката от списъка?')) act(item, 'remove'); }));
    node.append(el('p', item.text, 'order-text', true), el('p', meta, 'task-meta', true), actions);
    return node;
  }
  function render() {
    if (!state) return;
    const open = state.items.filter(item => item.status === 'open').sort((a, b) => a.truckDate.localeCompare(b.truckDate) || a.createdAt - b.createdAt);
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
  async function act(item, action) {
    if (busy) return; busy = true;
    try { await HubServer.send('/api/urgent-orders/' + item.id, 'PATCH', keyed({action}), {'If-Match': '"' + item.revision + '"'}); requestKey = null; $('orderMessage').textContent = 'Промяната е записана.'; }
    catch (error) { $('orderMessage').textContent = failure(error); }
    finally { busy = false; await refresh(); }
  }
  $('orderForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true; const controls = [...$('orderForm').querySelectorAll('input,textarea,button')]; for (const control of controls) control.disabled = true; $('editorFeedback').textContent = '';
    try {
      await HubServer.send('/api/urgent-orders', 'POST', keyed({text: $('orderText').value, truckDate: $('orderTruckDate').value}));
      requestKey = null; busy = false; $('orderEditor').close(); $('orderMessage').textContent = 'Поръчките са добавени.';
    } catch (error) { $('editorFeedback').textContent = failure(error); }
    finally { busy = false; for (const control of controls) control.disabled = false; }
  });
  $('newOrders').hidden = !manager;
  $('newOrders').addEventListener('click', () => {
    $('orderForm').reset(); requestKey = null; $('editorFeedback').textContent = ''; $('orderTruckDate').value = tomorrow();
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
