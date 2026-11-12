// In-app reminders. Browsers can't reliably wake a closed web app on a timer
// without a push server, so reminders are scheduled with setTimeout while the
// app is open (or recently backgrounded) and shown via the service worker.
import { getProfiles, readProfileState } from './store.js';
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

/** Schedule reminders for EVERY profile (each with its own notifications setting). */
export function reschedule() {
  timers.forEach(clearTimeout);
  timers = [];
  if (permission() !== 'granted') return;
  const profiles = getProfiles();
  const multi = profiles.length > 1;
  const now = Date.now();
  const horizon = now + 36 * 3600000;
  const fired = loadFired();
  const today = todayKey();
  for (const profile of profiles) {
    const st = readProfileState(profile.id);
    if (!st || !st.settings.notifications) continue;
    const fmt = st.settings.timeFormat;
    const prefix = multi ? `${profile.name}: ` : '';
    // Re-read the profile's data when the timer fires, so completed items don't notify.
    const fresh = () => readProfileState(profile.id);
    const plan = (key, at, title, body, stillDue) => {
      key = `${profile.id}:${key}`;
      if (fired[key] || at < now - 60000 || at > horizon) return;
      timers.push(setTimeout(() => {
        const s2 = fresh();
        if (!s2 || !s2.settings.notifications || !stillDue(s2) || loadFired()[key]) return;
        markFired(key);
        showNotification(prefix + title, body, key);
      }, Math.max(0, at - now)));
    };
    for (const k of [today, addDays(today, 1)]) {
      for (const t of tasksOn(st, k)) {
        if (!t.time || t.reminder === null || isTaskDone(t, k)) continue;
        const at = dateAt(k, t.time).getTime() - t.reminder * 60000;
        plan(`t:${t.id}:${k}`, at, t.title, t.reminder ? `Starts at ${fmtTime(t.time, fmt)}` : 'Starting now',
          (s2) => { const x = s2.tasks.find((y) => y.id === t.id); return x && !isTaskDone(x, k); });
      }
      for (const hb of activeHabits(st)) {
        if (!hb.reminder || !isDueOn(st, hb, k) || habitDone(st, hb, k)) continue;
        plan(`h:${hb.id}:${k}`, dateAt(k, hb.reminder).getTime(), `${hb.emoji} ${hb.name}`, 'Time for your habit',
          (s2) => { const x = s2.habits.find((y) => y.id === hb.id); return x && !x.archived && !habitDone(s2, x, k); });
      }
    }
  }
}
