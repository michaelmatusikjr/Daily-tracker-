// Persistent app state in localStorage with a versioned schema + migrations.
// Several profiles: an index key plus one data key per profile.
import { todayKey, isValidKey } from './dates.js';

export const APP_VERSION = '1.5.1';
export const SCHEMA_VERSION = 4;
const LEGACY_KEY = 'dailyTracker:data'; // single-profile data before 1.3.0
const PROFILES_KEY = 'dailyTracker:profiles';
// Copy of the pre-1.3 data as it was when it was moved, so a later merge can tell what an
// old tab really changed (three-way merge). Removed 14 days after the upgrade.
const BASELINE_KEY = 'dailyTracker:legacyBaseline';
const BASELINE_TTL = 14 * 86400000;
export const dataKey = (id) => `${LEGACY_KEY}:${id}`;
const ACCENT_IDS = ['indigo', 'teal', 'rose', 'amber', 'green', 'blue'];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function prefers12h() {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 !== false;
  } catch { return true; }
}

export function defaultCategories() {
  return [
    { id: 'work', name: 'Work', color: '#3b82f6' },
    { id: 'personal', name: 'Personal', color: '#10b981' },
    { id: 'health', name: 'Health', color: '#f43f5e' },
    { id: 'errands', name: 'Errands', color: '#f59e0b' },
  ];
}

export function defaultSettings() {
  return {
    theme: 'system',
    accent: 'indigo',
    weekStart: 1,
    timeFormat: prefers12h() ? '12' : '24',
    notifications: false,
    onboarded: false,
    weightUnit: 'lb',
    distanceUnit: 'mi',
    // Optional: check off a (checkbox) habit automatically when a matching workout is logged.
    workoutHabit: { habitId: null, filter: 'any' },
  };
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: defaultSettings(),
    categories: defaultCategories(),
    tasks: [],
    habits: [],
    logs: {},
    journal: {},
    exercises: [],
    workouts: [],
    autoHabit: {}, // { [habitId]: { [date]: true } } days checked by the workout link
  };
}

// Migration hook: migrations[n] upgrades a version-n object to version n+1.
const migrations = {
  // v1 → v2 added alarms and scan codes; v2 → v3 removed them again (the Alarms feature was dropped in 1.2.0).
  1: (data) => data,
  2: (data) => { const out = { ...data }; delete out.alarms; delete out.codes; return out; },
  // v3 → v4: workouts (exercises + workout entries) and the optional workout→habit link.
  3: (data) => ({ ...data, exercises: Array.isArray(data.exercises) ? data.exercises : [], workouts: Array.isArray(data.workouts) ? data.workouts : [] }),
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function normTask(t, i) {
  if (!isObj(t) || !str(t.title).trim()) return null;
  const recur = isObj(t.recur) ? t.recur : { type: 'none' };
  const type = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'interval'].includes(recur.type) ? recur.type : 'none';
  return {
    id: str(t.id, 40) || uid(),
    title: str(t.title, 200).trim(),
    notes: str(t.notes, 2000),
    date: isValidKey(t.date) ? t.date : todayKey(),
    time: TIME_RE.test(t.time) ? t.time : null,
    duration: Number.isFinite(t.duration) && t.duration > 0 ? Math.min(t.duration, 1440) : null,
    priority: [0, 1, 2, 3].includes(t.priority) ? t.priority : 0,
    category: typeof t.category === 'string' ? t.category : null,
    reminder: Number.isFinite(t.reminder) && t.reminder >= 0 ? t.reminder : null,
    recur: {
      type,
      days: Array.isArray(recur.days) ? recur.days.filter((d) => Number.isInteger(d) && d >= 0 && d < 7) : [],
      interval: Number.isInteger(recur.interval) && recur.interval > 0 ? recur.interval : 2,
    },
    done: !!t.done,
    doneDates: isObj(t.doneDates) ? t.doneDates : {},
    exceptions: Array.isArray(t.exceptions) ? t.exceptions.filter(isValidKey) : [],
    order: Number.isFinite(t.order) ? t.order : i,
    createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
    ...(Number.isFinite(t.updatedAt) ? { updatedAt: t.updatedAt } : {}),
  };
}

