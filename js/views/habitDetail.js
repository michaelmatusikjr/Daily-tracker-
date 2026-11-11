import { h, iconBtn, confirmDialog, onSwipe } from '../ui.js';
import { icon } from '../icons.js';
import { getState } from '../store.js';
import { ctx } from '../ctx.js';
import { streaks, completionRate, totalCompletions, scheduleLabel, habitVal, habitTarget, isScheduled, habitStart } from '../logic.js';
import { todayKey, addDays, startOfWeek, fromKey, fmtDateShort, fmtMonthYear, monthStart, addMonths, daysInMonth, weekdayLabels, fmt, fmtTime } from '../dates.js';
import { habitControl } from './widgets.js';
import { setArchived, deleteHabit, toggleHabitDay } from '../actions.js';
import { openHabitForm } from '../forms.js';

const pct = (r) => (r === null ? '—' : Math.round(r * 100) + '%');

export function renderHabitDetail(id) {
  const st = getState();
  const hb = st.habits.find((x) => x.id === id);
  const root = h('div.view.view-detail');
  if (!hb) {
    root.append(h('div.card', h('p', 'This habit no longer exists.'), h('a.btn.secondary', { href: '#habits' }, 'Back to habits')));
    return root;
  }
  const today = todayKey();
  const s = streaks(st, hb, today);
  const v = habitVal(st, hb, today);
  const target = habitTarget(hb);
  const dayNames = weekdayLabels('short');

  root.append(h('header.page-head.detail-head',
    iconBtn('arrowLeft', 'Back to habits', () => ctx.go('habits')),
    h('div.page-head-text', { style: { '--c': hb.color } },
      h('p.eyebrow', scheduleLabel(hb, dayNames) + (hb.archived ? ' · Archived' : '')),
      h('h1.page-title', h('span.title-emoji', { 'aria-hidden': 'true' }, hb.emoji), ' ', hb.name)),
    iconBtn('edit', 'Edit habit', () => openHabitForm(hb))));

  // Hero: today's control
  const status = v >= target ? 'Done for today' : hb.goal.type === 'count' ? `${v} of ${target}${hb.goal.unit ? ' ' + hb.goal.unit : ''} today` : 'Not done yet today';
  root.append(h('section.card.detail-hero', { style: { '--c': hb.color } },
    habitControl(hb, today, { big: true }),
    h('div',
      h('p.progress-big', status),
      h('p.progress-sub', hb.goal.type === 'count' ? 'Tap to add one · long-press to remove one' : 'Tap to toggle today'),
      hb.reminder ? h('p.progress-break', h('span', icon('bell', { size: 13 }), 'Reminder at ' + fmtTime(hb.reminder, st.settings.timeFormat))) : null)));

  const unit = s.unit === 'week' ? 'weeks' : 'days';
  root.append(h('section.stat-grid',
    statCard('🔥', String(s.current), `Current streak (${unit})`),
    statCard('🏆', String(s.best), `Best streak (${unit})`),
    statCard('📅', pct(completionRate(st, hb, 30, today)), 'Last 30 days'),
    statCard('📈', pct(completionRate(st, hb, null, today)), 'All time'),
    statCard('✅', String(totalCompletions(st, hb)), 'Total completions')));

  root.append(heatmap(hb));
  root.append(monthCalendar(hb));

  root.append(h('section.detail-actions',
    h('button.btn.secondary', { type: 'button', onclick: () => setArchived(hb.id, !hb.archived) }, icon('archive', { size: 18 }), hb.archived ? 'Restore habit' : 'Archive habit'),
    h('button.btn.danger-ghost', {
      type: 'button',
      onclick: async () => {
        if (await confirmDialog('Delete habit?', `“${hb.name}” and all of its history will be removed.`, { ok: 'Delete', danger: true })) {
          ctx.go('habits');
          deleteHabit(hb.id);
        }
      },
    }, icon('trash', { size: 18 }), 'Delete')));
  return root;
}

function statCard(emoji, value, label) {
  return h('div.stat-card', h('span.stat-emoji', { 'aria-hidden': 'true' }, emoji), h('span.stat-value', value), h('span.stat-label', label));
}

