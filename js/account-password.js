/* Self-service password change and sign-out from every device. Passwords stay in the form only. */
(() => {
  const form = document.getElementById('passwordForm');
  const current = document.getElementById('currentPassword');
  const next = document.getElementById('newPassword');
  const confirmation = document.getElementById('confirmPassword');
  const reveal = document.getElementById('showPasswords');
  const message = document.getElementById('passwordMessage');
  const sessionsMessage = document.getElementById('sessionsMessage');
  const logoutAll = document.getElementById('logoutAll');
  const logoutHere = document.getElementById('logoutHere');
  const home = document.getElementById('homeLink');
  const submit = form.querySelector('button[type=submit]');
  const messages = {
    CURRENT_PASSWORD_INVALID: 'Сегашната парола е грешна.',
    PASSWORD_REUSED: 'Новата парола трябва да се различава от сегашната.',
    PASSWORD_LENGTH: 'Паролата трябва да съдържа 12–128 знака.',
    RATE_LIMITED: 'Твърде много опити. Опитай отново след 15 минути.',
    CONFLICT: 'Паролата е променена междувременно. Влез отново.',
    LOGIN_REQUIRED: 'Сесията е изтекла. Влез отново.'
  };
  let csrf = '', temporary = false, busy = false;
  const show = (target, text, tone = 'error') => { target.textContent = text; target.dataset.tone = tone; };
  function setBusy(value) {
    busy = value;
    for (const control of [submit, logoutAll, logoutHere]) control.disabled = value;
  }
  async function post(url, data) {
    const response = await fetch(url, {method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: JSON.stringify(data)});
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) { location.assign('/login'); throw Object.assign(new Error(messages.LOGIN_REQUIRED), {status: 401}); }
    if (!response.ok) throw Object.assign(new Error(messages[body.error] || 'Сървърът не потвърди промяната. Опитай отново.'), {status: response.status});
    return body;
  }
  function setTemporary(value) {
    temporary = value;
    document.getElementById('temporaryNotice').hidden = !value;
    home.hidden = value;
  }
  reveal.addEventListener('change', () => { for (const field of [current, next, confirmation]) field.type = reveal.checked ? 'text' : 'password'; });
  if (location.protocol === 'file:') {
    document.getElementById('offlineNotice').hidden = false;
    for (const control of form.querySelectorAll('input,button')) control.disabled = true;
    logoutAll.disabled = true; logoutHere.hidden = true;
    return;
  }
  setBusy(true);
  fetch('/api/session', {credentials: 'same-origin', cache: 'no-store'}).then(async response => {
    if (response.status === 401) { location.assign('/login'); return; }
    if (!response.ok) throw new Error();
    const session = await response.json();
    csrf = session.csrf; setTemporary(!!session.user.mustChangePassword); setBusy(false);
  }).catch(() => show(message, 'Няма връзка със сървъра. Опитай отново.'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (!current.value || !next.value || !confirmation.value) { show(message, 'Попълни всички полета.'); return; }
    if (next.value.length < 12 || next.value.length > 128) { show(message, messages.PASSWORD_LENGTH); next.focus(); return; }
    if (next.value !== confirmation.value) { show(message, 'Новите пароли не съвпадат.'); confirmation.focus(); return; }
    if (next.value === current.value) { show(message, messages.PASSWORD_REUSED); next.focus(); return; }
    setBusy(true); show(message, 'Запазване…', 'pending');
    try {
      const result = await post('/api/account/password', {currentPassword: current.value, password: next.value});
      csrf = result.csrf; form.reset(); reveal.dispatchEvent(new Event('change'));
      if (temporary) { location.assign('/'); return; }
      setTemporary(false);
      show(message, 'Паролата е сменена. Другите устройства са изведени от акаунта.', 'success');
    } catch (error) {
      if (error.status !== 401) show(message, error.message);
    } finally { setBusy(false); }
  });
  logoutAll.addEventListener('click', async () => {
    if (busy || !confirm('Да излезеш от всички устройства? Ще трябва да влезеш отново и тук.')) return;
    setBusy(true); show(sessionsMessage, 'Прекратяване на сесиите…', 'pending');
    try { await post('/api/logout-all', {}); location.assign('/login'); }
    catch (error) { if (error.status !== 401) show(sessionsMessage, error.message); setBusy(false); }
  });
  logoutHere.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try { await post('/api/logout', {}); location.assign('/login'); }
    catch (error) { if (error.status !== 401) show(sessionsMessage, error.message); setBusy(false); }
  });
})();