function normHabit(hb, i) {
  if (!isObj(hb) || !str(hb.name).trim()) return null;
  const sc = isObj(hb.schedule) ? hb.schedule : {};
  const goal = isObj(hb.goal) ? hb.goal : {};
  const days = Array.isArray(sc.days) ? [...new Set(sc.days.filter((d) => Number.isInteger(d) && d >= 0 && d < 7))] : [];
  let type = ['daily', 'days', 'perWeek'].includes(sc.type) ? sc.type : 'daily';
  if (type === 'days' && !days.length) type = 'daily';
  return {
    id: str(hb.id, 40) || uid(),
    name: str(hb.name, 100).trim(),
    emoji: str(hb.emoji, 16) || '✅',
    color: /^#[0-9a-f]{6}$/i.test(hb.color) ? hb.color : '#6366f1',
    schedule: {
      type,
      days: days.length ? days : [1, 2, 3, 4, 5],
      times: Number.isInteger(sc.times) && sc.times > 0 && sc.times < 7 ? sc.times : 3,
    },
    goal: {
      type: goal.type === 'count' ? 'count' : 'check',
      target: Number.isInteger(goal.target) && goal.target > 0 ? Math.min(goal.target, 999) : 1,
      unit: str(goal.unit, 24),
    },
    reminder: TIME_RE.test(hb.reminder) ? hb.reminder : null,
    timeOfDay: ['anytime', 'morning', 'afternoon', 'evening'].includes(hb.timeOfDay) ? hb.timeOfDay : 'anytime',
    archived: !!hb.archived,
    order: Number.isFinite(hb.order) ? hb.order : i,
    createdAt: isValidKey(hb.createdAt) ? hb.createdAt : todayKey(),
    ...(Number.isFinite(hb.updatedAt) ? { updatedAt: hb.updatedAt } : {}),
  };
}

// ---------- Workouts ----------
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null);
const int = (v, max) => { const n = num(v, max); return n === null ? null : Math.round(n); };

function normExercise(e) {
  if (!isObj(e) || !str(e.name).trim()) return null;
  return {
    id: str(e.id, 40) || uid(), name: str(e.name, 60).trim(),
    // Case-insensitive; unknown types are resolved after the workouts are read (see normWorkoutData).
    type: ['strength', 'cardio', 'bodyweight'].includes(str(e.type).trim().toLowerCase()) ? str(e.type).trim().toLowerCase() : null,
    archived: !!e.archived, createdAt: Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
  };
}

// Sanity caps (form input is validated against the same limits).
export const CAPS = { reps: 1000, sets: 100, weight: { lb: 2000, kg: 1000 }, time: 24 * 3600, distance: 1000 };

function normLine(l, wu) {
  if (!isObj(l)) return null;
  // A line may keep its own unit when it was left unchanged while editing in the other unit.
  const unit = l.unit === 'kg' || l.unit === 'lb' ? l.unit : null;
  const line = { weight: num(l.weight, CAPS.weight[unit || wu]), sets: int(l.sets, CAPS.sets), reps: int(l.reps, CAPS.reps) };
  if (unit && unit !== wu) line.unit = unit;
  return [line.weight, line.sets, line.reps].some((v) => v !== null && v > 0) ? line : null;
}

function normWorkout(w) {
  if (!isObj(w) || !isValidKey(w.date) || typeof w.exerciseId !== 'string' || !w.exerciseId) return null;
  const out = {
    id: str(w.id, 40) || uid(), date: w.date, exerciseId: w.exerciseId.slice(0, 40),
    weightUnit: w.weightUnit === 'kg' ? 'kg' : 'lb',
    time: num(w.time, CAPS.time), // seconds
    distance: num(w.distance, CAPS.distance), distanceUnit: w.distanceUnit === 'km' ? 'km' : 'mi',
    note: str(w.note, 300), createdAt: Number.isFinite(w.createdAt) ? w.createdAt : Date.now(),
  };
  out.lines = (Array.isArray(w.lines) ? w.lines : []).map((l) => normLine(l, out.weightUnit)).filter(Boolean).slice(0, 30);
  if (!out.lines.length && !(out.time > 0) && !(out.distance > 0)) return null; // nothing logged
  return out;
}

