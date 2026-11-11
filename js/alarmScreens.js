// Full-screen alarm UI: ringing screen (normal / scan-to-stop / emergency math)
// and Bedside mode (dim clock that keeps the screen awake).
import { h, toast, haptic } from './ui.js';
import { icon } from './icons.js';
import { getState } from './store.js';
import { fmtTime, fmtDateLong, todayKey, pad } from './dates.js';
import { playTone, stopTone, startVibration, stopVibration, unlockAudio, audioReady } from './audio.js';
import { canSnooze, snoozeRinging, dismissRinging, snoozeInfo, nextAlarm, untilLabel } from './alarms.js';
import { openScanner } from './scanner.js';

// ---------- Screen Wake Lock (ref-counted, re-acquired when visible again) ----------
const wakeReasons = new Set();
let sentinel = null;
let wakeFailed = false;
const wakeListeners = new Set();
export const wakeLockSupported = () => 'wakeLock' in navigator;
export const wakeLockActive = () => !!sentinel;
export const wakeLockFailed = () => wakeFailed;

/** Request the screen wake lock. Call from a tap to retry after a refusal. */
export async function acquireWakeLock() {
  if (!wakeLockSupported() || sentinel || !wakeReasons.size || document.visibilityState !== 'visible') return !!sentinel;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    wakeFailed = false;
    sentinel.addEventListener('release', () => { sentinel = null; wakeListeners.forEach((l) => l()); });
  } catch {
    sentinel = null;
    wakeFailed = true;
  }
  wakeListeners.forEach((l) => l());
  return !!sentinel;
}
function holdWake(reason) { wakeReasons.add(reason); acquireWakeLock(); }
function releaseWake(reason) {
  wakeReasons.delete(reason);
  if (!wakeReasons.size && sentinel) { sentinel.release().catch(() => {}); sentinel = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquireWakeLock(); });

const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const msTime = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ---------- Making everything behind an overlay unusable ----------
const OVERLAYS = '.ring-screen, .scanner';
function setBackgroundInert(on) {
  for (const el of document.body.children) {
    if (el.matches(OVERLAYS) || el.tagName === 'SCRIPT') continue;
    if (on) { if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); el.dataset.ringInert = '1'; } }
    else if (el.dataset.ringInert) { el.removeAttribute('inert'); delete el.dataset.ringInert; }
  }
}

// ---------- Ringing ----------
let current = null; // { root, finish }

/** Close the ring screen without changing alarm state (it was stopped/snoozed elsewhere). */
export function hideRingScreen() {
  current?.finish(null);
}

