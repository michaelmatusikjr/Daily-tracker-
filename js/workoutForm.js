// Workout log form (bottom sheet): pick or create an exercise, enter values, save.
import { h, openSheet, segmented, iconBtn } from './ui.js';
import { icon } from './icons.js';
import { getState } from './store.js';
import { todayKey, isValidKey, fmtDateShort } from './dates.js';
import { saveWorkout, deleteWorkout } from './actions.js';
import {
  rankedExercises, lastWorkout, exerciseById, workoutSummary, weightLabel, distLabel,
  convWeight, convDist, trimNum, parseTime, timeInputValue,
} from './workouts.js';

const CARDIO_RE = /\b(run|running|jog|walk|walking|hike|cycle|cycling|bike|biking|ride|swim|swimming|row|rowing|elliptical|cardio|treadmill|stairs|skate|ski)\b/i;
export const guessType = (name) => (CARDIO_RE.test(name) ? 'cardio' : 'strength');

function parseNum(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  return parseFloat(s);
}

/** Number input with − / + buttons. */
function stepper({ label, value, step, decimal = false, id }) {
  const input = h('input.input.step-input', {
    type: 'text', inputmode: decimal ? 'decimal' : 'numeric', autocomplete: 'off', id,
    value: value === null || value === undefined ? '' : String(value), 'aria-label': label,
  });
  const bump = (dir) => {
    const cur = parseNum(input.value);
    const base = Number.isFinite(cur) ? cur : 0;
    const next = Math.max(0, Math.round((base + dir * step) * 100) / 100);
    input.value = next ? trimNum(next, 2) : '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const el = h('div.num-stepper',
    iconBtn('minus', `Decrease ${label}`, () => bump(-1), 'step-btn'),
    input,
    iconBtn('plus', `Increase ${label}`, () => bump(1), 'step-btn'));
  return { el, input, get: () => parseNum(input.value) };
}

