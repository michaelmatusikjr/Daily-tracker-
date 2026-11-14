// Long-press / right-click / keyboard action menus for tasks, habits, workouts, exercises and calendar days.
import { h, openSheet, closeAllSheets, onItemMenu, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { getState } from './store.js';
import { ctx } from './ctx.js';
import { isRecurring, isTaskDone, habitVal, habitTarget } from './logic.js';
import { todayKey, addDays, fmtDateShort, fmtDateLong } from './dates.js';
import {
  toggleTask, deleteTask, moveTask, duplicateTask, skipTaskDay,
  bumpHabit, toggleHabitDay, resetHabitDay, setArchived, deleteHabit,
  deleteWorkout, setExerciseArchived,
} from './actions.js';
import { openTaskForm, openHabitForm } from './forms.js';
import { openWorkoutForm } from './workoutForm.js';
import { exerciseById } from './workouts.js';
import { openExerciseEditor, confirmDeleteExercise } from './views/workouts.js';

/**
 * Show a menu. items: [{ label, icon, run, danger }] (falsy entries are skipped; danger items go last).
 * Touch → bottom sheet; mouse/keyboard on wide screens → popover anchored to the item.
 */
export function showMenu(title, items, { mode = 'touch', anchor = null, x = 0, y = 0 } = {}) {
  const list = items.filter(Boolean);
  const ordered = [...list.filter((i) => !i.danger), ...list.filter((i) => i.danger)];
  let at = null;
  if (mode !== 'touch' && matchMedia('(min-width: 600px)').matches) {
    const r = anchor?.getBoundingClientRect();
    at = mode === 'mouse' && (x || y) ? { x, y, top: y } : r ? { x: r.left + 12, y: r.bottom + 4, top: r.top - 4 } : { x: 16, y: 16 };
  }
  const buttons = ordered.map((it) => h(`button.menu-item${it.danger ? '.danger' : ''}`, {
    type: 'button', role: 'menuitem',
    onclick: () => { closeAllSheets(); it.run(); },
  }, icon(it.icon, { size: 20 }), h('span', it.label)));
  const menu = h('div.menu-list', {
    role: 'menu', 'aria-label': title,
    onkeydown: (e) => {
      const i = buttons.indexOf(document.activeElement);
      let j = null;
      if (e.key === 'ArrowDown') j = (i + 1) % buttons.length;
      else if (e.key === 'ArrowUp') j = (i - 1 + buttons.length) % buttons.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = buttons.length - 1;
      if (j === null) return;
      e.preventDefault(); buttons[j].focus();
    },
  }, buttons);
  // Keyboard/mouse: focus the first action. Touch: focus the sheet itself (no focus ring on a row).
  if (mode !== 'touch') buttons[0]?.setAttribute('autofocus', '');
  return openSheet({ title, content: menu, cls: 'action-menu', at });
}

/** Wire an element to open the menu built by build() (called at open time, so it reflects current state). */
export function attachMenu(el, build, focusEl = null) {
  el.classList.add('has-menu');
  onItemMenu(el, (mode, info) => {
    const m = build();
    if (!m) return;
    // Focus returns to the item when the menu closes (openSheet restores the focused element).
    const f = info.target?.closest?.('button, a, [tabindex]');
    const target = f && el.contains(f) ? f : focusEl || (el.matches('button, a') ? el : el.querySelector('button, a'));
    if (document.activeElement !== target) target?.focus({ preventScroll: true });
    showMenu(m.title, m.items, { mode, anchor: el, x: info.x, y: info.y });
  });
}

// ---------- Menus ----------
/** "Move to…" date picker. */
function pickDate(t) {
  const input = h('input.input', { type: 'date', value: t.date, 'aria-label': 'New date', autofocus: true });
  const go = () => { if (input.value) { sheet.close(); moveTask(t.id, input.value); } };
  const sheet = openSheet({
    title: `Move “${t.title}”`, cls: 'dialog',
    content: h('form.form', { onsubmit: (e) => { e.preventDefault(); go(); }, novalidate: true }, h('div.field', h('label.field-label', 'Date'), input)),
    footer: [h('button.btn.ghost', { type: 'button', onclick: () => sheet.close() }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: go }, 'Move')],
  });
}

