const assert = require('node:assert/strict');

async function assertResponsive(page, description) {
  const layout = await page.evaluate(() => {
    const visible = element => element.checkVisibility() && element.getBoundingClientRect().width > 0;
    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')].filter(visible);
    return {
      width: innerWidth,
      viewport: document.querySelector('meta[name=viewport]')?.content,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      overflowingElements: [...document.querySelectorAll('body *')].filter(visible).filter(element => {
        if (element.closest('.sched-scroll, .history-month-table, .stats-table-scroll, .import-table-wrap, .chart-wrap, #avTableContainer, #lineShiftContainer, #historyWrap')) return false;
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 1;
      }).map(element => element.id || element.className).slice(0, 8),
      smallButtons: buttons.filter(element => element.getBoundingClientRect().height < 43).map(element => element.id || element.className),
      smallInputs: innerWidth <= 600 ? inputs.filter(element => parseFloat(getComputedStyle(element).fontSize) < 16).map(element => element.id) : [],
      clippedDialogs: [...document.querySelectorAll('dialog[open], .modal-backdrop.open .modal-card')].filter(visible).some(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.right > innerWidth + 1 || rect.top < 0 || rect.bottom > innerHeight + 1;
      })
    };
  });
  assert.match(layout.viewport || '', /width=device-width/, description + ': mobile viewport');
  assert.equal(layout.overflow, false, description + ': no page overflow (' + layout.overflowingElements.join(', ') + ')');
  assert.deepEqual(layout.smallButtons, [], description + ': touch button height');
  assert.deepEqual(layout.smallInputs, [], description + ': readable mobile fields');
  assert.equal(layout.clippedDialogs, false, description + ': dialog fits viewport');
}

module.exports = {assertResponsive};
