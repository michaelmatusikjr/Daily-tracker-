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
const THOUSANDS = /^\d{1,3}(,\d{3})+$/;
const MAX_TIME = 24 * 3600;

/** Human text for a duration: "25 min 30 s", "1 h 15 min", "45 s". */
export function describeTime(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return [h && `${h} h`, m && `${m} min`, x && `${x} s`].filter(Boolean).join(' ') || '0 s';
}

/**
 * Read a time box. Accepts "90s", "45m", "1h", "1h15m", "25m30s", "1h15", and:
 *  - a plain number: minutes for cardio, seconds for strength
 *  - "a:bb": strength = m:ss; cardio = m:ss when a ≥ 6 (e.g. 25:30), h:mm when a ≤ 5 (e.g. 1:15)
 *  - "a:bb:cc": always h:mm:ss
 * `flip` swaps the reading of an ambiguous "a:bb". Returns { sec, text, ambiguous, altText } or
 * { error } (empty input → { sec: null }).
 */
export function readTime(input, type = 'cardio', flip = false) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return { sec: null, text: '' };
  if (THOUSANDS.test(raw)) return { error: 'Don’t use thousands separators – e.g. 1000, or 2.5 for a decimal.' };
  const s = raw.replace(',', '.');
  const ok = (sec, extra = {}) => {
    if (!Number.isFinite(sec) || sec < 0) return { error: 'That time can’t be read.' };
    if (sec > MAX_TIME) return { error: 'That’s more than 24 hours.' };
    return { sec: Math.round(sec), text: describeTime(sec), ambiguous: false, ...extra };
  };
  let m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in|ins|inutes?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ecs?|econds?)?)?$/);
  if (m && (m[1] || m[2] || m[3])) return ok((parseFloat(m[1] || 0) * 3600) + (parseFloat(m[2] || 0) * 60) + parseFloat(m[3] || 0));
  m = s.match(/^(\d+)\s*h\s*(\d+)$/);
  if (m) return ok(Number(m[1]) * 3600 + Number(m[2]) * 60);
  if (/^\d*\.?\d+$/.test(s)) return ok(parseFloat(s) * (type === 'cardio' ? 60 : 1));
  m = s.match(/^(\d+):([0-5]\d)$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const asMs = a * 60 + b, asHm = a * 3600 + b * 60;
    const defaultMs = type !== 'cardio' || a >= 6;
    const canHm = asHm <= MAX_TIME;
    const ambiguous = canHm; // both readings are possible
    const useMs = ambiguous && flip ? !defaultMs : defaultMs || !canHm;
    const sec = useMs ? asMs : asHm;
    return ok(sec, { ambiguous, altText: ambiguous ? describeTime(useMs ? asHm : asMs) : '' });
  }
  m = s.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (m) return ok(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  return { error: type === 'cardio' ? 'Time: minutes (30), m:ss (25:30), h:mm (1:15) or 1h15m.' : 'Time: seconds (45), m:ss (1:30) or 1m30s.' };
}

/** Seconds, null for empty, NaN when unreadable (kept for callers that only need the value). */
export function parseTime(input, type = 'cardio', flip = false) {
  const r = readTime(input, type, flip);
  return r.error ? NaN : r.sec;
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
  if (type === 'cardio') {
    if (sec % 60 === 0) return String(sec / 60);
    return sec < 6 * 60 || sec >= 3600 ? `${Math.floor(sec / 3600)}:${p2(Math.floor((sec % 3600) / 60))}:${p2(sec % 60)}` : fmtClock(sec);
  }
  return sec < 60 ? String(sec) : fmtClock(sec);
}
/** Pace per display unit, e.g. "12:00/mi". */
export function paceText(w, settings) {
  if (!(w.time > 0) || !(w.distance > 0)) return '';
  const d = fromKm(toKm(w.distance, w.distanceUnit), settings.distanceUnit);
  return `${fmtClock(w.time / d)}/${distLabel(settings.distanceUnit)}`;
}

// ---------- Summaries ----------
/** A line's weight unit: its own (kept when edited in the other unit) or the entry's. */
export const lineUnit = (l, w) => l.unit || w.weightUnit;

function lineParts(l, wu, settings, compact) {
  const w = l.weight !== null && l.weight > 0 ? trimNum(convWeight(l.weight, wu, settings.weightUnit), 1) : null;
  const sr = l.sets && l.reps ? `${l.sets}${compact ? '×' : ' × '}${l.reps}` : l.reps ? `${l.reps} reps` : l.sets ? `${l.sets} set${l.sets === 1 ? '' : 's'}` : '';
  return { w, sr };
}

