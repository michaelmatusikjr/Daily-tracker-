// State mutations used by views and forms (with undo where it matters).
import { update, getState, uid } from './store.js';
import { ctx } from './ctx.js';
import { toast, haptic, choose } from './ui.js';
import { isRecurring, isTaskDone, habitTarget, habitVal, dayProgress } from './logic.js';
import { todayKey, fmtDateShort, addDays } from './dates.js';
import { syncHabitLink, computeRecords, exerciseById, workoutSummary, recordToast } from './workouts.js';

function celebrateIfDone(k, before, undo = null) {
  const after = dayProgress(getState(), k);
  if (before.pct < 1 && after.pct === 1 && after.total > 0) {
    ctx.anim.add('ring');
    const msg = k === todayKey() ? 'Everything done for today. Nice work! 🎉' : 'Everything done for that day 🎉';
    setTimeout(() => toast(msg, undo ? { action: 'Undo', onAction: undo } : {}), 50);
    haptic([20, 40, 20]);
    return true;
  }
  return false;
}

/** Explicitly set a task occurrence's completion (used by toggle and by undo). */
export function setTaskDone(id, k, value) {
  update((s) => {
    const x = s.tasks.find((y) => y.id === id);
    if (!x) return;
    if (isRecurring(x)) {
      if (value) x.doneDates[k] = true; else delete x.doneDates[k];
    } else {
      x.done = !!value;
    }
    x.updatedAt = Date.now();
  });
}

// ---------- Tasks ----------
export function toggleTask(id, k) {
  const st = getState();
  const t = st.tasks.find((x) => x.id === id);
  if (!t) return;
  const was = isTaskDone(t, k);
  const before = dayProgress(st, k);
  if (!was) ctx.anim.add('t-' + id);
  setTaskDone(id, k, !was);
  haptic(was ? 5 : 12);
  if (was) return;
  const undo = () => setTaskDone(id, k, was);
  if (!celebrateIfDone(k, before, undo)) {
    toast(`Completed “${t.title}”`, { action: 'Undo', onAction: undo });
  }
}

export function moveToToday(ids) {
  const today = todayKey();
  const prev = new Map();
  update((s) => {
    for (const t of s.tasks) if (ids.includes(t.id)) { prev.set(t.id, t.date); t.date = today; t.updatedAt = Date.now(); }
  });
  toast(ids.length === 1 ? 'Moved to today' : `Moved ${ids.length} tasks to today`, {
    action: 'Undo',
    onAction: () => update((s) => { for (const t of s.tasks) if (prev.has(t.id)) t.date = prev.get(t.id); }),
  });
}

export function saveTask(data) {
  update((s) => {
    const existing = data.id && s.tasks.find((t) => t.id === data.id);
    if (existing) {
      Object.assign(existing, data, { updatedAt: Date.now() });
    } else {
      const maxOrder = s.tasks.reduce((m, t) => Math.max(m, t.order || 0), 0);
      s.tasks.push({
        notes: '', time: null, duration: null, priority: 0, category: null, reminder: null,
        recur: { type: 'none', days: [], interval: 2 }, done: false, doneDates: {}, exceptions: [],
        createdAt: Date.now(), ...data, id: uid(), order: maxOrder + 1,
      });
    }
  });
}

/** Delete a task. For recurring tasks ask: this day only vs the whole series. Returns true if deleted. */
export async function deleteTask(id, k) {
  const st = getState();
  const t = st.tasks.find((x) => x.id === id);
  if (!t) return false;
  if (isRecurring(t)) {
    const choice = await choose('Delete repeating task', `“${t.title}” repeats. What would you like to delete?`, [
      { value: 'one', label: 'This day only', style: 'secondary' },
      { value: 'all', label: 'Whole series', style: 'danger' },
      { value: null, label: 'Cancel', style: 'ghost' },
    ]);
    if (!choice) return false;
    if (choice === 'one') { skipTaskDay(id, k, 'Removed from this day'); return true; }
  }
  const snapshot = JSON.parse(JSON.stringify(t));
  const index = st.tasks.indexOf(t);
  update((s) => { s.tasks = s.tasks.filter((x) => x.id !== id); });
  toast(`Deleted “${t.title}”`, {
    action: 'Undo',
    onAction: () => update((s) => { s.tasks.splice(Math.min(index, s.tasks.length), 0, snapshot); }),
  });
  return true;
}

