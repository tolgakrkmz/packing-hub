/* Problem text and identities stay out of browser persistence and translation. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined') { $('problemMessage').textContent = 'Глобалните проблеми са достъпни в сървърната версия след вход с личен акаунт.'; $('problemBoard').hidden = true; return; }
  const manager = HubServer.can('canManageProblems'), creator = HubServer.can('canCreateProblems');
  const statuses = {new: 'Нов', described: 'Описан', presented: 'Представен на среща', escalated: 'Ескалиран / чака отговор', 'in-resolution': 'В решаване от отговорните', verification: 'Проверка', resolved: 'Решен', postponed: 'Отложен', rejected: 'Отхвърлен'};
  const flow = ['new', 'described', 'presented', 'escalated', 'in-resolution', 'verification', 'resolved'];
  const closed = ['resolved', 'rejected'], waiting = ['escalated', 'in-resolution'];
  const categories = {equipment: 'Оборудване', materials: 'Материали / доставки', quality: 'Качество', safety: 'Безопасност', it: 'ИТ / системи', organization: 'Организация', other: 'Друго'};
  const levels = {low: 'Ниско', medium: 'Средно', high: 'Високо'};
  const efforts = {S: 'Малко (S)', M: 'Средно (M)', L: 'Голямо (L)'};
  const actionLabels = {created: 'Създаден', edit: 'Редакция', status: 'Смяна на статус', propose: 'Ново предложение', accept: 'Прието решение', contact: 'Запис на контакт'};
  let state = null, busy = false, editing = null, acting = null, viewing = null, requestKey = null, sequence = 0, clockFormatter;
  const dialogs = ['problemEditor', 'problemDetail', 'problemAction'];
  const draftOpen = () => busy || ['problemEditor', 'problemAction'].some(id => $(id).open);
  function el(tag, text = '', cls = '', custom = false) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; if (custom) node.setAttribute('translate', 'no'); return node; }
  function button(label, fn, cls = 'secondary') { const node = el('button', label, cls); node.type = 'button'; node.addEventListener('click', fn); return node; }
  function badge(text, cls = '', custom = false) { return el('span', text, 'task-badge' + (cls ? ' ' + cls : ''), custom); }
  function clock(at) { clockFormatter ||= new Intl.DateTimeFormat('bg-BG', {timeZone: state.timezone, dateStyle: 'short', timeStyle: 'short'}); return clockFormatter.format(new Date(at)); }
  const attention = item => item.contactOverdue || item.promiseOverdue;
  const canEdit = item => !closed.includes(item.status) && (manager || creator && item.status === 'new' && item.createdBy.id === HubServer.user.id);
  const canContact = item => !closed.includes(item.status) && (manager || item.owner?.id === HubServer.user.id);
  function counter(value, label) { const node = el('div', '', 'task-metric'); node.append(el('strong', String(value)), el('span', label)); return node; }
  function signals(item) {
    const list = [];
    if (item.quietDays !== null) { const node = badge('', item.quietDays >= 14 ? 'alert' : ''); node.append(el('b', String(item.quietDays)), document.createTextNode(' '), el('span', 'дни без контакт')); list.push(node); }
    if (item.contactOverdue) list.push(badge('Просрочен контакт', 'alert'));
    if (item.promiseOverdue) list.push(badge('Минал обещан срок', 'alert'));
    return list;
  }
  function matches(item) {
    const query = $('problemSearch').value.trim().toLocaleLowerCase('bg');
    if (query && ![item.title, item.area, item.description, item.dependsOn, item.request].join(' ').toLocaleLowerCase('bg').includes(query)) return false;
    if ($('categoryFilter').value && item.category !== $('categoryFilter').value) return false;
    const focus = $('focusFilter').value;
    if (focus === 'closed') return ['postponed', 'rejected'].includes(item.status);
    if (item.status === 'postponed' || item.status === 'rejected') return false;
    if (focus === 'attention') return attention(item);
    if (focus === 'mine') return item.owner?.id === HubServer.user.id;
    return true;
  }
  function card(item) {
    const node = el('button', '', 'task-card problem-card' + (attention(item) ? ' is-alert' : '')); node.type = 'button';
    node.addEventListener('click', () => openDetail(item.id));
    const badges = el('div', '', 'task-badges');
    badges.append(badge(categories[item.category]), badge(levels[item.impactLevel], item.impactLevel === 'high' ? 'alert' : ''), ...signals(item));
    if (item.proposals.some(entry => entry.accepted)) badges.append(badge('Има прието решение', 'good'));
    else if (item.proposals.length) { const node = badge(''); node.append(el('b', String(item.proposals.length)), document.createTextNode(' '), el('span', item.proposals.length === 1 ? 'предложение' : 'предложения')); badges.append(node); }
    node.append(el('h3', item.title, '', true), badges);
    const meta = [item.area, item.dependsOn && '→ ' + item.dependsOn, item.owner?.username].filter(Boolean).join(' · ');
    if (meta) node.append(el('p', meta, 'task-meta', true));
    return node;
  }
  function render() {
    if (!state) return;
    const open = state.items.filter(item => !closed.includes(item.status) && item.status !== 'postponed');
    $('problemOverview').replaceChildren(counter(open.length, 'Отворени'), counter(open.filter(item => waiting.includes(item.status)).length, 'Чакат отговорните'),
      counter(open.filter(attention).length, 'Изискват внимание'), counter(state.items.filter(item => item.status === 'resolved').length, 'Решени'));
    const shown = state.items.filter(matches).sort((a, b) => Number(attention(b)) - Number(attention(a)) || ['high', 'medium', 'low'].indexOf(a.impactLevel) - ['high', 'medium', 'low'].indexOf(b.impactLevel) || b.createdAt - a.createdAt);
    if (!state.items.length) {
      const empty = el('div', '', 'task-empty'); empty.append(el('p', 'Още няма описани проблеми.'));
      if (creator) { const row = el('div', '', 'task-actions task-empty-actions'); row.append(button('+ Опиши проблем', () => openEditor(), '')); empty.append(row); }
      $('problemBoard').replaceChildren(empty); return;
    }
    const columns = $('focusFilter').value === 'closed' ? ['postponed', 'rejected'] : flow;
    $('problemBoard').replaceChildren(...columns.map(status => {
      const items = shown.filter(item => item.status === status), column = el('section', '', 'problem-column'), heading = el('h2');
      heading.append(el('span', statuses[status]), el('span', String(items.length), 'task-badge'));
      column.append(heading, ...(items.length ? items.map(card) : [el('p', 'Няма проблеми.', 'task-muted')]));
      return column;
    }));
  }
  function row(list, label, value, custom = true) { if (!value) return; list.append(el('dt', label), el('dd', value, '', custom)); }
  function renderDetail() {
    const item = state?.items.find(value => value.id === viewing);
    if (!item) { if ($('problemDetail').open) $('problemDetail').close(); return; }
    $('detailTitle').textContent = item.title;
    const content = [], badges = el('div', '', 'task-badges');
    badges.append(badge(statuses[item.status], closed.includes(item.status) ? 'good' : ''), badge(categories[item.category]), badge(levels[item.impactLevel], item.impactLevel === 'high' ? 'alert' : ''), ...signals(item));
    content.push(badges);
    const list = el('dl', '', 'problem-fields');
    row(list, 'Линия / зона', item.area); row(list, 'Описание', item.description); row(list, 'Въздействие', item.impact); row(list, 'Основна причина', item.rootCause);
    row(list, 'Зависи от', item.dependsOn); row(list, 'Лице за контакт', item.contact); row(list, 'Нашето искане', item.request);
    row(list, 'Наш отговорник', item.owner?.username); row(list, 'Следващ контакт', item.nextContact); row(list, 'Обещан срок от тях', item.promisedDate);
    row(list, 'Описан от', item.createdBy.username + ' · ' + clock(item.createdAt));
    content.push(list);
    const actions = el('div', '', 'task-actions');
    if (canEdit(item)) actions.append(button('Редактирай', () => openEditor(item)));
    if (manager) actions.append(button('Смени статус', () => openAction(item, 'status')));
    if (creator && !closed.includes(item.status)) actions.append(button('+ Предложение', () => openAction(item, 'propose')));
    if (canContact(item)) actions.append(button('+ Контакт', () => openAction(item, 'contact')));
    if (actions.childElementCount) content.push(actions);
    content.push(el('h3', 'Предложени решения'));
    if (!item.proposals.length) content.push(el('p', 'Още няма предложения.', 'task-muted'));
    for (const entry of item.proposals) {
      const node = el('div', '', 'problem-entry' + (entry.accepted ? ' is-accepted' : '')), meta = el('div', '', 'task-badges');
      meta.append(badge(efforts[entry.effort]), badge(entry.actor.username, '', true));
      if (entry.accepted) meta.append(badge('Прието', 'good'));
      else if (manager && !closed.includes(item.status)) meta.append(button('Приеми', () => act(item, {action: 'accept', proposalId: entry.id})));
      node.append(el('p', entry.text, '', true), meta); content.push(node);
    }
    content.push(el('h3', 'Дневник на контактите'));
    if (!item.contacts.length) content.push(el('p', 'Още няма записани контакти.', 'task-muted'));
    for (const entry of [...item.contacts].reverse()) {
      const node = el('div', '', 'problem-entry'), meta = el('div', '', 'task-badges');
      meta.append(badge(entry.date, '', true));
      if (entry.with) meta.append(badge(entry.with, '', true));
      if (entry.promisedDate) { const promise = badge(''); promise.append(el('span', 'Обещано до'), document.createTextNode(' '), el('b', entry.promisedDate, '', true)); meta.append(promise); }
      node.append(meta, el('p', entry.note, '', true), el('p', entry.actor.username, 'task-muted', true)); content.push(node);
    }
    const history = el('details', '', 'problem-history'); history.append(el('summary', 'История'));
    for (const entry of [...item.events].reverse()) {
      const node = el('div', '', 'problem-entry'), meta = el('div', '', 'task-badges');
      meta.append(badge(actionLabels[entry.action] || entry.action), badge(statuses[entry.status]), badge(entry.actor.username + ' · ' + clock(entry.at), '', true));
      node.append(meta); if (entry.note) node.append(el('p', entry.note, '', true)); history.append(node);
    }
    content.push(history);
    $('detailContent').replaceChildren(...content);
  }
  function openDetail(id) { viewing = id; renderDetail(); if (!$('problemDetail').open) $('problemDetail').showModal(); }
  async function refresh() {
    if (draftOpen()) return;
    const current = ++sequence;
    try {
      const result = await HubServer.json('/api/problems');
      if (current !== sequence || draftOpen()) return;
      state = result; if ($('problemMessage').querySelector('button')) $('problemMessage').textContent = ''; render(); if ($('problemDetail').open) renderDetail();
    } catch (error) {
      if (current !== sequence) return;
      const retry = button('Опитай отново', refresh);
      $('problemMessage').replaceChildren(el('span', (state ? error.message + ' Показани са последно заредените данни. ' : 'Проблемите не могат да се заредят. ' + error.message + ' ')), retry);
    }
  }
  function openEditor(item = null) {
    editing = item; requestKey = null; $('problemForm').reset(); $('editorFeedback').textContent = '';
    $('editorTitle').textContent = item ? 'Редактирай проблем' : 'Опиши проблем';
    $('problemTitle').value = item?.title || ''; $('problemArea').value = item?.area || ''; $('problemCategory').value = item?.category || 'equipment';
    $('problemDescription').value = item?.description || ''; $('problemImpactLevel').value = item?.impactLevel || 'medium'; $('problemImpact').value = item?.impact || '';
    $('problemRootCause').value = item?.rootCause || ''; $('problemDependsOn').value = item?.dependsOn || ''; $('problemContact').value = item?.contact || ''; $('problemRequest').value = item?.request || '';
    $('problemEditor').showModal(); $('problemTitle').focus();
  }
  function openAction(item, action) {
    acting = {item, action}; requestKey = null; $('actionForm').reset(); $('actionFeedback').textContent = '';
    $('actionTitle').textContent = {status: 'Смени статус', propose: 'Предложи решение', contact: 'Запиши контакт'}[action]; $('actionProblemTitle').textContent = item.title;
    $('statusFields').hidden = action !== 'status'; $('proposalFields').hidden = action !== 'propose'; $('contactFields').hidden = action !== 'contact'; $('actionNoteLabel').hidden = action === 'propose';
    $('proposalText').required = action === 'propose'; $('contactDate').required = action === 'contact';
    if (action === 'status') {
      $('actionStatus').replaceChildren(...Object.entries(statuses).map(([value, label]) => new Option(label, value))); $('actionStatus').value = item.status;
      $('actionOwner').replaceChildren(new Option('Без отговорник', ''), ...state.owners.map(person => { const option = new Option(person.username, person.id); option.setAttribute('translate', 'no'); return option; }));
      $('actionOwner').value = item.owner ? String(item.owner.id) : ''; $('actionNextContact').value = item.nextContact || '';
    }
    if (action === 'contact') { $('contactDate').value = state.today; $('contactDate').max = state.today; $('contactNext').value = item.nextContact || ''; }
    noteRequirement(); $('problemAction').showModal();
  }
  function noteRequirement() {
    const required = acting?.action === 'contact' || acting?.action === 'status' && ['postponed', 'rejected'].includes($('actionStatus').value);
    $('actionNote').required = required;
    $('actionNoteLabel').firstChild.textContent = acting?.action === 'contact' ? 'Какво е отговорено / обещано' : required ? 'Причина' : 'Бележка';
  }
  function keyed(payload) {
    const signature = JSON.stringify(payload);
    if (!requestKey || requestKey.signature !== signature) requestKey = {signature, id: crypto.randomUUID()};
    return {...payload, requestId: requestKey.id};
  }
  async function mutate(form, feedback, fn) {
    if (busy) return;
    busy = true; const controls = [...form.querySelectorAll('input,select,textarea,button')].filter(control => !control.disabled); for (const control of controls) control.disabled = true; feedback.textContent = '';
    try { const result = await fn(); busy = false; form.closest('dialog').close(); if (result?.id && !editing) viewing = result.id; await refresh(); if (result?.id && !editing && state) openDetail(result.id); $('problemMessage').textContent = 'Промяната е записана.'; }
    catch (error) { feedback.textContent = error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.'; if (error.status === 409) feedback.textContent += ' Затвори прозореца и натисни „Опресни“. Въведеното е запазено до затваряне.'; }
    finally { busy = false; for (const control of controls) control.disabled = false; }
  }
  const patch = (item, payload) => HubServer.send('/api/problems/' + item.id, 'PATCH', keyed(payload), {'If-Match': '"' + item.revision + '"'});
  async function act(item, payload) {
    if (busy) return; busy = true;
    try { await patch(item, payload); requestKey = null; busy = false; await refresh(); $('problemMessage').textContent = 'Промяната е записана.'; }
    catch (error) { busy = false; $('problemMessage').textContent = error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.'; await refresh(); }
  }
  $('problemForm').addEventListener('submit', event => {
    event.preventDefault();
    const payload = {title: $('problemTitle').value, area: $('problemArea').value, category: $('problemCategory').value, description: $('problemDescription').value, impactLevel: $('problemImpactLevel').value,
      impact: $('problemImpact').value, rootCause: $('problemRootCause').value, dependsOn: $('problemDependsOn').value, contact: $('problemContact').value, request: $('problemRequest').value};
    mutate($('problemForm'), $('editorFeedback'), () => editing ? patch(editing, {...payload, action: 'edit'}) : HubServer.send('/api/problems', 'POST', keyed(payload)));
  });
  $('actionForm').addEventListener('submit', event => {
    event.preventDefault();
    const {item, action} = acting, note = $('actionNote').value;
    const payload = action === 'status' ? {action, status: $('actionStatus').value, note, ownerId: $('actionOwner').value ? Number($('actionOwner').value) : null, nextContact: $('actionNextContact').value || null}
      : action === 'propose' ? {action, text: $('proposalText').value, effort: $('proposalEffort').value}
      : {action, date: $('contactDate').value, with: $('contactWith').value, note, promisedDate: $('contactPromised').value || null, nextContact: $('contactNext').value || null};
    mutate($('actionForm'), $('actionFeedback'), () => patch(item, payload));
  });
  $('problemCategory').replaceChildren(...Object.entries(categories).map(([value, label]) => new Option(label, value)));
  $('categoryFilter').append(...Object.entries(categories).map(([value, label]) => new Option(label, value)));
  $('actionStatus').addEventListener('change', noteRequirement);
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => { if (!busy) $(control.dataset.close).close(); });
  for (const id of dialogs) $(id).addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  for (const id of ['problemEditor', 'problemAction']) $(id).addEventListener('close', () => { if (!draftOpen()) refresh(); });
  $('problemDetail').addEventListener('close', () => { viewing = null; });
  $('newProblem').hidden = !creator; $('newProblem').addEventListener('click', () => { if (state) openEditor(); });
  $('refreshProblems').addEventListener('click', refresh);
  for (const id of ['problemSearch', 'categoryFilter', 'focusFilter']) $(id).addEventListener('input', render);
  document.addEventListener('click', event => { if (event.target.closest('[data-hub-language]') && !draftOpen()) render(); });
  HubServer.watch('problems', refresh, draftOpen); HubServer.watch('accounts', refresh, draftOpen);
  setInterval(refresh, 60000); refresh();
})();
