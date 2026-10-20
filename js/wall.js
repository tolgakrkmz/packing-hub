/* Shift leads' wall. Posts stay on the server only; nothing is kept in browser storage. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined') { $('wallMessage').textContent = 'Стената е достъпна само в сървърната версия след вход с личен акаунт.'; $('refreshWall').hidden = true; return; }
  const poster = HubServer.can('canPostWall'), admin = HubServer.user.role === 'admin';
  const emoji = {beer: '🍺', laugh: '😂', fire: '🔥', like: '👍'};
  const names = {beer: 'Бира', laugh: 'Смях', fire: 'Огън', like: 'Харесва ми'};
  let state = null, items = [], nextBefore = null, busy = false, requestKey = null, sequence = 0;
  function el(tag, text = '', cls = '', custom = false) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; if (custom) node.setAttribute('translate', 'no'); return node; }
  function button(label, fn, cls = 'secondary') { const node = el('button', label, cls); node.type = 'button'; node.addEventListener('click', fn); return node; }
  const {photoPicker} = createTaskPhotos({$, el, button, photoObserver: null, observePhotos() {}, forgetPhotos() {}, getState: () => state, isBusy: () => busy});
  const picker = photoPicker('wall');
  const english = () => typeof HubI18n !== 'undefined' && HubI18n.language === 'en';
  const when = at => new Date(at).toLocaleString(english() ? 'en-GB' : 'bg-BG', {dateStyle: 'short', timeStyle: 'short'});
  const author = person => HubServer.avatar('wall-avatar', {...person, avatarRoute: '/api/wall/authors/' + person.id + '/avatar'});
  const draftOpen = () => busy || !!$('wallText').value.trim() || picker.count > 0 || picker.pending || [...document.querySelectorAll('.wall-comment-form input')].some(input => input.value.trim());
  function keyed(payload) {
    const signature = JSON.stringify(payload);
    if (!requestKey || requestKey.signature !== signature) requestKey = {signature, id: crypto.randomUUID()};
    return {...payload, requestId: requestKey.id};
  }
  const failure = error => error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.';
  async function run(fn, feedback = $('wallMessage')) {
    if (busy) return null;
    busy = true; feedback.textContent = '';
    try { const result = await fn(); requestKey = null; return result || {}; }
    catch (error) { feedback.textContent = failure(error); return null; }
    finally { busy = false; }
  }
  function header(person, at, remove) {
    const node = el('div', '', 'wall-author'), who = el('div');
    who.append(el('strong', person.username, '', true), el('span', when(at), 'task-muted'));
    node.append(author(person), who);
    if (remove) node.append(remove);
    return node;
  }
  function canDelete(person) { return admin || person.id === HubServer.user.id; }
  function confirmDelete(label, fn) { return button(label, async () => { if (confirm(typeof HubI18n === 'undefined' ? label + '?' : HubI18n.t(label + '?')) && await run(fn)) await refresh(); }, 'secondary wall-delete'); }
  function card(item) {
    const node = el('article', '', 'wall-post'); node.dataset.id = item.id;
    node.append(header(item.author, item.createdAt, canDelete(item.author) ? confirmDelete('Изтрий публикацията', () => HubServer.send('/api/wall/' + item.id, 'DELETE')) : null));
    if (item.text) node.append(el('p', item.text, 'wall-text', true));
    if (item.photo?.available) {
      const url = '/api/wall/' + item.id + '/photos/' + item.photo.id, img = el('img');
      img.alt = 'Снимка от ' + item.author.username; img.loading = 'lazy'; img.width = item.photo.width; img.height = item.photo.height; img.src = url;
      node.append(button('', () => { $('photoViewerImage').alt = img.alt; $('photoViewerImage').src = url; $('taskPhotoViewer').showModal(); }, 'wall-photo'));
      node.lastChild.setAttribute('aria-label', 'Отвори снимката'); node.lastChild.append(img);
    }
    const reactions = el('div', '', 'wall-reactions');
    for (const kind of state.reactions) {
      const active = item.mine.includes(kind), control = button(emoji[kind] + ' ' + item.reactions[kind], () => react(item, kind), 'secondary wall-reaction' + (active ? ' is-active' : ''));
      control.setAttribute('aria-pressed', String(active)); control.setAttribute('aria-label', names[kind] + ': ' + item.reactions[kind]); control.setAttribute('translate', 'no');
      reactions.append(control);
    }
    node.append(reactions);
    const comments = el('div', '', 'wall-comments');
    for (const entry of item.comments) {
      const row = el('div', '', 'wall-comment');
      row.append(header(entry.author, entry.createdAt, canDelete(entry.author) ? confirmDelete('Изтрий коментара', () => HubServer.send('/api/wall/' + item.id + '/comments/' + entry.id, 'DELETE')) : null), el('p', entry.text, 'wall-text', true));
      comments.append(row);
    }
    if (poster) {
      const form = el('form', '', 'wall-comment-form'), input = el('input'), feedback = el('p', '', 'task-error');
      input.maxLength = 300; input.required = true; input.placeholder = 'Напиши коментар…'; input.setAttribute('aria-label', 'Коментар');
      feedback.setAttribute('role', 'status');
      form.append(input, el('button', 'Изпрати'), feedback);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (await run(() => HubServer.send('/api/wall/' + item.id + '/comments', 'POST', keyed({text: input.value})), feedback)) { input.value = ''; await refresh(); }
      });
      comments.append(form);
    }
    node.append(comments);
    return node;
  }
  async function react(item, kind) { if (await run(() => HubServer.send('/api/wall/' + item.id + '/reactions', 'POST', keyed({kind})))) await refresh(); }
  function render() {
    if (!state) return;
    $('wallFeed').replaceChildren(...(items.length ? items.map(card) : [el('p', 'Още няма публикации.', 'task-empty')]));
    $('wallMore').hidden = !nextBefore;
  }
  // A refresh reloads every page already shown, so reactions and comments stay current further down the feed.
  async function refresh() {
    if (busy) return;
    const current = ++sequence;
    try {
      let loaded = [], before = null, result;
      do {
        result = await HubServer.json('/api/wall' + (before ? '?before=' + before : ''));
        loaded = loaded.concat(result.items); before = result.nextBefore;
      } while (before && loaded.length < items.length);
      if (current !== sequence) return;
      state = result; items = loaded; nextBefore = before; $('wallMessage').textContent = ''; render();
    } catch (error) {
      if (current === sequence) $('wallMessage').replaceChildren(el('span', 'Стената не може да се зареди.'), ' ', el('span', failure(error)), ' ', button('Опитай отново', refresh));
    }
  }
  $('wallMore').addEventListener('click', async () => {
    const result = await run(() => HubServer.json('/api/wall?before=' + nextBefore));
    if (result?.items) { items = items.concat(result.items); nextBefore = result.nextBefore; render(); }
  });
  $('wallForm').hidden = !poster;
  $('wallForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (picker.pending) { $('actionFeedback').textContent = 'Изчакай снимката да е готова.'; return; }
    if (picker.failed) { $('actionFeedback').textContent = 'Снимката не е валидна. Избери я отново.'; return; }
    const [photo] = picker.values;
    if (!$('wallText').value.trim() && !photo) { $('actionFeedback').textContent = 'Напиши текст или добави снимка.'; return; }
    const controls = [...$('wallForm').querySelectorAll('textarea,input,button')]; for (const control of controls) control.disabled = true;
    const result = await run(() => HubServer.send('/api/wall', 'POST', keyed({text: $('wallText').value, ...(photo ? {photo} : {})})), $('actionFeedback'));
    for (const control of controls) control.disabled = false;
    if (!result) return;
    $('wallText').value = ''; picker.reset(); await refresh(); $('wallMessage').textContent = 'Публикацията е добавена.';
  });
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => $(control.dataset.close).close());
  $('taskPhotoViewer').addEventListener('close', () => $('photoViewerImage').removeAttribute('src'));
  $('refreshWall').addEventListener('click', refresh);
  document.addEventListener('click', event => { if (event.target.closest('[data-hub-language]') && !busy) render(); });
  HubServer.watch('wall', refresh, draftOpen);
  setInterval(() => { if (!draftOpen()) refresh(); }, 60000);
  picker.reset(); refresh();
})();
