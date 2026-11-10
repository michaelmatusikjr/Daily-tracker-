// In-app reminders. Browsers can't reliably wake a closed web app on a timer
// without a push server, so reminders are scheduled with setTimeout while the
// app is open (or recently backgrounded) and shown via the service worker.
import { getState } from './store.js';
import { todayKey, addDays, dateAt, fmtTime } from './dates.js';
import { tasksOn, isTaskDone, activeHabits, isDueOn, habitDone } from './logic.js';

const FIRED_KEY = 'dailyTracker:fired';
let timers = [];

export const notifySupported = () => 'Notification' in window;
export const permission = () => (notifySupported() ? Notification.permission : 'unsupported');

export async function requestPermission() {
  if (!notifySupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

function loadFired() {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); } catch { return {}; }
}
function markFired(key) {
  const f = loadFired();
  f[key] = Date.now();
  const cutoff = Date.now() - 3 * 86400000;
  for (const k in f) if (f[k] < cutoff) delete f[k];
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

export async function showNotification(title, body, tag) {
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return true; }
  } catch { /* fall through */ }
  try { new Notification(title, opts); return true; } catch { return false; }
}

export function reschedule() {
  timers.forEach(clearTimeout);
  timers = [];
  const st = getState();
  if (!st.settings.notifications || permission() !== 'granted') return;
  const now = Date.now();
  const horizon = now + 36 * 3600000;
  const fired = loadFired();
  const fmt = st.settings.timeFormat;
  const plan = (key, at, title, body, stillDue) => {
    if (fired[key] || at < now - 60000 || at > horizon) return;
    timers.push(setTimeout(() => {
      if (!stillDue() || loadFired()[key]) return;
      markFired(key);
      showNotification(title, body, key);
    }, Math.max(0, at - now)));
  };
  const today = todayKey();
  for (const k of [today, addDays(today, 1)]) {
    for (const t of tasksOn(st, k)) {
      if (!t.time || t.reminder === null || isTaskDone(t, k)) continue;
      const at = dateAt(k, t.time).getTime() - t.reminder * 60000;
      plan(`t:${t.id}:${k}`, at, t.title, t.reminder ? `Starts at ${fmtTime(t.time, fmt)}` : 'Starting now',
        () => { const x = getState().tasks.find((y) => y.id === t.id); return x && !isTaskDone(x, k); });
    }
    for (const hb of activeHabits(st)) {
      if (!hb.reminder || !isDueOn(st, hb, k) || habitDone(st, hb, k)) continue;
      plan(`h:${hb.id}:${k}`, dateAt(k, hb.reminder).getTime(), `${hb.emoji} ${hb.name}`, 'Time for your habit',
        () => { const s2 = getState(); const x = s2.habits.find((y) => y.id === hb.id); return x && !x.archived && !habitDone(s2, x, k); });
    }
  }
}
