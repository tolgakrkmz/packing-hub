(() => {
  const message = document.getElementById('accountMessage');
  const roles = {admin: 'Администратор', operator: 'Оператор', observer: 'Наблюдател'};
  async function load() {
    const result = await HubServer.json('/api/accounts');
    const list = document.getElementById('accountList'); list.replaceChildren();
    for (const user of result.users) {
      const form = document.createElement('form'); form.className = 'account-card'; form.dataset.id = user.id;
      const name = document.createElement('h2'); name.setAttribute('translate', 'no'); name.textContent = user.username; form.append(name);
      const role = document.createElement('select'); role.setAttribute('aria-label', 'Роля');
      for (const [value, label] of Object.entries(roles)) { const option = document.createElement('option'); option.value = value; option.textContent = label; role.append(option); }
      role.value = user.role; form.append(role);
      const activeLabel = document.createElement('label'); const active = document.createElement('input'); active.type = 'checkbox'; active.checked = user.active; activeLabel.append(active, document.createTextNode(' Активен')); form.append(activeLabel);
      const password = document.createElement('input'); password.type = 'password'; password.placeholder = 'Нова парола (по избор)'; password.autocomplete = 'new-password'; password.setAttribute('aria-label', 'Нова парола'); password.maxLength = 128; form.append(password);
      const button = document.createElement('button'); button.textContent = 'Запази'; form.append(button);
      form.addEventListener('submit', async event => { event.preventDefault(); button.disabled = true; try { await HubServer.send('/api/accounts/' + user.id, 'PATCH', {role: role.value, active: active.checked, ...(password.value ? {password: password.value} : {})}); message.textContent = 'Акаунтът е обновен.'; await load(); } catch (error) { message.textContent = error.message; } finally { button.disabled = false; } });
      list.append(form);
    }
  }
  document.getElementById('accountForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try { await HubServer.send('/api/accounts', 'POST', {username: document.getElementById('accountUsername').value.trim(), password: document.getElementById('accountPassword').value, role: document.getElementById('accountRole').value}); event.target.reset(); message.textContent = 'Акаунтът е създаден.'; await load(); }
    catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
  });
  load().catch(error => { message.textContent = error.message; });
})();
