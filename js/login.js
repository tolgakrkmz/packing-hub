const loginPassword = document.getElementById('password');
const loginPasswordToggle = document.getElementById('togglePassword');
function setLoginPasswordVisible(visible) {
  loginPassword.type = visible ? 'text' : 'password';
  loginPasswordToggle.setAttribute('aria-pressed', String(visible));
  loginPasswordToggle.setAttribute('aria-label', visible ? 'Скрий паролата' : 'Покажи паролата');
  loginPasswordToggle.textContent = visible ? 'Скрий' : 'Покажи';
}
loginPasswordToggle.addEventListener('click', () => setLoginPasswordVisible(loginPassword.type === 'password'));
document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type=submit]');
  const message = document.getElementById('loginMessage');
  if (button.disabled) return;
  setLoginPasswordVisible(false);
  button.disabled = true; message.textContent = 'Влизане…';
  try {
    const response = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: document.getElementById('username').value.trim().toLowerCase(), password: document.getElementById('password').value})});
    if (response.ok) { location.assign('/'); return; }
    message.textContent = response.status === 401 ? 'Невалидно потребителско име или парола.'
      : response.status === 429 ? 'Твърде много опити. Опитай отново след 15 минути.'
      : 'Входът временно не е достъпен. Опитай отново.';
  } catch { message.textContent = 'Няма връзка със сървъра. Опитай отново.'; }
  finally { button.disabled = false; }
});
