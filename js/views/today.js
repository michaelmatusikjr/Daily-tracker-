import { h, iconBtn, ring, onSwipe, makeSortable, emptyState, sectionHead } from '../ui.js';
import { icon } from '../icons.js';
import { getState } from '../store.js';
import { ctx } from '../ctx.js';
import { dayProgress, tasksOn, splitTasks, overdueTasks, activeHabits, isDueOn, habitStart, streaks, habitVal, habitTarget, MOODS, weekCount } from '../logic.js';
import { fmt as fmtDate, diffDays, addDays, todayKey, startOfWeek, fromKey, fmtDateLong, fmtDateShort, greeting, nowMin, timeToMin, fmtTime, weekdayNarrow, weekdayLabels } from '../dates.js';
import { taskRow, habitControl, streakBadge, timeRange } from './widgets.js';
import { moveToToday, reorderTasks, setMood, setNote, bumpHabit } from '../actions.js';
import { openQuickAdd } from '../forms.js';

const TOD_ORDER = { morning: 0, afternoon: 1, evening: 2, anytime: 3 };
const TOD_LABEL = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', anytime: '' };

/** "Tomorrow", "In 3 days", "12 days ago" (+ year when it differs) — never repeats the title. */
function eyebrowLabel(k, today) {
  const d = diffDays(today, k);
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  const rel = d > 0 ? `In ${d} days` : `${-d} days ago`;
  return k.slice(0, 4) !== today.slice(0, 4) ? `${rel} · ${k.slice(0, 4)}` : rel;
}

