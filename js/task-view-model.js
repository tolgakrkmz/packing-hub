/* Decides where each task appears on the tasks page. No DOM and no storage. */
const TaskViewModel = (() => {
  const DONE = ['completed'], MISSED = ['not-done', 'not-applicable', 'cancelled'];
  // Every task has one tab; open tasks also have one group, in the order shown on the page.
  function place(item, now, canReview) {
    if (DONE.includes(item.status)) return {tab: 'done', group: null};
    if (MISSED.includes(item.status)) return {tab: 'missed', group: null};
    if (item.status === 'review' && canReview) return {tab: 'open', group: 'confirm'};
    if (item.kind === 'global') return {tab: 'open', group: 'deadline'};
    if (item.displayStatus === 'unreported') return {tab: 'open', group: 'unreported'};
    return {tab: 'open', group: now < item.shift.start ? 'upcoming' : 'shift'};
  }
  const formatters = new Map();
  function monthOf(item, timezone) {
    if (item.kind === 'shift') return item.shift.date.slice(0, 7);
    if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit'}));
    return formatters.get(timezone).format(new Date(item.due)).slice(0, 7);
  }
  function addMonths(month, count) {
    const [year, value] = month.split('-').map(Number), total = year * 12 + value - 1 + count;
    return `${Math.floor(total / 12)}-${String(total % 12 + 1).padStart(2, '0')}`;
  }
  // A shift counts once it is reported, or once its grace period ends without a report.
  function counted(items, month, timezone, now, graceMs) {
    return items.filter(item => item.kind === 'shift' && monthOf(item, timezone) === month && !['cancelled', 'not-applicable'].includes(item.status)
      && (item.status !== 'pending' || item.due + graceMs < now));
  }
  function totals(items) {
    const done = items.filter(item => item.status === 'completed').length, failed = items.filter(item => item.status === 'not-done' || item.displayStatus === 'unreported').length;
    return {done, failed, total: items.length, pct: items.length ? Math.round(done / items.length * 100) : 0};
  }
  const monthSummary = (items, ...rest) => totals(counted(items, ...rest));
  function byOwner(items, ...rest) {
    const owners = new Map();
    for (const item of counted(items, ...rest)) owners.set(item.owner.id, [...(owners.get(item.owner.id) || []), item]);
    return [...owners].map(([id, list]) => ({id, username: list[0].owner.username, ...totals(list)})).sort((a, b) => a.username.localeCompare(b.username));
  }
  return {place, monthOf, addMonths, monthSummary, byOwner};
})();
if (typeof module !== 'undefined') module.exports = TaskViewModel;
