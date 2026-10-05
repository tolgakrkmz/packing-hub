document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  const message = document.getElementById('loginMessage');
  button.disabled = true; message.textContent = 'Влизане…';
  try {
    const response = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: document.getElementById('username').value.trim().toLowerCase(), password: document.getElementById('password').value})});
    if (response.ok) { location.assign('/index.html'); return; }
    message.textContent = response.status === 429 ? 'Твърде много опити. Опитай отново след 15 минути.' : 'Невалидно потребителско име или парола.';
  } catch { message.textContent = 'Няма връзка със сървъра. Опитай отново.'; }
  finally { button.disabled = false; }
});
