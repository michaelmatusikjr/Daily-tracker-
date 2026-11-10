import { h, iconBtn, makeSortable, emptyState, sectionHead } from '../ui.js';
import { icon } from '../icons.js';
import { getState } from '../store.js';
import { ctx } from '../ctx.js';
import { activeHabits, streaks, scheduleLabel, habitVal, habitTarget } from '../logic.js';
import { todayKey, weekdayLabels } from '../dates.js';
import { habitControl, weekDots, streakBadge } from './widgets.js';
import { reorderHabits, setArchived, seedExamples, bumpHabit } from '../actions.js';
import { openHabitForm } from '../forms.js';

const GROUPS = [['morning', 'Morning', '🌅'], ['afternoon', 'Afternoon', '☀️'], ['evening', 'Evening', '🌙'], ['anytime', 'Anytime', '✨']];

export function renderHabits() {
  const st = getState();
  const today = todayKey();
  const habits = activeHabits(st);
  const archived = st.habits.filter((x) => x.archived);
  const reorder = ctx.ui.habitsReorder && habits.length > 1;
  const root = h('div.view.view-habits');
  const dayNames = weekdayLabels('short');

  root.append(h('header.page-head',
    h('div.page-head-text', h('p.eyebrow', habits.length ? `${habits.length} active` : 'Build routines'), h('h1.page-title', 'Habits')),
    h('div.head-actions',
      habits.length > 1 ? h(`button.chip-btn${reorder ? '.active' : ''}`, {
        type: 'button', 'aria-pressed': String(reorder), onclick: () => { ctx.ui.habitsReorder = !reorder; ctx.rerender(); },
      }, icon(reorder ? 'check' : 'reorder', { size: 16 }), reorder ? 'Done' : 'Reorder') : null,
      iconBtn('plus', 'New habit', () => openHabitForm(null), 'accent'))));

  if (!habits.length) {
    root.append(h('section.card', emptyState('🌱', 'No habits yet',
      'Small daily actions add up. Start with one habit you can do in two minutes.',
      h('div.empty-actions',
        h('button.btn.primary', { type: 'button', onclick: () => openHabitForm(null) }, icon('plus', { size: 18 }), 'Create a habit'),
        h('button.btn.secondary', { type: 'button', onclick: () => seedExamples() }, icon('sparkles', { size: 18 }), 'Add examples')))));
  }

  const card = (hb) => {
    const s = streaks(st, hb, today);
    const v = habitVal(st, hb, today);
    const target = habitTarget(hb);
    const sub = [scheduleLabel(hb, dayNames)];
    if (hb.goal.type === 'count') sub.push(`${target}${hb.goal.unit ? ' ' + hb.goal.unit : ''} a day`);
    const li = h('li.habit-card', { dataset: { id: hb.id }, style: { '--c': hb.color } },
      h('div.habit-card-top',
        h('button.habit-open', { type: 'button', onclick: () => ctx.go('habit/' + hb.id), 'aria-label': `Open ${hb.name}` },
          h('span.emoji-bubble', { 'aria-hidden': 'true' }, hb.emoji),
          h('span.habit-row-text',
            h('span.habit-name', hb.name),
            h('span.habit-sub', h('span.sub-text', sub.join(' · '))))),
        reorder
          ? h('button.drag-handle', { type: 'button', 'data-fk': 'dh-' + hb.id, 'aria-label': `Reorder ${hb.name} (use arrow keys)` }, icon('grip', { size: 20 }))
          : h('div.habit-actions',
            hb.goal.type === 'count' && v > 0 ? iconBtn('minus', `Remove one from ${hb.name}`, () => bumpHabit(hb.id, today, -1), 'minus-btn') : null,
            habitControl(hb, today))));
    if (!reorder) {
      li.append(h('div.habit-card-bottom',
        weekDots(hb, today),
        h('div.streaks',
          streakBadge(s) || h('span.streak.zero', '🔥 0'),
          h('span.best', { title: 'Best streak' }, icon('trophy', { size: 13 }), String(s.best), s.unit === 'week' ? ' wk' : ''))));
    }
    return li;
  };

  if (habits.length) {
    if (reorder) {
      const list = h('ul.habit-list');
      habits.forEach((hb) => list.append(card(hb)));
      makeSortable(list, { onReorder: (ids) => reorderHabits(ids) });
      root.append(h('p.hint-line', 'Drag the handles (or focus one and use arrow keys) to reorder.'), list);
    } else {
      const useGroups = habits.some((x) => x.timeOfDay !== 'anytime');
      for (const [key, label, emo] of GROUPS) {
        const items = useGroups ? habits.filter((x) => x.timeOfDay === key) : (key === 'anytime' ? habits : []);
        if (!items.length) continue;
        const list = h('ul.habit-list');
        items.forEach((hb) => list.append(card(hb)));
        root.append(h('section.section', useGroups ? sectionHead(`${emo} ${label}`) : null, list));
      }
    }
  }

  if (archived.length) {
    const open = ctx.ui.showArchived;
    const sec = h('section.section.archived',
      h('button.collapse-btn', { type: 'button', 'aria-expanded': String(open), onclick: () => { ctx.ui.showArchived = !open; ctx.rerender(); } },
        icon('archive', { size: 16 }), `Archived (${archived.length})`, h('span.chev', icon('chevronDown', { size: 16 }))));
    if (open) {
      sec.append(h('ul.archived-list', archived.map((hb) => h('li.archived-item',
        h('button.habit-open', { type: 'button', onclick: () => ctx.go('habit/' + hb.id) },
          h('span.emoji-bubble.small', { style: { '--c': hb.color }, 'aria-hidden': 'true' }, hb.emoji), h('span.habit-name', hb.name)),
        h('button.btn.small.secondary', { type: 'button', onclick: () => setArchived(hb.id, false) }, 'Restore')))));
    }
    root.append(sec);
  }
  return root;
}
