/* Modules resolve links only against data already authorized for this account. */
window.HubNotificationTarget = (() => {
  const raw = new URLSearchParams(location.search).get('target');
  const id = raw && raw.length <= 1000 ? raw : null;
  let pending = !!id, scrolled = false, focusedNode;
  function select(records, key, choose) {
    if (!pending) return;
    pending = false;
    const record = records.find(value => String(key(value)) === id);
    if (record) { choose(record); return record; }
    const message = document.createElement('p');
    message.id = 'notificationTargetMessage'; message.className = 'notification-target-message';
    message.setAttribute('role', 'status');
    const copy = document.createElement('span'); copy.textContent = 'Записът от известието е изтрит или вече не е достъпен.';
    const back = document.createElement('a'); back.href = '/notifications'; back.textContent = 'Към известията';
    message.append(copy, back); document.querySelector('main, .wrap')?.prepend(message);
  }
  function reveal(container = document) {
    if (!id) return;
    const node = [...container.querySelectorAll('[data-notification-target]')].find(value => value.dataset.notificationTarget === id);
    if (!node) return;
    node.classList.add('notification-target'); node.tabIndex = -1;
    if (scrolled) {
      // A second source can finish loading after the first render. Restore
      // focus only when replacing our focused record left it on the body.
      if (focusedNode && !focusedNode.isConnected && document.activeElement === document.body) { node.focus({preventScroll: true}); focusedNode = node; }
      return;
    }
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    requestAnimationFrame(() => {
      if (!node.isConnected || !node.checkVisibility() || scrolled) return;
      scrolled = true; node.focus({preventScroll: true}); focusedNode = node; node.scrollIntoView({block: 'center', behavior: 'instant'});
    });
  }
  return {id, select, reveal};
})();
