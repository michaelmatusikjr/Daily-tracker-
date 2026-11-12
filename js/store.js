// Persistent app state in localStorage with a versioned schema + migrations.
// Several profiles: an index key plus one data key per profile.
import { todayKey, isValidKey } from './dates.js';

export const APP_VERSION = '1.3.0';
export const SCHEMA_VERSION = 4;
const LEGACY_KEY = 'dailyTracker:data'; // single-profile data before 1.3.0
const PROFILES_KEY = 'dailyTracker:profiles';
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
  };
}

// ---------- Workouts ----------
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null);
const int = (v, max) => { const n = num(v, max); return n === null ? null : Math.round(n); };

function normExercise(e) {
  if (!isObj(e) || !str(e.name).trim()) return null;
  return {
    id: str(e.id, 40) || uid(), name: str(e.name, 60).trim(),
    type: e.type === 'cardio' ? 'cardio' : 'strength',
    archived: !!e.archived, createdAt: Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
  };
}

function normLine(l) {
  if (!isObj(l)) return null;
  const line = { weight: num(l.weight, 5000), sets: int(l.sets, 1000), reps: int(l.reps, 100000) };
  return Object.values(line).some((v) => v !== null && v > 0) ? line : null;
}

function normWorkout(w) {
  if (!isObj(w) || !isValidKey(w.date) || typeof w.exerciseId !== 'string' || !w.exerciseId) return null;
  const out = {
    id: str(w.id, 40) || uid(), date: w.date, exerciseId: w.exerciseId.slice(0, 40),
    lines: (Array.isArray(w.lines) ? w.lines : []).map(normLine).filter(Boolean).slice(0, 30),
    weightUnit: w.weightUnit === 'kg' ? 'kg' : 'lb',
    time: num(w.time, 1e6), // seconds
    distance: num(w.distance, 1e5), distanceUnit: w.distanceUnit === 'km' ? 'km' : 'mi',
    note: str(w.note, 300), createdAt: Number.isFinite(w.createdAt) ? w.createdAt : Date.now(),
  };
  if (!out.lines.length && !(out.time > 0) && !(out.distance > 0)) return null; // nothing logged
  return out;
}