export function taskMenu(id, k) {
  const t = getState().tasks.find((x) => x.id === id);
  if (!t) return null;
  const done = isTaskDone(t, k);
  const tomorrow = addDays(todayKey(), 1);
  const rec = isRecurring(t);
  return {
    title: t.title,
    items: [
      { label: 'Edit', icon: 'edit', run: () => openTaskForm(t) },
      { label: done ? 'Mark not done' : 'Mark done', icon: done ? 'undo' : 'check', run: () => toggleTask(id, k) },
      rec ? { label: 'Skip this day', icon: 'skip', run: () => skipTaskDay(id, k) } : null,
      !rec && t.date !== tomorrow ? { label: 'Move to tomorrow', icon: 'arrowRight', run: () => moveTask(id, tomorrow) } : null,
      !rec ? { label: 'Move to…', icon: 'calendar', run: () => pickDate(t) } : null,
      { label: 'Duplicate', icon: 'copy', run: () => duplicateTask(id) },
      { label: rec ? 'Delete…' : 'Delete', icon: 'trash', danger: true, run: () => deleteTask(id, k) },
    ],
  };
}

export function habitMenu(id, k = todayKey()) {
  const st = getState();
  const hb = st.habits.find((x) => x.id === id);
  if (!hb) return null;
  const v = habitVal(st, hb, k);
  const done = v >= habitTarget(hb);
  const can = k <= todayKey() && !hb.archived;
  const dayWord = k === todayKey() ? 'today' : fmtDateShort(k);
  const count = hb.goal.type === 'count';
  return {
    title: `${hb.emoji} ${hb.name}`,
    items: [
      { label: 'Edit', icon: 'edit', run: () => openHabitForm(hb) },
      { label: 'View details', icon: 'stats', run: () => ctx.go('habit/' + id) },
      can && count ? { label: 'Add one', icon: 'plus', run: () => bumpHabit(id, k, 1) } : null,
      can && count && v > 0 ? { label: 'Remove one', icon: 'minus', run: () => bumpHabit(id, k, -1) } : null,
      can ? { label: done ? `Mark not done ${dayWord}` : `Mark done ${dayWord}`, icon: done ? 'undo' : 'check', run: () => toggleHabitDay(id, k) } : null,
      can && count && v > 0 ? { label: `Reset ${dayWord}`, icon: 'undo', run: () => resetHabitDay(id, k) } : null,
      { label: hb.archived ? 'Unarchive' : 'Archive', icon: 'archive', run: () => setArchived(id, !hb.archived) },
      {
        label: 'Delete', icon: 'trash', danger: true,
        run: async () => {
          if (!(await confirmDialog('Delete habit?', `“${hb.name}” and all of its history will be removed.`, { ok: 'Delete', danger: true }))) return;
          if (location.hash === '#habit/' + id) ctx.go('habits');
          deleteHabit(id);
        },
      },
    ],
  };
}

export function workoutMenu(id) {
  const st = getState();
  const w = st.workouts.find((x) => x.id === id);
  if (!w) return null;
  const ex = exerciseById(st, w.exerciseId);
  const name = ex?.name || 'Workout';
  return {
    title: `${name} · ${fmtDateShort(w.date)}`,
    items: [
      { label: 'Edit', icon: 'edit', run: () => openWorkoutForm(w) },
      ex ? { label: 'Log again today', icon: 'repeat', run: () => openWorkoutForm(null, { template: w, date: todayKey() }) } : null,
      ex ? { label: 'View exercise', icon: 'stats', run: () => ctx.go('exercise/' + ex.id) } : null,
      { label: 'Delete', icon: 'trash', danger: true, run: () => deleteWorkout(id) },
    ],
  };
}

export function exerciseMenu(id) {
  const ex = exerciseById(getState(), id);
  if (!ex) return null;
  return {
    title: ex.name,
    items: [
      { label: 'Edit', icon: 'edit', run: () => openExerciseEditor(ex) },
      { label: 'View history', icon: 'stats', run: () => ctx.go('exercise/' + ex.id) },
      { label: ex.archived ? 'Unarchive' : 'Archive', icon: 'archive', run: () => setExerciseArchived(id, !ex.archived) },
      { label: 'Delete', icon: 'trash', danger: true, run: () => confirmDeleteExercise(ex) },
    ],
  };
}

export function dayMenu(k) {
  return {
    title: fmtDateLong(k),
    items: [
      { label: 'Open day', icon: 'calendar', run: () => { ctx.setDate(k); ctx.go('today'); } },
      { label: 'Add task on this day', icon: 'plus', run: () => openTaskForm(null, { date: k }) },
      k <= todayKey() ? { label: 'Log workout on this day', icon: 'dumbbell', run: () => openWorkoutForm(null, { date: k }) } : null,
    ],
  };
}
