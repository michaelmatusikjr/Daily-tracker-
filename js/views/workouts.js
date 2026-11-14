// Workouts tab (history by day + filter), exercise detail (records, totals, chart)
// and exercise management.
import { h, s, iconBtn, segmented, emptyState, openSheet, choose, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { getState, update } from '../store.js';
import { ctx } from '../ctx.js';
import { fmt, fmtDateShort, relativeLabel } from '../dates.js';
import {
  computeRecords, exerciseById, workoutSummary, periodStats, exerciseTotals, chartSeries,
  fmtClock, fmtLong, trimNum, weightLabel, distLabel, paceText, recordText, STD_DISTANCES,
} from '../workouts.js';
import { openWorkoutForm } from '../workoutForm.js';
import { deleteWorkout, deleteExercise, resyncExerciseDates, setExerciseArchived } from '../actions.js';
import { attachMenu, workoutMenu, exerciseMenu } from '../itemMenu.js';

export const TYPE_ICON = { strength: 'dumbbell', bodyweight: 'body', cardio: 'run' };
export const TYPE_NAME = { strength: 'Strength', bodyweight: 'Bodyweight', cardio: 'Cardio' };
export const typeIcon = (ex, size = 18) => icon(TYPE_ICON[ex?.type] || 'dumbbell', { size });
const TYPE_OPTIONS = [
  { value: 'strength', label: 'Strength', icon: 'dumbbell' }, { value: 'bodyweight', label: 'Bodyweight', icon: 'body' }, { value: 'cardio', label: 'Cardio', icon: 'run' },
];
export { TYPE_OPTIONS };
const dayLabel = (k) => fmt(k, { weekday: 'short', month: 'short', day: 'numeric' });

function allRecords(st) {
  const map = new Map();
  for (const ex of st.exercises) for (const [id, labels] of computeRecords(st, ex.id).records) map.set(id, labels);
  return map;
}

function prBadge(labels) {
  if (!labels) return null;
  const text = labels.map(recordText);
  return h('span.pr-badge', { title: text.join(' · '), 'aria-label': `Personal record: ${text.join(', ')}` }, '🏆');
}

/** One workout entry row: tap to edit, trash to delete (with Undo). */
function entryRow(w, st, records, { showName = true } = {}) {
  const ex = exerciseById(st, w.exerciseId);
  const summary = workoutSummary(w, ex, st.settings);
  const pop = ctx.anim.has('w-' + w.id);
  const li = h(`li.wo-entry${pop ? '.pop' : ''}`, { dataset: { id: w.id } },
    h('button.wo-main', { type: 'button', onclick: () => openWorkoutForm(w), 'aria-label': `Edit ${ex?.name || 'workout'}: ${summary}` },
      h('span.wo-icon', { 'aria-hidden': 'true' }, typeIcon(ex)),
      h('span.wo-text',
        h('span.wo-title', showName ? ex?.name || 'Workout' : dayLabel(w.date), prBadge(records.get(w.id))),
        h('span.wo-summary', summary),
        w.note ? h('span.wo-note', w.note) : null)),
    iconBtn('trash', `Delete ${ex?.name || 'workout'} on ${fmtDateShort(w.date)}`, () => deleteWorkout(w.id), 'wo-del'));
  attachMenu(li, () => workoutMenu(w.id), li.querySelector('.wo-main'));
  return li;
}

function matchesFilter(w, f, st) {
  if (f === 'all') return true;
  const ex = exerciseById(st, w.exerciseId);
  if (f in TYPE_NAME) return (ex?.type || 'strength') === f;
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
  root.append(h('div.wo-filters', { role: 'group', 'aria-label': 'Filter workouts' },
    h('div.filter-wrap', chip('all', 'All'), ...TYPE_OPTIONS.map((o) => chip(o.value, o.label, icon(o.icon, { size: 14 })))),
    exChips.length ? h('div.filter-row.ex-filter-row.no-swipe', exChips.map((e) => { const c = chip('ex:' + e.id, e.name); attachMenu(c, () => exerciseMenu(e.id), c); return c; })) : null));

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
  const { summary, records, list } = computeRecords(st, id);
  const tot = exerciseTotals(st, id);
  root.append(h('header.page-head.detail-head',
    iconBtn('arrowLeft', 'Back to workouts', () => ctx.go('workouts')),
    h('div.page-head-text',
      h('p.eyebrow', `${TYPE_NAME[ex.type] || 'Strength'}${ex.archived ? ' · Archived' : ''}`),
      h('h1.page-title', ex.name)),
    iconBtn('edit', `Edit ${ex.name}`, () => openExerciseEditor(ex))));
  root.append(h('button.btn.primary.block.log-btn', { type: 'button', onclick: () => openWorkoutForm(null, { exerciseId: id }) }, icon('plus', { size: 20 }), `Log ${ex.name}`));

  if (!list.length) {
    root.append(h('section.card', emptyState({ cardio: '🏃', bodyweight: '🤸' }[ex.type] || '🏋️', 'No history yet', 'Log this exercise to see records and progress.')));
    return root;
  }

  // Personal records
  root.append(recordsCard(ex, summary, s));

  // Totals
  const totals = [statCard(String(tot.sessions), tot.sessions === 1 ? 'Day logged' : 'Days logged')];
  if (ex.type === 'cardio') {
    if (tot.time) totals.push(statCard(fmtLong(tot.time), 'Total time'));
    if (tot.dist) totals.push(statCard(`${trimNum(tot.dist, 1)} ${distLabel(s.distanceUnit)}`, 'Total distance'));
  } else {
    if (tot.sets) totals.push(statCard(String(tot.sets), 'Total sets'));
    if (tot.reps) totals.push(statCard(String(tot.reps), 'Total reps'));
    if (ex.type === 'bodyweight' && tot.time) totals.push(statCard(fmtClock(tot.time), 'Total hold time'));
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
    h('div.section-head', h('div', h('h2.section-title', cur.label), h('p.muted.small', cur.points.length ? `${cur.points.length} day${cur.points.length === 1 ? '' : 's'}${cur.markLabel && cur.points.some((p) => p.mark) ? ' · ◆ = 3×5 day' : ''}` : 'No data')), toggle),
    cur.points.length ? lineChart(cur.points, cur.fmt, cur.markLabel) : h('p.hint-line', 'Nothing to chart yet.'),
    h('table.sr-only', h('caption', cur.label), h('tbody', cur.points.map((p) => h('tr', h('th', { scope: 'row' }, fmtDateShort(p.date)), h('td', cur.fmt(p.v))))))));

  // History
  const recs = new Map([...records]);
  root.append(h('section.section', h('div.section-head', h('h2.section-title', 'History')),
    h('ul.wo-list', [...list].reverse().map((w) => entryRow(w, st, recs, { showName: false })))));
  return root;
}

