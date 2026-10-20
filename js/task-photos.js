/* Task photos: metadata stripping, evidence thumbnails and the problem/solution pickers. tasks.js passes its helpers and live state. */
function createTaskPhotos({$, el, button, photoObserver, observePhotos, forgetPhotos, getState, isBusy, photoUrl = (item, photo, recurring) => '/api/tasks/' + (recurring ? 'schedules/' : 'items/') + item.id + '/photos/' + photo.id}) {
function withoutMetadata(dataURL) {
  // Some browsers add an ICC profile to canvas JPEGs. Strip optional metadata
  // segments as well as camera tags; compressed pixels stay unchanged.
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
  return 'data:image/jpeg;base64,' + btoa(parts.join(''));
}
function photoView(item, photo, label, recurring = false, index = 0, total = 1) {
  label = (HubI18n.language === 'en' ? label === 'Проблем' ? 'Problem' : 'Solution' : label) + (total > 1 ? ' ' + (index + 1) : '');
  const figure = el('figure', '', 'task-photo'); figure.append(el('figcaption', label, '', true));
  if (!photo?.available) { figure.append(el('p', photo ? 'Снимката е изтрита след срока за съхранение.' : 'Няма снимка от предишната версия.', 'task-muted')); return figure; }
  const url = photoUrl(item, photo, recurring);
  const control = button('Отвори снимката', () => {
    $('photoViewerTitle').textContent = label; $('photoViewerFeedback').textContent = '';
    $('photoViewerImage').alt = label; $('photoViewerImage').src = url; $('taskPhotoViewer').showModal();
  }, 'secondary task-photo-button');
  const img = el('img'); img.alt = label; img.loading = 'lazy'; img.decoding = 'async'; img.width = photo.width || 220; img.height = photo.height || 130;
  if (photoObserver) img.dataset.photoSrc = url; else img.src = url;
  img.addEventListener('error', () => { control.replaceChildren(el('span', 'Снимката не е достъпна. Опресни задачите.')); });
  control.replaceChildren(img, el('span', 'Отвори снимката')); figure.append(control); return figure;
}
const photoViews = (item, list, label, recurring = false) => list.map((photo, index) => photoView(item, photo, label, recurring, index, list.length));
function photoPicker(prefix) {
  let entries = [], pending = false, failed = false, original = null, sequence = 0, expected = 0;
  const input = $(prefix + 'Photo'), camera = $(prefix + 'Camera'), preview = $(prefix + 'PhotoPreview'), info = $(prefix + 'PhotoInfo'), clear = $(prefix + 'PhotoClear');
  const clearFeedback = () => { $(prefix === 'problem' ? 'editorFeedback' : 'actionFeedback').textContent = ''; };
  function render() {
    forgetPhotos(preview); preview.replaceChildren(); clear.hidden = !entries.length && !failed && !pending;
    entries.forEach((entry, index) => {
      const row = el('div', '', 'task-photo-choice');
      if (entry.photo) row.append(photoView(original.item, entry.photo, 'Проблем', original.recurring, index, entries.length));
      else { const img = el('img', '', 'task-photo-preview'); img.alt = 'Избрана снимка'; img.src = 'data:image/jpeg;base64,' + entry.data; row.append(img); }
      row.append(button('Премахни снимката', () => { if (!isBusy() && !pending) { entries.splice(index, 1); failed = false; info.textContent = ''; clearFeedback(); render(); } })); preview.append(row);
    });
    const count = $(prefix + 'PhotoCount'); count.setAttribute('translate', 'no');
    count.textContent = HubI18n.language === 'en' ? expected ? `Solution photos: ${entries.length} / ${expected} required.` : `Selected photos: ${entries.length} / ${getState()?.photoPolicy.maxPhotos || 10}.` : expected ? `Снимки на решението: ${entries.length} / ${expected} задължителни.` : `Избрани снимки: ${entries.length} / ${getState()?.photoPolicy.maxPhotos || 10}.`;
    observePhotos(preview);
  }
  function reset(existing = [], item = null, recurring = false, required = 0) {
    ++sequence; entries = existing.map(photo => ({photo})); pending = false; failed = false; original = {existing, item, recurring}; expected = required;
    input.value = ''; camera.value = ''; input.disabled = isBusy(); camera.disabled = isBusy(); info.textContent = ''; render();
  }
  async function encode(file) {
    let bitmap;
    try {
      if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('Избери снимка до 20 MB, която браузърът може да отвори (JPEG, PNG или WebP).');
      bitmap = await createImageBitmap(file);
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('Снимката е прекалено голяма. Избери по-малка снимка.');
      let edge = getState().photoPolicy.maxEdge, result;
      while (edge >= 320) {
        const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        for (const quality of [.82, .7, .58]) {
          result = canvas.toDataURL('image/jpeg', quality);
          if ((result.length - result.indexOf(',') - 1) * 3 / 4 <= getState().photoPolicy.maxBytes) break;
        }
        if ((result.length - result.indexOf(',') - 1) * 3 / 4 <= getState().photoPolicy.maxBytes) break;
        result = null; edge = Math.floor(edge * .75);
      }
      if (!result) throw new Error('Снимката е прекалено голяма. Избери по-малка снимка.');
      return withoutMetadata(result).split(',')[1];
    } finally { bitmap?.close(); }
  }
  async function choose(event) {
    if (isBusy() || pending) return;
    const files = [...event.target.files]; if (!files.length) return;
    const current = ++sequence; pending = true; failed = false; clear.hidden = false; input.disabled = true; camera.disabled = true; clearFeedback(); info.textContent = 'Подготвяне на снимката…';
    try {
      if (getState().photoPolicy.maxPhotos === 1) entries = []; // A single-photo picker replaces its choice.
      if (entries.length + files.length > getState().photoPolicy.maxPhotos) throw new Error('Можеш да добавиш до 10 снимки.');
      const added = [];
      for (const file of files) { added.push({data: await encode(file)}); if (sequence !== current) return; }
      entries.push(...added); info.textContent = entries.length === 1 ? 'Снимката е готова за запис.' : 'Снимките са готови за запис.';
    } catch (error) { if (sequence === current) { failed = true; info.textContent = /^(Избери|Снимката|Можеш)/.test(error.message) ? error.message : 'Снимката не може да се отвори. Избери JPEG, PNG или WebP.'; } }
    finally { if (sequence === current) { pending = false; input.disabled = isBusy(); camera.disabled = isBusy(); input.value = ''; camera.value = ''; render(); } }
  }
  input.addEventListener('change', choose); camera.addEventListener('change', choose); clear.addEventListener('click', () => { if (!isBusy()) { clearFeedback(); reset([], original?.item, original?.recurring, expected); } });
  return {reset, render, get values() { return entries.map(entry => entry.photo ? {id: entry.photo.id} : entry.data); }, get count() { return entries.length; }, get valid() { return entries.every(entry => !entry.photo || entry.photo.available); }, get pending() { return pending; }, get failed() { return failed; }};
}
  return {photoViews, photoPicker};
}
