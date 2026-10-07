(() => {
  const message = document.getElementById('accountMessage');
  const list = document.getElementById('accountList');
  const search = document.getElementById('accountSearch');
  const filter = document.getElementById('accountFilter');
  const createForm = document.getElementById('accountForm');
  const roles = {admin: 'Администратор', operator: 'Оператор', observer: 'Наблюдател'};
  const permissionLabels = {canImportData: 'Импорт на данни', canExportReports: 'Експорт на отчети', canCreateReports: 'Добавяне на отчети', canEditReports: 'Корекции и изтриване на отчети', canViewTasks: 'Преглед на „Задачи“'};
  const defaults = {
    admin: {canImportData: true, canExportReports: true, canCreateReports: true, canEditReports: true, canViewTasks: true},
    operator: {canImportData: false, canExportReports: true, canCreateReports: true, canEditReports: false, canViewTasks: false},
    observer: {canImportData: false, canExportReports: true, canCreateReports: false, canEditReports: false, canViewTasks: false}
  };
  const cards = new Map();
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function field(text, input) {
    const label = element('label'); label.append(element('span', '', text), input); return label;
  }
  function taskProfileControls(form, role, initial = {}) {
    const group = element('fieldset', 'account-permissions'); group.append(element('legend', '', 'Отговорност за задачи'));
    const flag = element('input'); flag.type = 'checkbox'; flag.dataset.taskSupervisor = ''; flag.checked = !!initial.taskSupervisor;
    const label = element('label', 'account-active'); label.append(flag, element('span', '', 'Началник смяна (задачи)'));
    const team = element('select'); team.setAttribute('aria-label', 'Екип за задачи'); team.dataset.taskTeam = '';
    for (const value of ['', 'А', 'Б', 'В', 'Г', 'СТИКЕРИ']) { const option = element('option', '', value || 'Избери екип'); option.value = value; team.append(option); }
    team.value = initial.taskTeam || '';
    group.append(label, field('Екип за задачи', team), element('small', '', 'Личният акаунт определя кой отчита задачите. Промяната на екипа не променя вече възложените смени.'), element('small', '', 'Началникът вижда своите задачи. Друг акаунт с право за преглед вижда всички задачи без промени. Изключеният преглед блокира достъпа и възлагането към този акаунт.'));
    const refresh = () => { flag.disabled = role.value !== 'operator'; if (flag.disabled) flag.checked = false; team.disabled = !flag.checked; team.required = flag.checked; form.dispatchEvent(new Event('taskprofilechange')); };
    role.addEventListener('change', refresh); flag.addEventListener('change', refresh);
    form.addEventListener('reset', () => setTimeout(() => { flag.checked = false; team.value = ''; refresh(); }, 0));
    form.insertBefore(group, form.querySelector('.account-actions')); refresh();
    return () => ({taskSupervisor: flag.checked, taskTeam: flag.checked ? team.value : ''});
  }
  function permissionControls(form, role, initialOverrides = {}) {
    let overrides = {...initialOverrides};
    const group = element('fieldset', 'account-permissions');
    group.append(element('legend', '', 'Права на акаунта'));
    const controls = new Map();
    const grid = element('div', 'account-permission-grid');
    for (const [key, text] of Object.entries(permissionLabels)) {
      const label = element('label', 'account-flag');
      const input = element('input'); input.type = 'checkbox'; input.dataset.permission = key;
      const copy = element('span'); const status = element('small');
      copy.append(element('span', 'account-flag-title', text), status); label.append(input, copy); grid.append(label);
      controls.set(key, {input, status});
      input.addEventListener('change', () => { overrides[key] = input.checked; refresh(); });
    }
    const footer = element('div', 'account-permission-footer');
    const state = element('small');
    const reset = element('button', 'account-secondary', 'Върни правата по роля'); reset.type = 'button';
    footer.append(state, reset); group.append(grid, footer);
    const allowed = key => ['canExportReports', 'canViewTasks'].includes(key) || (key === 'canImportData' ? role.value === 'admin' : role.value !== 'observer');
    const inherited = key => defaults[role.value][key] || key === 'canViewTasks' && role.value === 'operator' && !!form.querySelector('[data-task-supervisor]')?.checked;
    const read = () => Object.fromEntries(Object.entries(overrides).filter(([key]) => allowed(key)));
    const refresh = () => {
      for (const [key, {input, status}] of controls) {
        input.disabled = !allowed(key);
        input.checked = allowed(key) && (Object.hasOwn(overrides, key) ? overrides[key] : inherited(key));
        status.textContent = !allowed(key) ? key === 'canImportData' ? 'Само за администратори' : 'Недостъпно за наблюдател' : Object.hasOwn(overrides, key) ? 'Индивидуално право' : 'Според ролята';
      }
      const custom = Object.keys(read()).length > 0;
      state.textContent = custom ? 'Индивидуални права' : 'Права според ролята'; reset.disabled = !custom;
    };
    reset.addEventListener('click', () => { overrides = {}; refresh(); });
    role.addEventListener('change', refresh);
    form.addEventListener('taskprofilechange', refresh);
    form.addEventListener('reset', () => { overrides = {}; setTimeout(refresh, 0); });
    form.insertBefore(group, form.querySelector('.account-actions')); refresh();
    return read;
  }
  function applyFilters() {
    const query = search.value.trim().toLowerCase(); let count = 0;
    for (const {user, details} of cards.values()) {
      const matches = user.username.toLowerCase().includes(query) && (filter.value === 'all' || filter.value === 'active' && user.active || filter.value === 'inactive' && !user.active || filter.value === user.role);
      details.hidden = !matches; if (matches) count++;
    }
    document.getElementById('accountCount').textContent = `${count} / ${cards.size}`;
    document.getElementById('accountEmpty').hidden = count > 0;
  }
  function renderUser(user, open = false, feedback = '') {
    const details = element('details', 'account-entry'); details.open = open;
    const summary = element('summary', 'account-summary');
    const identity = element('div', 'account-identity');
    const name = element('h2', '', user.username); name.setAttribute('translate', 'no');
    const badges = element('div', 'account-badges');
    badges.append(element('span', 'account-role-badge', roles[user.role]), element('span', user.active ? 'account-status is-active' : 'account-status', user.active ? 'Активен' : 'Неактивен'));
    if (user.taskSupervisor) badges.append(element('span', 'account-role-badge', 'Началник смяна'), element('span', 'account-role-badge', 'Екип: ' + user.taskTeam));
    identity.append(name, badges); summary.append(identity, element('span', 'account-manage', 'Управление')); details.append(summary);
    const form = element('form', 'account-card'); form.dataset.id = user.id;
    const fields = element('div', 'account-fields account-edit-fields');
    const role = element('select'); role.setAttribute('aria-label', 'Роля');
    for (const [value, label] of Object.entries(roles)) { const option = element('option', '', label); option.value = value; role.append(option); }
    role.value = user.role;
    const active = element('input'); active.type = 'checkbox'; active.checked = user.active; active.dataset.active = '';
    const activeLabel = element('label', 'account-active'); activeLabel.append(active, element('span', '', 'Активен профил'));
    fields.append(field('Роля', role), activeLabel); form.append(fields);
    const actions = element('div', 'account-actions');
    const button = element('button', '', 'Запази промените'); button.type = 'submit';
    const deleteButton = element('button', 'account-danger', 'Изтрий акаунта'); deleteButton.type = 'button'; deleteButton.dataset.deleteAccount = '';
    const ownAccount = user.id === HubServer.user.id;
    deleteButton.disabled = ownAccount;
    if (ownAccount) deleteButton.title = 'Не можеш да изтриеш акаунта, с който си влязъл.';
    actions.append(element('small', '', 'Промените прекратяват сесиите на този профил.'), button, deleteButton); form.append(actions);
    const permissions = permissionControls(form, role, user.permissionOverrides);
    const taskProfile = taskProfileControls(form, role, user);
    const password = element('input'); password.type = 'password'; password.placeholder = 'Нова парола (по избор)'; password.autocomplete = 'new-password'; password.setAttribute('aria-label', 'Нова парола'); password.minLength = 12; password.maxLength = 128;
    const passwordDetails = element('details', 'account-password');
    passwordDetails.append(element('summary', '', 'Смяна на парола'), field('Нова парола', password), element('small', '', 'Поне 12 знака. Остави празно, за да запазиш текущата парола.'));
    password.addEventListener('invalid', () => { passwordDetails.open = true; });
    form.insertBefore(passwordDetails, actions);
    const status = element('p', 'account-feedback', feedback); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); form.append(status);
    form.addEventListener('submit', async event => {
      event.preventDefault(); button.disabled = true; deleteButton.disabled = true; status.textContent = '';
      try {
        const result = await HubServer.send('/api/accounts/' + user.id, 'PATCH', {role: role.value, active: active.checked, permissions: permissions(), ...taskProfile(), ...(password.value ? {password: password.value} : {})});
        renderUser(result.user, true, 'Акаунтът е обновен.'); message.textContent = 'Акаунтът е обновен.';
        cards.get(user.id).details.querySelector('button[type=submit]').focus({preventScroll: true});
      } catch (error) { status.textContent = error.message; } finally { button.disabled = false; deleteButton.disabled = ownAccount; }
    });
    deleteButton.addEventListener('click', async () => {
      if (!confirm('Да изтриеш акаунта "' + user.username + '"? Достъпът му ще бъде прекратен. Историята се запазва, а потребителското име остава заето.')) return;
      button.disabled = true; deleteButton.disabled = true; status.textContent = '';
      try {
        await HubServer.send('/api/accounts/' + user.id, 'DELETE', {});
        details.remove(); cards.delete(user.id); applyFilters();
        message.textContent = 'Акаунтът е изтрит.'; search.focus({preventScroll: true});
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; deleteButton.disabled = ownAccount; }
    });
    details.append(form);
    const previous = cards.get(user.id);
    if (previous) previous.details.replaceWith(details);
    else {
      const next = [...list.children].find(entry => cards.get(Number(entry.querySelector('form').dataset.id)).user.username > user.username);
      list.insertBefore(details, next || null);
    }
    cards.set(user.id, {user, details}); applyFilters();
  }
  function setCreateOpen(open) {
    document.getElementById('accountCreate').hidden = !open;
    document.getElementById('newAccountButton').setAttribute('aria-expanded', String(open));
    if (open) document.getElementById('accountUsername').focus();
    else document.getElementById('newAccountButton').focus({preventScroll: true});
  }
  const createPermissions = permissionControls(createForm, document.getElementById('accountRole'));
  const createTaskProfile = taskProfileControls(createForm, document.getElementById('accountRole'));
  document.getElementById('newAccountButton').addEventListener('click', () => setCreateOpen(document.getElementById('accountCreate').hidden));
  document.getElementById('cancelCreate').addEventListener('click', () => { createForm.reset(); setCreateOpen(false); });
  search.addEventListener('input', applyFilters); filter.addEventListener('change', applyFilters);
  createForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = createForm.querySelector('button[type=submit]'); button.disabled = true;
    const status = document.getElementById('accountCreateMessage'); status.textContent = '';
    try {
      const result = await HubServer.send('/api/accounts', 'POST', {username: document.getElementById('accountUsername').value.trim(), password: document.getElementById('accountPassword').value, role: document.getElementById('accountRole').value, permissions: createPermissions(), ...createTaskProfile()});
      createForm.reset(); setCreateOpen(false); search.value = ''; filter.value = 'all';
      renderUser(result.user); message.textContent = 'Акаунтът е създаден.';
    } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  });
  HubServer.json('/api/accounts').then(result => { for (const user of result.users) renderUser(user); applyFilters(); }).catch(error => { message.textContent = error.message; });
})();