export function showRingScreen(item) {
  if (current) current.finish(null);
  const { alarm } = item; // a snapshot taken when the alarm started ringing
  const fmt = getState().settings.timeFormat;
  holdWake('ring');
  playTone(alarm.tone, { gradual: alarm.gradual });
  if (alarm.vibrate) startVibration();

  const clock = h('p.ring-time', fmtTime(nowTime(), fmt));
  const clockTimer = setInterval(() => { clock.textContent = fmtTime(nowTime(), fmt); }, 1000);
  const soundHint = h('button.ring-sound-hint', {
    type: 'button', hidden: audioReady(),
    onclick: () => { unlockAudio(); playTone(alarm.tone, { gradual: false }); soundHint.hidden = true; },
  }, icon('alert', { size: 16 }), 'Tap to turn the sound on');
  // Browsers only allow sound after a tap (e.g. after a reload); the first tap anywhere starts it.
  const firstTap = () => {
    if (!audioReady()) { unlockAudio(); playTone(alarm.tone, { gradual: false }); }
    soundHint.hidden = true;
  };

  const actions = h('div.ring-actions');
  const setActions = (...nodes) => actions.replaceChildren(...nodes.flat().filter(Boolean));
  const titleId = 'ring-title';
  const root = h('div.ring-screen', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, onpointerdown: firstTap },
    h('div.ring-pulse', { 'aria-hidden': 'true' }, icon('alarm', { size: 44 })),
    clock,
    h('h2.alarm-ring-label', { id: titleId }, alarm.label || 'Alarm'),
    h('p.ring-sub', item.snoozed ? 'Snoozed alarm' : `Alarm for ${fmtTime(alarm.time, fmt)}`),
    soundHint,
    actions);
  document.body.append(root);
  document.body.classList.add('ringing');
  setBackgroundInert(true);
  requestAnimationFrame(() => root.classList.add('show'));

  // Keep keyboard focus inside the ring screen (the scanner, when open, sits above it).
  const onKey = (e) => {
    if (e.key !== 'Tab' || document.querySelector('.scanner.show')) return;
    const f = [...root.querySelectorAll('button, input')].filter((x) => !x.disabled && !x.hidden && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);

  let scanner = null;
  const finish = (msg) => {
    if (!current || current.root !== root) return;
    current = null;
    clearInterval(clockTimer);
    document.removeEventListener('keydown', onKey);
    stopTone(); stopVibration(); releaseWake('ring');
    scanner?.close();
    root.remove();
    document.body.classList.remove('ringing');
    setBackgroundInert(false);
    if (msg) toast(msg);
  };
  current = { root, finish };

  const stop = () => { finish('Alarm stopped'); dismissRinging(); };
  const snooze = () => {
    const until = snoozeRinging();
    finish(until ? `Snoozed until ${fmtTime(msTime(until), fmt)}` : null);
  };
  const snoozeBtn = () => {
    if (!canSnooze(alarm)) return null;
    const left = alarm.maxSnoozes - (snoozeInfo(alarm.id)?.count || 0);
    return h('button.btn.ring-btn.secondary', { type: 'button', onclick: snooze },
      `Snooze ${alarm.snoozeMin} min`, h('small', ` · ${left} left`));
  };

  const codeValues = alarm.codeValues || [];
  const codeNames = alarm.codeNames || [];
  const openScan = () => {
    if (scanner) return;
    scanner = openScanner({
      title: 'Scan your code to stop the alarm',
      hint: codeValues.length ? `Registered: ${codeNames.join(', ')}` : 'No registered code – use Emergency stop.',
      closable: true,
      onClose: () => { scanner = null; },
      onCode: ({ value }) => {
        if (codeValues.includes(value)) { setTimeout(stop, 0); return true; }
        return 'Not your code';
      },
    });
  };

  function renderNormal() {
    setActions(
      h('button.btn.ring-btn.primary', { type: 'button', onclick: stop, autofocus: true }, icon('check', { size: 22 }), 'Stop'),
      snoozeBtn());
  }

  function renderScan() {
    setActions(
      h('p.ring-scan-note', h('span.nowrap', icon('qr', { size: 18 }), 'Scan your registered code'), ' to stop'),
      h('button.btn.ring-btn.primary', { type: 'button', onclick: openScan, autofocus: true }, icon('camera', { size: 22 }), 'Scan code'),
      snoozeBtn(),
      emergencyButton(() => renderMath()));
  }

  function renderMath() {
    scanner?.close();
    let solved = 0;
    const NEED = 3;
    const q = h('p.math-q', { 'aria-live': 'polite' });
    const progress = h('p.math-progress');
    const inp = h('input.input.math-input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Answer', pattern: '[0-9]*' });
    let answer = 0;
    const newProblem = () => {
      const a = 12 + Math.floor(Math.random() * 18), b = 3 + Math.floor(Math.random() * 7), c = 10 + Math.floor(Math.random() * 90);
      answer = a * b + c;
      q.textContent = `${a} × ${b} + ${c} = ?`;
      progress.textContent = `Problem ${solved + 1} of ${NEED}`;
      inp.value = '';
      inp.focus();
    };
    const form = h('form.math-form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (Number(inp.value.trim()) === answer) {
          solved++;
          haptic(20);
          if (solved >= NEED) { stop(); return; }
        } else {
          form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
          haptic([60, 40, 60]);
        }
        newProblem();
      },
    }, progress, q, h('div.math-row', inp, h('button.btn.primary', { type: 'submit' }, 'Check')));
    setActions(
      h('p.ring-scan-note', 'Emergency stop: solve 3 problems'),
      form,
      h('button.btn.ghost.ring-back', { type: 'button', onclick: () => renderScan() }, 'Back to scanning'));
    newProblem();
  }

  if (alarm.dismiss === 'scan') { renderScan(); if (codeValues.length) openScan(); } else renderNormal();
  requestAnimationFrame(() => root.querySelector('[autofocus]')?.focus());
}

