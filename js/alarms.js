// Alarm engine. Web apps can't run while closed, so alarms ring only while the app
// is open (ideally in Bedside mode). A 1-second check against Date.now() makes the
// timing drift-safe; occurrences that passed while the app wasn't running are
// reported as missed instead of ringing late (unless within a short grace window).
//
// Persistent runtime (localStorage, shared by all tabs):
//   lastSeen  – last moment any tab was alive (used only to find missed alarms on startup)
//   snoozes   – { [alarmId]: { until, count } }
//   missed    – [{ id, at, time, label, shownAt }]
//   active    – the alarm currently ringing { id, occ, snoozed, startedAt, alarm } or null.
//               It survives reloads/reopen and is cleared only by Stop (scan/emergency for
//               scan alarms) or Snooze. Every open tab shows it; stopping in one stops all.
import { getState, update } from './store.js';
import { addDays, dateAt, dow, toKey, fmtTime } from './dates.js';

const RT_KEY = 'dailyTracker:alarmRuntime';
export const GRACE_MS = 2 * 60 * 1000;
export const RESUME_NORMAL_MS = 60 * 60 * 1000; // a normal alarm still rings after a reload for up to 60 min

let ringHandler = () => {};
let endHandler = () => {};
let changeHandler = () => {};
let tickTimer = null;
let preciseTimer = null;
let tabLastSeen = null; // per tab, so two open tabs both notice an alarm
let showing = null; // { id, occ } shown in this tab
let channel = null;

function loadRt() {
  let rt = null;
  try { rt = JSON.parse(localStorage.getItem(RT_KEY) || 'null'); } catch { /* ignore */ }
  if (!rt || typeof rt !== 'object') rt = {};
  const snoozes = {};
  if (rt.snoozes && typeof rt.snoozes === 'object') {
    for (const [id, s] of Object.entries(rt.snoozes)) {
      if (s && Number.isFinite(s.until)) snoozes[id] = { until: s.until, count: Number.isInteger(s.count) ? s.count : 1 };
    }
  }
  const a = rt.active;
  return {
    lastSeen: Number.isFinite(rt.lastSeen) ? rt.lastSeen : Date.now(),
    snoozes,
    missed: Array.isArray(rt.missed) ? rt.missed.slice(-10) : [],
    active: a && a.alarm && Number.isFinite(a.occ) ? a : null,
    queue: Array.isArray(rt.queue) ? rt.queue.slice(-5) : [],
  };
}
function saveRt(rt) {
  try { localStorage.setItem(RT_KEY, JSON.stringify(rt)); } catch { /* ignore */ }
}
function broadcast() {
  try { channel?.postMessage({ type: 'sync' }); } catch { /* ignore */ }
}

/** First occurrence strictly after `afterMs` (handles midnight + DST via local dates). */
export function nextOccurrence(alarm, afterMs = Date.now()) {
  const k = toKey(new Date(afterMs));
  for (let i = 0; i <= 8; i++) {
    const d = addDays(k, i);
    if (alarm.days.length && !alarm.days.includes(dow(d))) continue;
    const t = dateAt(d, alarm.time).getTime();
    if (t > afterMs) return t;
  }
  return null;
}

/** Latest occurrence at or before `atMs`. */
export function prevOccurrence(alarm, atMs = Date.now()) {
  const k = toKey(new Date(atMs));
  for (let i = 0; i <= 8; i++) {
    const d = addDays(k, -i);
    if (alarm.days.length && !alarm.days.includes(dow(d))) continue;
    const t = dateAt(d, alarm.time).getTime();
    if (t <= atMs) return t;
  }
  return null;
}

export function snoozeInfo(id) {
  return loadRt().snoozes[id] || null;
}

/** The next thing that will ring: { alarm, at, snoozed }. */
export function nextAlarm(now = Date.now()) {
  const st = getState();
  const rt = loadRt();
  let best = null;
  for (const a of st.alarms) {
    const sn = rt.snoozes[a.id];
    if (sn && sn.until > now && (!best || sn.until < best.at)) best = { alarm: a, at: sn.until, snoozed: true };
    if (!a.enabled) continue;
    const at = nextOccurrence(a, now);
    if (at && (!best || at < best.at)) best = { alarm: a, at, snoozed: false };
  }
  return best;
}