function normWorkoutData(data, out) {
  const s = out.settings;
  if (!['lb', 'kg'].includes(s.weightUnit)) s.weightUnit = 'lb';
  if (!['mi', 'km'].includes(s.distanceUnit)) s.distanceUnit = 'mi';
  out.exercises = dedupeIds((Array.isArray(data.exercises) ? data.exercises : []).map(normExercise).filter(Boolean)).slice(0, 500);
  out.workouts = dedupeIds((Array.isArray(data.workouts) ? data.workouts : []).map(normWorkout).filter(Boolean)).slice(-20000);
  // Unknown type: Cardio when any of its entries has a distance, otherwise Strength.
  for (const e of out.exercises) {
    if (e.type) continue;
    e.type = out.workouts.some((w) => w.exerciseId === e.id && w.distance > 0) ? 'cardio' : 'strength';
  }
  // A workout pointing at a missing exercise gets a placeholder exercise, so no history is lost.
  const known = new Set(out.exercises.map((e) => e.id));
  for (const w of out.workouts) {
    if (known.has(w.exerciseId)) continue;
    known.add(w.exerciseId);
    out.exercises.push({ id: w.exerciseId, name: 'Unknown exercise', type: w.lines.length ? 'strength' : 'cardio', archived: false, createdAt: Date.now() });
  }
  // Workout → habit link: only an active checkbox habit; anything else falls back to None.
  const wh = isObj(s.workoutHabit) ? s.workoutHabit : {};
  const linked = out.habits.find((x) => x.id === wh.habitId && !x.archived && x.goal.type === 'check');
  s.workoutHabit = { habitId: linked ? linked.id : null, filter: ['strength', 'bodyweight', 'cardio'].includes(wh.filter) ? wh.filter : 'any' };
  const habitIds = new Set(out.habits.map((x) => x.id));
  out.autoHabit = {};
  if (isObj(data.autoHabit)) {
    for (const [hid, days] of Object.entries(data.autoHabit)) {
      if (!habitIds.has(hid) || !isObj(days)) continue;
      const clean = {};
      for (const k of Object.keys(days)) if (isValidKey(k) && days[k] === true) clean[k] = true;
      if (Object.keys(clean).length) out.autoHabit[hid] = clean;
    }
  }
}

// ---------- Profiles ----------
export const PROFILE_COLORS = ['#6366f1', '#ec4899', '#f97316', '#10b981', '#0ea5e9', '#8b5cf6', '#ef4444', '#64748b'];
const AVATAR_MAX = 150000; // characters of a data URL (~110 KB image)

export function normAvatar(a, fallbackColor = PROFILE_COLORS[0]) {
  if (isObj(a) && a.type === 'photo' && typeof a.data === 'string' && a.data.length <= AVATAR_MAX
    && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(a.data)) return { type: 'photo', data: a.data };
  const color = isObj(a) && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : fallbackColor;
  return { type: 'emoji', emoji: isObj(a) ? str(a.emoji, 16) : '', color };
}

function normProfileMeta(p, i) {
  if (!isObj(p)) return null;
  return {
    id: /^[A-Za-z0-9_-]{1,40}$/.test(p.id) ? p.id : uid(),
    name: str(p.name, 40).trim() || 'Me',
    avatar: normAvatar(p.avatar, PROFILE_COLORS[i % PROFILE_COLORS.length]),
    updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : 0,
    ...(p.introPending ? { introPending: true } : {}),
  };
}

/** Give duplicated ids a fresh id (later duplicates lose any id-keyed history). */
function dedupeIds(list) {
  const seen = new Set();
  for (const item of list) {
    while (seen.has(item.id)) item.id = uid();
    seen.add(item.id);
  }
  return list;
}

/** Fill defaults and drop malformed entries so the rest of the app can trust the shape. */
export function normalize(data) {
  const def = defaultState();
  const out = { ...def, version: SCHEMA_VERSION };
  out.settings = { ...def.settings, ...(isObj(data.settings) ? data.settings : {}) };
  if (!['system', 'light', 'dark'].includes(out.settings.theme)) out.settings.theme = 'system';
  if (!ACCENT_IDS.includes(out.settings.accent)) out.settings.accent = 'indigo';
  out.settings.notifications = !!out.settings.notifications;
  out.settings.onboarded = !!out.settings.onboarded;
  if (![0, 1].includes(out.settings.weekStart)) out.settings.weekStart = 1;
  if (!['12', '24'].includes(out.settings.timeFormat)) out.settings.timeFormat = def.settings.timeFormat;
  out.categories = Array.isArray(data.categories)
    ? data.categories.filter((c) => isObj(c) && str(c.name).trim()).map((c) => ({
        id: str(c.id, 40) || uid(), name: str(c.name, 40).trim(), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#64748b',
      }))
    : def.categories;
  out.categories = dedupeIds(out.categories);
  out.tasks = dedupeIds((Array.isArray(data.tasks) ? data.tasks : []).map(normTask).filter(Boolean));
  out.habits = dedupeIds((Array.isArray(data.habits) ? data.habits : []).map(normHabit).filter(Boolean));
  out.logs = {};
  if (isObj(data.logs)) {
    for (const [hid, days] of Object.entries(data.logs)) {
      if (!isObj(days)) continue;
      const clean = {};
      for (const [k, v] of Object.entries(days)) if (isValidKey(k) && Number.isFinite(v) && v > 0) clean[k] = Math.min(v, 9999);
      out.logs[hid] = clean;
    }
  }
  normWorkoutData(data, out);
  out.journal = {};
  if (isObj(data.journal)) {
    for (const [k, v] of Object.entries(data.journal)) {
      if (!isValidKey(k) || !isObj(v)) continue;
      const mood = [1, 2, 3, 4, 5].includes(v.mood) ? v.mood : null;
      const note = str(v.note, 1000);
      if (mood || note) out.journal[k] = { mood, note, ...(Number.isFinite(v.updatedAt) ? { updatedAt: v.updatedAt } : {}) };
    }
  }
  return out;
}