export function renderToday() {
  const st = getState();
  const k = ctx.ui.date;
  const today = todayKey();
  const isToday = k === today;
  const fmt = st.settings.timeFormat;
  const prog = dayProgress(st, k);
  const root = h('div.view.view-today');

  // ---- Header ----
  root.append(h('header.page-head',
    h('div.page-head-text',
      h('p.eyebrow', isToday ? greeting() : eyebrowLabel(k, today)),
      // With the "Today" chip showing, narrow screens get a short date (swapped in CSS).
      h('h1.page-title',
        h('span.title-long', fmtDateLong(k)),
        !isToday ? h('span.title-short', fmtDate(k, { weekday: 'short', month: 'short', day: 'numeric' })) : null)),
    h('div.head-actions',
      !isToday ? h('button.chip-btn', { type: 'button', onclick: () => ctx.setDate(today) }, 'Today') : null,
      iconBtn('chevronLeft', 'Previous day', () => ctx.setDate(addDays(k, -1))),
      iconBtn('chevronRight', 'Next day', () => ctx.setDate(addDays(k, 1))))));

  // ---- Week strip ----
  const ws = startOfWeek(k, st.settings.weekStart);
  const strip = h('div.week-strip.no-swipe', { role: 'group', 'aria-label': 'Week' });
  const longNames = weekdayLabels('long');
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const p = dayProgress(st, d);
    strip.append(h(`button.ws-day${d === k ? '.selected' : ''}${d === today ? '.is-today' : ''}`, {
      type: 'button', 'aria-current': d === k ? 'date' : null,
      'aria-label': `${longNames[fromKey(d).getDay()]} ${fmtDateShort(d)}${p.total ? `, ${p.done} of ${p.total} done` : ''}`,
      onclick: () => ctx.setDate(d),
    },
    h('span.ws-letter', weekdayNarrow(d)),
    h('span.ws-num', String(fromKey(d).getDate())),
    h('span.ws-bar', { style: { '--p': p.total ? p.pct : 0 }, 'data-empty': p.total ? null : '' })));
  }
  onSwipe(strip, { left: () => ctx.setDate(addDays(k, 7)), right: () => ctx.setDate(addDays(k, -7)) });
  root.append(strip);

  // ---- Progress card ----
  const pctLabel = Math.round(prog.pct * 100) + '%';
  let mood = 'Plan something small. Tap + to add.';
  if (prog.total) {
    if (prog.pct === 1) mood = 'All done. Enjoy the rest of your day!';
    else if (prog.pct >= 0.5) mood = 'More than halfway there. Keep going!';
    else if (prog.done) mood = 'Nice start. One thing at a time.';
    else mood = isToday ? 'Fresh start. Pick one thing to begin.' : k > today ? 'Planned ahead. Nice.' : 'Nothing was checked off.';
  }
  const ringAnim = ctx.anim.has('ring');
  root.append(h(`section.card.progress-card${ringAnim ? '.celebrate' : ''}`, { 'aria-label': 'Day progress' },
    ring(prog.pct, { size: 84, stroke: 9, label: pctLabel, cls: 'day-ring' }),
    h('div.progress-text',
      h('p.progress-big', prog.total ? `${prog.done} of ${prog.total} done` : 'A clear day'),
      h('p.progress-sub', mood),
      prog.total ? h('p.progress-break',
        h('span', icon('check', { size: 13 }), `${prog.tasks.done}/${prog.tasks.total} tasks`),
        h('span', icon('habits', { size: 13 }), `${prog.habits.done}/${prog.habits.total} habits`)) : null)));

  // ---- Overdue (rollover) ----
  if (isToday) {
    const overdue = overdueTasks(st, today);
    if (overdue.length) {
      const list = h('ul.tasks.compact');
      for (const t of overdue) {
        const row = taskRow(t, t.date, { showDate: true });
        row.append(h('button.btn.small.secondary.move-btn', { type: 'button', onclick: () => moveToToday([t.id]), 'aria-label': `Move “${t.title}” to today` }, icon('arrowRight', { size: 16 }), h('span.hide-xs', 'Today')));
        list.append(row);
      }
      root.append(h('section.card.overdue-card', { 'aria-label': 'Unfinished from earlier days' },
        sectionHead(`Unfinished from earlier · ${overdue.length}`,
          overdue.length > 1 ? h('button.link-btn', { type: 'button', onclick: () => moveToToday(overdue.map((t) => t.id)) }, 'Move all to today') : null, 'alert'),
        list));
    }
  }

  // ---- Habits due ----
  const habits = activeHabits(st)
    .filter((hb) => habitStart(st, hb) <= k || k >= hb.createdAt)
    .filter((hb) => isDueOn(st, hb, k))
    .sort((a, b) => TOD_ORDER[a.timeOfDay] - TOD_ORDER[b.timeOfDay] || a.order - b.order);
  if (habits.length) {
    const list = h('ul.habit-rows');
    for (const hb of habits) {
      const s = streaks(st, hb, today);
      const v = habitVal(st, hb, k);
      // Most useful info first, since the line is truncated with an ellipsis.
      const sub = [];
      if (hb.schedule.type === 'perWeek') sub.push(`${weekCount(st, hb, k)}/${hb.schedule.times} this week`);
      if (hb.goal.type === 'count') sub.push(`${v}/${habitTarget(hb)}${hb.goal.unit ? ' ' + hb.goal.unit : ''}`);
      if (TOD_LABEL[hb.timeOfDay]) sub.push(TOD_LABEL[hb.timeOfDay]);
      list.append(h('li.habit-row', { style: { '--c': hb.color } },
        h('button.habit-row-main', { type: 'button', onclick: () => ctx.go('habit/' + hb.id), 'aria-label': `${hb.name} details` },
          h('span.emoji-bubble', { 'aria-hidden': 'true' }, hb.emoji),
          h('span.habit-row-text', h('span.habit-name', hb.name), sub.length || s.current ? h('span.habit-sub', streakBadge(s), h('span.sub-text', sub.join(' · '))) : null)),
        hb.goal.type === 'count' && v > 0 && k <= today ? iconBtn('minus', `Remove one from ${hb.name}`, () => bumpHabit(hb.id, k, -1), 'minus-btn') : null,
        habitControl(hb, k)));
    }
    root.append(h('section.section', sectionHead('Habits', h('a.link-btn', { href: '#habits' }, 'All habits'), 'habits'), list));
  }

  // ---- Tasks ----
  const { timed, anytime } = splitTasks(tasksOn(st, k));
  if (!timed.length && !anytime.length) {
    root.append(h('section.card', emptyState(isToday ? '🌤️' : '🗓️', 'Nothing scheduled',
      'Tap + and type something like “Gym 6pm” or “Call mom tomorrow 14:30”.',
      h('button.btn.primary', { type: 'button', onclick: () => openQuickAdd() }, icon('plus', { size: 18 }), 'Add a task'))));
  }
  if (timed.length) {
    const now = isToday ? nowMin() : null;
    const list = h('ol.timeline');
    let nowPlaced = !isToday;
    const nowLine = () => h('li.now-line', { 'aria-label': `Now, ${fmtTime(`${String(Math.floor(now / 60)).padStart(2, '0')}:${String(now % 60).padStart(2, '0')}`, fmt)}` },
      h('span.now-dot'), h('span.now-label', 'Now'));
    for (const t of timed) {
      if (!nowPlaced && timeToMin(t.time) > now) { list.append(nowLine()); nowPlaced = true; }
      const row = taskRow(t, k, { nowMin: now });
      row.classList.add('timed');
      row.prepend(h('span.task-time', h('span', fmtTime(t.time, fmt)), t.duration ? h('small', timeRange(t, fmt).split(' – ')[1] || '') : null));
      list.append(row);
    }
    if (!nowPlaced) list.append(nowLine());
    root.append(h('section.section', sectionHead('Schedule', null, 'clock'), list));
  }
  if (anytime.length) {
    const list = h('ul.tasks');
    for (const t of anytime) list.append(taskRow(t, k, { draggable: anytime.length > 1 }));
    makeSortable(list, { onReorder: (ids) => reorderTasks(ids) });
    const doneCount = anytime.filter((t) => list.querySelector(`[data-id="${CSS.escape(t.id)}"].done`)).length;
    root.append(h('section.section', sectionHead('Anytime', h('span.muted.small', `${doneCount}/${anytime.length}`), 'list'), list));
  }

  // ---- Journal ----
  root.append(journalCard(k));

  onSwipe(root, { left: () => ctx.setDate(addDays(k, 1)), right: () => ctx.setDate(addDays(k, -1)) });
  return root;
}

