/* Shared presentation controls; all filtering and totals stay with each module. */
window.HubListPagination = (() => {
  const clamp = (page, total, size) => Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / size)));
  function create({id, page, total, size, onChange}) {
    const english = typeof HubI18n !== 'undefined' && HubI18n.language === 'en', pages = Math.max(1, Math.ceil(total / size));
    const nav = document.createElement('nav'); nav.id = id; nav.className = 'hub-pagination';
    nav.dataset.total = total;
    nav.setAttribute('translate', 'no'); nav.setAttribute('aria-label', english ? 'Result pages' : 'Страници с резултати');
    const status = document.createElement('span'); status.className = 'hub-page-status'; status.tabIndex = -1;
    status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    const first = total ? (page - 1) * size + 1 : 0, last = Math.min(page * size, total);
    status.textContent = english ? `${first}–${last} of ${total} · Page ${page} of ${pages}` : `${first}–${last} от ${total} · Страница ${page} от ${pages}`;
    function control(action, label, nextPage, disabled) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
      button.textContent = label; button.dataset.pageAction = action; button.disabled = disabled;
      button.addEventListener('click', () => {
        onChange(nextPage);
        const replacement = document.getElementById(id), next = replacement?.querySelector(`[data-page-action="${action}"]`);
        (next && !next.disabled ? next : replacement?.querySelector('.hub-page-status'))?.focus();
      });
      return button;
    }
    nav.append(control('previous', english ? 'Previous' : 'Предишна', page - 1, page === 1), status,
      control('next', english ? 'Next' : 'Следваща', page + 1, page === pages));
    return nav;
  }
  return {clamp, create};
})();