export function migrate(data) {
  if (!isObj(data)) throw new Error('Data is not an object');
  let v = Number.isInteger(data.version) ? data.version : 1;
  if (v > SCHEMA_VERSION) throw new Error('This backup was made by a newer version of the app');
  while (v < SCHEMA_VERSION) {
    const fn = migrations[v];
    if (fn) data = fn(data);
    v++;
  }
  return normalize(data);
}

/**
 * Validate an imported backup.
 *  - multi-profile backup (1.3+): { kind: 'multi', activeId, profiles: [{ id, name, avatar, data }] }
 *  - single-profile backup (v1–v3, or a bare data object): { kind: 'single', data }
 * Throws a friendly Error when the file isn't usable.
 */
export function validateImport(obj) {
  if (!isObj(obj)) throw new Error('The file is not a valid backup.');
  if (obj.app === 'daily-tracker' && Array.isArray(obj.profiles)) {
    const profiles = [];
    const seen = new Set();
    obj.profiles.slice(0, 20).forEach((p, i) => {
      const meta = normProfileMeta(p, i);
      if (!meta) return;
      const unreadable = p.unreadable === true && typeof p.raw === 'string' && p.raw.length <= 5e6;
      if (!unreadable && !isObj(p.data)) return;
      while (seen.has(meta.id)) meta.id = uid();
      seen.add(meta.id);
      delete meta.introPending;
      // Data this app couldn't read is carried as raw text, so restoring keeps its safety guard.
      profiles.push(unreadable ? { ...meta, raw: p.raw, unreadable: true } : { ...meta, data: migrate(p.data) });
    });
    if (!profiles.length) throw new Error('The backup contains no profiles.');
    const activeId = profiles.some((p) => p.id === obj.activeId) ? obj.activeId : profiles[0].id;
    return { kind: 'multi', activeId, profiles };
  }
  const data = isObj(obj.data) && obj.app === 'daily-tracker' ? obj.data : obj;
  if (!Array.isArray(data.tasks) || !Array.isArray(data.habits)) {
    throw new Error('The file does not look like a Daily Tracker backup (missing tasks/habits).');
  }
  return { kind: 'single', data: migrate(data) };
}

// ---- runtime store ----
let state = defaultState();
let storageOk = true;
// If saved data can't be read we keep a backup and block saving until the user decides,
// so a bug or corrupted value never silently overwrites their data.
let loadFailure = null; // { raw, backupKey, error }
// Profile index: { activeId, profiles, deleted: [ids], migratedLegacy: { profileId, hash, length, at } }
let index = { activeId: null, profiles: [], deleted: [], migratedLegacy: null };
const listeners = new Set();
const saveErrorListeners = new Set();
const saveOkListeners = new Set();

function lsGet(k) { return localStorage.getItem(k); }
function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
    if (!storageOk) { storageOk = true; saveOkListeners.forEach((l) => l()); }
    return true;
  } catch (e) {
    storageOk = false;
    saveErrorListeners.forEach((l) => l(e));
    return false;
  }
}

/** Small, stable string hash (FNV-1a) to recognise legacy data we've already moved. */
export function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + str.length;
}

function readStoredIndex() {
  let parsed = null;
  try { parsed = JSON.parse(lsGet(PROFILES_KEY) || 'null'); } catch { parsed = null; }
  if (!isObj(parsed) || !Array.isArray(parsed.profiles)) return null;
  const seen = new Set();
  return {
    activeId: parsed.activeId,
    profiles: parsed.profiles.map(normProfileMeta).filter((p) => p && !seen.has(p.id) && seen.add(p.id)),
    deleted: Array.isArray(parsed.deleted) ? parsed.deleted.filter((x) => typeof x === 'string').slice(-200) : [],
    migratedLegacy: isObj(parsed.migratedLegacy) ? parsed.migratedLegacy : null,
  };
}

/**
 * Combine this tab's index with what's stored (another tab may have changed it): union by id,
 * newer profile edits win, deletions are remembered as tombstones so they stick.
 */
