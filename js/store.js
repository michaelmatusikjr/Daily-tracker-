// Persistent app state in localStorage with a versioned schema + migrations.
import { todayKey, isValidKey } from './dates.js';

export const APP_VERSION = '1.1.1';
export const SCHEMA_VERSION = 2;
const STORAGE_KEY = 'dailyTracker:data';
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
    alarms: [],
    codes: [],
  };
}

// Migration hook: migrations[n] upgrades a version-n object to version n+1.
const migrations = {
  // v1 → v2: alarms and registered scan codes were added.
  1: (data) => ({ ...data, alarms: Array.isArray(data.alarms) ? data.alarms : [], codes: Array.isArray(data.codes) ? data.codes : [] }),
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

export const ALARM_TONES = ['classic', 'digital', 'chime', 'sunrise'];

function normAlarm(a) {
  if (!isObj(a) || !TIME_RE.test(a.time)) return null;
  const days = Array.isArray(a.days) ? [...new Set(a.days.filter((d) => Number.isInteger(d) && d >= 0 && d < 7))].sort() : [];
  return {
    id: str(a.id, 40) || uid(),
    time: a.time,
    label: str(a.label, 60).trim(),
    days, // [] = once
    enabled: a.enabled !== false,
    tone: ALARM_TONES.includes(a.tone) ? a.tone : 'classic',
    gradual: !!a.gradual,
    snoozeMin: [5, 10, 15].includes(a.snoozeMin) ? a.snoozeMin : 10,
    maxSnoozes: Number.isInteger(a.maxSnoozes) && a.maxSnoozes >= 0 && a.maxSnoozes <= 10 ? a.maxSnoozes : 3,
    vibrate: a.vibrate !== false,
    dismiss: a.dismiss === 'scan' ? 'scan' : 'normal',
    scanSnooze: !!a.scanSnooze,
    codeIds: Array.isArray(a.codeIds) ? a.codeIds.filter((x) => typeof x === 'string').slice(0, 20) : [],
    createdAt: Number.isFinite(a.createdAt) ? a.createdAt : Date.now(),
    // Occurrences before this moment are never rung or reported as missed (set on save/enable).
    armedAt: Number.isFinite(a.armedAt) ? a.armedAt : Date.now(),
  };
}

function normCode(c) {
  if (!isObj(c) || typeof c.value !== 'string' || !c.value) return null;
  return {
    id: str(c.id, 40) || uid(),
    value: c.value.slice(0, 500),
    format: str(c.format, 30),
    nickname: str(c.nickname, 40).trim() || 'My code',
    createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
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
  out.alarms = dedupeIds((Array.isArray(data.alarms) ? data.alarms : []).map(normAlarm).filter(Boolean)).slice(0, 50);
  out.codes = dedupeIds((Array.isArray(data.codes) ? data.codes : []).map(normCode).filter(Boolean)).slice(0, 20);
  const codeIds = new Set(out.codes.map((c) => c.id));
  out.alarms.forEach((a) => {
    const had = a.codeIds.length;
    a.codeIds = a.codeIds.filter((id) => codeIds.has(id));
    // Never widen "these codes" to "any code", and scan mode needs at least one code.
    if (a.dismiss === 'scan' && (!out.codes.length || (had && !a.codeIds.length))) { a.dismiss = 'normal'; a.codeIds = []; }
  });
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

/** Validate an imported backup. Returns a normalized state or throws a friendly Error. */
export function validateImport(obj) {
  if (!isObj(obj)) throw new Error('The file is not a valid backup.');
  const data = isObj(obj.data) && obj.app === 'daily-tracker' ? obj.data : obj;
  if (!Array.isArray(data.tasks) || !Array.isArray(data.habits)) {
    throw new Error('The file does not look like a Daily Tracker backup (missing tasks/habits).');
  }
  return migrate(data);
}

export function exportPayload() {
  return { app: 'daily-tracker', appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: state };
}

// ---- runtime store ----
let state = defaultState();
let storageOk = true;
// If saved data can't be read we keep a backup and block saving until the user decides,
// so a bug or corrupted value never silently overwrites their data.
let loadFailure = null; // { raw, backupKey, error }
const listeners = new Set();

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    storageOk = false;
    state = defaultState();
    return state;
  }
  try {
    state = raw ? migrate(JSON.parse(raw)) : defaultState();
  } catch (e) {
    console.warn('Could not read saved data; keeping a backup and pausing saves.', e);
    const backupKey = writeBackup(raw);
    loadFailure = { raw, backupKey, error: String(e?.message || e) };
    state = defaultState();
    state.settings.onboarded = true;
  }
  return state;
}

const BACKUP_PREFIX = `${STORAGE_KEY}:backup-`;
function backupKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(BACKUP_PREFIX)) keys.push(k);
    }
  } catch { /* ignore */ }
  return keys.sort((a, b) => Number(b.slice(BACKUP_PREFIX.length)) - Number(a.slice(BACKUP_PREFIX.length))); // newest first
}
function pruneBackups(keep) {
  backupKeys().slice(keep).forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
}
/** Store the unreadable text once (no duplicate per reload) and keep only the newest 3 backups. */
function writeBackup(raw) {
  const existing = backupKeys().find((k) => { try { return localStorage.getItem(k) === raw; } catch { return false; } });
  if (existing) return existing;
  const key = BACKUP_PREFIX + Date.now();
  try { localStorage.setItem(key, raw); } catch { /* storage full: raw is still kept in memory */ }
  pruneBackups(3);
  return key;
}

export const getLoadFailure = () => loadFailure;

/** User chose to start fresh: allow saving again (the backup key stays in storage). */
export function resolveLoadFailure() {
  loadFailure = null;
  pruneBackups(1); // keep just the most recent copy of the unreadable data
  save();
  listeners.forEach((l) => l(state));
}

export function save() {
  if (loadFailure) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageOk = true;
  } catch {
    storageOk = false;
  }
  return storageOk;
}

export const isStorageOk = () => storageOk;
export const getState = () => state;

/** Mutate state via fn(state), persist, and notify listeners (unless silent). */
export function update(fn, { silent = false } = {}) {
  fn(state);
  save();
  if (!silent) listeners.forEach((l) => l(state));
}

export function replaceState(next) {
  loadFailure = null; // an explicit import/reset is the user's decision
  state = next;
  save();
  listeners.forEach((l) => l(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const STORAGE_KEY_NAME = STORAGE_KEY;
