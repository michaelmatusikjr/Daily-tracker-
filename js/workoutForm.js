// Workout log form (bottom sheet): pick or create an exercise, enter values, save.
import { h, openSheet, segmented, iconBtn } from './ui.js';
import { icon } from './icons.js';
import { getState, CAPS } from './store.js';
import { todayKey, isValidKey, fmtDateShort } from './dates.js';
import { saveWorkout, deleteWorkout } from './actions.js';
import {
  rankedExercises, lastWorkout, exerciseById, workoutSummary, weightLabel, distLabel,
  convWeight, convDist, trimNum, readTime, timeInputValue, lineUnit,
} from './workouts.js';

const CARDIO_RE = /\b(run|running|jog|walk|walking|hike|cycle|cycling|bike|biking|ride|swim|swimming|row|rowing|elliptical|cardio|treadmill|stairs|skate|ski)\b/i;
const BODY_RE = /\b(push[- ]?ups?|sit[- ]?ups?|pull[- ]?ups?|chin[- ]?ups?|dips?|planks?|burpees?|lunges?|crunch(es)?|wall[- ]?sits?|air squats?|bodyweight squats?)\b/i;
export const guessType = (name) => (CARDIO_RE.test(name) ? 'cardio' : BODY_RE.test(name) ? 'bodyweight' : 'strength');
const TYPE_ICON = { strength: 'dumbbell', bodyweight: 'body', cardio: 'run' };
const TYPE_OPTIONS = [
  { value: 'strength', label: 'Strength', icon: 'dumbbell' }, { value: 'bodyweight', label: 'Bodyweight', icon: 'body' }, { value: 'cardio', label: 'Cardio', icon: 'run' },
];