function mergeIndex(mine, stored) {
  if (!stored) return mine;
  const deleted = new Set([...(mine.deleted || []), ...(stored.deleted || [])]);
  const byId = new Map(stored.profiles.map((p) => [p.id, p]));
  const order = [...mine.profiles.map((p) => p.id), ...stored.profiles.map((p) => p.id)];
  for (const p of mine.profiles) {
    const o = byId.get(p.id);
    if (!o || (p.updatedAt || 0) >= (o.updatedAt || 0)) byId.set(p.id, p);
  }
  const profiles = [...new Set(order)].filter((id) => !deleted.has(id)).map((id) => byId.get(id));
  return { activeId: mine.activeId, profiles, deleted: [...deleted].slice(-200), migratedLegacy: mine.migratedLegacy || stored.migratedLegacy || null };
}

function saveIndex() {
  index = mergeIndex(index, readStoredIndex());
  if (!index.profiles.some((p) => p.id === index.activeId)) index.activeId = index.profiles[0]?.id || null;
  return lsSet(PROFILES_KEY, JSON.stringify({ version: 1, ...index }));
}

/** Read (or create) the profile index, moving pre-1.3 single-profile data into the first profile. */
function loadIndex() {
  const stored = readStoredIndex();
  if (stored && stored.profiles.length) {
    index = { ...stored, activeId: stored.profiles.some((p) => p.id === stored.activeId) ? stored.activeId : stored.profiles[0].id };
    return;
  }
  // First run of 1.3+: the old data (if any) becomes the first profile. The raw text is moved
  // as-is, so even unreadable data keeps its load-failure/backup protection.
  const legacy = lsGet(LEGACY_KEY);
  const id = 'p' + uid();
  index = {
    activeId: id, deleted: [],
    profiles: [{ id, name: 'Me', avatar: { type: 'emoji', emoji: '', color: PROFILE_COLORS[0] }, updatedAt: 0, ...(legacy ? { introPending: true } : {}) }],
    migratedLegacy: legacy !== null ? { profileId: id, hash: hashStr(legacy), length: legacy.length, at: Date.now() } : null,
  };
  if (legacy !== null) {
    if (!lsSet(dataKey(id), legacy)) return; // keep the legacy key if the copy failed
    try { localStorage.setItem(BASELINE_KEY, legacy); } catch { /* optional: merge falls back to two-way */ }
  }
  if (saveIndex() && legacy !== null) { try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ } }
}

function loadProfileData(id) {
  loadFailure = null;
  let raw = null;
  try { raw = lsGet(dataKey(id)); } catch { storageOk = false; state = defaultState(); return; }
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    state = parsed ? migrate(parsed) : defaultState();
    // Write migrated data straight back so old fields don't linger in storage.
    if (parsed && parsed.version !== SCHEMA_VERSION) save();
  } catch (e) {
    console.warn('Could not read saved data; keeping a backup and pausing saves.', e);
    const backupKey = writeBackup(id, raw);
    loadFailure = { raw, backupKey, error: String(e?.message || e) };
    state = defaultState();
    state.settings.onboarded = true;
  }
}

export function load() {
  try { loadIndex(); } catch { storageOk = false; }
  try {
    const at = index.migratedLegacy?.at || 0;
    if (lsGet(BASELINE_KEY) !== null && lsGet(LEGACY_KEY) === null && Date.now() - at > BASELINE_TTL) localStorage.removeItem(BASELINE_KEY);
  } catch { /* ignore */ }
  if (index.activeId) loadProfileData(index.activeId); else state = defaultState();
  return state;
}

const backupPrefix = (id) => `${dataKey(id)}:backup-`;
function backupKeys(id) {
  const keys = [];
  const prefix = backupPrefix(id);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
  } catch { /* ignore */ }
  return keys.sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length))); // newest first
}
function pruneBackups(id, keep) {
  backupKeys(id).slice(keep).forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
}
/** Store the unreadable text once (no duplicate per reload) and keep only the newest 3 backups. */
function writeBackup(id, raw) {
  const existing = backupKeys(id).find((k) => { try { return localStorage.getItem(k) === raw; } catch { return false; } });
  if (existing) return existing;
  const key = backupPrefix(id) + Date.now();
  try { localStorage.setItem(key, raw); } catch { /* storage full: raw is still kept in memory */ }
  pruneBackups(id, 3);
  return key;
}

export const getLoadFailure = () => loadFailure;

/** User chose to start fresh: allow saving again (the backup key stays in storage). */
export function resolveLoadFailure() {
  loadFailure = null;
  pruneBackups(index.activeId, 1); // keep just the most recent copy of the unreadable data
  save();
  emit();
}

export function save() {
  if (loadFailure || !index.activeId) return false;
  return lsSet(dataKey(index.activeId), JSON.stringify(state));
}

