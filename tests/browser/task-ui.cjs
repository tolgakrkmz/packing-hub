/* Shared steps for the tasks page: the per-card menu and the quick report buttons. */
const taskCard = (page, title) => page.locator('.task-card').filter({has: page.locator('h2', {hasText: title})});
async function menuAction(card, name) {
  await card.locator('.task-more summary').click();
  await card.locator('.task-menu').getByRole('button', {name, exact: true}).click();
}
// Steps the month picker until it shows the wanted month, e.g. 'Декември 2026'.
async function showMonth(page, label) {
  for (let step = 0; step < 24 && (await page.locator('#monthLabel').textContent()) !== label; step++) {
    const [year, month] = label.split(' ').reverse(), names = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
    const [shownName, shownYear] = (await page.locator('#monthLabel').textContent()).split(' ');
    const later = Number(shownYear) * 12 + names.indexOf(shownName) > Number(year) * 12 + names.indexOf(month);
    await page.locator(later ? '#monthPrev' : '#monthNext').click();
  }
}
module.exports = {taskCard, menuAction, showMonth};