/** Skip one occurrence of a repeating task (an exception), with Undo. */
export function skipTaskDay(id, k, msg = `Skipped ${fmtDateShort(k)}`) {
  const t = getState().tasks.find((x) => x.id === id);
  if (!t) return;
  const wasDone = !!t.doneDates?.[k];
  update((s) => {
    const x = s.tasks.find((y) => y.id === id);
    if (!x.exceptions.includes(k)) x.exceptions.push(k);
    x.updatedAt = Date.now();
    delete x.doneDates[k];
  });
  toast(msg, {
    action: 'Undo',
    onAction: () => update((s) => {
      const x = s.tasks.find((y) => y.id === id);
      if (!x) return;
      x.exceptions = x.exceptions.filter((d) => d !== k);
      if (wasDone) x.doneDates[k] = true;
    }),
  });
}

/** Move a one-off task to another day, with Undo. */
export function moveTask(id, date) {
  const t = getState().tasks.find((x) => x.id === id);
  if (!t || !date || t.date === date) return;
  const prev = t.date;
  update((s) => { const x = s.tasks.find((y) => y.id === id); if (x) { x.date = date; x.updatedAt = Date.now(); } });
  const label = date === todayKey() ? 'today' : date === addDays(todayKey(), 1) ? 'tomorrow' : fmtDateShort(date);
  toast(`Moved “${t.title}” to ${label}`, {
    action: 'Undo',
    onAction: () => update((s) => { const x = s.tasks.find((y) => y.id === id); if (x) x.date = prev; }),
  });
}

/** Copy a task (not its completion), placed right after the original, with Undo. */
export function duplicateTask(id) {
  const t = getState().tasks.find((x) => x.id === id);
  if (!t) return;
  const copy = { ...JSON.parse(JSON.stringify(t)), id: uid(), done: false, doneDates: {}, createdAt: Date.now(), updatedAt: Date.now(), order: (t.order || 0) + 0.5 };
  update((s) => { s.tasks.push(copy); });
  toast(`Duplicated “${t.title}”`, { action: 'Undo', onAction: () => update((s) => { s.tasks = s.tasks.filter((x) => x.id !== copy.id); }) });
}

export function reorderTasks(ids) {
  update((s) => {
    ids.forEach((id, i) => { const t = s.tasks.find((x) => x.id === id); if (t) t.order = i; });
  });
}

// ---------- Habits ----------
export function setHabitValue(id, k, v, { silentUndo = false } = {}) {
  if (k > todayKey()) return; // can't complete habits in the future
  const st = getState();
  const before = dayProgress(st, k);
  const h = st.habits.find((x) => x.id === id);
  if (!h) return;
  const prev = habitVal(st, h, k);
  const wasDone = prev >= habitTarget(h);
  const value = Math.max(0, Math.min(9999, v));
  update((s) => {
    s.logs[id] = s.logs[id] || {};
    if (value > 0) s.logs[id][k] = value; else delete s.logs[id][k];
    // A manual change takes over from the workout link for that day.
    if (s.autoHabit[id]) { delete s.autoHabit[id][k]; if (!Object.keys(s.autoHabit[id]).length) delete s.autoHabit[id]; }
  });
  const nowDone = value >= habitTarget(h);
  if (nowDone && !wasDone) {
    ctx.anim.add('h-' + id); haptic(15);
    if (!silentUndo) celebrateIfDone(k, before, () => setHabitValue(id, k, prev, { silentUndo: true }));
  }
  else haptic(6);
}

