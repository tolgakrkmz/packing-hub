(() => {
  const el = id => document.getElementById(id);
  const message = el('activityMessage');
  if (typeof HubServer === 'undefined' || HubServer.user.role !== 'admin') {
    message.textContent = 'Журналът е достъпен само за администратори в сървърен режим.';
    el('refreshActivity').disabled = true;
    return;
  }
  const modules = {index:'Начален екран', accounts:'Акаунти', 'activity-log':'Потребителска активност', 'system-status':'Статус на системата', 'production-log':'Тонаж и брак', 'line-downtime':'Престои', personnel:'Смени и хора', 'pair-targets':'Двойки и таргети', 'package-instructions':'Инструкции за опаковка', statistics:'Статистики', tasks:'Задачи', 'data-import':'Импорт / експорт', system:'Система'};
  modules['admin-panel'] = 'Админ панел';
  const actions = {visit:'Отваряне на страница', login:'Вход в акаунта', logout:'Изход от акаунта', write:'Запазване на данни', export:'Експорт на отчет', import:'Импорт на данни', 'attachment-write':'Запазване на приложение', 'attachments-import':'Импорт на приложения', 'account-create':'Създаване на акаунт', 'account-update':'Промяна на акаунт', 'account-delete':'Изтриване на акаунт', 'task-create':'Създаване на задача', 'task-report':'Отчитане на задача', 'task-approve':'Одобряване на задача', 'task-return':'Връщане на задача', 'task-cancel':'Отмяна на задача', restore:'Възстановяване на архив'};
  Object.assign(actions, {'task-edit':'Промяна на задача', 'task-stop':'Спиране на повторение', 'task-reopen':'Повторно отваряне на задача', 'task-progress':'Напредък по задача'});
  const node = (tag, text, raw = false) => {
    const result = document.createElement(tag); result.textContent = text;
    if (raw) result.setAttribute('translate', 'no');
    return result;
  };
  const time = value => {
    if (value === null) return node('span', 'Няма записано посещение');
    const date = new Date(value), result = node('time', new Intl.DateTimeFormat('bg-BG', {dateStyle:'short',timeStyle:'medium'}).format(date), true);
    result.dateTime = date.toISOString(); return result;
  };
  const status = user => user.deletedAt ? 'Изтрит акаунт' : user.active ? 'Активен профил' : 'Неактивен профил';
  let users = [], events = [], nextBefore = null, query = '', busy = false;
  function renderUsers() {
    const selected = el('activityUser').value;
    el('activityUsers').replaceChildren(...users.filter(user => !selected || String(user.id) === selected).map(user => {
      const card = document.createElement('div'); card.className = 'activity-user';
      card.append(node('strong', user.username, true), node('small', status(user)), time(user.lastVisitAt));
      if (user.lastVisitAt !== null) card.append(node('p', user.lastAction === 'login' ? actions.login : modules[user.lastModule] || 'Модул'));
      return card;
    }));
  }
  function renderEvents() {
    el('activityEvents').replaceChildren(...events.map(event => {
      const row = document.createElement('li'); row.className = 'activity-event';
      const identity = document.createElement('section');
      identity.append(node('strong', event.username || 'Система', !!event.username));
      if (event.username && (!event.active || event.deletedAt)) identity.append(node('small', status(event)));
      const detail = document.createElement('div');
      detail.append(node('span', actions[event.action] || 'Действие'), node('small', modules[event.module] || 'Модул'));
      row.append(time(event.at), identity, detail); return row;
    }));
    el('activityEmpty').hidden = events.length > 0;
    el('activityCount').textContent = 'Показани действия: ' + events.length;
    el('moreActivity').hidden = nextBefore === null;
  }
  function filters() {
    const params = new URLSearchParams({action:el('activityAction').value});
    if (el('activityUser').value) params.set('userId', el('activityUser').value);
    if (el('activityPeriod').value !== 'all') {
      const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate() - Number(el('activityPeriod').value) + 1);
      params.set('from', start.getTime());
    }
    return params.toString();
  }
  async function load(more = false) {
    if (busy) return;
    busy = true; message.textContent = '';
    const controls = [...el('activityFilters').elements, el('refreshActivity'), el('moreActivity')];
    controls.forEach(control => { control.disabled = true; });
    el('activityContent').setAttribute('aria-busy', 'true');
    const nextQuery = more ? query : filters();
    try {
      const result = await HubServer.json('/api/admin/activity?' + nextQuery + (more ? '&before=' + nextBefore : ''));
      query = nextQuery; users = result.users; events = more ? [...events, ...result.events] : result.events; nextBefore = result.nextBefore;
      const selected = el('activityUser').value;
      const options = users.map(user => {
        const option = node('option', user.username, true); option.value = user.id; return option;
      });
      const all = node('option', 'Всички потребители'); all.value = '';
      el('activityUser').replaceChildren(all, ...options); el('activityUser').value = selected;
      renderUsers(); renderEvents(); el('activityContent').hidden = false;
    } catch (error) { message.textContent = error.message; }
    finally {
      busy = false; controls.forEach(control => { control.disabled = false; });
      el('activityContent').setAttribute('aria-busy', 'false');
    }
  }
  el('activityFilters').addEventListener('submit', event => { event.preventDefault(); load(); });
  el('activityUser').addEventListener('change', () => load());
  el('activityPeriod').addEventListener('change', () => load());
  el('activityAction').addEventListener('change', () => load());
  el('refreshActivity').addEventListener('click', () => load());
  el('moreActivity').addEventListener('click', () => load(true));
  load();
})();
