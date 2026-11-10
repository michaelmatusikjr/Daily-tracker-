// Pure domain logic: recurrence, completion, streaks, stats.
import { addDays, diffDays, dow, daysInMonth, isoWeekStart, todayKey, timeToMin } from './dates.js';

// ---------- Tasks ----------
export const isRecurring = (t) => (t.recur?.type || 'none') !== 'none';

export function occursOn(t, k) {
  if (k < t.date) return false;
  if (t.exceptions?.includes(k)) return false;
  const r = t.recur || { type: 'none' };
  switch (r.type) {
    case 'daily': return true;
    case 'weekdays': { const d = dow(k); return d > 0 && d < 6; }
    case 'weekly': {
      const days = r.days?.length ? r.days : [dow(t.date)];
      return days.includes(dow(k));
    }
    case 'monthly': {
      const startDay = Number(t.date.slice(8, 10));
      const [y, m, d] = k.split('-').map(Number);
      return d === Math.min(startDay, daysInMonth(y, m - 1));
    }
    case 'interval': {
      const n = Math.max(1, r.interval || 1);
      return diffDays(t.date, k) % n === 0;
    }
    default: return k === t.date;
  }
}

export const isTaskDone = (t, k) => (isRecurring(t) ? !!t.doneDates?.[k] : !!t.done);

export const tasksOn = (state, k) => state.tasks.filter((t) => occursOn(t, k));

export function splitTasks(tasks) {
  const timed = tasks.filter((t) => t.time).sort((a, b) => a.time.localeCompare(b.time) || a.order - b.order);
  const anytime = tasks.filter((t) => !t.time).sort((a, b) => a.order - b.order);
  return { timed, anytime };
}