export function bumpHabit(id, k, delta) {
  const st = getState();
  const h = st.habits.find((x) => x.id === id);
  if (!h) return;
  const cur = habitVal(st, h, k);
  if (h.goal.type !== 'count') {
    setHabitValue(id, k, cur >= 1 ? 0 : 1);
  } else {
    if (delta < 0 && cur === 0) return;
    setHabitValue(id, k, cur + delta);
  }
}

/** Clear a habit's value for one day, with Undo. */
export function resetHabitDay(id, k) {
  const st = getState();
  const hb = st.habits.find((x) => x.id === id);
  if (!hb) return;
  const prev = habitVal(st, hb, k);
  if (!prev) return;
  setHabitValue(id, k, 0);
  toast(`Reset ${hb.name} for ${k === todayKey() ? 'today' : fmtDateShort(k)}`, { action: 'Undo', onAction: () => setHabitValue(id, k, prev, { silentUndo: true }) });
}

/** Toggle a day fully done / not done (used by the week dots and calendars). */
export function toggleHabitDay(id, k) {
  const st = getState();
  const h = st.habits.find((x) => x.id === id);
  if (!h) return;
  setHabitValue(id, k, habitVal(st, h, k) >= habitTarget(h) ? 0 : habitTarget(h));
}

export function saveHabit(data) {
  let id = data.id;
  update((s) => {
    const existing = id && s.habits.find((x) => x.id === id);
    if (existing) Object.assign(existing, data, { updatedAt: Date.now() });
    else {
      id = uid();
      const maxOrder = s.habits.reduce((m, x) => Math.max(m, x.order || 0), 0);
      s.habits.push({ archived: false, createdAt: todayKey(), ...data, id, order: maxOrder + 1 });
    }
  });
  // The workout link only works with check-off habits.
  const st = getState();
  const hb = st.habits.find((x) => x.id === id);
  if (st.settings.workoutHabit?.habitId === id && hb?.goal.type !== 'check') {
    update((s) => { clearAutoChecks(s, id); s.settings.workoutHabit = { habitId: null, filter: 'any' }; });
    setTimeout(() => toast(`Workout link removed: “${hb.name}” is now a count habit`, { duration: 6000 }), 60);
  }
  return id;
}

/** Remove the checks the workout link made for a habit (manual checks stay). */
function clearAutoChecks(s, hid) {
  const auto = s.autoHabit[hid];
  if (!auto) return;
  for (const d of Object.keys(auto)) if (s.logs[hid]) delete s.logs[hid][d];
  delete s.autoHabit[hid];
}

/** Change the workout → habit link. Switching to another habit removes the old one's auto-only checks. */
export function setWorkoutHabit(habitId, filter) {
  update((s) => {
    const old = s.settings.workoutHabit?.habitId || null;
    if (old && old !== habitId) clearAutoChecks(s, old);
    s.settings.workoutHabit = { habitId: habitId || null, filter: filter || s.settings.workoutHabit?.filter || 'any' };
  });
}

/** After an exercise's type changes, a type-filtered habit link may need re-checking on its dates. */
export function resyncExerciseDates(s, exerciseId) {
  const dates = [...new Set(s.workouts.filter((w) => w.exerciseId === exerciseId).map((w) => w.date))];
  dates.forEach((d) => syncHabitLink(s, d));
}

function unlinkWorkoutHabit(s, id) {
  if (s.settings.workoutHabit?.habitId === id) s.settings.workoutHabit = { habitId: null, filter: 'any' };
}

export function setArchived(id, archived) {
  update((s) => { const x = s.habits.find((y) => y.id === id); if (x) { x.archived = archived; x.updatedAt = Date.now(); } if (archived) unlinkWorkoutHabit(s, id); });
  toast(archived ? 'Habit archived' : 'Habit restored', {
    action: 'Undo',
    onAction: () => update((s) => { const x = s.habits.find((y) => y.id === id); if (x) x.archived = !archived; }),
  });
}