export const isStorageOk = () => storageOk;
export const getState = () => state;
export const onSaveError = (fn) => saveErrorListeners.add(fn);
export const onSaveOk = (fn) => saveOkListeners.add(fn);

function emit(info = {}) { listeners.forEach((l) => l(state, info)); }

/** Mutate state via fn(state), persist, and notify listeners (unless silent). Returns whether it saved. */
export function update(fn, { silent = false } = {}) {
  fn(state);
  const ok = save();
  if (!silent) emit();
  return ok;
}

export function replaceState(next) {
  loadFailure = null; // an explicit import/reset is the user's decision
  state = next;
  save();
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Profile API ----------
export const getProfiles = () => index.profiles;
export const getActiveProfile = () => index.profiles.find((p) => p.id === index.activeId) || index.profiles[0];
export const getIndexInfo = () => ({ migratedLegacy: index.migratedLegacy });

export function switchProfile(id) {
  if (id === index.activeId || !index.profiles.some((p) => p.id === id)) return false;
  save();
  index.activeId = id;
  saveIndex();
  loadProfileData(id);
  emit({ profileSwitched: true });
  return true;
}

/** Create a profile (optionally with existing data) and switch to it. */
export function addProfile({ name, avatar, data = null, raw = null }) {
  const id = 'p' + uid();
  const meta = { ...normProfileMeta({ id, name, avatar }, index.profiles.length), updatedAt: Date.now() };
  const fresh = data || defaultState();
  if (!data && raw === null) fresh.settings.onboarded = true;
  if (!lsSet(dataKey(id), raw !== null ? raw : JSON.stringify(fresh))) return null;
  index.profiles.push(meta);
  if (!saveIndex()) { index.profiles = index.profiles.filter((p) => p.id !== id); try { localStorage.removeItem(dataKey(id)); } catch { /* ignore */ } return null; }
  switchProfile(id);
  return id;
}

export function updateProfile(id, patch) {
  const p = index.profiles.find((x) => x.id === id);
  if (!p) return false;
  const prev = { ...p };
  const next = normProfileMeta({ ...p, ...patch, id }, index.profiles.indexOf(p));
  delete next.introPending;
  Object.assign(p, next, { updatedAt: Date.now() });
  if (!patch.introPending) delete p.introPending;
  if (!saveIndex()) { Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, prev); return false; }
  emit({ profileChanged: true });
  return true;
}

export function deleteProfile(id) {
  if (index.profiles.length <= 1) return false;
  const wasActive = id === index.activeId;
  index.profiles = index.profiles.filter((p) => p.id !== id);
  index.deleted = [...(index.deleted || []), id];
  if (wasActive) index.activeId = index.profiles[0].id;
  saveIndex();
  try { localStorage.removeItem(dataKey(id)); } catch { /* ignore */ }
  pruneBackups(id, 0);
  if (wasActive) { loadProfileData(index.activeId); emit({ profileSwitched: true }); } else emit({ profileChanged: true });
  return true;
}

/** Read-only state of any profile (the active one from memory). Unreadable data → null. */
export function readProfileState(id) {
  if (id === index.activeId) return loadFailure ? null : state;
  try {
    const raw = lsGet(dataKey(id));
    return raw ? migrate(JSON.parse(raw)) : defaultState();
  } catch { return null; }
}

function isReadable(id) {
  if (id === index.activeId) return !loadFailure;
  return readProfileState(id) !== null;
}

/** Profiles on this device whose data can't be read (they're never deleted without asking). */
export function unreadableProfiles(excludeIds = []) {
  return index.profiles.filter((p) => !excludeIds.includes(p.id) && !isReadable(p.id));
}

export function exportPayload() {
  return {
    app: 'daily-tracker', appVersion: APP_VERSION, format: 'profiles', exportedAt: new Date().toISOString(),
    activeId: index.activeId,
    profiles: index.profiles.map((p) => {
      const meta = { id: p.id, name: p.name, avatar: p.avatar };
      if (p.id === index.activeId && loadFailure) return { ...meta, unreadable: true, raw: loadFailure.raw ?? '' };
      const data = readProfileState(p.id);
      if (data) return { ...meta, data };
      let raw = '';
      try { raw = lsGet(dataKey(p.id)) ?? ''; } catch { /* ignore */ }
      return { ...meta, unreadable: true, raw };
    }),
  };
}

/**
 * Replace every profile with an imported multi-profile backup. Profiles on this device whose
 * data can't be read are kept (with their backups) unless deleteUnreadable is explicitly true.
 */
