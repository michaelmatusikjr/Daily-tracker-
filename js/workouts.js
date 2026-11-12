// Workout domain logic: units, time parsing/formatting, summaries, personal records,
// chart data and the optional workout → habit link. Pure functions on state.
import { todayKey, startOfWeek } from './dates.js';

const LB = 0.45359237;
const MI = 1.609344;

// ---------- Units ----------
export const weightLabel = (u) => (u === 'kg' ? 'kg' : 'lbs');
export const distLabel = (u) => (u === 'km' ? 'km' : 'mi');
export const toKg = (v, u) => (u === 'kg' ? v : v * LB);
export const toKm = (v, u) => (u === 'km' ? v : v * MI);
export const fromKg = (kg, u) => (u === 'kg' ? kg : kg / LB);
export const fromKm = (km, u) => (u === 'km' ? km : km / MI);

/** Trim a number for display: up to `dp` decimals, no trailing zeros. */
export function trimNum(v, dp = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return String(Number(v.toFixed(dp)));
}

/** Weight in the display unit. Values logged in another unit are converted and rounded to 0.5. */
export function convWeight(v, fromUnit, toUnit) {
  if (v === null) return null;
  if (fromUnit === toUnit) return v;
  return Math.round(fromKg(toKg(v, fromUnit), toUnit) * 2) / 2;
}
export function convDist(v, fromUnit, toUnit) {
  if (v === null) return null;
  if (fromUnit === toUnit) return v;
  return Math.round(fromKm(toKm(v, fromUnit), toUnit) * 100) / 100;
}

// ---------- Time ----------
/**
 * Parse a time box. Accepts "90s", "45m", "1h", "1h30", and:
 *  - cardio:   plain number = minutes, "h:mm", "h:mm:ss"
 *  - strength: plain number = seconds, "m:ss", "h:mm:ss" (holds like a 1:30 plank)
 * Returns seconds, null for empty, or NaN when it can't be read.
 */
export function parseTime(input, type = 'cardio') {
  const s = String(input ?? '').trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs)$/);
  if (m) { const v = parseFloat(m[1]); return Math.round(v * ({ s: 1, sec: 1, secs: 1, m: 60, min: 60, mins: 60 }[m[2]] || 3600)); }
  m = s.match(/^(\d+)\s*h\s*(\d+)\s*(m|min)?$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * (type === 'cardio' ? 60 : 1));
  m = s.match(/^(\d+):([0-5]\d)$/);
  if (m) return type === 'cardio' ? Number(m[1]) * 3600 + Number(m[2]) * 60 : Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return NaN;
}

const p2 = (n) => String(n).padStart(2, '0');
/** 90 → "1:30", 3725 → "1:02:05" */
export function fmtClock(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}
/** Cardio durations: "30 min", "1 h 15 min", or a clock when seconds matter. */
export function fmtLong(sec) {
  sec = Math.round(sec);
  if (sec % 60) return fmtClock(sec);
  const min = sec / 60;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), mm = min % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}
/** Value for the time input when editing. */
export function timeInputValue(sec, type) {
  if (sec === null || sec === undefined) return '';
  if (type === 'cardio') return sec % 60 ? fmtClock(sec) : String(sec / 60);
  return sec < 60 ? String(sec) : fmtClock(sec);
}
/** Pace per display unit, e.g. "12:00/mi". */
export function paceText(w, settings) {
  if (!(w.time > 0) || !(w.distance > 0)) return '';
  const d = fromKm(toKm(w.distance, w.distanceUnit), settings.distanceUnit);
  return `${fmtClock(w.time / d)}/${distLabel(settings.distanceUnit)}`;
}

// ---------- Summaries ----------
function lineParts(l, wu, settings, compact) {
  const w = l.weight !== null && l.weight > 0 ? trimNum(convWeight(l.weight, wu, settings.weightUnit), 1) : null;
  const sr = l.sets && l.reps ? `${l.sets}${compact ? '×' : ' × '}${l.reps}` : l.reps ? `${l.reps} reps` : l.sets ? `${l.sets} set${l.sets === 1 ? '' : 's'}` : '';
  return { w, sr };
}