function normWorkoutData(data, out) {
  const s = out.settings;
  if (!['lb', 'kg'].includes(s.weightUnit)) s.weightUnit = 'lb';
  if (!['mi', 'km'].includes(s.distanceUnit)) s.distanceUnit = 'mi';
  out.exercises = dedupeIds((Array.isArray(data.exercises) ? data.exercises : []).map(normExercise).filter(Boolean)).slice(0, 500);
  out.workouts = dedupeIds((Array.isArray(data.workouts) ? data.workouts : []).map(normWorkout).filter(Boolean)).slice(-20000);
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
  s.workoutHabit = { habitId: linked ? linked.id : null, filter: ['strength', 'cardio'].includes(wh.filter) ? wh.filter : 'any' };
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
      if (mood || note) out.journal[k] = { mood, note };
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
      if (!meta || !isObj(p.data)) return;
      while (seen.has(meta.id)) meta.id = uid();
      seen.add(meta.id);
      delete meta.introPending;
      profiles.push({ ...meta, data: migrate(p.data) });
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
let index = { activeId: null, profiles: [] }; // profile index
const listeners = new Set();
const saveErrorListeners = new Set();

function lsGet(k) { return localStorage.getItem(k); }
function lsSet(k, v) {
  try { localStorage.setItem(k, v); return true; } catch (e) {
    storageOk = false;
    saveErrorListeners.forEach((l) => l(e));
    return false;
  }
}

function saveIndex() {
  return lsSet(PROFILES_KEY, JSON.stringify({ version: 1, activeId: index.activeId, profiles: index.profiles }));
}

/** Read (or create) the profile index, moving pre-1.3 single-profile data into the first profile. */
function loadIndex() {
  let parsed = null;
  try { parsed = JSON.parse(lsGet(PROFILES_KEY) || 'null'); } catch { parsed = null; }
  if (isObj(parsed) && Array.isArray(parsed.profiles)) {
    const seen = new Set();
    const profiles = parsed.profiles.map(normProfileMeta).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
    if (profiles.length) {
      index = { activeId: profiles.some((p) => p.id === parsed.activeId) ? parsed.activeId : profiles[0].id, profiles };
      return;
    }
  }
  // First run of 1.3+: the old data (if any) becomes the first profile. The raw text is moved
  // as-is, so even unreadable data keeps its load-failure/backup protection.
  const legacy = lsGet(LEGACY_KEY);
  const id = 'p' + uid();
  index = { activeId: id, profiles: [{ id, name: 'Me', avatar: { type: 'emoji', emoji: '', color: PROFILE_COLORS[0] }, ...(legacy ? { introPending: true } : {}) }] };
  if (legacy !== null) {
    if (!lsSet(dataKey(id), legacy)) return; // keep the legacy key if the copy failed
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
  const ok = lsSet(dataKey(index.activeId), JSON.stringify(state));
  if (ok) storageOk = true;
  return ok;
}

export const isStorageOk = () => storageOk;
export const getState = () => state;
export const onSaveError = (fn) => saveErrorListeners.add(fn);

function emit(info = {}) { listeners.forEach((l) => l(state, info)); }

/** Mutate state via fn(state), persist, and notify listeners (unless silent). */
export function update(fn, { silent = false } = {}) {
  fn(state);
  save();
  if (!silent) emit();
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
export function addProfile({ name, avatar, data = null }) {
  const id = 'p' + uid();
  const meta = normProfileMeta({ id, name, avatar }, index.profiles.length);
  const fresh = data || defaultState();
  if (!data) fresh.settings.onboarded = true;
  if (!lsSet(dataKey(id), JSON.stringify(fresh))) return null;
  index.profiles.push(meta);
  if (!saveIndex()) { index.profiles.pop(); try { localStorage.removeItem(dataKey(id)); } catch { /* ignore */ } return null; }
  switchProfile(id);
  return id;
}

export function updateProfile(id, patch) {
  const p = index.profiles.find((x) => x.id === id);
  if (!p) return false;
  const prev = { ...p };
  const next = normProfileMeta({ ...p, ...patch, id }, index.profiles.indexOf(p));
  delete next.introPending;
  Object.assign(p, next);
  if (!patch.introPending) delete p.introPending;
  if (!saveIndex()) { Object.assign(p, prev); return false; }
  emit({ profileChanged: true });
  return true;
}

export function deleteProfile(id) {
  if (index.profiles.length <= 1) return false;
  const wasActive = id === index.activeId;
  index.profiles = index.profiles.filter((p) => p.id !== id);
  if (wasActive) index.activeId = index.profiles[0].id;
  saveIndex();
  try { localStorage.removeItem(dataKey(id)); } catch { /* ignore */ }
  pruneBackups(id, 0);
  if (wasActive) { loadProfileData(index.activeId); emit({ profileSwitched: true }); } else emit({ profileChanged: true });
  return true;
}

/** Read-only state of any profile (the active one from memory). Unreadable data → null. */
export function readProfileState(id) {
  if (id === index.activeId) return state;
  try {
    const raw = lsGet(dataKey(id));
    return raw ? migrate(JSON.parse(raw)) : defaultState();
  } catch { return null; }
}

export function exportPayload() {
  return {
    app: 'daily-tracker', appVersion: APP_VERSION, format: 'profiles', exportedAt: new Date().toISOString(),
    activeId: index.activeId,
    profiles: index.profiles.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, data: readProfileState(p.id) })).filter((p) => p.data),
  };
}

/** Replace every profile with an imported multi-profile backup. */
export function replaceAllProfiles({ activeId, profiles }) {
  const old = index.profiles.map((p) => p.id);
  for (const p of profiles) if (!lsSet(dataKey(p.id), JSON.stringify(p.data))) return false;
  old.filter((id) => !profiles.some((p) => p.id === id)).forEach((id) => {
    try { localStorage.removeItem(dataKey(id)); } catch { /* ignore */ }
    pruneBackups(id, 0);
  });
  index = { activeId, profiles: profiles.map(({ id, name, avatar }) => ({ id, name, avatar })) };
  saveIndex();
  loadProfileData(activeId);
  emit({ profileSwitched: true });
  return true;
}
