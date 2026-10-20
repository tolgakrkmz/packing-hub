const assert = require('node:assert/strict');

async function assertResponsive(page, description) {
  const viewport = page.viewportSize();
  const layout = await page.evaluate(viewport => {
    const width = viewport?.width || document.documentElement.clientWidth;
    const height = viewport?.height || document.documentElement.clientHeight;
    const visible = element => element.checkVisibility() && element.getBoundingClientRect().width > 0;
    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')].filter(visible);
    return {
      width,
      viewport: document.querySelector('meta[name=viewport]')?.content,
      overflow: document.documentElement.scrollWidth > width + 1,
      overflowingElements: [...document.querySelectorAll('body *')].filter(visible).filter(element => {
        if (element.closest('.sched-scroll, .history-month-table, .stats-table-scroll, .import-table-wrap, .task-table-wrap, .chart-wrap, #avTableContainer, #lineShiftContainer, #historyWrap, .ratings-table')) return false;
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > width + 1;
      }).map(element => element.id || element.className).slice(0, 8),
      smallButtons: buttons.filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.height < 43 || rect.width < 43;
      }).map(element => element.id || element.className),
      smallInputs: width <= 600 ? inputs.filter(element => parseFloat(getComputedStyle(element).fontSize) < 16).map(element => element.id) : [],
      clippedDialogs: [...document.querySelectorAll('dialog[open], .modal-backdrop.open .modal-card')].filter(visible).some(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.right > width + 1 || rect.top < 0 || rect.bottom > height + 1;
      })
    };
  }, viewport);
  assert.match(layout.viewport || '', /width=device-width/, description + ': mobile viewport');
  assert.equal(layout.overflow, false, description + ': no page overflow (' + layout.overflowingElements.join(', ') + ')');
  assert.deepEqual(layout.smallButtons, [], description + ': touch button size');
  assert.deepEqual(layout.smallInputs, [], description + ': readable mobile fields');
  assert.equal(layout.clippedDialogs, false, description + ': dialog fits viewport');
}

module.exports = {assertResponsive};