/** Press and hold for 3 s to reveal the math challenge. */
function emergencyButton(onDone) {
  let timer = null;
  const btn = h('button.btn.ghost.hold-btn', { type: 'button', 'aria-label': 'Emergency stop: press and hold for 3 seconds' },
    h('span.hold-fill', { 'aria-hidden': 'true' }), h('span.hold-text', 'Hold for Emergency stop'));
  const start = (e) => {
    if (e.type === 'keydown' && (e.repeat || (e.key !== 'Enter' && e.key !== ' '))) return;
    e.preventDefault();
    clearTimeout(timer);
    btn.classList.add('holding');
    timer = setTimeout(() => { btn.classList.remove('holding'); haptic(40); onDone(); }, 3000);
  };
  const cancel = () => { clearTimeout(timer); btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('keydown', start);
  ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur'].forEach((ev) => btn.addEventListener(ev, cancel));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return btn;
}

// ---------- Bedside mode ----------
let bedRoot = null;

export function openBedside() {
  if (bedRoot) return;
  unlockAudio(); // this tap is the gesture that allows the alarm sound later
  holdWake('bedside');
  const fmt = getState().settings.timeFormat;
  const time = h('p.bed-time');
  const date = h('p.bed-date');
  const next = h('p.bed-next');
  const wakeText = h('span');
  const retry = h('button.btn.small.ghost.bed-retry', { type: 'button', hidden: true, onclick: () => acquireWakeLock() }, icon('refresh', { size: 14 }), 'Try again');
  const wake = h('p.bed-wake', { role: 'status' }, wakeText, retry);
  bedRoot = h('div.bedside', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bedside mode' },
    h('div.bed-top',
      h('button.btn.ghost.bed-btn', { type: 'button', onclick: () => bedRoot.classList.toggle('dimmer'), 'aria-label': 'Toggle extra dim' }, icon('moon', { size: 18 }), 'Dim'),
      h('button.btn.ghost.bed-btn', { type: 'button', onclick: () => close() }, icon('x', { size: 18 }), 'Exit')),
    h('div.bed-center', time, date, next),
    h('div.bed-foot', wake, h('p.bed-note', 'Keep this screen open and the phone plugged in. Alarms can’t ring if the app is closed or the phone is locked.')));
  const renderWake = () => {
    let msg;
    if (!wakeLockSupported()) msg = 'This browser can’t keep the screen on – set your screen timeout to Never and keep the phone plugged in.';
    else if (wakeLockActive()) msg = 'Screen will stay on.';
    else if (wakeLockFailed()) msg = 'Couldn’t keep the screen on – set your screen timeout to Never and keep the phone plugged in.';
    else msg = 'Keeping the screen on…';
    if (wakeText.textContent !== msg) wakeText.textContent = msg;
    retry.hidden = !(wakeLockSupported() && !wakeLockActive() && wakeLockFailed());
  };
  const render = () => {
    const d = new Date();
    time.textContent = fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`, fmt);
    date.textContent = fmtDateLong(todayKey());
    const n = nextAlarm();
    if (n) {
      const a = n.alarm;
      next.replaceChildren(icon('alarm', { size: 18 }),
        `${n.snoozed ? 'Snoozed · ' : ''}${fmtTime(msTime(n.at), fmt)}${a.label ? ' · ' + a.label : ''} · ${untilLabel(n.at)}`);
    } else next.replaceChildren(icon('alarm', { size: 18 }), 'No alarm set');
    renderWake();
  };
  render();
  wakeListeners.add(renderWake);
  const timer = setInterval(render, 1000);
  const onKey = (e) => { if (e.key === 'Escape' && !document.body.classList.contains('ringing')) close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(bedRoot);
  document.body.classList.add('bedside-open');
  requestAnimationFrame(() => { bedRoot?.classList.add('show'); bedRoot?.querySelector('.bed-btn:last-child')?.focus(); });
  function close() {
    clearInterval(timer);
    wakeListeners.delete(renderWake);
    document.removeEventListener('keydown', onKey);
    releaseWake('bedside');
    bedRoot?.remove(); bedRoot = null;
    document.body.classList.remove('bedside-open');
  }
}

export const isBedsideOpen = () => !!bedRoot;