/** "225 lbs · 3 × 5" | "225 × 3×5, 245 × 1×3" | "1:30" | "30 min · 2.5 mi · 12:00/mi" */
export function workoutSummary(w, ex, settings) {
  const parts = [];
  if ((ex?.type || 'strength') === 'strength') {
    if (w.lines.length === 1) {
      const { w: wt, sr } = lineParts(w.lines[0], w.weightUnit, settings, false);
      if (wt) parts.push(`${wt} ${weightLabel(settings.weightUnit)}`);
      if (sr) parts.push(sr);
    } else if (w.lines.length > 1) {
      parts.push(w.lines.map((l) => { const { w: wt, sr } = lineParts(l, w.weightUnit, settings, true); return [wt, sr].filter(Boolean).join(' × '); }).join(', '));
    }
    if (w.time > 0) parts.push(fmtClock(w.time));
    if (w.distance > 0) parts.push(`${trimNum(convDist(w.distance, w.distanceUnit, settings.distanceUnit))} ${distLabel(settings.distanceUnit)}`);
  } else {
    if (w.time > 0) parts.push(fmtLong(w.time));
    if (w.distance > 0) parts.push(`${trimNum(convDist(w.distance, w.distanceUnit, settings.distanceUnit))} ${distLabel(settings.distanceUnit)}`);
    const pace = paceText(w, settings);
    if (pace) parts.push(pace);
    if (w.lines.length) parts.push(w.lines.map((l) => { const { w: wt, sr } = lineParts(l, w.weightUnit, settings, true); return [wt, sr].filter(Boolean).join(' × '); }).join(', '));
  }
  return parts.join(' · ');
}

export const exerciseById = (state, id) => state.exercises.find((e) => e.id === id);