/** Simple single-series line chart (inline SVG) with a point tooltip per day. */
function lineChart(points, fmtV, markLabel = '') {
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
  points.forEach((p, i) => svg.append(s('g', { class: `pt${p.mark ? ' marked' : ''}` },
    s('title', {}, `${fmtDateShort(p.date)}: ${fmtV(p.v)}${p.mark ? ` · ${markLabel}` : ''}`),
    s('circle', { cx: x(i), cy: y(p.v), r: 12, class: 'hit' }),
    p.mark ? s('rect', { x: x(i) - 5, y: y(p.v) - 5, width: 10, height: 10, rx: 2, class: 'mark', transform: `rotate(45 ${x(i)} ${y(p.v)})` }) : s('circle', { cx: x(i), cy: y(p.v), r: 4, class: 'dot' }))));
  svg.append(s('text', { x: padL, y: H - 6, class: 'axis' }, fmtDateShort(points[0].date)));
  if (points.length > 1) svg.append(s('text', { x: W - padR, y: H - 6, class: 'axis', 'text-anchor': 'end' }, fmtDateShort(points[points.length - 1].date)));
  return svg;
}

/** Records card by type. */
function recordsCard(ex, sum, s) {
  const wt = (v) => `${trimNum(v, 1)} ${weightLabel(s.weightUnit)}`;
  const cell = (value, label, sub) => statCard(value ?? '—', label, sub);
  const card = h('section.section', h('div.section-head', h('h2.section-title', '🏆 Records')));
  if (sum.type === 'strength') {
    card.append(h('div.stat-grid',
      cell(sum.oneRm && wt(sum.oneRm.v), '1-rep max', sum.oneRm ? fmtDateShort(sum.oneRm.date) : 'Log a lift'),
      cell(sum.threeByFive && wt(sum.threeByFive.v), '3×5 max', sum.threeByFive ? fmtDateShort(sum.threeByFive.date) : '3 sets of 5+ reps at one weight')));
    return card;
  }
  if (sum.type === 'bodyweight') {
    const period = (p, label) => {
      const b = sum[p];
      const so = p !== 'day' && sum.current[p] ? `This ${p} so far: ${sum.current[p]}` : null;
      return cell(b ? `${b.v} reps` : null, `Most in a ${label}`, [b ? (p === 'day' ? fmtDateShort(b.date) : null) : null, so].filter(Boolean).join(' · ') || null);
    };
    card.append(h('div.stat-grid', period('day', 'day'), period('week', 'week'), period('month', 'month'), period('year', 'year'),
      sum.hold ? cell(fmtClock(sum.hold.v), 'Longest hold', fmtDateShort(sum.hold.date)) : null));
    return card;
  }
  // Cardio: fastest time per standard distance
  const rows = STD_DISTANCES.filter((d) => sum.distances[d.id]);
  const missing = STD_DISTANCES.find((d) => !sum.distances[d.id]);
  card.append(h('div.card.dist-records',
    rows.length ? h('table.dist-table',
      h('thead', h('tr', h('th', { scope: 'col' }, 'Distance'), h('th', { scope: 'col' }, 'Time'), h('th', { scope: 'col' }, 'Pace'), h('th', { scope: 'col' }, 'Date'))),
      h('tbody', rows.map((d) => { const b = sum.distances[d.id]; return h('tr', h('th', { scope: 'row' }, d.label), h('td', fmtClock(b.time)), h('td', paceText(b.w, s)), h('td', fmtDateShort(b.date))); })))
      : null,
    missing ? h('p.muted.small', `Log a ${missing.hint} to set a record.`) : null));
  return card;
}