function heatmap(hb) {
  const st = getState();
  const today = todayKey();
  const ws = st.settings.weekStart;
  const start = startOfWeek(addDays(today, -52 * 7), ws);
  const target = habitTarget(hb);
  const hs = habitStart(st, hb);
  const grid = h('div.heatmap', { 'aria-hidden': 'true', style: { '--c': hb.color } });
  const months = h('div.heatmap-months', { 'aria-hidden': 'true' });
  let weekIdx = 0, lastMonth = null;
  for (let w = start; w <= today; w = addDays(w, 7), weekIdx++) {
    const m = fromKey(w).getMonth();
    if (m !== lastMonth) {
      months.append(h('span', { style: { gridColumn: String(weekIdx + 1) } }, fmt(w, { month: 'short' })));
      lastMonth = m;
    }
    for (let i = 0; i < 7; i++) {
      const k = addDays(w, i);
      if (k > today) { grid.append(h('span.hm.future')); continue; }
      const v = habitVal(st, hb, k);
      const level = v <= 0 ? 0 : v >= target ? 4 : Math.max(1, Math.min(3, Math.ceil((v / target) * 3)));
      const off = hb.schedule.type === 'days' && !isScheduled(hb, k);
      grid.append(h(`span.hm.l${level}${off ? '.off' : ''}${k < hs ? '.pre' : ''}`, { title: `${fmtDateShort(k)}: ${v >= target ? 'done' : v ? `${v}/${target}` : off ? 'not scheduled' : 'not done'}` }));
    }
  }
  const dl = weekdayLabels('short');
  const labels = h('div.heatmap-days', { 'aria-hidden': 'true' }, Array.from({ length: 7 }, (_, i) => h('span', i % 2 ? dl[(ws + i) % 7] : '')));
  const scroller = h('div.heatmap-scroll.no-swipe', h('div.heatmap-inner', months, grid));
  const total = Object.values(st.logs[hb.id] || {}).filter((x) => x >= target).length;
  requestAnimationFrame(() => { scroller.scrollLeft = scroller.scrollWidth; });
  return h('section.card.heatmap-card',
    h('div.section-head', h('h2.section-title', 'Past year'), h('span.muted.small', `${total} completions`)),
    h('p.sr-only', `Heatmap of the past year: ${total} days completed.`),
    h('div.heatmap-wrap', labels, scroller),
    h('div.heatmap-legend', { 'aria-hidden': 'true' }, 'Less', [0, 1, 2, 3, 4].map((l) => h(`span.hm.l${l}`, { style: { '--c': hb.color } })), 'More'));
}

function monthCalendar(hb) {
  const st = getState();
  const today = todayKey();
  if (!ctx.ui.detailMonth || ctx.ui.detailHabit !== hb.id) { ctx.ui.detailMonth = monthStart(today); ctx.ui.detailHabit = hb.id; }
  const m = ctx.ui.detailMonth;
  const ws = st.settings.weekStart;
  const [y, mo] = m.split('-').map(Number);
  const dim = daysInMonth(y, mo - 1);
  const first = startOfWeek(m, ws);
  const target = habitTarget(hb);
  const names = weekdayLabels('narrow');
  const grid = h('div.mini-cal', { role: 'grid', 'aria-label': fmtMonthYear(m) });
  for (let i = 0; i < 7; i++) grid.append(h('span.mc-head', { 'aria-hidden': 'true' }, names[(ws + i) % 7]));
  const end = addDays(m, dim - 1);
  const last = addDays(startOfWeek(end, ws), 6);
  for (let k = first; k <= last; k = addDays(k, 1)) {
    if (k.slice(0, 7) !== m.slice(0, 7)) { grid.append(h('span.mc-day.outside', { 'aria-hidden': 'true' })); continue; }
    const v = habitVal(st, hb, k);
    const done = v >= target;
    const off = hb.schedule.type === 'days' && !isScheduled(hb, k);
    grid.append(h(`button.mc-day${done ? '.done' : ''}${v && !done ? '.partial' : ''}${off ? '.off' : ''}${k === today ? '.today' : ''}`, {
      type: 'button', disabled: k > today, style: { '--c': hb.color },
      'aria-pressed': String(done), 'aria-label': `${fmtDateShort(k)}: ${done ? 'done' : 'not done'}`,
      onclick: () => toggleHabitDay(hb.id, k),
    }, String(Number(k.slice(8)))));
  }
  const setM = (n) => { ctx.ui.detailMonth = addMonths(m, n); ctx.rerender(); };
  const card = h('section.card',
    h('div.section-head',
      h('h2.section-title', fmtMonthYear(m)),
      h('div.head-actions', iconBtn('chevronLeft', 'Previous month', () => setM(-1)), iconBtn('chevronRight', 'Next month', () => setM(1)))),
    grid,
    h('p.field-hint', 'Tap a day to mark it done or not done.'));
  onSwipe(card, { left: () => setM(1), right: () => setM(-1) });
  return card;
}