/** Chronological order (oldest first): by date, then by when it was logged. */
const chrono = (a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt;

export function lastWorkout(state, exerciseId, excludeId = null) {
  let best = null;
  for (const w of state.workouts) {
    if (w.exerciseId !== exerciseId || w.id === excludeId) continue;
    if (!best || chrono(w, best) > 0) best = w;
  }
  return best;
}

/** Exercises ordered for the picker: recent and frequent first. */
export function rankedExercises(state, today = todayKey()) {
  const stats = new Map();
  for (const w of state.workouts) {
    const s = stats.get(w.exerciseId) || { count: 0, last: '' };
    s.count++;
    if (w.date > s.last) s.last = w.date;
    stats.set(w.exerciseId, s);
  }
  const score = (e) => {
    const s = stats.get(e.id);
    if (!s) return -1;
    const days = Math.max(0, (Date.parse(today) - Date.parse(s.last)) / 86400000);
    return s.count + 30 / (1 + days); // frequent + recently used
  };
  return state.exercises.filter((e) => !e.archived).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

// ---------- Personal records ----------
/**
 * Walk an exercise's history in order and mark each workout that beat the previous best.
 * Derived on demand, so edits and deletes are always reflected.
 * Returns { records: Map(workoutId → [label]), best }.
 */
export function computeRecords(state, exerciseId) {
  const ex = exerciseById(state, exerciseId);
  const s = state.settings;
  const list = state.workouts.filter((w) => w.exerciseId === exerciseId).sort(chrono);
  const records = new Map();
  const best = { weight: null, repsAt: new Map(), bodyReps: null, time: null, dist: null, pace: null };
  const wtxt = (kg) => `${trimNum(Math.round(fromKg(kg, s.weightUnit) * 2) / 2, 1)} ${weightLabel(s.weightUnit)}`;
  list.forEach((w, i) => {
    const labels = [];
    const first = i === 0;
    for (const l of w.lines) {
      if (l.weight > 0) {
        const kg = toKg(l.weight, w.weightUnit);
        const key = Math.round(kg * 10);
        if (best.weight === null || kg > best.weight.v + 1e-9) {
          if (!first && best.weight !== null) labels.push(`Heaviest: ${wtxt(kg)}`);
          best.weight = { v: kg, date: w.date, id: w.id };
        }
        if (l.reps > 0) {
          const prev = best.repsAt.get(key);
          if (prev !== undefined && l.reps > prev.v && !first) labels.push(`Most reps at ${wtxt(kg)}: ${l.reps}`);
          if (prev === undefined || l.reps > prev.v) best.repsAt.set(key, { v: l.reps, kg, date: w.date });
        }
      } else if (l.reps > 0) {
        if (best.bodyReps !== null && l.reps > best.bodyReps.v && !first) labels.push(`Most reps: ${l.reps}`);
        if (best.bodyReps === null || l.reps > best.bodyReps.v) best.bodyReps = { v: l.reps, date: w.date };
      }
    }
    if (w.time > 0) {
      if (best.time !== null && w.time > best.time.v && !first) labels.push(`Longest time: ${ex?.type === 'cardio' ? fmtLong(w.time) : fmtClock(w.time)}`);
      if (best.time === null || w.time > best.time.v) best.time = { v: w.time, date: w.date };
    }
    if (w.distance > 0) {
      const km = toKm(w.distance, w.distanceUnit);
      if (best.dist !== null && km > best.dist.v + 1e-9 && !first) labels.push(`Longest distance: ${trimNum(fromKm(km, s.distanceUnit))} ${distLabel(s.distanceUnit)}`);
      if (best.dist === null || km > best.dist.v) best.dist = { v: km, date: w.date };
      if (w.time > 0) {
        const pace = w.time / km; // seconds per km (lower is faster)
        if (best.pace !== null && pace < best.pace.v - 1e-9 && !first) labels.push(`Fastest pace: ${paceText(w, s)}`);
        if (best.pace === null || pace < best.pace.v) best.pace = { v: pace, date: w.date, w };
      }
    }
    if (labels.length) records.set(w.id, [...new Set(labels)]);
  });
  return { records, best, list };
}

/** Recent records across all exercises, newest first. */
export function recentRecords(state, limit = 5) {
  const out = [];
  for (const ex of state.exercises) {
    const { records, list } = computeRecords(state, ex.id);
    for (const w of list) if (records.has(w.id)) out.push({ w, ex, labels: records.get(w.id) });
  }
  return out.sort((a, b) => chrono(b.w, a.w)).slice(0, limit);
}

// ---------- Chart data ----------
/** Strength: top weight per day (or reps/time). Cardio: distance per day plus pace. */
export function chartSeries(state, exerciseId) {
  const ex = exerciseById(state, exerciseId);
  const s = state.settings;
  const byDay = new Map();
  for (const w of state.workouts) {
    if (w.exerciseId !== exerciseId) continue;
    const d = byDay.get(w.date) || { weight: null, reps: null, time: 0, dist: 0, paceTime: 0, paceDist: 0 };
    for (const l of w.lines) {
      if (l.weight > 0) d.weight = Math.max(d.weight ?? 0, fromKg(toKg(l.weight, w.weightUnit), s.weightUnit));
      if (l.reps > 0) d.reps = Math.max(d.reps ?? 0, l.reps);
    }
    if (w.time > 0) d.time += w.time;
    if (w.distance > 0) {
      const dd = fromKm(toKm(w.distance, w.distanceUnit), s.distanceUnit);
      d.dist += dd;
      if (w.time > 0) { d.paceTime += w.time; d.paceDist += dd; }
    }
    byDay.set(w.date, d);
  }
  const days = [...byDay.keys()].sort().slice(-60);
  const pts = (fn) => days.map((date) => ({ date, v: fn(byDay.get(date)) })).filter((p) => p.v !== null && p.v > 0);
  if (ex?.type === 'cardio') {
    return {
      primary: { label: `Distance (${distLabel(s.distanceUnit)})`, unit: distLabel(s.distanceUnit), points: pts((d) => (d.dist > 0 ? d.dist : null)), fmt: (v) => trimNum(v) },
      pace: { label: `Pace (min/${distLabel(s.distanceUnit)})`, points: pts((d) => (d.paceDist > 0 ? d.paceTime / d.paceDist : null)), fmt: (v) => fmtClock(v) },
      time: { label: 'Time (min)', points: pts((d) => (d.time > 0 ? d.time / 60 : null)), fmt: (v) => trimNum(v, 0) },
    };
  }
  const w = pts((d) => d.weight);
  if (w.length) return { primary: { label: `Top weight (${weightLabel(s.weightUnit)})`, points: w, fmt: (v) => trimNum(v, 1) } };
  const r = pts((d) => d.reps);
  if (r.length) return { primary: { label: 'Most reps', points: r, fmt: (v) => String(Math.round(v)) } };
  return { primary: { label: 'Time', points: pts((d) => (d.time > 0 ? d.time : null)), fmt: (v) => fmtClock(v) } };
}

// ---------- Totals ----------
export function exerciseTotals(state, exerciseId) {
  const s = state.settings;
  const t = { sessions: new Set(), sets: 0, reps: 0, time: 0, dist: 0, count: 0 };
  for (const w of state.workouts) {
    if (w.exerciseId !== exerciseId) continue;
    t.count++;
    t.sessions.add(w.date);
    for (const l of w.lines) { t.sets += l.sets || 0; t.reps += (l.sets || 1) * (l.reps || 0); }
    t.time += w.time || 0;
    if (w.distance > 0) t.dist += fromKm(toKm(w.distance, w.distanceUnit), s.distanceUnit);
  }
  return { ...t, sessions: t.sessions.size };
}

export function periodStats(state, today = todayKey()) {
  const s = state.settings;
  const weekStart = startOfWeek(today, s.weekStart);
  const monthStart = today.slice(0, 8) + '01';
  const weekDays = new Set(), monthDays = new Set();
  let strength = 0, cardio = 0, cardioTime = 0, cardioDist = 0;
  for (const w of state.workouts) {
    if (w.date > today) continue;
    if (w.date >= weekStart) weekDays.add(w.date);
    if (w.date < monthStart) continue;
    monthDays.add(w.date);
    const ex = exerciseById(state, w.exerciseId);
    if (ex?.type === 'cardio') {
      cardio++;
      cardioTime += w.time || 0;
      if (w.distance > 0) cardioDist += fromKm(toKm(w.distance, w.distanceUnit), s.distanceUnit);
    } else strength++;
  }
  return { week: weekDays.size, month: monthDays.size, strength, cardio, cardioTime, cardioDist };
}

export const workoutsOn = (state, date) => state.workouts.filter((w) => w.date === date);
export const hasWorkoutOn = (state, date) => state.workouts.some((w) => w.date === date);

// ---------- Optional workout → habit link ----------
export function linkedHabit(state) {
  const id = state.settings.workoutHabit?.habitId;
  const hb = id && state.habits.find((x) => x.id === id);
  return hb && !hb.archived && hb.goal.type === 'check' ? hb : null;
}

function matchesFilter(state, w) {
  const f = state.settings.workoutHabit?.filter || 'any';
  if (f === 'any') return true;
  const ex = exerciseById(state, w.exerciseId);
  return (ex?.type || 'strength') === f;
}

/**
 * Bring the linked habit in line with the workouts on `date` (mutates state; call inside update()).
 * A matching workout checks the habit and marks the day "auto". When none remains, the habit is
 * unchecked only if the link checked it. Never touches future days or manual checks.
 */
export function syncHabitLink(state, date) {
  const hb = linkedHabit(state);
  if (!hb || date > todayKey()) return;
  const has = state.workouts.some((w) => w.date === date && matchesFilter(state, w));
  const logs = (state.logs[hb.id] = state.logs[hb.id] || {});
  const auto = (state.autoHabit[hb.id] = state.autoHabit[hb.id] || {});
  if (has) {
    if (!(logs[date] >= 1)) { logs[date] = 1; auto[date] = true; }
  } else if (auto[date]) {
    delete logs[date];
    delete auto[date];
  }
  if (!Object.keys(auto).length) delete state.autoHabit[hb.id];
}

