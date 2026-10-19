/* Recover failed local writes and keep a report's identity across retries. */
function createReportWriter({sync, getData, setData, render, updateControls, controls, message, retryButton}) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const drafts = new Map();
  const operations = new Map();
  const unconfirmedOperations = new Map();
  let busy = false, retry = null;
  let conflicting = null;
  let unconfirmedEntryId = null;
  const hasPendingChange = () => !!retry || !!conflicting || !!unconfirmedEntryId || unconfirmedOperations.size > 0;
  if(typeof HubServer !== 'undefined') HubServer.guardUpdate?.({isBusy:() => busy, hasDraft:hasPendingChange});
  const reviewButton = typeof HubServer === 'undefined' ? null : document.createElement('button');
  if(reviewButton) {
    reviewButton.type = 'button'; reviewButton.className = 'conn-btn'; reviewButton.textContent = 'Прегледай актуалния запис'; reviewButton.hidden = true;
    retryButton.after(reviewButton);
    reviewButton.addEventListener('click', async () => {
      const attempt = conflicting;
      if(!attempt || busy) return;
      reviewButton.disabled = true;
      try {
        const fields = controls().filter(control => ['INPUT','SELECT','TEXTAREA'].includes(control.tagName) && control.type !== 'file').map(control => ({control,value:control.value,checked:control.checked}));
        const reviewed = await HubServer.reviewRecord(sync(), attempt[3].entryId, () => fields.forEach(({control,value,checked}) => {
          if(control.tagName === 'SELECT' && !Array.from(control.options).some(option => option.value === value)) {
            const option = document.createElement('option'); option.value = value; option.textContent = value; control.append(option);
          }
          control.value = value; control.checked = checked;
        }));
        if(reviewed && conflicting === attempt) {
          attempt[3] = {...attempt[3],action:attempt[3].action === 'create' ? 'update' : attempt[3].action,version:reviewed.version,operationId:crypto.randomUUID()};
          retry = attempt; retryButton.hidden = false; reviewButton.hidden = true;
          message.textContent = 'Версията е прегледана. Натисни „Опитай отново“, за да запазиш черновата.';
        }
      } catch(error) { message.textContent = error.message; }
      finally { reviewButton.disabled = false; }
    });
  }
  function clearRetry() { if(busy) return; retry = null; conflicting = null; retryButton.hidden = true; if(reviewButton) reviewButton.hidden = true; }
  controls().forEach(control => {
    control.addEventListener('input', clearRetry);
    control.addEventListener('change', clearRetry);
  });
  retryButton.addEventListener('click', () => retry && run(...retry));
  function failureMessage(error) {
    if(typeof HubServer !== 'undefined') return error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново със същата чернова.';
    if(error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Няма разрешение за запис. Възстановете достъпа до файла и опитайте отново.';
    if(error.code === 'HUB_DATA') return 'Проверете дали е свързан валиден файл и дали въведените данни са правилни.';
    if(error.code === 'REPORT_CONFLICT') return 'Записът е променен. Опреснете данните преди нов опит.';
    return 'Проверете връзката с файла и опитайте отново.';
  }
  async function run(change, onSuccess, successMessage, operation = null) {
    if(busy) return false;
    busy = true;
    const focused = document.activeElement;
    if(operation && operation.action !== 'create' && !operation.reason) {
      const reason = await HubServer.correctionReason();
      if(reason === null) { busy = false; return false; }
      operation.reason = reason;
    }
    retry = null;
    retryButton.hidden = true;
    if(reviewButton) reviewButton.hidden = true;
    message.textContent = 'Записва се...';
    message.dataset.state = 'pending';
    const locked = controls().map(control => ({control,disabled:control.disabled}));
    const fields = locked.filter(({control}) => ['INPUT','SELECT','TEXTAREA'].includes(control.tagName) && control.type !== 'file')
      .map(({control}) => ({control,value:control.value,checked:control.checked}));
    locked.forEach(({control}) => { control.disabled = true; });
    updateControls();
    let before = clone(getData()), accepted = false, confirmation = '';
    try {
      const connection = sync();
      if(operation && connection.commitOperation) {
        const result = await connection.commitOperation(operation);
        setData(result.data); confirmation = result.message;
      } else {
        if(connection.fileHandle) await connection.refreshFromDisk({fresh:true});
        before = clone(getData());
        const next = change(clone(before));
        if(next) {
          setData(next);
          await connection.commitData();
        }
      }
      accepted = true;
      if(operation) for(const [id,entryId] of unconfirmedOperations) if(entryId === operation.entryId) unconfirmedOperations.delete(id);
    } catch(error) {
      if(operation) unconfirmedOperations.set(operation.operationId,operation.entryId);
      setData(before);
      if(operation?.action === 'create') unconfirmedEntryId = operation.entryId;
      message.textContent = (error.code === 'REPORT_CONFLICT' && operation ? 'Конфликт. ' : operation && error.status && error.status < 500 ? 'Записът не е направен. ' : 'Промяната не е потвърдена. ')+failureMessage(error);
      message.dataset.state = operation ? error.code === 'REPORT_CONFLICT' ? 'conflict' : error.status && error.status < 500 ? 'rejected' : 'unconfirmed' : 'error';
      message.scrollIntoView?.({block:'nearest'});
      if(error.code !== 'REPORT_CONFLICT') retry = [change,onSuccess,successMessage,operation];
      else if(operation) { conflicting = [change,onSuccess,successMessage,operation]; reviewButton.hidden = false; }
    } finally {
      try {
        if(accepted) { conflicting = null; onSuccess(); message.textContent = (confirmation ? confirmation+' ' : '')+successMessage; message.dataset.state = 'success'; }
        busy = false;
        render();
        if(!accepted) fields.forEach(({control,value,checked}) => { control.value = value; control.checked = checked; });
      } finally {
        busy = false;
        locked.forEach(({control,disabled}) => { control.disabled = disabled; });
        updateControls();
        retryButton.hidden = !retry;
        // Disabled controls drop keyboard focus; return it to the retry, the same control or the status.
        const active = document.activeElement, usable = control => !control.disabled && control.checkVisibility();
        if(focused && focused !== document.body && (active === document.body || !usable(active))) (retry ? retryButton : usable(focused) ? focused : message).focus();
      }
    }
    return accepted;
  }
  function conflict() { const error = new Error('Report conflict'); error.code = 'REPORT_CONFLICT'; throw error; }
  const same = (left,right) => Object.keys(right).every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
  return {
    run, clearRetry,
    get busy() { return busy; },
    get hasPendingChange() { return hasPendingChange(); },
    operation(action, entry, version) {
      if(!sync().commitOperation) return null;
      const value = {action,entryId:entry.id,...(action === 'delete' ? {} : {entry}),...(action === 'create' ? {} : {version:version ?? sync().recordVersion(entry.id)})};
      const key = JSON.stringify(value);
      if(!operations.has(key)) operations.set(key,{...clone(value),operationId:crypto.randomUUID()});
      return operations.get(key);
    },
    entry(draft) {
      if(unconfirmedEntryId) return {...draft,id:unconfirmedEntryId};
      const key = JSON.stringify(draft);
      if(!drafts.has(key)) drafts.set(key,{...draft,id:globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)});
      return drafts.get(key);
    },
    confirmEntry(entry) { if(unconfirmedEntryId === entry.id) unconfirmedEntryId = null; for(const [key,value] of drafts) if(value.id === entry.id) drafts.delete(key); },
    append(data,entry) {
      const saved = data.entries.find(row => row.id === entry.id);
      if(saved) { if(!same(saved,entry)) conflict(); return null; }
      return {...data,entries:[...data.entries,entry]};
    },
    remove(data,original) {
      const current = data.entries.find(row => row.id === original.id);
      if(!current) return null;
      if(!same(current,original)) conflict();
      return {...data,entries:data.entries.filter(row => row.id !== original.id)};
    }
  };
}