/** Open the log form. workout = existing entry to edit (or null). opts: { exerciseId, date } */
export function openWorkoutForm(workout, opts = {}) {
  const st = getState();
  const settings = st.settings;
  const wu = settings.weightUnit, du = settings.distanceUnit;
  const isNew = !workout;
  const today = todayKey();
  let exId = workout?.exerciseId || (opts.exerciseId && exerciseById(st, opts.exerciseId) ? opts.exerciseId : null);
  let newEx = null; // { name, type } for an exercise created while logging
  let showNote = !!workout?.note;

  const date = h('input.input', { type: 'date', value: workout?.date || (opts.date && opts.date <= today ? opts.date : today), max: today, required: true, 'aria-label': 'Date' });
  const exBox = h('div.ex-picker');
  const fieldsBox = h('div.wo-fields');
  const lastLine = h('p.last-time', { 'aria-live': 'polite' });
  const err = h('p.form-error', { role: 'alert' });
  const noteBox = h('div');
  const note = h('textarea.input', { rows: 2, maxlength: 300, placeholder: 'How did it go?', 'aria-label': 'Note' }, workout?.note || '');

  const exType = () => (newEx ? newEx.type : exerciseById(getState(), exId)?.type || 'strength');
  let query = '';
  let lines = []; // [{ weight, sets, reps }] stepper refs
  let timeInput = null, distStep = null;

  // ---- exercise picker ----
  function renderPicker() {
    const st2 = getState();
    if (exId || newEx) {
      const ex = newEx || exerciseById(st2, exId);
      exBox.replaceChildren(...[
        h('div.ex-selected',
          h('span.ex-chip.selected', icon(ex.type === 'cardio' ? 'run' : 'dumbbell', { size: 18 }), h('b', ex.name)),
          isNew ? h('button.link-btn', { type: 'button', onclick: () => { exId = null; newEx = null; query = ''; renderAll(true); } }, 'Change') : null),
        newEx ? h('div.field', h('span.field-label', `What kind of exercise is “${newEx.name}”?`),
          segmented([{ value: 'strength', label: 'Strength', icon: 'dumbbell' }, { value: 'cardio', label: 'Cardio', icon: 'run' }], newEx.type,
            (v) => { newEx.type = v; renderFields(); }, { label: 'Exercise type' })) : null].filter(Boolean));
      return;
    }
    const search = h('input.input.ex-search', { type: 'text', value: query, autofocus: !exBox.isConnected, placeholder: 'Exercise – pick or type a new one', autocomplete: 'off', 'aria-label': 'Exercise', maxlength: 60 });
    const chips = h('div.ex-chips', { role: 'list' });
    const renderChips = () => {
      const q = query.trim().toLowerCase();
      const all = rankedExercises(getState());
      const shown = (q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all).slice(0, q ? 12 : 8);
      const exact = all.some((e) => e.name.toLowerCase() === q) || getState().exercises.some((e) => e.name.toLowerCase() === q);
      const items = shown.map((e) => h('button.ex-chip', { type: 'button', role: 'listitem', onclick: () => { exId = e.id; renderAll(); } },
        icon(e.type === 'cardio' ? 'run' : 'dumbbell', { size: 18 }), e.name));
      if (q && !exact) {
        const name = query.trim().replace(/\s+/g, ' ');
        items.push(h('button.ex-chip.add', { type: 'button', role: 'listitem', onclick: () => { newEx = { name, type: guessType(name) }; renderAll(); } },
          icon('plus', { size: 18 }), `Add “${name}”`));
      }
      // An archived exercise typed by exact name can be used again.
      const archived = q && getState().exercises.find((e) => e.archived && e.name.toLowerCase() === q);
      if (archived) items.push(h('button.ex-chip', { type: 'button', role: 'listitem', onclick: () => { exId = archived.id; renderAll(); } }, icon('archive', { size: 18 }), `${archived.name} (archived)`));
      chips.replaceChildren(...(items.length ? items : [h('p.field-hint', 'Type the name of your first exercise, e.g. “Squats” or “Walk”.')]));
    };
    search.addEventListener('input', () => { query = search.value; renderChips(); });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      chips.querySelector('.ex-chip')?.click();
    });
    renderChips();
    exBox.replaceChildren(search, chips);
    if (!isNew || exBox.isConnected) requestAnimationFrame(() => search.focus());
  }

  // ---- value fields ----
  function addLine(v = {}) {
    const i = lines.length;
    const weight = stepper({ label: `Weight (${weightLabel(wu)})${i ? ` line ${i + 1}` : ''}`, value: v.weight ?? null, step: wu === 'kg' ? 2.5 : 5, decimal: true });
    const sets = stepper({ label: `Sets${i ? ` line ${i + 1}` : ''}`, value: v.sets ?? null, step: 1 });
    const reps = stepper({ label: `Reps${i ? ` line ${i + 1}` : ''}`, value: v.reps ?? null, step: 1 });
    lines.push({ weight, sets, reps });
  }

  function renderFields() {
    const type = exType();
    if (!exId && !newEx) { fieldsBox.replaceChildren(); lastLine.textContent = ''; return; }
    if (type === 'strength') {
      if (!lines.length) addLine();
      const lineRows = lines.map((l, i) => h('div.wo-line',
        h('div.wo-cell.w', h('span.cell-label', i ? '' : `Weight (${weightLabel(wu)})`), l.weight.el),
        h('div.wo-cell', h('span.cell-label', i ? '' : 'Sets'), l.sets.el),
        h('div.wo-cell', h('span.cell-label', i ? '' : 'Reps'), l.reps.el),
        lines.length > 1 ? iconBtn('x', `Remove line ${i + 1}`, () => { lines.splice(i, 1); renderFields(); }, 'line-remove') : null));
      const timeVal = timeInput ? timeInput.value : (workout && exType() === 'strength' ? timeInputValue(workout.time, 'strength') : '');
      timeInput = h('input.input', { type: 'text', inputmode: 'text', value: timeVal, placeholder: 'e.g. 1:30 or 45', autocomplete: 'off', id: 'wo-time' });
      fieldsBox.replaceChildren(
        h(`div.wo-lines${lines.length === 1 ? '.single' : ''}`, lineRows),
        h('button.btn.ghost.small.add-line', { type: 'button', onclick: () => { addLine(); renderFields(); fieldsBox.querySelectorAll('.wo-line')[lines.length - 1]?.querySelector('input')?.focus(); } },
          icon('plus', { size: 16 }), 'Add another line'),
        h('div.field.compact', h('label.field-label', { for: 'wo-time' }, 'Time (optional, m:ss)'), timeInput),
        h('p.field-hint', 'Leave weight empty for bodyweight exercises.'));
      distStep = null;
    } else {
      const timeVal = timeInput ? timeInput.value : (workout ? timeInputValue(workout.time, 'cardio') : '');
      timeInput = h('input.input', { type: 'text', inputmode: 'text', value: timeVal, placeholder: 'Minutes or h:mm', autocomplete: 'off', id: 'wo-time' });
      const dv = distStep ? distStep.get() : (workout ? convDist(workout.distance, workout.distanceUnit, du) : null);
      distStep = stepper({ label: `Distance (${distLabel(du)})`, value: Number.isFinite(dv) ? dv : null, step: 0.5, decimal: true, id: 'wo-dist' });
      fieldsBox.replaceChildren(h('div.grid-2',
        h('div.field', h('label.field-label', { for: 'wo-time' }, 'Time'), timeInput),
        h('div.field', h('label.field-label', { for: 'wo-dist' }, `Distance (${distLabel(du)})`), distStep.el)));
    }
  }

  function prefill() {
    lines = []; timeInput = null; distStep = null;
    const st2 = getState();
    const src = workout || (exId ? lastWorkout(st2, exId) : null);
    lastLine.textContent = '';
    if (!src) return;
    const ex = exerciseById(st2, exId);
    if (!workout) lastLine.textContent = `Last time: ${workoutSummary(src, ex, st2.settings)} · ${fmtDateShort(src.date)}`;
    src.lines.forEach((l) => addLine({ weight: convWeight(l.weight, src.weightUnit, wu), sets: l.sets, reps: l.reps }));
    // Time/distance are rebuilt from `src` in renderFields via `workout`; for a fresh log copy them too.
    if (!workout) {
      timeInput = h('input.input', { value: timeInputValue(src.time, ex?.type || 'strength') });
      if (src.distance !== null) distStep = { get: () => convDist(src.distance, src.distanceUnit, du) };
    }
  }

  function renderNote() {
    noteBox.replaceChildren(showNote
      ? h('div.field', h('label.field-label', 'Note'), note)
      : h('button.link-btn', { type: 'button', onclick: () => { showNote = true; renderNote(); note.focus(); } }, icon('note', { size: 16 }), ' Add note'));
  }

  function renderAll(resetValues = false) {
    if (resetValues || !workout) prefill();
    renderPicker();
    renderFields();
  }

  function save() {
    err.textContent = '';
    const d = date.value;
    if (!isValidKey(d)) { err.textContent = 'Please pick a valid date.'; date.focus(); return; }
    if (d > todayKey()) { err.textContent = 'Workouts can’t be logged in the future.'; date.focus(); return; }
    if (!exId && !newEx) { err.textContent = 'Pick an exercise, or type a new one.'; exBox.querySelector('input')?.focus(); return; }
    const type = exType();
    const bad = (v) => Number.isNaN(v);
    const outLines = [];
    if (type === 'strength') {
      for (const l of lines) {
        const line = { weight: l.weight.get(), sets: l.sets.get(), reps: l.reps.get() };
        if (bad(line.weight) || bad(line.sets) || bad(line.reps)) { err.textContent = 'Use numbers only (decimals with a dot or comma).'; return; }
        if (line.sets !== null) line.sets = Math.round(line.sets);
        if (line.reps !== null) line.reps = Math.round(line.reps);
        if ([line.weight, line.sets, line.reps].some((v) => v > 0)) outLines.push(line);
      }
    }
    const time = parseTime(timeInput?.value, type);
    if (bad(time)) { err.textContent = type === 'cardio' ? 'Time: enter minutes (e.g. 30) or h:mm (e.g. 1:15).' : 'Time: enter seconds (e.g. 45) or m:ss (e.g. 1:30).'; timeInput?.focus(); return; }
    const distance = type === 'cardio' ? distStep?.get() ?? null : null;
    if (bad(distance)) { err.textContent = 'Distance: use a number, e.g. 2.5'; return; }
    if (!outLines.length && !(time > 0) && !(distance > 0)) {
      err.textContent = type === 'cardio' ? 'Enter a time or a distance.' : 'Enter at least a weight, sets, reps or a time.';
      return;
    }
    const data = {
      date: d, exerciseId: exId, lines: outLines, weightUnit: wu,
      time: time > 0 ? time : null, distance: distance > 0 ? distance : null, distanceUnit: du,
      note: showNote ? note.value.trim().slice(0, 300) : (workout?.note || ''),
    };
    if (workout) data.id = workout.id;
    sheet.close();
    saveWorkout(data, { newExercise: newEx });
  }

  const form = h('form.form.wo-form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    h('div.field', h('span.field-label', 'Exercise'), exBox, lastLine),
    fieldsBox,
    h('div.field', h('label.field-label', 'Date'), date),
    noteBox,
    err);
  renderAll(!!workout);
  renderNote();
  const footer = [
    !isNew ? h('button.btn.danger-ghost', { type: 'button', onclick: () => { sheet.close(); deleteWorkout(workout.id); } }, icon('trash', { size: 18 }), 'Delete') : h('span'),
    h('button.btn.primary', { type: 'button', onclick: save }, isNew ? 'Save workout' : 'Save'),
  ];
  const sheet = openSheet({ title: isNew ? 'Log workout' : 'Edit workout', content: form, footer });
  if (exId) requestAnimationFrame(() => fieldsBox.querySelector('input')?.focus());
}