export function deleteHabit(id) {
  const st = getState();
  const habit = st.habits.find((x) => x.id === id);
  if (!habit) return;
  const snap = JSON.parse(JSON.stringify(habit));
  const logs = st.logs[id] ? { ...st.logs[id] } : null;
  update((s) => { s.habits = s.habits.filter((x) => x.id !== id); delete s.logs[id]; delete s.autoHabit[id]; unlinkWorkoutHabit(s, id); });
  toast(`Deleted “${habit.name}”`, {
    action: 'Undo',
    onAction: () => update((s) => { s.habits.push(snap); if (logs) s.logs[id] = logs; }),
  });
}

export function reorderHabits(ids) {
  update((s) => { ids.forEach((id, i) => { const x = s.habits.find((y) => y.id === id); if (x) x.order = i; }); });
}

// ---------- Journal ----------
export function setMood(k, mood) {
  update((s) => {
    const j = s.journal[k] || { mood: null, note: '' };
    j.mood = j.mood === mood ? null : mood;
    j.updatedAt = Date.now();
    if (!j.mood && !j.note) delete s.journal[k]; else s.journal[k] = j;
  });
  haptic(8);
}

export function setNote(k, note) {
  update((s) => {
    const j = s.journal[k] || { mood: null, note: '' };
    j.note = note.slice(0, 1000);
    j.updatedAt = Date.now();
    if (!j.mood && !j.note) delete s.journal[k]; else s.journal[k] = j;
  }, { silent: true });
}

// ---------- Examples ----------
export function seedExamples() {
  const today = todayKey();
  const examples = [
    { name: 'Drink water', emoji: '💧', color: '#0ea5e9', goal: { type: 'count', target: 8, unit: 'glasses' }, timeOfDay: 'anytime', schedule: { type: 'daily', days: [], times: 3 } },
    { name: 'Morning stretch', emoji: '🧘', color: '#8b5cf6', goal: { type: 'check', target: 1, unit: '' }, timeOfDay: 'morning', schedule: { type: 'daily', days: [], times: 3 } },
    { name: 'Read 20 minutes', emoji: '📚', color: '#f59e0b', goal: { type: 'check', target: 1, unit: '' }, timeOfDay: 'evening', schedule: { type: 'daily', days: [], times: 3 } },
    { name: 'Workout', emoji: '🏃', color: '#ef4444', goal: { type: 'check', target: 1, unit: '' }, timeOfDay: 'anytime', schedule: { type: 'perWeek', days: [], times: 3 } },
  ];
  update((s) => {
    let order = s.habits.reduce((m, x) => Math.max(m, x.order || 0), 0);
    for (const e of examples) {
      if (s.habits.some((x) => x.name === e.name)) continue;
      s.habits.push({ id: uid(), reminder: null, archived: false, createdAt: today, order: ++order, ...e });
    }
  });
}

// ---------- Workouts ----------
/** Everything a workout save/delete can change, for an exact Undo (incl. the linked habit). */
function workoutSnapshot(s) {
  const hid = s.settings.workoutHabit?.habitId;
  return JSON.parse(JSON.stringify({
    workouts: s.workouts, exercises: s.exercises, hid,
    logs: hid ? s.logs[hid] || null : null, auto: hid ? s.autoHabit[hid] || null : null,
  }));
}
function restoreSnapshot(snap) {
  update((s) => {
    s.workouts = snap.workouts;
    s.exercises = snap.exercises;
    if (snap.hid) {
      if (snap.logs) s.logs[snap.hid] = snap.logs; else delete s.logs[snap.hid];
      if (snap.auto) s.autoHabit[snap.hid] = snap.auto; else delete s.autoHabit[snap.hid];
    }
  });
}

