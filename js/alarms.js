// Alarm engine. Web apps can't run while closed, so alarms ring only while the app
// is open (ideally in Bedside mode). A 1-second check against Date.now() makes the
// timing drift-safe; occurrences that passed while the app wasn't running are
// reported as missed instead of ringing late (unless within a short grace window).
import { getState, update } from './store.js';
import { addDays, dateAt, dow, toKey, fmtTime } from './dates.js';

const RT_KEY = 'dailyTracker:alarmRuntime';
export const GRACE_MS = 2 * 60 * 1000;

let ringHandler = () => {};
let changeHandler = () => {};
let tickTimer = null;
let preciseTimer = null;
let ringing = null; // { alarm, occ, snoozed }
const queue = [];

function loadRt() {
  let rt = null;
  try { rt = JSON.parse(localStorage.getItem(RT_KEY) || 'null'); } catch { /* ignore */ }
  if (!rt || typeof rt !== 'object') rt = {};
  return {
    lastSeen: Number.isFinite(rt.lastSeen) ? rt.lastSeen : Date.now(),
    snoozes: rt.snoozes && typeof rt.snoozes === 'object' ? rt.snoozes : {},
    missed: Array.isArray(rt.missed) ? rt.missed.slice(-10) : [],
  };
}
function saveRt(rt) {
  try { localStorage.setItem(RT_KEY, JSON.stringify(rt)); } catch { /* ignore */ }
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
export function clearMissed() { const rt = loadRt(); rt.missed = []; saveRt(rt); changeHandler(); }

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

function disableOnce(alarm) {
  if (alarm.days.length) return;
  update((s) => { const x = s.alarms.find((y) => y.id === alarm.id); if (x) x.enabled = false; });
}

async function notify(alarm) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    const title = `⏰ ${alarm.label || 'Alarm'}`;
    const opts = {
      body: `${fmtTime(alarm.time, getState().settings.timeFormat)} – open Daily Tracker to stop it`,
      tag: 'alarm-' + alarm.id, renotify: true, requireInteraction: true,
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [500, 200, 500],
    };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* best effort */ }
}

function startRinging(item) {
  if (ringing) { queue.push(item); return; }
  ringing = item;
  notify(item.alarm);
  ringHandler(item);
}

/** Main check: runs every second and right at the next due time. */
export function tick() {
  const now = Date.now();
  const st = getState();
  const rt = loadRt();
  const due = [];
  let changed = false;
  for (const a of st.alarms) {
    if (a.enabled) {
      const occ = prevOccurrence(a, now);
      if (occ && occ > rt.lastSeen && occ >= a.armedAt) {
        if (now - occ <= GRACE_MS) due.push({ alarm: a, occ, snoozed: false });
        else { rt.missed.push({ id: a.id, at: occ, time: a.time, label: a.label }); changed = true; }
        disableOnce(a);
      }
    }
    const sn = rt.snoozes[a.id];
    if (sn && !sn.ringing && sn.until <= now && sn.until > rt.lastSeen - 1000) {
      if (now - sn.until <= GRACE_MS) { sn.ringing = true; due.push({ alarm: a, occ: sn.until, snoozed: true }); }
      else { delete rt.snoozes[a.id]; rt.missed.push({ id: a.id, at: sn.until, time: a.time, label: a.label }); changed = true; }
    }
  }
  rt.lastSeen = now;
  rt.missed = rt.missed.slice(-10);
  saveRt(rt);
  due.forEach(startRinging);
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

export function getRinging() { return ringing; }

function finishRinging() {
  ringing = null;
  const next = queue.shift();
  if (next) setTimeout(() => startRinging(next), 300);
}

export function canSnooze(alarm) {
  if (alarm.dismiss === 'scan' && !alarm.scanSnooze) return false;
  const sn = loadRt().snoozes[alarm.id];
  return (sn?.count || 0) < alarm.maxSnoozes;
}

export function snoozeRinging() {
  if (!ringing) return null;
  const { alarm } = ringing;
  const rt = loadRt();
  const count = (rt.snoozes[alarm.id]?.count || 0) + 1;
  const until = Date.now() + alarm.snoozeMin * 60000;
  rt.snoozes[alarm.id] = { until, count, ringing: false };
  saveRt(rt);
  finishRinging();
  changeHandler();
  schedulePrecise();
  return until;
}

export function dismissRinging() {
  if (!ringing) return;
  const rt = loadRt();
  delete rt.snoozes[ringing.alarm.id];
  saveRt(rt);
  finishRinging();
  changeHandler();
}

/** Forget runtime state for an alarm (deleted or edited). */
export function resetAlarmRuntime(id) {
  const rt = loadRt();
  delete rt.snoozes[id];
  saveRt(rt);
}

export function startAlarmEngine({ onRing, onChange }) {
  ringHandler = onRing;
  changeHandler = onChange;
  tick();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
}