export function replaceAllProfiles({ activeId, profiles }, { deleteUnreadable = false } = {}) {
  const keepUnreadable = deleteUnreadable ? [] : unreadableProfiles(profiles.map((p) => p.id));
  for (const p of profiles) {
    const ok = lsSet(dataKey(p.id), p.unreadable ? p.raw : JSON.stringify(p.data));
    if (!ok) return false;
  }
  const keepIds = new Set([...profiles.map((p) => p.id), ...keepUnreadable.map((p) => p.id)]);
  const removed = index.profiles.map((p) => p.id).filter((id) => !keepIds.has(id));
  removed.forEach((id) => { try { localStorage.removeItem(dataKey(id)); } catch { /* ignore */ } });
  // Backup keys are left alone here; they only ever hold copies of unreadable data.
  index = {
    activeId,
    profiles: [...profiles.map(({ id, name, avatar }) => ({ id, name, avatar, updatedAt: Date.now() })), ...keepUnreadable],
    deleted: [...(index.deleted || []), ...removed],
    migratedLegacy: index.migratedLegacy,
  };
  lsSet(PROFILES_KEY, JSON.stringify({ version: 1, ...index })); // a full replace: don't merge the old list back in
  loadProfileData(activeId);
  emit({ profileSwitched: true });
  return true;
}

// ---------- Changes from other tabs ----------
/**
 * Handle a `storage` event (another tab changed localStorage). Returns what happened, or null.
 * - the profile list changed → refresh it; if our active profile was deleted, switch.
 * - our active profile's data changed → reload it.
 * - an older app version wrote the pre-1.3 key → report it (see pendingLegacy).
 */
export function handleStorageEvent(e) {
  if (e.key === null) return null; // storage cleared elsewhere; ignore
  if (e.key === PROFILES_KEY) {
    const stored = readStoredIndex();
    if (!stored) return null;
    const deleted = new Set(stored.deleted);
    const mine = { ...index, profiles: index.profiles.filter((p) => !deleted.has(p.id)) };
    index = mergeIndex(mine, stored);
    if (!index.profiles.some((p) => p.id === index.activeId)) {
      const gone = index.activeId;
      index.activeId = index.profiles[0]?.id || null;
      if (index.activeId) { loadProfileData(index.activeId); emit({ profileSwitched: true, deletedElsewhere: gone }); }
      return { deletedElsewhere: gone };
    }
    emit({ profileChanged: true });
    return { profileChanged: true };
  }
  if (e.key === dataKey(index.activeId)) {
    loadProfileData(index.activeId);
    emit({ external: true });
    return { external: true };
  }
  if (e.key === LEGACY_KEY && e.newValue === null) {
    emit({ legacyResolved: true }); // another tab handled it
    return { legacyResolved: true };
  }
  if (e.key === LEGACY_KEY && e.newValue !== null) {
    emit({ legacyChanged: true });
    return { legacyChanged: true };
  }
  return null;
}

// ---------- Data written by an older (pre-1.3) tab after the upgrade ----------
/** Legacy data that appeared after migration (an old tab kept writing it), or null. */
export function pendingLegacy() {
  let raw = null;
  try { raw = lsGet(LEGACY_KEY); } catch { return null; }
  if (raw === null) return null;
  if (index.migratedLegacy && index.migratedLegacy.hash === hashStr(raw)) {
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ } // already moved; leftover copy
    return null;
  }
  return { raw };
}

const strip = (x) => {
  if (x === undefined || x === null) return x;
  // Bookkeeping fields aren't user changes (createdAt is filled in when old data lacks it).
  const { updatedAt, order, createdAt, ...rest } = x; void updatedAt; void order; void createdAt;
  return JSON.stringify(rest);
};
const same = (a, b) => strip(a) === strip(b);

/**
 * Three-way merge of one value: base = as migrated, leg = old tab now, cur = this version now.
 * - old tab didn't change it → keep ours (including a local deletion / un-check)
 * - old tab changed it → take theirs, unless we changed it too after the upgrade (newer wins)
 * - old tab deleted it → delete, unless we changed it locally
 * Returns the value to keep, or undefined to drop it.
 */
function merge3(base, leg, cur, since) {
  if (same(leg, base)) return cur;
  if (leg === undefined) return cur !== undefined && !same(cur, base) ? cur : undefined;
  if (cur !== undefined && !same(cur, base) && (cur.updatedAt || 0) > since) return cur; // both changed: ours is newer
  return leg;
}

function mergeList(baseList, legList, curList, since) {
  const B = new Map((baseList || []).map((x) => [x.id, x]));
  const L = new Map(legList.map((x) => [x.id, x]));
  const C = new Map(curList.map((x) => [x.id, x]));
  const ids = [...new Set([...curList.map((x) => x.id), ...legList.map((x) => x.id), ...B.keys()])];
  const out = [];
  for (const id of ids) {
    const v = merge3(B.get(id), L.get(id), C.get(id), since);
    if (v !== undefined) out.push(v === L.get(id) && v !== C.get(id) ? { ...v, ...(C.get(id)?.order !== undefined ? { order: C.get(id).order } : {}), updatedAt: Date.now() } : v);
  }
  return out;
}

