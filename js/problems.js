/* Problem text and identities stay out of browser persistence and machine translation; English versions are written by people. */
(() => {
  const $ = id => document.getElementById(id);
  if (typeof HubServer === 'undefined') { $('problemMessage').textContent = 'Глобалните проблеми са достъпни в сървърната версия след вход с личен акаунт.'; $('problemBoard').hidden = true; return; }
  const manager = HubServer.can('canManageProblems'), creator = HubServer.can('canCreateProblems');
  const stages = {open: 'Без решение', proposed: 'Предложено решение', resolved: 'Решен'};
  const levels = {low: 'Ниско', medium: 'Средно', high: 'Високо'};
  let state = null, busy = false, editing = null, viewing = null, translating = null, requestKey = null, sequence = 0;
  const draftOpen = () => busy || $('problemEditor').open || $('translationDialog').open || !!$('proposalText').value.trim() || solutionPicker.count > 0 || solutionPicker.pending;
  function el(tag, text = '', cls = '', custom = false) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; if (custom) node.setAttribute('translate', 'no'); return node; }
  function button(label, fn, cls = 'secondary') { const node = el('button', label, cls); node.type = 'button'; node.addEventListener('click', fn); return node; }
  function badge(text, cls = '', custom = false) { return el('span', text, 'task-badge' + (cls ? ' ' + cls : ''), custom); }
  const {photoViews, photoPicker} = createTaskPhotos({$, el, button, photoObserver: null, observePhotos() {}, forgetPhotos() {}, getState: () => state, isBusy: () => busy,
    photoUrl: (item, photo) => '/api/problems/' + item.id + '/photos/' + photo.id});
  const problemPicker = photoPicker('problem'), solutionPicker = photoPicker('solution');
  function gallery(item, list, label) { if (!list.length) return []; const node = el('div', '', 'task-photos'); node.append(...photoViews(item, list, label)); return [node]; }
  // Mirrors the task form checks so nothing is sent while a photo is still being prepared or is invalid.
  function photoProblem(picker) { return picker.pending ? 'Изчакай снимката да е готова.' : picker.failed || !picker.valid ? 'Снимката не е валидна. Избери я отново.' : ''; }
  // English versions are typed by people for meetings; Bulgarian stays the fallback for any empty field.
  const english = () => typeof HubI18n !== 'undefined' && HubI18n.language === 'en';
  const local = (value, key) => english() && value[key + 'En'] ? value[key + 'En'] : value[key];
  const date = at => new Date(at).toLocaleDateString(english() ? 'en-GB' : 'bg-BG');
  const untranslated = item => english() && !item.titleEn;
  // The switch only shows or hides the English fields; hiding them never clears what was written.
  function setSwitch(control, on) { control.setAttribute('aria-checked', String(on)); $(control.getAttribute('aria-controls')).hidden = !on; }
  for (const id of ['englishToggle', 'proposalEnglishToggle']) $(id).addEventListener('click', () => {
    const control = $(id); setSwitch(control, control.getAttribute('aria-checked') !== 'true');
    if (control.getAttribute('aria-checked') === 'true') $(control.getAttribute('aria-controls')).querySelector('input,textarea').focus();
  });
  const owns = item => item.createdBy.id === HubServer.user.id && creator;

  function card(item) {
    const node = el('button', '', 'task-card problem-card' + (item.impactLevel === 'high' && item.stage !== 'resolved' ? ' is-alert' : '')); node.type = 'button';
    node.addEventListener('click', () => openDetail(item.id));
    const badges = el('div', '', 'task-badges');
    badges.append(badge(levels[item.impactLevel], item.impactLevel === 'high' ? 'alert' : ''));
    if (item.dependsOn) badges.append(badge('→ ' + local(item, 'dependsOn'), '', true));
    if (untranslated(item)) badges.append(badge('Само на български'));
    node.append(el('h3', local(item, 'title'), '', true), badges);
    const latest = item.proposals.at(-1);
    if (latest) node.append(el('p', local(latest, 'text'), 'task-meta problem-solution', true));
    return node;
  }
  function render() {
    if (!state) return;
    const query = $('problemSearch').value.trim().toLocaleLowerCase('bg');
    const shown = state.items.filter(item => !query || [item.title, item.description, item.dependsOn, item.titleEn, item.descriptionEn, item.dependsOnEn, ...item.proposals.flatMap(entry => [entry.text, entry.textEn])].join(' ').toLocaleLowerCase('bg').includes(query))
      .sort((a, b) => ['high', 'medium', 'low'].indexOf(a.impactLevel) - ['high', 'medium', 'low'].indexOf(b.impactLevel) || b.createdAt - a.createdAt);
    if (!state.items.length) {
      const empty = el('div', '', 'task-empty'); empty.append(el('p', 'Още няма записани проблеми.'));
      if (creator) { const row = el('div', '', 'task-actions task-empty-actions'); row.append(button('+ Запиши проблем', () => openEditor(), '')); empty.append(row); }
      $('problemBoard').replaceChildren(empty); return;
    }
    $('problemBoard').replaceChildren(...Object.entries(stages).map(([stage, label]) => {
      const items = shown.filter(item => item.stage === stage), column = el('section', '', 'problem-column'), heading = el('h2');
      heading.append(el('span', label), el('span', String(items.length), 'task-badge'));
      column.append(heading, ...(items.length ? items.map(card) : [el('p', 'Няма проблеми.', 'task-muted')]));
      return column;
    }));
  }
  // Free text keeps its paragraphs; lines starting with "1." or "-" become real lists. Built with text nodes only, never HTML.
  function richText(value) {
    const root = el('div', '', 'problem-text', true);
    let list = null, paragraph = null, blank = false;
    for (const line of String(value).split(/\r?\n/)) {
      if (!line.trim()) { paragraph = null; blank = true; continue; }
      const marker = line.match(/^\s*(?:(\d{1,3})[.)]|[-•*–])\s+(.*)$/);
      if (marker) {
        const tag = marker[1] === undefined ? 'UL' : 'OL';
        if (list?.tagName !== tag) { list = document.createElement(tag); if (tag === 'OL' && marker[1] !== '1') list.start = Number(marker[1]); root.append(list); }
        list.append(el('li', marker[2])); paragraph = null;
      } else if (list && !blank) list.lastChild.append(document.createElement('br'), line.trim());
      else if (paragraph && !blank) paragraph.append(document.createElement('br'), line);
      else { list = null; paragraph = el('p', line); root.append(paragraph); }
      blank = false;
    }
    return root;
  }
  function section(label, ...children) { const node = el('section', '', 'problem-section'); node.append(el('h3', label), ...children); return node; }
  function renderDetail() {
    const item = state?.items.find(value => value.id === viewing);
    if (!item) { if ($('problemDetail').open) $('problemDetail').close(); return; }
    $('detailTitle').textContent = local(item, 'title');
    $('detailMeta').replaceChildren(badge(stages[item.stage], item.stage === 'resolved' ? 'good' : ''), badge(levels[item.impactLevel], item.impactLevel === 'high' ? 'alert' : ''),
      ...(item.dependsOn ? [badge('→ ' + local(item, 'dependsOn'), '', true)] : []), badge(item.createdBy.username + ' · ' + date(item.createdAt), 'problem-muted-badge', true),
      ...(untranslated(item) ? [badge('Само на български')] : []));
    const actions = [];
    if (manager || owns(item)) {
      actions.push(button('Редактирай', () => openEditor(item)));
      actions.push(item.resolvedAt ? button('Отвори отново', () => act(item, {action: 'reopen'})) : button('Маркирай като решен', () => act(item, {action: 'resolve'}), ''));
    }
    $('detailActions').replaceChildren(...actions);
    const problem = [];
    if (local(item, 'description')) problem.push(section('Описание', richText(local(item, 'description'))));
    if (local(item, 'impact')) { const impact = el('div', '', 'problem-impact'); impact.append(richText(local(item, 'impact'))); problem.push(section('Въздействие', impact)); }
    if (item.photos.length) problem.push(section('Снимки', ...gallery(item, item.photos, 'Проблем')));
    if (!problem.length) problem.push(el('p', 'Няма описание.', 'task-muted'));
    $('detailProblem').replaceChildren(...problem);
    const proposals = item.proposals.length ? [] : [el('p', 'Още няма предложения.', 'task-muted')];
    item.proposals.forEach(entry => {
      const node = el('article', '', 'problem-proposal'), foot = el('div', '', 'problem-proposal-foot');
      foot.append(el('span', entry.actor.username + ' · ' + date(entry.at), 'task-muted', true));
      if (manager || entry.actor.id === HubServer.user.id) foot.append(button(entry.textEn ? 'Промени английския текст' : '+ Английски текст', () => openTranslation(item, entry)));
      node.append(richText(local(entry, 'text')), ...gallery(item, entry.photos, 'Решение'), foot);
      proposals.push(node);
    });
    $('detailProposals').replaceChildren(...proposals);
    const canPropose = creator && !item.resolvedAt;
    $('proposalOpen').hidden = !canPropose || !$('proposalForm').hidden;
    if (!canPropose) $('proposalForm').hidden = true;
  }
  function showProposalForm(open) {
    $('proposalForm').hidden = !open; $('proposalOpen').hidden = open || !creator;
    if (open) $('proposalText').focus();
    else { $('proposalForm').reset(); $('actionFeedback').textContent = ''; solutionPicker.reset(); setSwitch($('proposalEnglishToggle'), false); }
  }
  function openDetail(id) {
    if (viewing !== id) showProposalForm(false);
    viewing = id; renderDetail(); if (!$('problemDetail').open) $('problemDetail').showModal();
  }
  function openTranslation(item, entry) {
    translating = {item, entry}; requestKey = null; $('translationFeedback').textContent = '';
    $('translationSource').textContent = entry.text; $('translationText').value = entry.textEn || '';
    $('translationDialog').showModal(); $('translationText').focus();
  }
  async function refresh() {
    if (busy || $('problemEditor').open) return;
    const current = ++sequence;
    try {
      const result = await HubServer.json('/api/problems');
      if (current !== sequence || busy || $('problemEditor').open) return;
      state = result; if ($('problemMessage').querySelector('button')) $('problemMessage').textContent = ''; render(); if ($('problemDetail').open) renderDetail();
    } catch (error) {
      if (current !== sequence) return;
      $('problemMessage').replaceChildren(el('span', (state ? error.message + ' Показани са последно заредените данни. ' : 'Проблемите не могат да се заредят. ' + error.message + ' ')), button('Опитай отново', refresh));
    }
  }
  function openEditor(item = null) {
    editing = item; requestKey = null; $('problemForm').reset(); $('editorFeedback').textContent = '';
    $('editorTitle').textContent = item ? 'Редактирай проблем' : 'Запиши проблем';
    $('problemTitle').value = item?.title || ''; $('problemDescription').value = item?.description || ''; $('problemImpactLevel').value = item?.impactLevel || 'medium';
    $('problemImpact').value = item?.impact || ''; $('problemDependsOn').value = item?.dependsOn || ''; problemPicker.reset(item?.photos || [], item);
    setSwitch($('englishToggle'), !!(item?.titleEn || item?.descriptionEn || item?.impactEn || item?.dependsOnEn));
    $('problemTitleEn').value = item?.titleEn || ''; $('problemDescriptionEn').value = item?.descriptionEn || ''; $('problemImpactEn').value = item?.impactEn || ''; $('problemDependsOnEn').value = item?.dependsOnEn || '';
    $('problemEditor').showModal(); $('problemTitle').focus();
  }
  function keyed(payload) {
    const signature = JSON.stringify(payload);
    if (!requestKey || requestKey.signature !== signature) requestKey = {signature, id: crypto.randomUUID()};
    return {...payload, requestId: requestKey.id};
  }
  const patch = (item, payload) => HubServer.send('/api/problems/' + item.id, 'PATCH', keyed(payload), {'If-Match': '"' + item.revision + '"'});
  const failure = error => (error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.') + (error.status === 409 ? ' Натисни „Опресни“. Въведеното е запазено.' : '');
  async function submit(form, feedback, fn) {
    if (busy) return;
    busy = true; const controls = [...form.querySelectorAll('input,select,textarea,button')].filter(control => !control.disabled); for (const control of controls) control.disabled = true; feedback.textContent = '';
    try { const result = await fn(); requestKey = null; busy = false; return result; }
    catch (error) { feedback.textContent = failure(error); return null; }
    finally { busy = false; for (const control of controls) control.disabled = false; }
  }
  async function act(item, payload) {
    if (busy) return; busy = true;
    try { await patch(item, payload); requestKey = null; $('problemMessage').textContent = 'Промяната е записана.'; }
    catch (error) { $('problemMessage').textContent = failure(error); }
    finally { busy = false; await refresh(); }
  }
  $('problemForm').addEventListener('submit', async event => {
    event.preventDefault();
    const invalid = photoProblem(problemPicker); if (invalid) { $('editorFeedback').textContent = invalid; return; }
    const payload = {title: $('problemTitle').value, description: $('problemDescription').value, impactLevel: $('problemImpactLevel').value, impact: $('problemImpact').value, dependsOn: $('problemDependsOn').value, photos: problemPicker.values,
      titleEn: $('problemTitleEn').value, descriptionEn: $('problemDescriptionEn').value, impactEn: $('problemImpactEn').value, dependsOnEn: $('problemDependsOnEn').value};
    const result = await submit($('problemForm'), $('editorFeedback'), () => editing ? patch(editing, {...payload, action: 'edit'}) : HubServer.send('/api/problems', 'POST', keyed(payload)));
    if (!result) return;
    $('problemEditor').close(); await refresh(); $('problemMessage').textContent = 'Промяната е записана.';
    if (result.id) openDetail(result.id);
  });
  $('proposalForm').addEventListener('submit', async event => {
    event.preventDefault();
    const item = state.items.find(value => value.id === viewing);
    if (!item) return;
    const invalid = photoProblem(solutionPicker); if (invalid) { $('actionFeedback').textContent = invalid; return; }
    const result = await submit($('proposalForm'), $('actionFeedback'), () => patch(item, {action: 'propose', text: $('proposalText').value, textEn: $('proposalTextEn').value, photos: solutionPicker.values}));
    if (!result) return;
    showProposalForm(false); await refresh(); $('problemMessage').textContent = 'Промяната е записана.';
  });
  $('translationForm').addEventListener('submit', async event => {
    event.preventDefault();
    const {item, entry} = translating;
    const result = await submit($('translationForm'), $('translationFeedback'), () => patch(item, {action: 'translate', proposalId: entry.id, textEn: $('translationText').value}));
    if (!result) return;
    $('translationDialog').close(); await refresh(); $('problemMessage').textContent = 'Промяната е записана.';
  });
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => { if (!busy) $(control.dataset.close).close(); });
  for (const id of ['problemEditor', 'problemDetail', 'translationDialog', 'taskPhotoViewer']) $(id).addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('problemEditor').addEventListener('close', () => { problemPicker.reset(); refresh(); });
  $('taskPhotoViewer').addEventListener('close', () => $('photoViewerImage').removeAttribute('src'));
  $('problemDetail').addEventListener('close', () => { viewing = null; showProposalForm(false); });
  $('proposalOpen').addEventListener('click', () => showProposalForm(true));
  $('proposalCancel').addEventListener('click', () => { if (!busy) showProposalForm(false); });
  $('newProblem').hidden = !creator; $('newProblem').addEventListener('click', () => { if (state) openEditor(); });
  $('refreshProblems').addEventListener('click', refresh);
  $('problemSearch').addEventListener('input', render);
  document.addEventListener('click', event => { if (event.target.closest('[data-hub-language]') && !busy) { render(); if ($('problemDetail').open) renderDetail(); } });
  HubServer.watch('problems', refresh, draftOpen); HubServer.watch('accounts', refresh, draftOpen);
  setInterval(() => { if (!draftOpen()) refresh(); }, 60000); refresh();
})();