export function missedAlarms() { return loadRt().missed; }
export function clearMissed(entry = null) {
  const rt = loadRt();
  rt.missed = entry === null ? [] : rt.missed.filter((m) => !(m.at === entry.at && m.id === entry.id));
  saveRt(rt); broadcast(); changeHandler();
}
/** Missed entries not yet announced with a toast; marks them as shown. */
export function takeUnannouncedMissed() {
  const rt = loadRt();
  const fresh = rt.missed.filter((m) => !m.shownAt);
  if (!fresh.length) return [];
  rt.missed.forEach((m) => { if (!m.shownAt) m.shownAt = Date.now(); });
  saveRt(rt);
  return fresh;
}

export function repeatLabel(alarm, dayNames) {
  const d = alarm.days;
  if (!d.length) return 'Once';
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  if (d.join() === '0,6') return 'Weekends';
  return d.map((i) => dayNames[i]).join(' ');
}

export function untilLabel(at, now = Date.now()) {
  const mins = Math.max(0, Math.round((at - now) / 60000));
  if (mins < 1) return 'in less than a minute';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 24) { const days = Math.floor(h / 24); return `in ${days} day${days === 1 ? '' : 's'}`; }
  return `in ${h ? h + 'h ' : ''}${m}m`;
}

function disableOnce(id) {
  const a = getState().alarms.find((x) => x.id === id);
  if (!a || a.days.length || !a.enabled) return;
  update((s) => { const x = s.alarms.find((y) => y.id === id); if (x) x.enabled = false; });
}

function addMissed(rt, alarm, at) {
  if (rt.missed.some((m) => m.id === alarm.id && m.at === at)) return false;
  rt.missed.push({ id: alarm.id, at, time: alarm.time, label: alarm.label || '' });
  rt.missed = rt.missed.slice(-10);
  return true;
}

async function notify(alarm, resumed = false) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    const title = `⏰ ${alarm.label || 'Alarm'}`;
    const opts = {
      body: `${fmtTime(alarm.time, getState().settings.timeFormat)} – ${resumed ? 'still ringing, open' : 'open'} Daily Tracker to stop it`,
      tag: 'alarm-' + alarm.id, renotify: true, requireInteraction: true,
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [500, 200, 500],
    };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* best effort */ }
}

/** A frozen copy of the alarm (plus the code values that stop it) so ringing can resume even if it's edited or deleted. */
function snapshot(alarm) {
  const codes = getState().codes.filter((c) => !alarm.codeIds.length || alarm.codeIds.includes(c.id));
  return { ...JSON.parse(JSON.stringify(alarm)), codeValues: codes.map((c) => c.value), codeNames: codes.map((c) => c.nickname) };
}

/** Make the UI in this tab match rt.active. */
function syncUi(rt = loadRt(), { resumed = false } = {}) {
  const a = rt.active;
  if (a && (!showing || showing.id !== a.id || showing.occ !== a.occ)) {
    if (showing) endHandler();
    showing = { id: a.id, occ: a.occ };
    ringHandler({ alarm: a.alarm, occ: a.occ, snoozed: a.snoozed, resumed });
  } else if (!a && showing) {
    showing = null;
    endHandler(); // stopped or snoozed in another tab
    changeHandler();
  }
}

function start(rt, item, now) {
  if (rt.active) {
    if (rt.active.id === item.alarm.id && rt.active.occ === item.occ) return; // already started by another tab
    // Another alarm is ringing: this one waits until that one is handled.
    if (!rt.queue.some((q) => q.id === item.alarm.id && q.occ === item.occ)) {
      rt.queue = [...rt.queue, { id: item.alarm.id, occ: item.occ, snoozed: item.snoozed }].slice(-5);
    }
    return;
  }
  if (!item.snoozed) delete rt.snoozes[item.alarm.id]; // a fresh occurrence starts with a fresh snooze count
  rt.active = { id: item.alarm.id, occ: item.occ, snoozed: item.snoozed, startedAt: now, alarm: snapshot(item.alarm) };
  notify(item.alarm);
}

