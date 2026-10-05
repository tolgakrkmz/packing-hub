/* Recover failed local writes and keep a report's identity across retries. */
function createReportWriter({sync, getData, setData, render, updateControls, controls, message, retryButton}) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const drafts = new Map();
  let busy = false, retry = null;
  function clearRetry() { if(busy) return; retry = null; retryButton.hidden = true; }
  controls().forEach(control => {
    control.addEventListener('input', clearRetry);
    control.addEventListener('change', clearRetry);
  });
  retryButton.addEventListener('click', () => retry && run(...retry));
  function failureMessage(error) {
    if(error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Няма разрешение за запис. Възстановете достъпа до файла и опитайте отново.';
    if(error.code === 'HUB_DATA') return 'Проверете дали е свързан валиден файл и дали въведените данни са правилни.';
    if(error.code === 'REPORT_CONFLICT') return 'Записът е променен. Опреснете данните преди нов опит.';
    return 'Проверете връзката с файла и опитайте отново.';
  }
  async function run(change, onSuccess, successMessage) {
    if(busy) return false;
    busy = true;
    retry = null;
    retryButton.hidden = true;
    message.textContent = 'Записва се...';
    message.dataset.state = 'pending';
    const locked = controls().map(control => ({control,disabled:control.disabled}));
    const fields = locked.filter(({control}) => ['INPUT','SELECT','TEXTAREA'].includes(control.tagName) && control.type !== 'file')
      .map(({control}) => ({control,value:control.value,checked:control.checked}));
    locked.forEach(({control}) => { control.disabled = true; });
    updateControls();
    let before = clone(getData()), accepted = false;
    try {
      const connection = sync();
      if(connection.fileHandle) await connection.refreshFromDisk();
      before = clone(getData());
      const next = change(clone(before));
      if(next) {
        setData(next);
        await connection.commitData();
      }
      accepted = true;
    } catch(error) {
      setData(before);
      message.textContent = 'Промяната не е потвърдена. '+failureMessage(error);
      message.dataset.state = 'error';
      message.scrollIntoView?.({block:'nearest'});
      if(error.code !== 'REPORT_CONFLICT') retry = [change,onSuccess,successMessage];
    } finally {
      try {
        if(accepted) { onSuccess(); message.textContent = successMessage; message.dataset.state = 'success'; }
        busy = false;
        render();
        if(!accepted) fields.forEach(({control,value,checked}) => { control.value = value; control.checked = checked; });
      } finally {
        busy = false;
        locked.forEach(({control,disabled}) => { control.disabled = disabled; });
        updateControls();
        retryButton.hidden = !retry;
      }
    }
    return accepted;
  }
  function conflict() { const error = new Error('Report conflict'); error.code = 'REPORT_CONFLICT'; throw error; }
  const same = (left,right) => Object.keys(right).every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
  return {
    run, clearRetry,
    get busy() { return busy; },
    entry(draft) {
      const key = JSON.stringify(draft);
      if(!drafts.has(key)) drafts.set(key,{...draft,id:globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)});
      return drafts.get(key);
    },
    confirmEntry(entry) { for(const [key,value] of drafts) if(value.id === entry.id) drafts.delete(key); },
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
