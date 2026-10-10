/* Account-specific device invitation; browser permission is requested only on a click. */
((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.HubNotificationPrompt = model;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const WEEK = 7 * 86400000;
  function load(storage, key) {
    try { const value = JSON.parse(storage.getItem(key)); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
  }
  function create({storage, sessionStorage, accountId, now = Date.now}) {
    const key = 'portfolio-hub-notification-prompt:' + accountId;
    let local = load(storage, key), shown = false;
    const save = () => { try { storage.setItem(key, JSON.stringify(local)); } catch {} };
    function eligible({configured, allowed, supported, subscribed, visible, busy}) {
      const fresh = load(storage, key); if (Object.keys(fresh).length) local = fresh;
      const session = load(sessionStorage, key);
      return configured && allowed && supported && !subscribed && visible && !busy && !shown && !session.shown && !local.never &&
        (!Number.isFinite(local.nextAt) || now() >= local.nextAt);
    }
    function shownNow() {
      shown = true; local.nextAt = now() + WEEK; save();
      try { sessionStorage.setItem(key, JSON.stringify({shown: true})); } catch {}
    }
    function defer() { local.nextAt = now() + WEEK; save(); }
    function never() { local.never = true; save(); }
    function reset() { local.never = false; local.nextAt = now() + WEEK; save(); }
    function muted() { return local.never === true; }
    return {eligible, shownNow, defer, never, reset, muted};
  }
  return {create, WEEK};
});