export function overdueTasks(state, today = todayKey()) {
  return state.tasks
    .filter((t) => !isRecurring(t) && !t.done && t.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function recurrenceLabel(t, dayNames) {
  const r = t.recur || {};
  switch (r.type) {
    case 'daily': return 'Every day';
    case 'weekdays': return 'Weekdays';
    case 'weekly': {
      const days = r.days?.length ? r.days : [dow(t.date)];
      return 'Weekly · ' + [...days].sort().map((d) => dayNames[d]).join(', ');
    }
    case 'monthly': return `Monthly on day ${Number(t.date.slice(8))}`;
    case 'interval': return `Every ${r.interval} days`;
    default: return '';
  }
}

export function taskEndTime(t) {
  if (!t.time) return null;
  return timeToMin(t.time) + (t.duration || 0);
}

// ---------- Habits ----------
export const activeHabits = (state) => state.habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);

export const habitTarget = (h) => (h.goal?.type === 'count' ? Math.max(1, h.goal.target || 1) : 1);
export const habitVal = (state, h, k) => state.logs[h.id]?.[k] || 0;
export const habitDone = (state, h, k) => habitVal(state, h, k) >= habitTarget(h);

/** Is the habit expected on that weekday (for day-based schedules)? perWeek: any day counts. */
export function isScheduled(h, k) {
  if (h.schedule?.type === 'days') return (h.schedule.days || []).includes(dow(k));
  return true;
}

export function weekCount(state, h, k) {
  const ws = isoWeekStart(k);
  let c = 0;
  for (let i = 0; i < 7; i++) if (habitDone(state, h, addDays(ws, i))) c++;
  return c;
}

/** First day the habit "exists": creation date or earliest log, whichever is earlier. */
export function habitStart(state, h) {
  let s = h.createdAt || todayKey();
  const logs = state.logs[h.id];
  if (logs) for (const k in logs) if (logs[k] > 0 && k < s) s = k;
  return s;
}

/** Should this habit appear as something to do on day k? */
export function isDueOn(state, h, k) {
  if (h.schedule?.type === 'perWeek') {
    return habitDone(state, h, k) || weekCount(state, h, k) < (h.schedule.times || 1);
  }
  return isScheduled(h, k);
}

/**
 * Streaks respect schedules: days the habit isn't scheduled never break a streak,
 * and today (still in progress) never breaks it either. perWeek habits count
 * consecutive ISO weeks where the weekly target was met.
 */
export function streaks(state, h, today = todayKey()) {
  const start = habitStart(state, h);
  if (start > today) return { current: 0, best: 0, unit: h.schedule?.type === 'perWeek' ? 'week' : 'day' };
  if (h.schedule?.type === 'perWeek') {
    const times = h.schedule.times || 1;
    const thisWeek = isoWeekStart(today);
    let run = 0, best = 0;
    for (let w = isoWeekStart(start); w <= thisWeek; w = addDays(w, 7)) {
      const met = weekCount(state, h, w) >= times;
      if (met) { run++; best = Math.max(best, run); }
      else if (w !== thisWeek) run = 0;
    }
    return { current: run, best, unit: 'week' };
  }
  let run = 0, best = 0;
  for (let k = start; k <= today; k = addDays(k, 1)) {
    if (!isScheduled(h, k)) continue;
    if (habitDone(state, h, k)) { run++; if (run > best) best = run; }
    else if (k !== today) run = 0;
  }
  return { current: run, best, unit: 'day' };
}

/** Completion rate over the last `days` days (or all time when null). Returns 0..1 or null. */
export function completionRate(state, h, days = null, today = todayKey()) {
  const start = habitStart(state, h);
  if (start > today) return null;
  const from = days ? (addDays(today, -(days - 1)) > start ? addDays(today, -(days - 1)) : start) : start;
  if (h.schedule?.type === 'perWeek') {
    const times = h.schedule.times || 1;
    let done = 0;
    for (let k = from; k <= today; k = addDays(k, 1)) if (habitDone(state, h, k)) done++;
    const span = diffDays(from, today) + 1;
    const expected = Math.max(1, Math.round((span / 7) * times));
    return Math.min(1, done / expected);
  }
  let sched = 0, done = 0;
  for (let k = from; k <= today; k = addDays(k, 1)) {
    if (!isScheduled(h, k)) continue;
    const d = habitDone(state, h, k);
    if (k === today && !d) continue; // today still in progress
    sched++;
    if (d) done++;
  }
  return sched ? done / sched : null;
}

export function totalCompletions(state, h) {
  const logs = state.logs[h.id] || {};
  let n = 0;
  for (const k in logs) if (logs[k] >= habitTarget(h)) n++;
  return n;
}

export function scheduleLabel(h, dayNames) {
  const s = h.schedule || {};
  if (s.type === 'days') {
    const d = [...(s.days || [])].sort();
    if (d.length === 7) return 'Every day';
    if (d.join() === '1,2,3,4,5') return 'Weekdays';
    if (d.join() === '0,6') return 'Weekends';
    return d.map((i) => dayNames[i]).join(' ');
  }
  if (s.type === 'perWeek') return `${s.times}× per week`;
  return 'Every day';
}

// ---------- Day-level aggregates ----------
export function dayProgress(state, k) {
  const tasks = tasksOn(state, k);
  const tDone = tasks.filter((t) => isTaskDone(t, k)).length;
  const habits = activeHabits(state).filter((h) => habitStart(state, h) <= k && isDueOn(state, h, k));
  const hDone = habits.filter((h) => habitDone(state, h, k)).length;
  const total = tasks.length + habits.length;
  const done = tDone + hDone;
  return {
    total, done, pct: total ? done / total : 0,
    tasks: { total: tasks.length, done: tDone },
    habits: { total: habits.length, done: hDone, pct: habits.length ? hDone / habits.length : 0 },
  };
}

export function moodEmoji(m) {
  return ['', '😞', '😕', '😐', '🙂', '😄'][m] || '';
}
export const MOODS = [
  { v: 1, e: '😞', label: 'Awful' },
  { v: 2, e: '😕', label: 'Bad' },
  { v: 3, e: '😐', label: 'Okay' },
  { v: 4, e: '🙂', label: 'Good' },
  { v: 5, e: '😄', label: 'Great' },
];

export const PRIORITIES = [
  { v: 0, label: 'None', color: 'var(--text-3)' },
  { v: 1, label: 'Low', color: 'var(--prio-low)' },
  { v: 2, label: 'Medium', color: 'var(--prio-med)' },
  { v: 3, label: 'High', color: 'var(--prio-high)' },
];
