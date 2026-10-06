(() => {
  const message = document.getElementById('accountMessage');
  const roles = {admin: 'Администратор', operator: 'Оператор', observer: 'Наблюдател'};
  const permissionLabels = {canImportData: 'Импорт на данни', canExportReports: 'Експорт на отчети', canCreateReports: 'Добавяне на отчети', canEditReports: 'Корекции и изтриване на отчети'};
  const defaults = {
    admin: {canImportData: true, canExportReports: true, canCreateReports: true, canEditReports: true},
    operator: {canImportData: false, canExportReports: true, canCreateReports: true, canEditReports: false},
    observer: {canImportData: false, canExportReports: true, canCreateReports: false, canEditReports: false}
  };
  function permissionControls(form, role, overrides = {}) {
    const group = document.createElement('fieldset'); group.className = 'account-permissions';
    const legend = document.createElement('legend'); legend.textContent = 'Права на акаунта'; group.append(legend);
    const controls = new Map();
    for (const [key, text] of Object.entries(permissionLabels)) {
      const label = document.createElement('label'); label.append(document.createTextNode(text));
      const select = document.createElement('select'); select.dataset.permission = key; select.setAttribute('aria-label', text);
      for (const [value, name] of [['inherit', 'Според ролята'], ['allow', 'Разрешено'], ['deny', 'Забранено']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option);
      }
      select.value = Object.hasOwn(overrides, key) ? overrides[key] ? 'allow' : 'deny' : 'inherit';
      const status = document.createElement('small'); label.append(select, status); group.append(label); controls.set(key, {select, status});
    }
    const refresh = () => {
      for (const [key, {select, status}] of controls) {
        const allowed = key === 'canExportReports' || (key === 'canImportData' ? role.value === 'admin' : role.value !== 'observer');
        select.disabled = !allowed;
        status.textContent = !allowed ? 'Недостъпно за тази роля.' : (select.value === 'inherit' ? defaults[role.value][key] : select.value === 'allow') ? 'Разрешено' : 'Забранено';
      }
    };
    role.addEventListener('change', refresh); group.addEventListener('change', refresh); form.append(group); refresh();
    return () => Object.fromEntries([...controls].filter(([, {select}]) => !select.disabled && select.value !== 'inherit').map(([key, {select}]) => [key, select.value === 'allow']));
  }
  async function load() {
    const result = await HubServer.json('/api/accounts');
    const list = document.getElementById('accountList'); list.replaceChildren();
    for (const user of result.users) {
      const form = document.createElement('form'); form.className = 'account-card'; form.dataset.id = user.id;
      const name = document.createElement('h2'); name.setAttribute('translate', 'no'); name.textContent = user.username; form.append(name);
      const role = document.createElement('select'); role.setAttribute('aria-label', 'Роля');
      for (const [value, label] of Object.entries(roles)) { const option = document.createElement('option'); option.value = value; option.textContent = label; role.append(option); }
      role.value = user.role; form.append(role);
      const permissions = permissionControls(form, role, user.permissionOverrides);
      const activeLabel = document.createElement('label'); const active = document.createElement('input'); active.type = 'checkbox'; active.checked = user.active; activeLabel.append(active, document.createTextNode(' Активен')); form.append(activeLabel);
      const password = document.createElement('input'); password.type = 'password'; password.placeholder = 'Нова парола (по избор)'; password.autocomplete = 'new-password'; password.setAttribute('aria-label', 'Нова парола'); password.maxLength = 128; form.append(password);
      const button = document.createElement('button'); button.textContent = 'Запази'; form.append(button);
      form.addEventListener('submit', async event => { event.preventDefault(); button.disabled = true; try { await HubServer.send('/api/accounts/' + user.id, 'PATCH', {role: role.value, active: active.checked, permissions: permissions(), ...(password.value ? {password: password.value} : {})}); message.textContent = 'Акаунтът е обновен.'; await load(); } catch (error) { message.textContent = error.message; } finally { button.disabled = false; } });
      list.append(form);
    }
  }
  const createForm = document.getElementById('accountForm');
  const createPermissions = permissionControls(createForm, document.getElementById('accountRole'));
  createForm.append(createForm.querySelector('button'));
  createForm.addEventListener('reset', () => setTimeout(() => document.getElementById('accountRole').dispatchEvent(new Event('change')), 0));
  createForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try { await HubServer.send('/api/accounts', 'POST', {username: document.getElementById('accountUsername').value.trim(), password: document.getElementById('accountPassword').value, role: document.getElementById('accountRole').value, permissions: createPermissions()}); event.target.reset(); message.textContent = 'Акаунтът е създаден.'; await load(); }
    catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
  });
  load().catch(error => { message.textContent = error.message; });
})();