/** Number from an input: null when empty, NaN (with .why) when invalid. "2,5" is a decimal; "1,000" is rejected. */
function parseNum(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  if (/^\d{1,3}(,\d{3})+$/.test(raw)) { const n = NaN; parseNum.why = 'Don’t use thousands separators – type 1000, or 2.5 for a decimal.'; return n; }
  const s = raw.replace(',', '.');
  if (!/^\d*\.?\d+$/.test(s)) { parseNum.why = 'Use numbers only (decimals with a dot or comma).'; return NaN; }
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
  // Values being edited. `orig` remembers a value shown in converted units so that, if the user
  // doesn't change it, the original number and unit are saved back unchanged (no drift).
  let lines = []; // [{ weight, sets, reps, orig: { value, unit, shown } | null }]
  let timeText = null; // current text of the time box (null → take it from the source entry)
  let flip = false; // user tapped the hint to swap an ambiguous a:bb reading
  let dist = null; // { shown, orig: { value, unit } | null }
  let timeInput = null, distStep = null;

  // ---- exercise picker ----
  function renderPicker() {
    const st2 = getState();
    if (exId || newEx) {
      const ex = newEx || exerciseById(st2, exId);
      exBox.replaceChildren(...[
        h('div.ex-selected',
          h('span.ex-chip.selected', icon(TYPE_ICON[ex.type] || 'dumbbell', { size: 18 }), h('b', ex.name)),
          isNew ? h('button.link-btn', { type: 'button', onclick: () => { exId = null; newEx = null; query = ''; renderAll(true); } }, 'Change') : null),
        newEx ? h('div.field', h('span.field-label', `What kind of exercise is “${newEx.name}”?`),
          segmented(TYPE_OPTIONS, newEx.type,
            (v) => { newEx.type = v; flip = false; renderFields(); }, { label: 'Exercise type' })) : null].filter(Boolean));
      return;
    }
    const search = h('input.input.ex-search', { type: 'text', value: query, autofocus: !exBox.isConnected, placeholder: 'Exercise – pick or type a new one', autocomplete: 'off', 'aria-label': 'Exercise', maxlength: 60 });
    const chips = h('div.ex-chips', { role: 'list' });
    const renderChips = () => {
      const q = query.trim().toLowerCase();
      const all = rankedExercises(getState());
      const shown = (q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all).slice(0, q ? 12 : 8);
      const exact = getState().exercises.some((e) => e.name.toLowerCase() === q);
      const items = shown.map((e) => h('button.ex-chip', { type: 'button', role: 'listitem', onclick: () => { exId = e.id; renderAll(true); } },
        icon(TYPE_ICON[e.type] || 'dumbbell', { size: 18 }), e.name));
      if (q && !exact) {
        const name = query.trim().replace(/\s+/g, ' ');
        items.push(h('button.ex-chip.add', { type: 'button', role: 'listitem', onclick: () => { newEx = { name, type: guessType(name) }; renderAll(true); } },
          icon('plus', { size: 18 }), `Add “${name}”`));
      }
      // An archived exercise typed by exact name can be used again.
      const archived = q && getState().exercises.find((e) => e.archived && e.name.toLowerCase() === q);
      if (archived) items.push(h('button.ex-chip', { type: 'button', role: 'listitem', onclick: () => { exId = archived.id; renderAll(true); } }, icon('archive', { size: 18 }), `${archived.name} (archived)`));
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
    if (exBox.isConnected) requestAnimationFrame(() => search.focus());
  }

  // ---- values ----
  function lineFromSource(l, srcEntry) {
    const unit = lineUnit(l, srcEntry);
    const w = convWeight(l.weight, unit, wu);
    const shown = w === null ? '' : trimNum(w, 2);
    return { weight: shown, sets: l.sets ?? '', reps: l.reps ?? '', orig: l.weight !== null ? { value: l.weight, unit, shown } : null };
  }

  /** Load values from the entry being edited, or from the last time this exercise was logged. */
  function loadValues() {
    lines = []; timeText = null; dist = null; flip = false;
    const st2 = getState();
    const src = workout || (exId ? lastWorkout(st2, exId) : null);
    lastLine.textContent = '';
    if (!src) return;
    const ex = exerciseById(st2, exId);
    if (!workout) lastLine.textContent = `Last time: ${workoutSummary(src, ex, st2.settings)} · ${fmtDateShort(src.date)}`;
    lines = src.lines.map((l) => lineFromSource(l, src));
    timeText = timeInputValue(src.time, ex?.type === 'cardio' ? 'cardio' : 'strength');
    if (src.distance !== null) {
      const shown = trimNum(convDist(src.distance, src.distanceUnit, du), 2);
      dist = { shown, orig: { value: src.distance, unit: src.distanceUnit, shown } };
    }
  }

  /** Copy what's typed into `lines`/`timeText`/`dist` before re-rendering. */
  function captureInputs() {
    fieldsBox.querySelectorAll('.wo-line').forEach((row, i) => {
      const ins = row.querySelectorAll('input');
      if (lines[i]) Object.assign(lines[i], { weight: ins[0].value, sets: ins[1].value, reps: ins[2].value });
    });
    if (timeInput) timeText = timeInput.value;
    if (distStep) dist = { ...(dist || {}), shown: distStep.input.value };
  }

  function timeHint(type) {
    const hint = h('button.time-hint', { type: 'button', 'aria-live': 'polite' });
    const update = () => {
      const r = readTime(timeInput.value, type, flip);
      hint.disabled = !(r.ambiguous);
      hint.classList.toggle('error', !!r.error);
      if (r.error) hint.textContent = r.error;
      else if (r.sec === null) hint.textContent = type === 'cardio' ? 'Minutes (30), 25:30, 1:15 (h:mm) or 1h15m' : 'Seconds (45) or m:ss (1:30)';
      else hint.textContent = r.ambiguous ? `= ${r.text} · tap if you meant ${r.altText}` : `= ${r.text}`;
      hint.setAttribute('aria-label', r.ambiguous ? `Read as ${r.text}. Activate to read it as ${r.altText} instead.` : hint.textContent);
    };
    hint.addEventListener('click', () => { flip = !flip; update(); });
    timeInput.addEventListener('input', () => { flip = false; update(); });
    update();
    return hint;
  }

  function renderFields() {
    captureInputs();
    const type = exType();
    if (!exId && !newEx) { fieldsBox.replaceChildren(); lastLine.textContent = ''; timeInput = null; distStep = null; return; }
    timeInput = h('input.input', { type: 'text', inputmode: 'text', value: timeText ?? '', autocomplete: 'off', id: 'wo-time', 'aria-describedby': 'wo-time-hint' });
    if (type !== 'cardio') {
      const body = type === 'bodyweight';
      const wLabel = body ? `Extra weight (${weightLabel(wu)})` : `Weight (${weightLabel(wu)})`;
      if (!lines.length) lines.push({ weight: '', sets: '', reps: '', orig: null });
      const rows = lines.map((l, i) => {
        const weight = stepper({ label: `${wLabel}${i ? ` line ${i + 1}` : ''}`, value: l.weight, step: wu === 'kg' ? 2.5 : 5, decimal: true });
        const sets = stepper({ label: `Sets${i ? ` line ${i + 1}` : ''}`, value: l.sets, step: 1 });
        const reps = stepper({ label: `Reps${i ? ` line ${i + 1}` : ''}`, value: l.reps, step: 1 });
        return h('div.wo-line',
          h('div.wo-cell.w', h('span.cell-label', i ? '' : wLabel), weight.el),
          h('div.wo-cell', h('span.cell-label', i ? '' : 'Sets'), sets.el),
          h('div.wo-cell', h('span.cell-label', i ? '' : 'Reps'), reps.el),
          lines.length > 1 ? iconBtn('x', `Remove line ${i + 1}`, () => { captureInputs(); lines.splice(i, 1); renderFields(); }, 'line-remove') : null);
      });
      timeInput.placeholder = 'e.g. 1:30 or 45';
      const hint = body ? timeHint('strength') : null;
      if (hint) hint.id = 'wo-time-hint';
      // Strength has no time box; an older strength entry's stored time is kept and shown here.
      const keptTime = !body && workout?.time > 0 ? h('p.field-hint', `Logged time ${timeInputValue(workout.time, 'strength')} is kept. For holds like planks, use a Bodyweight exercise.`) : null;
      fieldsBox.replaceChildren(...[
        h(`div.wo-lines${lines.length === 1 ? '.single' : ''}`, rows),
        h('button.btn.ghost.small.add-line', {
          type: 'button',
          onclick: () => { captureInputs(); lines.push({ weight: '', sets: '', reps: '', orig: null }); renderFields(); fieldsBox.querySelectorAll('.wo-line')[lines.length - 1]?.querySelector('input')?.focus(); },
        }, icon('plus', { size: 16 }), 'Add another line'),
        body ? h('div.field.compact', h('label.field-label', { for: 'wo-time' }, 'Hold time (optional, m:ss)'), timeInput, hint) : keptTime,
        body ? h('p.field-hint', 'Extra weight is optional (e.g. a weight vest).') : null].filter(Boolean));
      if (!body) timeInput = null;
      distStep = null;
    } else {
      timeInput.placeholder = 'Minutes, m:ss or h:mm';
      const hint = timeHint('cardio');
      hint.id = 'wo-time-hint';
      distStep = stepper({ label: `Distance (${distLabel(du)})`, value: dist?.shown ?? '', step: 0.5, decimal: true, id: 'wo-dist' });
      fieldsBox.replaceChildren(
        h('div.grid-2',
          h('div.field', h('label.field-label', { for: 'wo-time' }, 'Time'), timeInput),
          h('div.field', h('label.field-label', { for: 'wo-dist' }, `Distance (${distLabel(du)})`), distStep.el)),
        hint);
    }
  }

  function renderNote() {
    noteBox.replaceChildren(showNote
      ? h('div.field', h('label.field-label', 'Note'), note)
      : h('button.link-btn', { type: 'button', onclick: () => { showNote = true; renderNote(); note.focus(); } }, icon('note', { size: 16 }), ' Add note'));
  }

  function renderAll(resetValues = false) {
    if (resetValues) { lines = []; timeText = null; dist = null; fieldsBox.replaceChildren(); loadValues(); }
    renderPicker();
    renderFields();
  }

  function save() {
    err.textContent = '';
    captureInputs();
    const d = date.value;
    if (!isValidKey(d)) { err.textContent = 'Please pick a valid date.'; date.focus(); return; }
    if (d > todayKey()) { err.textContent = 'Workouts can’t be logged in the future.'; date.focus(); return; }
    if (!exId && !newEx) { err.textContent = 'Pick an exercise, or type a new one.'; exBox.querySelector('input')?.focus(); return; }
    const type = exType();
    const fail = (msg) => { err.textContent = msg; return null; };
    const outLines = [];
    if (type !== 'cardio') {
      for (const l of lines) {
        const wt = parseNum(l.weight), sets = parseNum(l.sets), reps = parseNum(l.reps);
        if ([wt, sets, reps].some((v) => Number.isNaN(v))) return fail(parseNum.why);
        const line = { weight: wt, sets: sets === null ? null : Math.round(sets), reps: reps === null ? null : Math.round(reps) };
        // Unchanged weight shown in converted units → keep the original value and unit.
        let unit = wu;
        if (l.orig && String(l.weight).trim() === l.orig.shown) { line.weight = l.orig.value; unit = l.orig.unit; }
        if (line.weight !== null && line.weight > CAPS.weight[unit]) return fail(`Weight looks too high (max ${CAPS.weight[unit]} ${weightLabel(unit)}).`);
        if (line.sets !== null && line.sets > CAPS.sets) return fail(`Sets: max ${CAPS.sets}.`);
        if (line.reps !== null && line.reps > CAPS.reps) return fail(`Reps: max ${CAPS.reps}.`);
        if ([line.weight, line.sets, line.reps].some((v) => v > 0)) outLines.push({ ...line, unit });
      }
    }
    let time = null;
    if (type === 'strength') time = workout?.time > 0 ? workout.time : null; // no time box: keep what was stored
    else {
      const tr = readTime(timeText, type === 'cardio' ? 'cardio' : 'strength', flip);
      if (tr.error) { timeInput?.focus(); return fail(tr.error); }
      time = tr.sec;
    }
    let distance = null, distanceUnit = du;
    if (type === 'cardio' && dist) {
      const dv = parseNum(dist.shown);
      if (Number.isNaN(dv)) return fail(`Distance: ${parseNum.why}`);
      distance = dv;
      if (dist.orig && String(dist.shown).trim() === dist.orig.shown) { distance = dist.orig.value; distanceUnit = dist.orig.unit; }
      if (distance !== null && distance > CAPS.distance) return fail(`Distance looks too high (max ${CAPS.distance}).`);
    }
    if (!outLines.length && !(time > 0) && !(distance > 0)) {
      return fail({ cardio: 'Enter a time or a distance.', bodyweight: 'Enter sets, reps or a hold time.' }[type] || 'Enter a weight, sets or reps.');
    }
    // One unit for the entry; a line keeps its own unit only if it differs (unchanged, logged in the other unit).
    const units = [...new Set(outLines.filter((l) => l.weight !== null).map((l) => l.unit))];
    const weightUnit = units.length === 1 ? units[0] : wu;
    const data = {
      date: d, exerciseId: exId, weightUnit,
      lines: outLines.map(({ unit, ...l }) => (l.weight !== null && unit !== weightUnit ? { ...l, unit } : l)),
      time: time > 0 ? time : null, distance: distance > 0 ? distance : null, distanceUnit,
      note: showNote ? note.value.trim().slice(0, 300) : (workout?.note || ''),
    };
    if (workout) data.id = workout.id;
    sheet.close();
    saveWorkout(data, { newExercise: newEx });
    return null;
  }

  const form = h('form.form.wo-form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    h('div.field', h('span.field-label', 'Exercise'), exBox, lastLine),
    fieldsBox,
    h('div.field', h('label.field-label', 'Date'), date),
    noteBox,
    err);
  renderAll(true);
  renderNote();
  const footer = [
    !isNew ? h('button.btn.danger-ghost', { type: 'button', onclick: () => { sheet.close(); deleteWorkout(workout.id); } }, icon('trash', { size: 18 }), 'Delete') : h('span'),
    h('button.btn.primary', { type: 'button', onclick: save }, isNew ? 'Save workout' : 'Save'),
  ];
  const sheet = openSheet({ title: isNew ? 'Log workout' : 'Edit workout', content: form, footer });
  if (exId) requestAnimationFrame(() => fieldsBox.querySelector('input')?.focus());
}
