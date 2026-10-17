/* Personal account overview. The photo is cropped and re-encoded locally; only the JPEG reaches the server. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined') { $('accountOffline').hidden = false; return; }
  const roles = {admin: 'Администратор', operator: 'Оператор', observer: 'Наблюдател'};
  const input = $('accountPhoto'), remove = $('accountPhotoRemove'), message = $('accountPhotoMessage');
  const upload = input.closest('label');
  const EDGE = 256, MAX_BYTES = 64 * 1024;
  let busy = false;
  $('accountUsername').textContent = HubServer.user.username;
  $('accountRole').textContent = roles[HubServer.user.role] || '';
  $('accountAvatar').append(HubServer.avatar());
  $('accountNotifications').hidden = !HubServer.can('canViewNotifications');
  $('accountProfile').hidden = false; $('accountLinks').hidden = false;
  const show = (text, tone = '') => { message.textContent = text; message.dataset.tone = tone; };
  function refresh() {
    remove.hidden = !HubServer.user.avatar;
    input.disabled = busy; remove.disabled = busy;
    upload.setAttribute('aria-disabled', String(busy));
  }
  // Canvas JPEGs may carry an ICC profile; optional metadata segments are dropped, pixels stay unchanged.
  function withoutMetadata(dataURL) {
    const binary = atob(dataURL.split(',')[1]), parts = [binary.slice(0, 2)];
    let offset = 2;
    while (offset + 4 <= binary.length) {
      const marker = binary.charCodeAt(offset + 1);
      if (marker === 0xda || marker === 0xd9) { parts.push(binary.slice(offset)); break; }
      const length = (binary.charCodeAt(offset + 2) << 8) + binary.charCodeAt(offset + 3), end = offset + 2 + length;
      if (binary.charCodeAt(offset) !== 0xff || length < 2 || end > binary.length) throw new Error('Снимката не може да се отвори. Избери JPEG, PNG или WebP.');
      if (!(marker >= 0xe1 && marker <= 0xef || marker === 0xfe)) parts.push(binary.slice(offset, end));
      offset = end;
    }
    return btoa(parts.join(''));
  }
  async function encode(file) {
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('Избери снимка до 20 MB, която браузърът може да отвори (JPEG, PNG или WebP).');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file).catch(() => { throw new Error('Снимката не може да се отвори. Избери JPEG, PNG или WebP.'); });
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('Снимката е прекалено голяма. Избери по-малка снимка.');
      // Centre crop to a square so faces stay in the middle of the circle.
      const side = Math.min(bitmap.width, bitmap.height), edge = Math.min(EDGE, side);
      const canvas = document.createElement('canvas'); canvas.width = edge; canvas.height = edge;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, edge, edge);
      context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
      for (const quality of [.86, .74, .6]) {
        const result = withoutMetadata(canvas.toDataURL('image/jpeg', quality));
        if (result.length * 3 / 4 <= MAX_BYTES) return result;
      }
      throw new Error('Снимката е прекалено голяма. Избери по-малка снимка.');
    } finally { bitmap?.close(); }
  }
  input.addEventListener('change', async () => {
    const [file] = input.files; input.value = '';
    if (!file || busy) return;
    busy = true; refresh(); show('Подготвяне на снимката…');
    try {
      const photo = await encode(file);
      show('Запазване…');
      const {avatar} = await HubServer.send('/api/account/avatar', 'PUT', {photo});
      HubServer.setAvatar(avatar); show('Снимката е запазена.', 'success');
    } catch (error) { show(error.message, 'error'); }
    finally { busy = false; refresh(); }
  });
  remove.addEventListener('click', async () => {
    if (busy) return;
    busy = true; refresh(); show('Премахване…');
    try { await HubServer.send('/api/account/avatar', 'DELETE', {}); HubServer.setAvatar(null); show('Снимката е премахната.', 'success'); }
    catch (error) { show(error.message, 'error'); }
    finally { busy = false; refresh(); }
  });
  refresh();
})();