/**
 * Save a workout (new or edited). `newExercise` = { name, type } creates the exercise first.
 * Shows a toast with Undo, or a 🏆 toast when it sets a personal record.
 */
export function saveWorkout(data, { newExercise = null } = {}) {
  const snap = workoutSnapshot(getState());
  let id = data.id;
  // Records this entry already held, so re-saving it (or changing only a note/date) doesn't celebrate again.
  const before = getState().workouts.find((w) => w.id === id);
  const had = before ? computeRecords(getState(), before.exerciseId).records.get(id) || [] : [];
  let exerciseId = data.exerciseId;
  let oldDate = null;
  update((s) => {
    if (newExercise) {
      exerciseId = uid();
      s.exercises.push({ id: exerciseId, name: newExercise.name.slice(0, 60), type: ['cardio', 'bodyweight'].includes(newExercise.type) ? newExercise.type : 'strength', archived: false, createdAt: Date.now() });
    }
    const entry = { ...data, exerciseId };
    const existing = id && s.workouts.find((w) => w.id === id);
    if (existing) { oldDate = existing.date; Object.assign(existing, entry); } else {
      id = uid();
      s.workouts.push({ ...entry, id, createdAt: Date.now() });
    }
    syncHabitLink(s, entry.date);
    if (oldDate && oldDate !== entry.date) syncHabitLink(s, oldDate);
  });
  const st = getState();
  const w = st.workouts.find((x) => x.id === id);
  const ex = exerciseById(st, exerciseId);
  const labels = (computeRecords(st, exerciseId).records.get(id) || [])
    .filter((r) => !had.some((o) => o.kind === r.kind && o.value === r.value));
  const undo = { action: 'Undo', onAction: () => restoreSnapshot(snap) };
  if (labels.length) {
    ctx.anim.add('w-' + id);
    haptic([20, 40, 20]);
    // e.g. '🏆 New 3×5 max: Squat 235 lbs' or '🏆 Fastest 5K: Run 24:50'
    toast(recordToast(labels, ex.name), { ...undo, duration: 6000 });
  } else {
    toast(`${data.id ? 'Saved' : 'Logged'} ${ex.name} · ${workoutSummary(w, ex, st.settings)}`, undo);
  }
  return id;
}

export function deleteWorkout(id) {
  const st = getState();
  const w = st.workouts.find((x) => x.id === id);
  if (!w) return;
  const ex = exerciseById(st, w.exerciseId);
  const snap = workoutSnapshot(st);
  update((s) => { s.workouts = s.workouts.filter((x) => x.id !== id); syncHabitLink(s, w.date); });
  toast(`Deleted ${ex?.name || 'workout'}`, { action: 'Undo', onAction: () => restoreSnapshot(snap) });
}

/** Archive / unarchive an exercise, with Undo. */
export function setExerciseArchived(id, archived) {
  const ex = exerciseById(getState(), id);
  if (!ex) return;
  update((s) => { const e = s.exercises.find((x) => x.id === id); if (e) e.archived = archived; });
  toast(`${ex.name} ${archived ? 'archived' : 'restored'}`, {
    action: 'Undo', onAction: () => update((s) => { const e = s.exercises.find((x) => x.id === id); if (e) e.archived = !archived; }),
  });
}

/** Delete an exercise and all of its workouts (Undo restores both). */
export function deleteExercise(id) {
  const st = getState();
  const ex = exerciseById(st, id);
  if (!ex) return;
  const snap = workoutSnapshot(st);
  const dates = [...new Set(st.workouts.filter((w) => w.exerciseId === id).map((w) => w.date))];
  update((s) => {
    s.exercises = s.exercises.filter((e) => e.id !== id);
    s.workouts = s.workouts.filter((w) => w.exerciseId !== id);
    dates.forEach((d) => syncHabitLink(s, d));
  });
  toast(`Deleted ${ex.name}`, { action: 'Undo', onAction: () => restoreSnapshot(snap) });
}
