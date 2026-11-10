// Persistent app state in localStorage with a versioned schema + migrations.
import { todayKey, isValidKey } from './dates.js';

export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'dailyTracker:data';

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
  };
}

// Migration hook: migrations[n] upgrades a version-n object to version n+1.
const migrations = {
  // 1: (data) => { /* e.g. rename fields */ return data; },
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
  return {
    id: str(hb.id, 40) || uid(),
    name: str(hb.name, 100).trim(),
    emoji: str(hb.emoji, 16) || '✅',
    color: /^#[0-9a-f]{6}$/i.test(hb.color) ? hb.color : '#6366f1',
    schedule: {
      type: ['daily', 'days', 'perWeek'].includes(sc.type) ? sc.type : 'daily',
      days: Array.isArray(sc.days) ? sc.days.filter((d) => Number.isInteger(d) && d >= 0 && d < 7) : [1, 2, 3, 4, 5],
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

/** Fill defaults and drop malformed entries so the rest of the app can trust the shape. */
export function normalize(data) {
  const def = defaultState();
  const out = { ...def, version: SCHEMA_VERSION };
  out.settings = { ...def.settings, ...(isObj(data.settings) ? data.settings : {}) };
  if (!['system', 'light', 'dark'].includes(out.settings.theme)) out.settings.theme = 'system';
  if (![0, 1].includes(out.settings.weekStart)) out.settings.weekStart = 1;
  if (!['12', '24'].includes(out.settings.timeFormat)) out.settings.timeFormat = def.settings.timeFormat;
  out.categories = Array.isArray(data.categories)
    ? data.categories.filter((c) => isObj(c) && str(c.name).trim()).map((c) => ({
        id: str(c.id, 40) || uid(), name: str(c.name, 40).trim(), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#64748b',
      }))
    : def.categories;
  out.tasks = (Array.isArray(data.tasks) ? data.tasks : []).map(normTask).filter(Boolean);
  out.habits = (Array.isArray(data.habits) ? data.habits : []).map(normHabit).filter(Boolean);
  out.logs = {};
  if (isObj(data.logs)) {
    for (const [hid, days] of Object.entries(data.logs)) {
      if (!isObj(days)) continue;
      const clean = {};
      for (const [k, v] of Object.entries(days)) if (isValidKey(k) && Number.isFinite(v) && v > 0) clean[k] = Math.min(v, 9999);
      out.logs[hid] = clean;
    }
  }
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
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? migrate(JSON.parse(raw)) : defaultState();
  } catch (e) {
    console.warn('Could not load saved data, starting fresh.', e);
    state = defaultState();
  }
  return state;
}

export function save() {
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
  state = next;
  save();
  listeners.forEach((l) => l(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const STORAGE_KEY_NAME = STORAGE_KEY;