/** Strength exercise whose entries look like bodyweight work (time-only or no weight). */
function looksBodyweight(st, e) {
  if (e.type !== 'strength') return false;
  const ws = st.workouts.filter((w) => w.exerciseId === e.id);
  return ws.length > 0 && ws.some((w) => w.time > 0 || !w.lines.some((l) => l.weight > 0));
}

// ---------------- Exercise management ----------------
const withExMenu = (e, li) => { attachMenu(li, () => exerciseMenu(e.id), li.querySelector('button')); return li; };
export function openExerciseManager() {
  const st = getState();
  const counts = new Map();
  st.workouts.forEach((w) => counts.set(w.exerciseId, (counts.get(w.exerciseId) || 0) + 1));
  const sorted = [...st.exercises].sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name));
  const list = sorted.length
    ? h('ul.ex-manage', sorted.map((e) => withExMenu(e, h(`li${e.archived ? '.archived' : ''}`,
      h('button.ex-manage-row', { type: 'button', onclick: () => { sheet.close(); openExerciseEditor(e); }, 'aria-label': `Edit ${e.name}` },
        typeIcon(e),
        h('span.ex-manage-text', h('b', e.name), h('small', `${TYPE_NAME[e.type] || 'Strength'} · ${counts.get(e.id) || 0} logged${e.archived ? ' · Archived' : ''}`),
          looksBodyweight(st, e) ? h('small.ex-hint', 'Has time-only or no-weight entries – Bodyweight may fit better.') : null),
        icon('chevronRight', { size: 18 }))))))
    : h('p.hint-line', 'No exercises yet. They’re created when you log a workout, or add one here.');
  const sheet = openSheet({
    title: 'Exercises',
    content: [list],
    footer: [h('span'), h('button.btn.primary', { type: 'button', onclick: () => { sheet.close(); openExerciseEditor(null); } }, icon('plus', { size: 18 }), 'New exercise')],
  });
}

