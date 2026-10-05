/* Test-only picker adapter. Native OPFS handles, streams and IndexedDB remain real Chrome APIs. */
function installStorage({fallback = false} = {}) {
  if (!/^https?:$/.test(location.protocol)) return;
  async function directory(parts, create = false) {
    let handle = await navigator.storage.getDirectory();
    for (const part of parts) handle = await handle.getDirectoryHandle(part, {create});
    return handle;
  }
  async function file(name, create = false) {
    const parts = name.split('/');
    const leaf = parts.pop();
    return (await directory(parts, create)).getFileHandle(leaf, {create});
  }
  async function write(name, value) {
    const stream = await (await file(name, true)).createWritable();
    await stream.write(typeof value === 'string' ? value : JSON.stringify(value));
    await stream.close();
  }
  window.__browserTest = {
    nextFile: '', nextDirectory: '', fault: null,
    write,
    async read(name) { return JSON.parse(await (await (await file(name)).getFile()).text()); },
    async text(name) { return (await (await file(name)).getFile()).text(); }
  };
  window.__browserTest.ready = (async () => {
    try { await file('initialized'); return; } catch {}
    await write('production-log.json', {entries: [], goalTons: 10});
    await write('line-downtime.json', {entries: [], reasons: ['Тестов престой', 'Друго']});
    await write('personnel.json', {schemaVersion: 3, employees: [], settings: {stickersStage1: 1, stickersStage2: 2}, moveLog: []});
    await write('pair-targets.json', {module: 'pair-targets', schemaVersion: 1, entries: []});
    await write('packing/data/package-instructions.json', {});
    await write('initialized', 'fictional browser test');
  })();
  window.showOpenFilePicker = async () => {
    await window.__browserTest.ready;
    const name = window.__browserTest.nextFile;
    if (name === 'cancel') throw new DOMException('Test cancellation', 'AbortError');
    return [await file(name)];
  };
  window.showSaveFilePicker = async options => {
    await window.__browserTest.ready;
    return file(window.__browserTest.nextFile || options.suggestedName, true);
  };
  window.showDirectoryPicker = async () => {
    await window.__browserTest.ready;
    return directory((window.__browserTest.nextDirectory || 'packing').split('/'), true);
  };
  const original = FileSystemFileHandle.prototype.createWritable;
  const getFile = FileSystemFileHandle.prototype.getFile;
  FileSystemFileHandle.prototype.getFile = async function (...args) {
    const fault = window.__browserTest.fault;
    if (fault?.file === this.name && fault.stage === 'read') {
      window.__browserTest.fault = null;
      throw new DOMException('Synthetic read failure', 'NotAllowedError');
    }
    return getFile.apply(this, args);
  };
  FileSystemFileHandle.prototype.createWritable = async function (...args) {
    const fault = window.__browserTest.fault;
    if (!fault || fault.file !== this.name) return original.apply(this, args);
    window.__browserTest.fault = null;
    if (fault.stage === 'open') throw new DOMException('Synthetic write failure', 'NotAllowedError');
    const stream = await original.apply(this, args);
    const close = stream.close.bind(stream);
    stream.close = async () => {
      await close();
      throw new DOMException('Synthetic acknowledgement failure', 'AbortError');
    };
    return stream;
  };
  if (fallback) delete window.showOpenFilePicker;
}
module.exports = {installStorage};
