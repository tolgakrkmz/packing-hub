/* Server-only inbox, device opt-in and a spaced invitation in the shared design. */
window.HubNotifications = (() => {
  const endpoint = '/api/notifications';
  let preferences, subscription, registration, subscribed = false, busy = false, deviceUnavailable = false;
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
  const safeStorage = name => ({getItem: key => window[name].getItem(key), setItem: (key, value) => window[name].setItem(key, value)});
  const prompt = HubNotificationPrompt.create({storage: safeStorage('localStorage'), sessionStorage: safeStorage('sessionStorage'), accountId: HubServer.user.id});
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const iosVersion = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  const modernIOS = !iosVersion || Number(iosVersion[1]) > 16 || Number(iosVersion[1]) === 16 && Number(iosVersion[2]) >= 4;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const installFirst = ios && modernIOS && !standalone;
  const supported = window.isSecureContext && 'serviceWorker' in navigator && ('PushManager' in window && 'Notification' in window || installFirst);
  const permission = () => 'Notification' in window ? Notification.permission : 'default';
  const send = (path, method, data) => HubServer.send(endpoint + path, method, data);
  function hint() {
    if (!preferences?.publicKey) return 'Телефонните известия още не са настроени. Известията в приложението работят.';
    if (deviceUnavailable) return 'Настройките за известия на браузъра не са достъпни. Получените известия остават тук.';
    if (!supported) return 'Този браузър не поддържа телефонни известия. Получените известия остават тук.';
    if (installFirst) return 'На iPhone отвори менюто за споделяне, избери „Добави към началния екран“, после отвори приложението от иконата.';
    if (permission() === 'denied') return 'Известията са блокирани. Разреши ги от настройките на браузъра или телефона и се върни тук.';
    return 'Телефонът показва общо известие. Подробностите се виждат след вход.';
  }
  function refreshDeviceUI() {
    const state = document.getElementById('notificationDeviceState');
    if (!state) return;
    state.textContent = subscribed ? 'Известията на това устройство са включени.' : 'Известията на това устройство са изключени.';
    document.getElementById('notificationDeviceHint').textContent = hint();
    const enable = document.getElementById('notificationEnable');
    enable.hidden = subscribed || installFirst || permission() === 'denied';
    enable.disabled = busy || !supported || !preferences?.publicKey || !preferences.types.some(type => type.enabled);
    const disable = document.getElementById('notificationDisable'); disable.hidden = !subscribed; disable.disabled = busy;
    const test = document.getElementById('notificationTest'); test.hidden = !subscribed; test.disabled = busy || !preferences.types.some(type => type.enabled);
    document.getElementById('notificationNever').checked = prompt.muted();
  }
  async function inspectDevice() {
    if (!supported || installFirst) return;
    registration = await navigator.serviceWorker.getRegistration('/');
    subscription = await registration?.pushManager.getSubscription();
    subscribed = !!subscription && permission() === 'granted' && (await send('/device', 'POST', {endpoint: subscription.endpoint})).subscribed;
  }
  async function enable() {
    if (busy || installFirst || !supported || permission() === 'denied' || !preferences?.publicKey) return;
    busy = true; deviceUnavailable = false; refreshDeviceUI();
    try {
      // The native permission request must stay directly in the user's click handler.
      const result = permission() === 'granted' ? 'granted' : await Notification.requestPermission();
      if (result !== 'granted') { prompt.defer(); return; }
      registration = await navigator.serviceWorker.register('/js/notification-worker.js', {scope: '/'});
      await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
      // Explicit opt-in renews a revoked or differently keyed device subscription.
      if (subscription && !subscribed) { await subscription.unsubscribe(); subscription = null; }
      if (!subscription) {
        const raw = atob(preferences.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
        subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, char => char.charCodeAt(0))});
      }
      await send('/subscriptions', 'POST', subscription.toJSON()); subscribed = true;
    } finally { busy = false; refreshDeviceUI(); }
  }
  async function stopDevice(localOnly = false) {
    if (!('serviceWorker' in navigator)) return;
    const worker = await navigator.serviceWorker.getRegistration('/');
    const current = await worker?.pushManager.getSubscription();
    if (current && !localOnly) await send('/unsubscribe', 'POST', {endpoint: current.endpoint});
    await current?.unsubscribe();
    for (const notification of await worker?.getNotifications() || []) notification.close();
    subscribed = false; subscription = null;
    // A forced sign-out after an admin changes flags is not a user's dismissal.
    if (!localOnly && current) prompt.defer();
    refreshDeviceUI();
  }
  let countSequence = 0, badge;
  async function refreshCount() {
    if (!badge) return;
    const sequence = ++countSequence;
    try {
      const data = await HubServer.json(endpoint);
      if (sequence !== countSequence) return;
      badge.textContent = String(data.count); badge.hidden = data.count === 0;
      badge.parentElement.setAttribute('aria-label', 'Известия: ' + data.count);
    } catch { if (sequence === countSequence) badge.hidden = true; }
  }
  function invitation() {
    const dialog = el('dialog', '', 'notification-invite'); dialog.id = 'notificationInvite';
    dialog.setAttribute('aria-labelledby', 'notificationInviteTitle'); dialog.setAttribute('aria-describedby', 'notificationInviteCopy');
    const head = el('div', '', 'notification-invite-head'), close = el('button', '×', 'notification-close');
    close.type = 'button'; close.setAttribute('aria-label', 'Затвори'); head.append(el('span', 'Package Hub', 'notification-brand'), close);
    const title = el('h2', 'Не пропускай важните известия'); title.id = 'notificationInviteTitle';
    const copy = el('p'); copy.id = 'notificationInviteCopy';
    const actions = el('div', '', 'notification-actions'), accept = el('button', 'Включи известията', 'notification-primary'), later = el('button', 'По-късно');
    const never = el('button', 'Не ме подсещай', 'notification-skip'), status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    for (const button of [accept, later, never]) button.type = 'button';
    actions.append(accept, later); dialog.append(head, title, copy, el('p', '„По-късно“ отлага поканата със 7 дни.'), actions, never, status); document.body.append(dialog);
    const dismiss = () => { prompt.defer(); dialog.close(); refreshDeviceUI(); };
    close.addEventListener('click', dismiss); later.addEventListener('click', dismiss);
    dialog.addEventListener('cancel', () => { prompt.defer(); refreshDeviceUI(); });
    never.addEventListener('click', () => { prompt.never(); dialog.close(); refreshDeviceUI(); });
    accept.addEventListener('click', async () => {
      if (installFirst || permission() === 'denied') { dialog.close(); location.assign('/notifications.html#settings'); return; }
      accept.disabled = true;
      try { await enable(); if (subscribed) dialog.close(); else { copy.textContent = hint(); status.textContent = 'Можеш да включиш известията по-късно от „Настройки“.'; accept.hidden = true; } }
      catch { status.textContent = 'Включването не успя. Опитай по-късно от „Настройки“.'; prompt.defer(); }
      finally { accept.disabled = false; }
    });
    return {show() {
      copy.textContent = installFirst || permission() === 'denied' ? hint() : 'Включи известията на това устройство за събитията, които са разрешени за твоя акаунт. Подробностите остават в приложението.';
      accept.textContent = installFirst ? 'Как да добавя приложението' : permission() === 'denied' ? 'Виж инструкциите' : 'Включи известията';
      accept.hidden = false; status.textContent = '';
      prompt.shownNow(); dialog.showModal(); later.focus();
    }};
  }
  const editedFields = new Map();
  const fieldValue = field => field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value;
  document.addEventListener('focusin', event => {
    const field = event.target;
    if (field.matches('input:not([type=file]),textarea,select') && !editedFields.has(field)) editedFields.set(field, fieldValue(field));
  });
  function occupied() {
    const active = document.activeElement;
    const unfinished = [...editedFields].some(([field, initial]) => field.isConnected && field.checkVisibility() && fieldValue(field) !== initial);
    return busy || unfinished || active && (active.matches('input,textarea,select,[contenteditable=true]') || active.closest('form')) ||
      [...document.querySelectorAll('dialog[open], [role=dialog]:not([hidden]), .modal.open, .modal-overlay.open, .modal-backdrop.open, #lightbox.open')].some(dialog => dialog.checkVisibility()) ||
      [...document.querySelectorAll('button:disabled, [data-photo-loading=true]')].some(control => control.checkVisibility() && !control.closest('.notification-page'));
  }
  async function inbox() {
    const list = document.getElementById('notificationList'); if (!list) return;
    const message = document.getElementById('notificationMessage'), more = document.getElementById('notificationMore');
    let cursor = null, loading = false, sequence = 0;
    const showError = error => { message.textContent = error.message; };
    async function load(append = false) {
      if (loading && append) return;
      const generation = ++sequence; loading = true;
      try {
        const data = await HubServer.json(endpoint + (append && cursor ? '?before=' + cursor : ''));
        if (generation !== sequence) return;
        if (!append) list.replaceChildren();
        document.getElementById('notificationUnread').textContent = 'Непрочетени: ' + data.count;
        cursor = data.nextBefore; more.hidden = !cursor;
        if (!data.items.length && !append) list.append(el('p', 'Няма известия.'));
        for (const item of data.items) {
          const row = el('article', '', 'notification-row'); row.dataset.read = String(item.read);
          const heading = el('h2', item.text), time = el('time', new Date(item.at).toLocaleString(document.documentElement.lang, {timeZone: 'Europe/Sofia'})); time.dateTime = new Date(item.at).toISOString(); time.setAttribute('translate', 'no');
          const link = el('a', 'Отвори'), read = el('button', 'Прочети'); link.href = item.href; read.type = 'button'; read.hidden = item.read;
          const mark = async () => { await send('/read', 'POST', {id: item.id}); row.dataset.read = 'true'; read.hidden = true; refreshCount(); };
          read.addEventListener('click', () => mark().then(() => load()).catch(showError));
          link.addEventListener('click', async event => { event.preventDefault(); try { await mark(); } catch {} location.assign(item.href); });
          const actions = el('div', '', 'notification-actions'); actions.append(time, link, read); row.append(heading, actions); list.append(row);
        }
        message.textContent = '';
      } catch (error) { if (generation === sequence) showError(error); }
      finally { if (generation === sequence) loading = false; }
    }
    more.addEventListener('click', () => load(true));
    document.getElementById('notificationReadAll').addEventListener('click', async () => { try { await send('/read', 'POST', {id: 'all'}); await load(); refreshCount(); } catch (error) { showError(error); } });
    const select = settings => {
      document.getElementById('notificationInbox').hidden = settings; document.getElementById('notificationSettings').hidden = !settings;
      document.getElementById('notificationInboxTab').setAttribute('aria-selected', String(!settings)); document.getElementById('notificationSettingsTab').setAttribute('aria-selected', String(settings));
    };
    document.getElementById('notificationInboxTab').addEventListener('click', () => select(false));
    document.getElementById('notificationSettingsTab').addEventListener('click', () => select(true)); select(location.hash === '#settings');
    function renderPreferences() {
      const container = document.getElementById('notificationTypes'); container.replaceChildren();
      for (const type of preferences.types) { const label = el('label', '', 'notification-check'), input = el('input'); input.type = 'checkbox'; input.checked = type.enabled; input.dataset.type = type.key; label.append(input, el('span', type.label)); container.append(label); }
      if (!preferences.types.length) container.append(el('p', 'Няма разрешени видове известия. Свържи се с администратор.'));
    }
    renderPreferences(); refreshDeviceUI();
    document.getElementById('notificationPreferences').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
      try { preferences = await send('/preferences', 'PATCH', Object.fromEntries([...event.target.querySelectorAll('input')].map(input => [input.dataset.type, input.checked]))); message.textContent = 'Настройките са запазени.'; refreshDeviceUI(); }
      catch (error) { showError(error); } finally { button.disabled = false; }
    });
    document.getElementById('notificationEnable').addEventListener('click', () => enable().catch(() => { message.textContent = 'Включването не успя. Опитай по-късно от „Настройки“.'; }));
    document.getElementById('notificationDisable').addEventListener('click', () => stopDevice().catch(showError));
    document.getElementById('notificationTest').addEventListener('click', async () => {
      if (busy || !subscribed || !subscription) return;
      busy = true; refreshDeviceUI();
      try { await send('/test', 'POST', {endpoint: subscription.endpoint}); message.textContent = 'Тестовото известие е изпратено. Провери дали се появи на устройството.'; }
      catch { message.textContent = 'Тестът не беше изпратен. Изчакай малко и провери дали известията са включени.'; }
      finally { busy = false; refreshDeviceUI(); }
    });
    document.getElementById('notificationNever').addEventListener('change', event => { if (event.target.checked) prompt.never(); else prompt.reset(); });
    HubServer.watch('notifications', load); setInterval(() => { if (!document.hidden) load(); }, 30000);
    await load();
  }
  document.addEventListener('DOMContentLoaded', async () => {
    if (!HubServer.can('canViewNotifications')) return;
    const link = el('a', '', 'notification-bell'); link.href = '/notifications.html'; link.setAttribute('aria-label', 'Известия'); link.title = 'Известия';
    // Local bell vector uses no external assets.
    link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></svg>';
    badge = el('span', '', 'notification-count'); badge.hidden = true; link.append(badge); document.querySelector('.server-links')?.append(link);
    HubServer.watch('notifications', refreshCount); HubServer.watch('tasks', refreshCount);
    for (const module of ['production-log', 'line-downtime', 'pair-targets', 'package-instructions']) HubServer.watch(module, refreshCount);
    setInterval(() => { if (!document.hidden) refreshCount(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCount(); }); refreshCount();
    try { preferences = await HubServer.json(endpoint + '/preferences'); try { await inspectDevice(); } catch { deviceUnavailable = true; } await inbox(); }
    catch (error) { const message = document.getElementById('notificationMessage'); if (message) message.textContent = error.message; return; }
    const invite = invitation(); let visibleTime = 0;
    const timer = setInterval(() => {
      if (!document.hidden) visibleTime += 5000;
      if (visibleTime < 30000 || !prompt.eligible({configured: !!preferences.publicKey, allowed: preferences.types.some(type => type.enabled), supported: supported && !deviceUnavailable, subscribed, visible: !document.hidden, busy: occupied()})) return;
      invite.show(); clearInterval(timer);
    }, 5000);
  });
  return {stopDevice};
})();
