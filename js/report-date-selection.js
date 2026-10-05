/* Automatic reporting dates follow the selected team until the user chooses a date. */
function createReportDateSelection({dateInput, dateHint, yesterdayButton, onChange, now = () => new Date(), hourOverride = null}) {
  let manual = false;
  const localDate = date => date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  const previousDate = date => {
    const previous = new Date(date);
    previous.setDate(previous.getDate()-1);
    return localDate(previous);
  };
  function automatic(shift) {
    if(manual) return;
    const at = now();
    const override = Number(hourOverride);
    const validOverride = hourOverride !== null && String(hourOverride).trim() && Number.isInteger(override) && override >= 0 && override < 24;
    const hour = validOverride ? override : at.getHours();
    const delayedNight = shift !== 'СТИКЕРИ' && hour < 10;
    dateInput.value = delayedNight ? previousDate(at) : localDate(at);
    dateHint.textContent = delayedNight ? '🌙 Избрана е вчерашна дата (нощна смяна) — провери дали е вярно.' : '';
  }
  const chooseManually = () => {
    manual = true;
    dateHint.textContent = '';
    onChange();
  };
  dateInput.addEventListener('input', chooseManually);
  dateInput.addEventListener('change', chooseManually);
  yesterdayButton.addEventListener('click', () => {
    dateInput.value = previousDate(now());
    chooseManually();
  });
  automatic(null);
  return {selectShift(shift) { automatic(shift); onChange(); }};
}