/** "225 lbs · 3 × 5" | "225 × 3×5, 245 × 1×3" | "1:30" | "30 min · 2.5 mi · 12:00/mi" */
export function workoutSummary(w, ex, settings) {
  const parts = [];
  if ((ex?.type || 'strength') !== 'cardio') {
    if (w.lines.length === 1) {
      const { w: wt, sr } = lineParts(w.lines[0], lineUnit(w.lines[0], w), settings, false);
      if (wt) parts.push(`${wt} ${weightLabel(settings.weightUnit)}`);
      if (sr) parts.push(sr);
    } else if (w.lines.length > 1) {
      parts.push(w.lines.map((l) => { const { w: wt, sr } = lineParts(l, lineUnit(l, w), settings, true); return [wt, sr].filter(Boolean).join(' × '); }).join(', '));
    }
    if (w.time > 0) parts.push(fmtClock(w.time));
    if (w.distance > 0) parts.push(`${trimNum(convDist(w.distance, w.distanceUnit, settings.distanceUnit))} ${distLabel(settings.distanceUnit)}`);
  } else {
    if (w.time > 0) parts.push(fmtLong(w.time));
    if (w.distance > 0) parts.push(`${trimNum(convDist(w.distance, w.distanceUnit, settings.distanceUnit))} ${distLabel(settings.distanceUnit)}`);
    const pace = paceText(w, settings);
    if (pace) parts.push(pace);
    if (w.lines.length) parts.push(w.lines.map((l) => { const { w: wt, sr } = lineParts(l, lineUnit(l, w), settings, true); return [wt, sr].filter(Boolean).join(' × '); }).join(', '));
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
export const STD_DISTANCES = [
  { id: '1mi', label: '1 mi', km: 1.609344, hint: '1 mi (1.6 km)' },
  { id: '2mi', label: '2 mi', km: 3.218688, hint: '2 mi (3.2 km)' },
  { id: '5k', label: '5K', km: 5, hint: '5K (3.1 mi)' },
  { id: '10k', label: '10K', km: 10, hint: '10K (6.2 mi)' },
  { id: '10mi', label: '10 mi', km: 16.09344, hint: '10 mi (16.1 km)' },
  { id: 'half', label: 'Half marathon', km: 21.0975, hint: 'half marathon (13.1 mi)' },
  { id: 'full', label: 'Marathon', km: 42.195, hint: 'marathon (26.2 mi)' },
];
const STD_TOLERANCE = 0.02; // a logged distance within ±2% counts (no pro-rating of longer runs)
export const stdDistanceFor = (km) => STD_DISTANCES.find((d) => Math.abs(km - d.km) / d.km <= STD_TOLERANCE) || null;

/** Calendar period keys (week follows the profile's week-start setting). */
function periodKeys(date, weekStart) {
  return { week: startOfWeek(date, weekStart), month: date.slice(0, 7), year: date.slice(0, 4) };
}

/**
 * Personal records for one exercise, from its full history (so edits and deletes are always
 * reflected). Entries are walked in order; an entry is a record when, after adding it, a value
 * beats the best that existed before it. The first-ever entry is never a record, and period
 * totals (week/month/year) need an earlier period to beat. Weights and distances are compared
 * in the display unit after display rounding, so converted values tie instead of "winning".
 *
 * Returns { records: Map(workoutId → [{ kind, title, value }]), summary, list }.
 *  Strength:   1-rep max (heaviest weight lifted for ≥ 1 rep) and 3×5 max (heaviest weight with
 *              ≥ 3 sets of ≥ 5 reps on one day, summed across that day's lines and entries).
 *  Bodyweight: most reps in a day / week / month / year (sets × reps summed), longest hold.
 *  Cardio:     fastest time at each standard distance (1 mi … marathon).
 */
export function computeRecords(state, exerciseId) {
  const ex = exerciseById(state, exerciseId);
  const type = ex?.type || 'strength';
  const s = state.settings;
  const list = state.workouts.filter((w) => w.exerciseId === exerciseId).sort(chrono);
  const records = new Map();
  const dispW = (w, l) => Math.round(fromKg(toKg(l.weight, lineUnit(l, w)), s.weightUnit) * 2) / 2;
  const wtxt = (v) => `${trimNum(v, 1)} ${weightLabel(s.weightUnit)}`;
  const add = (w, rec) => { records.set(w.id, [...(records.get(w.id) || []), rec]); };

  if (type === 'strength') {
    let best1 = null, best35 = null; // { v, date }
    const day = new Map(); // date → { sets: Map(weight → sets of ≥5 reps), one: max weight }
    list.forEach((w, i) => {
      const d = day.get(w.date) || { sets: new Map(), one: null };
      for (const l of w.lines) {
        if (!(l.weight > 0) || !(l.reps >= 1)) continue;
        const v = dispW(w, l);
        d.one = Math.max(d.one ?? 0, v);
        if (l.reps >= 5) d.sets.set(v, (d.sets.get(v) || 0) + Math.max(1, l.sets || 1));
      }
      day.set(w.date, d);
      const q = [...d.sets].filter(([, n]) => n >= 3).map(([v]) => v);
      const d35 = q.length ? Math.max(...q) : null;
      if (d.one !== null && (best1 === null || d.one > best1.v)) {
        if (i > 0 && best1 !== null) add(w, { kind: '1rm', title: 'New 1-rep max', value: wtxt(d.one) });
        best1 = { v: d.one, date: w.date };
      }
      if (d35 !== null && (best35 === null || d35 > best35.v)) {
        if (i > 0 && best35 !== null) add(w, { kind: '3x5', title: 'New 3×5 max', value: wtxt(d35) });
        best35 = { v: d35, date: w.date };
      }
    });
    // Days that qualified as 3×5 (for chart markers).
    const days35 = new Set([...day].filter(([, d]) => [...d.sets.values()].some((n) => n >= 3)).map(([k]) => k));
    return { records, list, summary: { type, oneRm: best1, threeByFive: best35, days35 } };
  }

  if (type === 'bodyweight') {
    const totals = { day: new Map(), week: new Map(), month: new Map(), year: new Map() };
    const best = { day: null, week: null, month: null, year: null, hold: null };
    const names = { day: 'day', week: 'week', month: 'month', year: 'year' };
    list.forEach((w, i) => {
      const reps = w.lines.reduce((n, l) => n + (l.reps > 0 ? l.reps * Math.max(1, l.sets || 1) : 0), 0);
      const keys = { day: w.date, ...periodKeys(w.date, s.weekStart) };
      for (const p of ['day', 'week', 'month', 'year']) {
        const total = (totals[p].get(keys[p]) || 0) + reps;
        totals[p].set(keys[p], total);
        if (!reps || total <= (best[p]?.v ?? 0)) continue;
        // A record needs an earlier period to beat (and never the very first entry).
        const others = [...totals[p]].filter(([k]) => k !== keys[p]).map(([, v]) => v);
        if (i > 0 && others.length && total > Math.max(...others)) add(w, { kind: p, title: `Most reps in a ${names[p]}`, value: String(total) });
        best[p] = { v: total, key: keys[p], date: w.date };
      }
      if (w.time > 0 && (!best.hold || w.time > best.hold.v)) {
        if (i > 0 && best.hold) add(w, { kind: 'hold', title: 'Longest hold', value: fmtClock(w.time) });
        best.hold = { v: w.time, date: w.date };
      }
    });
    const now = periodKeys(todayKey(), s.weekStart);
    const current = { week: totals.week.get(now.week) || 0, month: totals.month.get(now.month) || 0, year: totals.year.get(now.year) || 0 };
    return { records, list, summary: { type, ...best, current } };
  }

  // Cardio: fastest time per standard distance.
  const best = {};
  list.forEach((w) => {
    if (!(w.distance > 0) || !(w.time > 0)) return;
    const std = stdDistanceFor(toKm(w.distance, w.distanceUnit));
    if (!std) return;
    const t = Math.round(w.time);
    if (!best[std.id] || t < best[std.id].time) {
      if (best[std.id]) add(w, { kind: std.id, title: `Fastest ${std.label}`, value: fmtClock(t) });
      best[std.id] = { time: t, date: w.date, w };
    }
  });
  return { records, list, summary: { type, distances: best } };
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

export const recordText = (r) => `${r.title}: ${r.value}`;

// ---------- Chart data ----------
/** Strength: top weight per day (3×5 days marked). Bodyweight: reps per day. Cardio: distance + pace. */
export function chartSeries(state, exerciseId) {
  const ex = exerciseById(state, exerciseId);
  const s = state.settings;
  const byDay = new Map();
  for (const w of state.workouts) {
    if (w.exerciseId !== exerciseId) continue;
    const d = byDay.get(w.date) || { weight: null, reps: 0, time: 0, dist: 0, paceTime: 0, paceDist: 0 };
    for (const l of w.lines) {
      if (l.weight > 0 && l.reps >= 1) d.weight = Math.max(d.weight ?? 0, fromKg(toKg(l.weight, lineUnit(l, w)), s.weightUnit));
      if (l.reps > 0) d.reps += l.reps * Math.max(1, l.sets || 1);
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
  if (ex?.type === 'bodyweight') {
    return { primary: { label: 'Reps per day', points: pts((d) => d.reps || null), fmt: (v) => String(Math.round(v)) } };
  }
  const marks = computeRecords(state, exerciseId).summary.days35;
  const w = pts((d) => d.weight).map((p) => ({ ...p, mark: marks.has(p.date) }));
  return { primary: { label: `Top weight (${weightLabel(s.weightUnit)})`, points: w, fmt: (v) => trimNum(v, 1), markLabel: '3×5 day' } };
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
  let strength = 0, bodyweight = 0, cardio = 0, cardioTime = 0, cardioDist = 0;
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
    } else if (ex?.type === 'bodyweight') bodyweight++;
    else strength++;
  }
  return { week: weekDays.size, month: monthDays.size, strength, bodyweight, cardio, cardioTime, cardioDist };
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