/** Three-way map merge for { key: value } (habit logs per habit, journal per date). */
function mergeMap(base, leg, cur, since, wrap = (v) => v) {
  const out = {};
  for (const k of new Set([...Object.keys(cur), ...Object.keys(leg), ...Object.keys(base)])) {
    const v = merge3(wrap(base[k]), wrap(leg[k]), wrap(cur[k]), since);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Merge older-version data into a profile's data. With a baseline (the data as it was moved at
 * the upgrade) this is a true three-way merge: local deletions and un-checks stay, and deletions
 * made in the old tab are applied. Without one (upgraded before 1.3.2) nothing in the baseline is
 * known, so additions and old-tab edits come in and deletions are not applied.
 */
export function mergeLegacyInto(cur, leg, since, base = null) {
  const b = base || { tasks: [], habits: [], categories: [], logs: {}, journal: {} };
  const out = JSON.parse(JSON.stringify(cur));
  out.tasks = mergeList(b.tasks, leg.tasks, out.tasks, since);
  out.habits = mergeList(b.habits, leg.habits, out.habits, since);
  out.categories = mergeList(b.categories, leg.categories, out.categories, since);
  // Habit logs: per habit, per day, same three-way rule (values wrapped so "absent" is undefined).
  const box = (v) => (v === undefined ? undefined : { v });
  const hids = new Set([...Object.keys(out.logs), ...Object.keys(leg.logs), ...Object.keys(b.logs)]);
  for (const hid of hids) {
    const m = mergeMap(b.logs[hid] || {}, leg.logs[hid] || {}, out.logs[hid] || {}, since, box);
    out.logs[hid] = Object.fromEntries(Object.entries(m).map(([d, x]) => [d, x.v]));
    // A day the old tab changed is no longer an automatic (workout-link) check.
    if (out.autoHabit?.[hid]) for (const d of Object.keys(out.autoHabit[hid])) if (out.logs[hid][d] !== (cur.logs[hid] || {})[d]) delete out.autoHabit[hid][d];
  }
  out.journal = mergeMap(b.journal, leg.journal, out.journal, since);
  return normalize(out);
}

/** action: 'merge' (into targetId), 'add' (new profile) or 'discard'. Returns a short result message. */
/** The profile older-version changes belong to: the one the old data was moved into, if it still exists. */
export function legacyTargetProfile() {
  const id = index.migratedLegacy?.profileId;
  return index.profiles.find((p) => p.id === id) || getActiveProfile();
}

export function resolveLegacy(action, targetId = legacyTargetProfile()?.id) {
  const pending = pendingLegacy();
  if (!pending) return 'Nothing to do';
  const done = () => {
    // `at` moves forward: later merges treat edits made after this point as "ours, newer".
    index.migratedLegacy = { ...(index.migratedLegacy || {}), hash: hashStr(pending.raw), length: pending.raw.length, at: Date.now() + 1 };
    saveIndex();
    // What we just handled becomes the new baseline, in case the old tab writes again.
    try { localStorage.setItem(BASELINE_KEY, pending.raw); } catch { /* ignore */ }
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  };
  if (action === 'discard') { done(); return 'Discarded'; }
  let leg;
  try { leg = migrate(JSON.parse(pending.raw)); } catch {
    if (action === 'add') { const id = addProfile({ name: 'Older version', raw: pending.raw }); if (id) done(); return id ? 'Added' : 'Storage full'; }
    return 'Unreadable';
  }
  if (action === 'add') {
    leg.settings.onboarded = true;
    const id = addProfile({ name: 'Older version', data: leg });
    if (id) done();
    return id ? 'Added' : 'Storage full';
  }
  const since = index.migratedLegacy?.at || 0;
  const cur = targetId === index.activeId ? (loadFailure ? null : state) : readProfileState(targetId);
  if (!cur) return 'Unreadable';
  let base = null;
  try { const raw = lsGet(BASELINE_KEY); base = raw ? migrate(JSON.parse(raw)) : null; } catch { base = null; }
  const merged = mergeLegacyInto(cur, leg, since, base);
  if (targetId === index.activeId) { state = merged; if (!save()) return 'Storage full'; emit(); }
  else if (!lsSet(dataKey(targetId), JSON.stringify(merged))) return 'Storage full';
  done();
  return 'Merged';
}