/** Main check: runs every second and right at the next due time. */
export function tick() {
  const now = Date.now();
  if (tabLastSeen === null) tabLastSeen = now;
  const st = getState();
  const rt = loadRt();
  let changed = false;
  const due = [];
  for (const a of st.alarms) {
    if (a.enabled) {
      const occ = prevOccurrence(a, now);
      if (occ && occ > tabLastSeen && occ >= a.armedAt) {
        if (now - occ <= GRACE_MS) due.push({ alarm: a, occ, snoozed: false });
        else { changed = addMissed(rt, a, occ) || changed; disableOnce(a.id); }
      }
    }
    const sn = rt.snoozes[a.id];
    if (sn && sn.until <= now && sn.until > tabLastSeen) {
      if (now - sn.until <= GRACE_MS) due.push({ alarm: a, occ: sn.until, snoozed: true });
      else { delete rt.snoozes[a.id]; changed = addMissed(rt, a, sn.until) || changed; }
    }
  }
  // Drop snoozes of deleted alarms and stale ones nobody will ring.
  for (const id of Object.keys(rt.snoozes)) {
    const sn = rt.snoozes[id];
    const exists = st.alarms.some((a) => a.id === id);
    const isActive = rt.active?.id === id;
    if (!isActive && (!exists || sn.until < now - GRACE_MS)) { delete rt.snoozes[id]; changed = true; }
  }
  // Start the next queued alarm once nothing is ringing.
  if (!rt.active && rt.queue.length) {
    const q = rt.queue.shift();
    const a = st.alarms.find((x) => x.id === q.id);
    if (a) due.unshift({ alarm: a, occ: q.occ, snoozed: q.snoozed });
  }
  tabLastSeen = now;
  rt.lastSeen = Math.max(rt.lastSeen, now);
  due.forEach((item) => start(rt, item, now));
  saveRt(rt);
  if (due.length) broadcast();
  syncUi(rt);
  if (changed) changeHandler();
  schedulePrecise();
}

function schedulePrecise() {
  clearTimeout(preciseTimer);
  const n = nextAlarm();
  if (!n) return;
  const ms = n.at - Date.now();
  if (ms > 0 && ms < 2 ** 31 - 1) preciseTimer = setTimeout(tick, ms + 20);
}

export function getRinging() { return loadRt().active; }

export function canSnooze(alarm) {
  if (alarm.dismiss === 'scan' && !alarm.scanSnooze) return false;
  const sn = loadRt().snoozes[alarm.id];
  return (sn?.count || 0) < alarm.maxSnoozes;
}

function finish(rt) {
  showing = null;
  rt.active = null;
  saveRt(rt);
  broadcast();
  changeHandler();
  // Let a queued alarm (if any) start right away.
  setTimeout(tick, 300);
}

export function snoozeRinging() {
  const rt = loadRt();
  if (!rt.active) return null;
  const { id, alarm } = rt.active;
  const count = (rt.snoozes[id]?.count || 0) + 1;
  const until = Date.now() + (alarm.snoozeMin || 10) * 60000;
  rt.snoozes[id] = { until, count };
  finish(rt);
  schedulePrecise();
  return until;
}

/** Stop the ringing alarm (for scan alarms: only after a matching scan or the emergency challenge). */
export function dismissRinging() {
  const rt = loadRt();
  if (!rt.active) return;
  const { id } = rt.active;
  delete rt.snoozes[id];
  finish(rt);
  disableOnce(id); // one-time alarms switch off once they've been stopped
}

/** Forget snooze state for an alarm (deleted or edited). Never touches a ringing alarm. */
export function resetAlarmRuntime(id) {
  const rt = loadRt();
  if (rt.active?.id === id) return;
  delete rt.snoozes[id];
  saveRt(rt);
}

/** Resume an alarm that was ringing when the page was closed or reloaded. */
function resumeActive() {
  const rt = loadRt();
  const a = rt.active;
  if (!a) return;
  const now = Date.now();
  if (a.alarm.dismiss === 'scan' || now - a.occ <= RESUME_NORMAL_MS) {
    syncUi(rt, { resumed: true });
    notify(a.alarm, true);
    return;
  }
  // A normal alarm left ringing for over an hour: report it as missed instead of ringing again.
  addMissed(rt, a.alarm, a.occ);
  rt.active = null;
  delete rt.snoozes[a.id];
  saveRt(rt);
  disableOnce(a.id);
}

export function startAlarmEngine({ onRing, onEnd, onChange }) {
  ringHandler = onRing;
  endHandler = onEnd;
  changeHandler = onChange;
  tabLastSeen = loadRt().lastSeen; // catch anything that passed while no tab was open
  resumeActive();
  tick();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  // Keep every open tab in step (ring start/stop) – BroadcastChannel plus storage events as a fallback.
  try {
    channel = new BroadcastChannel('daily-tracker-alarms');
    channel.onmessage = () => syncUi();
  } catch { channel = null; }
  window.addEventListener('storage', (e) => { if (e.key === RT_KEY) syncUi(); });
}
