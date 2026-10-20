/* Required spot-ratings after a pair result. Server version only; nothing is kept in the browser. The report is in Statistics. */
const HubTeamRatings = (() => {
  const $ = id => document.getElementById(id);
  const server = typeof HubServer !== 'undefined';
  const ratings = [['good', '👍', 'Добре'], ['ok', '👌', 'Нормално'], ['poor', '👎', 'Слабо']];
  const reasons = [['', 'Без причина'], ['slow', 'Бавен'], ['scrap', 'Брак'], ['instructions', 'Неспазва указания'], ['away', 'Отсъства от поста'], ['other', 'Друго']];
  let current = null;
  function el(tag, text = '', cls = '') { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
  let asking = false;
  // Called after a pair result and on every pair-access check: an unanswered prompt comes back until every person is rated.
  // Failures stay silent; the rating never alters the pair save itself.
  async function prompt(scope) {
    if (!server || !HubServer.can('canRateTeam') || current || asking || !scope) return;
    let people;
    asking = true;
    try { ({people} = await HubServer.send('/api/team-ratings/prompt', 'POST', {date: scope.date, shiftCode: Number(scope.shiftCode), team: scope.team})); } catch { return; } finally { asking = false; }
    if (!people.length || current || document.querySelector('dialog[open]')) return;
    current = {scope: {date: scope.date, shiftCode: Number(scope.shiftCode), team: scope.team}, people};
    const list = $('ratingPeople'); list.replaceChildren(); $('ratingError').textContent = '';
    people.forEach((person, index) => {
      const set = el('fieldset', '', 'rating-person'), legend = el('legend', person.name); legend.setAttribute('translate', 'no');
      const choices = el('div', '', 'rating-choices');
      for (const [value, icon, label] of ratings) {
        const option = el('label', '', 'rating-choice'), input = el('input');
        input.type = 'radio'; input.name = 'rating-' + index; input.value = value; input.required = true;
        option.append(input, el('span', icon + ' ' + label)); choices.append(option);
      }
      const reason = el('label', 'Причина (по желание)'), select = el('select'); select.name = 'reason-' + index;
      for (const [value, label] of reasons) { const option = el('option', label); option.value = value; select.append(option); }
      reason.append(select); set.append(legend, choices, reason); list.append(set);
    });
    $('ratingDialog').showModal();
  }
  function close() { $('ratingDialog').close(); current = null; }
  async function save(event) {
    event.preventDefault();
    if (!current) return;
    const chosen = current.people.map((person, index) => {
      const rating = $('ratingForm').querySelector(`input[name="rating-${index}"]:checked`)?.value, reason = $('ratingForm').elements['reason-' + index].value;
      return rating && {employeeId: person.id, rating, ...(reason ? {reason} : {})};
    }).filter(Boolean);
    $('ratingSave').disabled = true; $('ratingError').textContent = 'Записва се...';
    try { await HubServer.send('/api/team-ratings', 'POST', {...current.scope, ratings: chosen}); close(); $('pageError').textContent = 'Оценките са записани.'; $('pageError').dataset.state = 'success'; }
    catch (error) { $('ratingError').textContent = error.status ? error.message : 'Връзката със сървъра е прекъсната. Опитай отново.'; }
    finally { $('ratingSave').disabled = false; }
  }
  if (server) {
    $('ratingForm').addEventListener('submit', save);
    // Rating is required: Escape does not close the dialog.
    $('ratingDialog').addEventListener('cancel', event => event.preventDefault());
  }
  return {prompt};
})();