function journalSubtitle(entry) {
  if (entry.mood) return `Feeling ${MOODS[entry.mood - 1].label.toLowerCase()}` + (entry.note ? ' · note saved' : '');
  return entry.note ? 'Note saved' : 'How was your day?';
}

function journalCard(k) {
  const st = getState();
  const entry = st.journal[k] || { mood: null, note: '' };
  if (ctx.ui.journalOpen === null) ctx.ui.journalOpen = false;
  const open = ctx.ui.journalOpen;
  const moodEmoji = MOODS.find((m) => m.v === entry.mood)?.e;
  const bodyId = 'journal-body';
  const head = h('button.journal-head', {
    type: 'button', 'aria-expanded': String(open), 'aria-controls': bodyId,
    onclick: () => { ctx.ui.journalOpen = !open; ctx.rerender(); },
  },
  h('span.journal-icon', { 'aria-hidden': 'true' }, moodEmoji || icon('book', { size: 18 })),
  h('span.journal-title', h('b', 'Journal'), h('small.journal-sub', journalSubtitle(entry))),
  h('span.chev', icon('chevronDown', { size: 18 })));
  const card = h(`section.card.journal${open ? '.open' : ''}`, head);
  if (open) {
    const moods = h('div.moods', { role: 'radiogroup', 'aria-label': 'Mood' },
      MOODS.map((m) => h('button.mood', {
        type: 'button', role: 'radio', 'aria-checked': String(entry.mood === m.v), 'aria-label': m.label, title: m.label,
        onclick: () => setMood(k, m.v),
      }, h('span.mood-e', m.e), h('span.mood-l', m.label))));
    let timer;
    // setNote is silent (no re-render, keeps focus), so refresh the subtitle by hand.
    const save = () => {
      setNote(k, ta.value);
      status.textContent = 'Saved';
      head.querySelector('.journal-sub').textContent = journalSubtitle(getState().journal[k] || { mood: null, note: '' });
    };
    const status = h('span.save-status', { 'aria-live': 'polite' });
    const ta = h('textarea.input.journal-note', {
      rows: 3, maxlength: 1000, placeholder: 'A few words about today…', 'aria-label': 'Journal note',
      oninput: () => {
        clearTimeout(timer);
        status.textContent = '';
        timer = setTimeout(save, 400);
      },
      onblur: () => { clearTimeout(timer); save(); },
    }, entry.note || '');
    card.append(h('div.journal-body', { id: bodyId }, moods, ta, status));
  }
  return card;
}
