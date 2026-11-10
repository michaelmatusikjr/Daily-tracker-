import { h, iconBtn, onSwipe } from '../ui.js';
import { getState } from '../store.js';
import { ctx } from '../ctx.js';
import { dayProgress, tasksOn, isTaskDone, moodEmoji, PRIORITIES } from '../logic.js';
import { todayKey, addDays, addMonths, startOfWeek, monthStart, daysInMonth, fmtMonthYear, fmtDateLong, weekdayLabels } from '../dates.js';

export function renderCalendar() {
  const st = getState();
  const today = todayKey();
  const m = ctx.ui.calMonth || monthStart(today);
  const ws = st.settings.weekStart;
  const [y, mo] = m.split('-').map(Number);
  const dim = daysInMonth(y, mo - 1);
  const first = startOfWeek(m, ws);
  const last = addDays(startOfWeek(addDays(m, dim - 1), ws), 6);
  const setM = (n) => { ctx.ui.calMonth = addMonths(m, n); ctx.rerender(); };
  const root = h('div.view.view-calendar');

  root.append(h('header.page-head',
    h('div.page-head-text', h('p.eyebrow', 'Calendar'), h('h1.page-title', fmtMonthYear(m))),
    h('div.head-actions',
      m !== monthStart(today) ? h('button.chip-btn', { type: 'button', onclick: () => { ctx.ui.calMonth = monthStart(today); ctx.rerender(); } }, 'Today') : null,
      iconBtn('chevronLeft', 'Previous month', () => setM(-1)),
      iconBtn('chevronRight', 'Next month', () => setM(1)))));

  const names = weekdayLabels('short');
  const grid = h('div.cal-grid', { role: 'grid', 'aria-label': fmtMonthYear(m) });
  for (let i = 0; i < 7; i++) grid.append(h('span.cal-head', { 'aria-hidden': 'true' }, names[(ws + i) % 7].slice(0, 2)));
  let monthTasks = 0, monthDone = 0, moodDays = 0;
  for (let k = first; k <= last; k = addDays(k, 1)) {
    const inMonth = k.slice(0, 7) === m.slice(0, 7);
    const p = dayProgress(st, k);
    const tasks = tasksOn(st, k);
    const mood = st.journal[k]?.mood;
    if (inMonth && k <= today) { monthTasks += p.total; monthDone += p.done; }
    if (inMonth && st.journal[k]) moodDays++;
    const intensity = k <= today && p.habits.total ? p.habits.pct : 0;
    const dots = tasks.slice(0, 3).map((t) => {
      const cat = t.category && st.categories.find((c) => c.id === t.category);
      return h(`span.cal-dot${isTaskDone(t, k) ? '.done' : ''}`, { style: { background: cat ? cat.color : t.priority ? PRIORITIES[t.priority].color : 'var(--accent)' } });
    });
    const label = `${fmtDateLong(k)}. ${tasks.length} task${tasks.length === 1 ? '' : 's'}${p.habits.total ? `, ${p.habits.done} of ${p.habits.total} habits done` : ''}${mood ? ', mood ' + ['awful', 'bad', 'okay', 'good', 'great'][mood - 1] : ''}`;
    grid.append(h(`button.cal-day${inMonth ? '' : '.outside'}${k === today ? '.today' : ''}${k === ctx.ui.date ? '.selected' : ''}${p.total && p.pct === 1 && k <= today ? '.perfect' : ''}`, {
      type: 'button', 'aria-label': label, style: { '--i': intensity.toFixed(2) },
      onclick: () => { ctx.setDate(k); ctx.go('today'); },
    },
    h('span.cal-num', String(Number(k.slice(8)))),
    mood ? h('span.cal-mood', { 'aria-hidden': 'true' }, moodEmoji(mood)) : null,
    tasks.length ? h('span.cal-dots', { 'aria-hidden': 'true' }, dots, tasks.length > 3 ? h('span.cal-more', '+') : null) : null));
  }
  const card = h('section.card.cal-card.no-swipe', grid);
  onSwipe(card, { left: () => setM(1), right: () => setM(-1) });
  root.append(card);

  root.append(h('div.cal-legend', { 'aria-hidden': 'true' },
    h('span', h('i.lg-swatch'), 'Habit completion'),
    h('span', h('i.lg-dot'), 'Task'),
    h('span', '🙂 Mood')));

  root.append(h('section.stat-grid.three',
    h('div.stat-card', h('span.stat-value', String(monthDone)), h('span.stat-label', 'Items completed')),
    h('div.stat-card', h('span.stat-value', monthTasks ? Math.round((monthDone / monthTasks) * 100) + '%' : '—'), h('span.stat-label', 'Completion')),
    h('div.stat-card', h('span.stat-value', String(moodDays)), h('span.stat-label', 'Days journaled'))));
  root.append(h('p.hint-line', 'Tap a day to open its agenda. Swipe to change months.'));
  return root;
}
