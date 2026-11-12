// Workouts tab (history by day + filter), exercise detail (records, totals, chart)
// and exercise management.
import { h, s, iconBtn, segmented, emptyState, openSheet, choose, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { getState, update } from '../store.js';
import { ctx } from '../ctx.js';
import { fmt, fmtDateShort, relativeLabel } from '../dates.js';
import {
  computeRecords, exerciseById, workoutSummary, periodStats, exerciseTotals, chartSeries,
  fmtClock, fmtLong, trimNum, fromKg, fromKm, weightLabel, distLabel, paceText,
} from '../workouts.js';
import { openWorkoutForm } from '../workoutForm.js';
import { deleteWorkout, deleteExercise } from '../actions.js';

const typeIcon = (ex) => icon(ex?.type === 'cardio' ? 'run' : 'dumbbell', { size: 18 });
const dayLabel = (k) => fmt(k, { weekday: 'short', month: 'short', day: 'numeric' });

function allRecords(st) {
  const map = new Map();
  for (const ex of st.exercises) for (const [id, labels] of computeRecords(st, ex.id).records) map.set(id, labels);
  return map;
}

function prBadge(labels) {
  if (!labels) return null;
  return h('span.pr-badge', { title: labels.join(' · '), 'aria-label': `Personal record: ${labels.join(', ')}` }, '🏆');
}

/** One workout entry row: tap to edit, trash to delete (with Undo). */
function entryRow(w, st, records, { showName = true } = {}) {
  const ex = exerciseById(st, w.exerciseId);
  const summary = workoutSummary(w, ex, st.settings);
  const pop = ctx.anim.has('w-' + w.id);
  return h(`li.wo-entry${pop ? '.pop' : ''}`, { dataset: { id: w.id } },
    h('button.wo-main', { type: 'button', onclick: () => openWorkoutForm(w), 'aria-label': `Edit ${ex?.name || 'workout'}: ${summary}` },
      h('span.wo-icon', { 'aria-hidden': 'true' }, typeIcon(ex)),
      h('span.wo-text',
        h('span.wo-title', showName ? ex?.name || 'Workout' : dayLabel(w.date), prBadge(records.get(w.id))),
        h('span.wo-summary', summary),
        w.note ? h('span.wo-note', w.note) : null)),
    iconBtn('trash', `Delete ${ex?.name || 'workout'} on ${fmtDateShort(w.date)}`, () => deleteWorkout(w.id), 'wo-del'));
}

function matchesFilter(w, f, st) {
  if (f === 'all') return true;
  const ex = exerciseById(st, w.exerciseId);
  if (f === 'strength' || f === 'cardio') return (ex?.type || 'strength') === f;
  return f === 'ex:' + w.exerciseId;
}

export function renderWorkouts() {
  const st = getState();
  const root = h('div.view.view-workouts');
  const ps = periodStats(st);
  root.append(h('header.page-head',
    h('div.page-head-text',
      h('p.eyebrow', st.workouts.length ? `${ps.week} workout day${ps.week === 1 ? '' : 's'} this week` : 'Log your training'),
      h('h1.page-title', 'Workouts')),
    h('div.head-actions', iconBtn('list', 'Manage exercises', () => openExerciseManager()))));
  root.append(h('button.btn.primary.block.log-btn', { type: 'button', onclick: () => openWorkoutForm(null) }, icon('plus', { size: 20 }), 'Log workout'));

  if (!st.workouts.length) {
    root.append(h('section.card', emptyState('💪', 'No workouts yet',
      'Log anything: “Squats, 225 lbs, 3 × 5” or “Walk, 30 min, 2.5 mi”. Your exercises appear as quick picks next time.')));
    return root;
  }

  // Filter: All / Strength / Cardio / one exercise
  let f = ctx.ui.workoutFilter || 'all';
  if (f.startsWith('ex:') && !exerciseById(st, f.slice(3))) f = ctx.ui.workoutFilter = 'all';
  const used = new Set(st.workouts.map((w) => w.exerciseId));
  const exChips = st.exercises.filter((e) => used.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  const chip = (value, label, ic = null) => h('button.chip.filter-chip', {
    type: 'button', 'aria-pressed': String(f === value),
    onclick: () => { ctx.ui.workoutFilter = value; ctx.ui.workoutDays = 30; ctx.rerender(); },
  }, ic, label);
  root.append(h('div.filter-row.no-swipe', { role: 'group', 'aria-label': 'Filter workouts' },
    chip('all', 'All'), chip('strength', 'Strength', icon('dumbbell', { size: 14 })), chip('cardio', 'Cardio', icon('run', { size: 14 })),
    exChips.map((e) => chip('ex:' + e.id, e.name))));

  if (f.startsWith('ex:')) {
    const ex = exerciseById(st, f.slice(3));
    root.append(h('a.card.ex-link', { href: '#exercise/' + encodeURIComponent(ex.id) },
      h('span', typeIcon(ex)), h('span.ex-link-text', h('b', ex.name), h('small', 'Records, totals and progress chart')), icon('chevronRight', { size: 18 })));
  }

  const records = allRecords(st);
  const list = st.workouts.filter((w) => matchesFilter(w, f, st))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const days = [...new Set(list.map((w) => w.date))];
  const shownDays = days.slice(0, ctx.ui.workoutDays || 30);
  if (!list.length) root.append(h('p.hint-line', 'No workouts match this filter.'));
  for (const d of shownDays) {
    const items = list.filter((w) => w.date === d);
    const names = [...new Set(items.map((w) => exerciseById(st, w.exerciseId)?.name || 'Workout'))];
    root.append(h('section.section.wo-day',
      h('h2.wo-day-head', h('b', relativeLabel(d) === 'Today' || relativeLabel(d) === 'Yesterday' ? `${relativeLabel(d)}, ${fmtDateShort(d)}` : dayLabel(d)), h('span', ` · ${names.join(', ')}`)),
      h('ul.wo-list', items.map((w) => entryRow(w, st, records)))));
  }
  if (days.length > shownDays.length) {
    root.append(h('button.btn.secondary.block', { type: 'button', onclick: () => { ctx.ui.workoutDays = (ctx.ui.workoutDays || 30) + 30; ctx.rerender(); } }, 'Show older workouts'));
  }
  return root;
}

// ---------------- Exercise detail ----------------
function statCard(value, label, sub = null) {
  return h('div.stat-card', h('span.stat-value', value), h('span.stat-label', label), sub ? h('span.stat-sub', sub) : null);
}

export function renderExercise(id) {
  const st = getState();
  const ex = exerciseById(st, id);
  const root = h('div.view.view-exercise');
  if (!ex) {
    root.append(h('div.card', h('p', 'This exercise no longer exists.'), h('a.btn.secondary', { href: '#workouts' }, 'Back to workouts')));
    return root;
  }
  const s = st.settings;
  const { best, records, list } = computeRecords(st, id);
  const tot = exerciseTotals(st, id);
  root.append(h('header.page-head.detail-head',
    iconBtn('arrowLeft', 'Back to workouts', () => ctx.go('workouts')),
    h('div.page-head-text',
      h('p.eyebrow', `${ex.type === 'cardio' ? 'Cardio' : 'Strength'}${ex.archived ? ' · Archived' : ''}`),
      h('h1.page-title', ex.name)),
    iconBtn('edit', `Edit ${ex.name}`, () => openExerciseEditor(ex))));
  root.append(h('button.btn.primary.block.log-btn', { type: 'button', onclick: () => openWorkoutForm(null, { exerciseId: id }) }, icon('plus', { size: 20 }), `Log ${ex.name}`));

  if (!list.length) {
    root.append(h('section.card', emptyState(ex.type === 'cardio' ? '🏃' : '🏋️', 'No history yet', 'Log this exercise to see records and progress.')));
    return root;
  }

  // Personal records
  const wt = (kg) => `${trimNum(Math.round(fromKg(kg, s.weightUnit) * 2) / 2, 1)} ${weightLabel(s.weightUnit)}`;
  const cards = [];
  if (ex.type === 'cardio') {
    if (best.dist) cards.push(statCard(`${trimNum(fromKm(best.dist.v, s.distanceUnit))} ${distLabel(s.distanceUnit)}`, 'Longest distance', fmtDateShort(best.dist.date)));
    if (best.time) cards.push(statCard(fmtLong(best.time.v), 'Longest time', fmtDateShort(best.time.date)));
    if (best.pace) cards.push(statCard(paceText(best.pace.w, s), 'Fastest pace', fmtDateShort(best.pace.date)));
  } else {
    if (best.weight) {
      cards.push(statCard(wt(best.weight.v), 'Heaviest', fmtDateShort(best.weight.date)));
      const atTop = [...best.repsAt.values()].sort((a, b) => b.kg - a.kg)[0];
      const mostReps = [...best.repsAt.values()].sort((a, b) => b.v - a.v || b.kg - a.kg)[0];
      if (atTop) cards.push(statCard(`${atTop.v} reps`, `Most reps at ${wt(atTop.kg)}`, fmtDateShort(atTop.date)));
      if (mostReps && mostReps !== atTop) cards.push(statCard(`${mostReps.v} reps`, `Most reps (at ${wt(mostReps.kg)})`, fmtDateShort(mostReps.date)));
    }
    if (best.bodyReps) cards.push(statCard(`${best.bodyReps.v} reps`, 'Most reps (bodyweight)', fmtDateShort(best.bodyReps.date)));
    if (best.time) cards.push(statCard(fmtClock(best.time.v), 'Longest time', fmtDateShort(best.time.date)));
  }
  if (cards.length) root.append(h('section.section', h('div.section-head', h('h2.section-title', '🏆 Personal records')), h('div.stat-grid', cards)));

  // Totals
  const totals = [statCard(String(tot.sessions), tot.sessions === 1 ? 'Day logged' : 'Days logged')];
  if (ex.type === 'cardio') {
    if (tot.time) totals.push(statCard(fmtLong(tot.time), 'Total time'));
    if (tot.dist) totals.push(statCard(`${trimNum(tot.dist, 1)} ${distLabel(s.distanceUnit)}`, 'Total distance'));
  } else {
    if (tot.sets) totals.push(statCard(String(tot.sets), 'Total sets'));
    if (tot.reps) totals.push(statCard(String(tot.reps), 'Total reps'));
  }
  root.append(h('section.section', h('div.section-head', h('h2.section-title', 'Totals')), h('div.stat-grid', totals)));

  // Progress chart
  const series = chartSeries(st, id);
  let key = 'primary';
  if (ex.type === 'cardio') {
    key = ctx.ui.exChart === 'pace' && series.pace.points.length ? 'pace' : ctx.ui.exChart === 'time' && series.time.points.length ? 'time' : 'primary';
    if (!series.primary.points.length) key = series.pace.points.length ? 'pace' : 'time';
  }
  const cur = series[key];
  const toggle = ex.type === 'cardio' ? segmented([
    { value: 'primary', label: 'Distance' }, { value: 'pace', label: 'Pace' }, { value: 'time', label: 'Time' },
  ], key, (v) => { ctx.ui.exChart = v; ctx.rerender(); }, { label: 'Chart', small: true }) : null;
  root.append(h('section.card.chart-card',
    h('div.section-head', h('div', h('h2.section-title', cur.label), h('p.muted.small', cur.points.length ? `${cur.points.length} day${cur.points.length === 1 ? '' : 's'}` : 'No data')), toggle),
    cur.points.length ? lineChart(cur.points, cur.fmt) : h('p.hint-line', 'Nothing to chart yet.'),
    h('table.sr-only', h('caption', cur.label), h('tbody', cur.points.map((p) => h('tr', h('th', { scope: 'row' }, fmtDateShort(p.date)), h('td', cur.fmt(p.v))))))));

  // History
  const recs = new Map([...records]);
  root.append(h('section.section', h('div.section-head', h('h2.section-title', 'History')),
    h('ul.wo-list', [...list].reverse().map((w) => entryRow(w, st, recs, { showName: false })))));
  return root;
}

/** Simple single-series line chart (inline SVG) with a point tooltip per day. */
function lineChart(points, fmtV) {
  const mainW = document.getElementById('main')?.clientWidth || 360;
  const W = Math.round(Math.max(280, Math.min(680, mainW - 66))), H = 170, padL = 46, padR = 10, padT = 10, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo = lo * 0.9; hi = hi * 1.1 || 1; }
  const pad = (hi - lo) * 0.1;
  lo = Math.max(0, lo - pad); hi += pad;
  const x = (i) => padL + (points.length === 1 ? iw / 2 : (iw * i) / (points.length - 1));
  const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  const svg = s('svg', { class: 'line-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Line chart, ${points.length} points` });
  for (const g of [0, 0.5, 1]) {
    const v = lo + (hi - lo) * g;
    svg.append(s('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }),
      s('text', { x: padL - 6, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, fmtV(v)));
  }
  if (points.length > 1) svg.append(s('path', { class: 'line', d: points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ') }));
  points.forEach((p, i) => svg.append(s('g', { class: 'pt' },
    s('title', {}, `${fmtDateShort(p.date)}: ${fmtV(p.v)}`),
    s('circle', { cx: x(i), cy: y(p.v), r: 12, class: 'hit' }),
    s('circle', { cx: x(i), cy: y(p.v), r: 4, class: 'dot' }))));
  svg.append(s('text', { x: padL, y: H - 6, class: 'axis' }, fmtDateShort(points[0].date)));
  if (points.length > 1) svg.append(s('text', { x: W - padR, y: H - 6, class: 'axis', 'text-anchor': 'end' }, fmtDateShort(points[points.length - 1].date)));
  return svg;
}

// ---------------- Exercise management ----------------
export function openExerciseManager() {
  const st = getState();
  const counts = new Map();
  st.workouts.forEach((w) => counts.set(w.exerciseId, (counts.get(w.exerciseId) || 0) + 1));
  const sorted = [...st.exercises].sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name));
  const list = sorted.length
    ? h('ul.ex-manage', sorted.map((e) => h(`li${e.archived ? '.archived' : ''}`,
      h('button.ex-manage-row', { type: 'button', onclick: () => { sheet.close(); openExerciseEditor(e); }, 'aria-label': `Edit ${e.name}` },
        typeIcon(e),
        h('span.ex-manage-text', h('b', e.name), h('small', `${e.type === 'cardio' ? 'Cardio' : 'Strength'} · ${counts.get(e.id) || 0} logged${e.archived ? ' · Archived' : ''}`)),
        icon('chevronRight', { size: 18 })))))
    : h('p.hint-line', 'No exercises yet. They’re created when you log a workout, or add one here.');
  const sheet = openSheet({
    title: 'Exercises',
    content: [list],
    footer: [h('span'), h('button.btn.primary', { type: 'button', onclick: () => { sheet.close(); openExerciseEditor(null); } }, icon('plus', { size: 18 }), 'New exercise')],
  });
}

export function openExerciseEditor(ex) {
  const isNew = !ex;
  let type = ex?.type || 'strength';
  let archived = !!ex?.archived;
  const name = h('input.input', { type: 'text', maxlength: 60, value: ex?.name || '', autofocus: true, 'aria-label': 'Exercise name' });
  const err = h('p.form-error', { role: 'alert' });
  const arch = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(archived), 'aria-label': 'Archived', onclick: () => { archived = !archived; arch.setAttribute('aria-checked', String(archived)); } }, h('span.knob'));
  const count = ex ? getState().workouts.filter((w) => w.exerciseId === ex.id).length : 0;
  const save = () => {
    const n = name.value.trim().replace(/\s+/g, ' ');
    if (!n) { err.textContent = 'Please enter a name.'; name.focus(); return; }
    if (getState().exercises.some((e) => e.id !== ex?.id && e.name.toLowerCase() === n.toLowerCase())) { err.textContent = `You already have “${n}”.`; name.focus(); return; }
    update((s2) => {
      if (isNew) s2.exercises.push({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, type, archived: false, createdAt: Date.now() });
      else Object.assign(s2.exercises.find((e) => e.id === ex.id), { name: n, type, archived });
    });
    sheet.close();
    toast(isNew ? `Added ${n}` : `Saved ${n}`);
  };
  const remove = async () => {
    if (count) {
      const c = await choose(`Delete ${ex.name}?`, `${count} logged workout${count === 1 ? '' : 's'} would be deleted too. Archive it instead to hide it but keep the history.`, [
        { value: 'archive', label: 'Archive instead', style: 'primary' },
        { value: 'delete', label: `Delete with ${count} workout${count === 1 ? '' : 's'}`, style: 'danger' },
        { value: null, label: 'Cancel', style: 'ghost' },
      ]);
      if (c === 'archive') { update((s2) => { s2.exercises.find((e) => e.id === ex.id).archived = true; }); sheet.close(); toast(`${ex.name} archived`); }
      if (c === 'delete') { sheet.close(); deleteExercise(ex.id); if (location.hash.startsWith('#exercise/')) ctx.go('workouts'); }
      return;
    }
    if (!(await confirmDialog(`Delete ${ex.name}?`, 'It has no logged workouts.', { ok: 'Delete', danger: true }))) return;
    sheet.close();
    deleteExercise(ex.id);
    if (location.hash.startsWith('#exercise/')) ctx.go('workouts');
  };
  const content = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    h('div.field', h('label.field-label', 'Name'), name, !isNew ? h('p.field-hint', 'Renaming keeps all history.') : null),
    h('div.field', { role: 'group', 'aria-label': 'Type' }, h('span.field-label', 'Type'),
      segmented([{ value: 'strength', label: 'Strength', icon: 'dumbbell' }, { value: 'cardio', label: 'Cardio', icon: 'run' }], type, (v) => { type = v; }, { label: 'Type' }),
      h('p.field-hint', 'Strength: weight, sets, reps (+ optional time). Cardio: time and distance.')),
    !isNew ? h('div.set-row.compact', h('div.set-text', h('span.set-label', 'Archived'), h('span.set-desc', 'Hidden from quick picks; history is kept.')), arch) : null,
    err);
  const footer = [
    !isNew ? h('button.btn.danger-ghost', { type: 'button', onclick: remove }, icon('trash', { size: 18 }), 'Delete') : h('span'),
    h('button.btn.primary', { type: 'button', onclick: save }, isNew ? 'Add exercise' : 'Save'),
  ];
  const sheet = openSheet({ title: isNew ? 'New exercise' : 'Edit exercise', content, footer });
}