/** Delete an exercise, offering "Archive instead" when it has history. onDone runs before deleting/archiving. */
export async function confirmDeleteExercise(ex, onDone = () => {}) {
  const count = getState().workouts.filter((w) => w.exerciseId === ex.id).length;
  const leave = () => { if (location.hash === '#exercise/' + encodeURIComponent(ex.id)) ctx.go('workouts'); };
  if (count) {
    const c = await choose(`Delete ${ex.name}?`, `${count} logged workout${count === 1 ? '' : 's'} would be deleted too. Archive it instead to hide it but keep the history.`, [
      { value: 'archive', label: 'Archive instead', style: 'primary' },
      { value: 'delete', label: `Delete with ${count} workout${count === 1 ? '' : 's'}`, style: 'danger' },
      { value: null, label: 'Cancel', style: 'ghost' },
    ]);
    if (c === 'archive') { onDone(); setExerciseArchived(ex.id, true); }
    if (c === 'delete') { onDone(); deleteExercise(ex.id); leave(); }
    return;
  }
  if (!(await confirmDialog(`Delete ${ex.name}?`, 'It has no logged workouts.', { ok: 'Delete', danger: true }))) return;
  onDone();
  deleteExercise(ex.id);
  leave();
}

export function openExerciseEditor(ex) {
  const isNew = !ex;
  let type = ex?.type || 'strength';
  let archived = !!ex?.archived;
  const name = h('input.input', { type: 'text', maxlength: 60, value: ex?.name || '', autofocus: true, 'aria-label': 'Exercise name' });
  const err = h('p.form-error', { role: 'alert' });
  const arch = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(archived), 'aria-label': 'Archived', onclick: () => { archived = !archived; arch.setAttribute('aria-checked', String(archived)); } }, h('span.knob'));
  const save = () => {
    const n = name.value.trim().replace(/\s+/g, ' ');
    if (!n) { err.textContent = 'Please enter a name.'; name.focus(); return; }
    if (getState().exercises.some((e) => e.id !== ex?.id && e.name.toLowerCase() === n.toLowerCase())) { err.textContent = `You already have “${n}”.`; name.focus(); return; }
    update((s2) => {
      if (isNew) s2.exercises.push({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, type, archived: false, createdAt: Date.now() });
      else {
        const typeChanged = ex.type !== type;
        Object.assign(s2.exercises.find((e) => e.id === ex.id), { name: n, type, archived });
        if (typeChanged) resyncExerciseDates(s2, ex.id); // a Strength/Cardio-only habit link may change
      }
    });
    sheet.close();
    toast(isNew ? `Added ${n}` : `Saved ${n}`);
  };
  const remove = () => confirmDeleteExercise(ex, () => sheet.close());
  const content = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    h('div.field', h('label.field-label', 'Name'), name, !isNew ? h('p.field-hint', 'Renaming keeps all history.') : null),
    h('div.field', { role: 'group', 'aria-label': 'Type' }, h('span.field-label', 'Type'),
      segmented(TYPE_OPTIONS, type, (v) => { type = v; }, { label: 'Type', small: true }),
      h('p.field-hint', 'Strength: weight, sets, reps. Bodyweight: sets, reps, optional weight vest and hold time. Cardio: time and distance. Changing the type keeps all history.')),
    !isNew ? h('div.set-row.compact', h('div.set-text', h('span.set-label', 'Archived'), h('span.set-desc', 'Hidden from quick picks; history is kept.')), arch) : null,
    err);
  const footer = [
    !isNew ? h('button.btn.danger-ghost', { type: 'button', onclick: remove }, icon('trash', { size: 18 }), 'Delete') : h('span'),
    h('button.btn.primary', { type: 'button', onclick: save }, isNew ? 'Add exercise' : 'Save'),
  ];
  const sheet = openSheet({ title: isNew ? 'New exercise' : 'Edit exercise', content, footer });
}

