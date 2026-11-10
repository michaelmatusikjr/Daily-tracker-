// Alarm tones synthesised with the Web Audio API (no audio files), plus vibration.
let ctx = null;
let loop = null; // { timer, master, rampTimer }
let vibTimer = null;

export const TONES = [
  { id: 'classic', name: 'Classic', desc: 'Two-tone beeps' },
  { id: 'digital', name: 'Digital', desc: 'Fast bright beeps' },
  { id: 'chime', name: 'Chime', desc: 'Gentle bells' },
  { id: 'sunrise', name: 'Sunrise', desc: 'Soft rising swells' },
];
const CYCLE = { classic: 1.2, digital: 1.0, chime: 2.4, sunrise: 3.2 }; // seconds per pattern

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Call from a user gesture (arming, Bedside mode, preview) so later playback is allowed. */
export function unlockAudio() {
  try {
    // iOS 17+: play through the silent switch like a media app.
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { /* ignore */ }
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try {
    const b = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = b; src.connect(c.destination); src.start(0);
  } catch { /* ignore */ }
  return true;
}

export const audioReady = () => !!ctx && ctx.state === 'running';

function note(c, out, t, freq, dur, { type = 'sine', vol = 0.5, attack = 0.01, harmonics = null } = {}) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  const partials = harmonics || [[1, 1]];
  for (const [mult, amp] of partials) {
    const o = c.createOscillator();
    const pg = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq * mult, t);
    pg.gain.value = amp;
    o.connect(pg); pg.connect(g);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

function schedulePattern(c, out, tone, t) {
  switch (tone) {
    case 'digital':
      for (let i = 0; i < 4; i++) note(c, out, t + i * 0.12, 1320, 0.08, { type: 'square', vol: 0.25 });
      break;
    case 'chime': {
      const bell = [[1, 1], [2.01, 0.4], [3.02, 0.2]];
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(c, out, t + i * 0.3, f, 1.4, { vol: 0.45, harmonics: bell }));
      break;
    }
    case 'sunrise':
      [392, 493.88, 587.33].forEach((f, i) => note(c, out, t + i * 0.5, f, 2.2, { vol: 0.4, attack: 0.6, type: 'triangle' }));
      break;
    default: // classic
      note(c, out, t, 880, 0.18, { type: 'square', vol: 0.3 });
      note(c, out, t + 0.25, 660, 0.18, { type: 'square', vol: 0.3 });
      note(c, out, t + 0.5, 880, 0.18, { type: 'square', vol: 0.3 });
      note(c, out, t + 0.75, 660, 0.18, { type: 'square', vol: 0.3 });
  }
}

/** Loop a tone until stopTone(). gradual: start quiet and reach full volume over ~45 s. */
export function playTone(tone = 'classic', { gradual = false } = {}) {
  stopTone();
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const master = c.createGain();
  const now = c.currentTime;
  master.gain.setValueAtTime(gradual ? 0.08 : 1, now);
  if (gradual) master.gain.linearRampToValueAtTime(1, now + 45);
  master.connect(c.destination);
  const cycle = CYCLE[tone] || 1.2;
  let next = now + 0.05;
  const pump = () => {
    // Schedule a little ahead so timer jitter never causes gaps.
    while (next < c.currentTime + 1.5) { schedulePattern(c, master, tone, next); next += cycle; }
  };
  pump();
  loop = { timer: setInterval(pump, 250), master };
  return true;
}

export function stopTone() {
  if (!loop) return;
  clearInterval(loop.timer);
  try {
    const t = ctx.currentTime;
    loop.master.gain.cancelScheduledValues(t);
    loop.master.gain.setValueAtTime(loop.master.gain.value, t);
    loop.master.gain.linearRampToValueAtTime(0, t + 0.05);
    const m = loop.master;
    setTimeout(() => { try { m.disconnect(); } catch { /* ignore */ } }, 120);
  } catch { /* ignore */ }
  loop = null;
}

export const isPlaying = () => !!loop;

let previewTimer = null;
/** Play roughly one pattern for the alarm form. */
export function previewTone(tone) {
  unlockAudio();
  clearTimeout(previewTimer);
  playTone(tone);
  previewTimer = setTimeout(stopTone, (CYCLE[tone] || 1.2) * 1000 + 600);
}

export function startVibration() {
  stopVibration();
  if (!navigator.vibrate) return false;
  // Browsers ignore (and log) vibrate() before the user has interacted with the page.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  const buzz = () => { try { navigator.vibrate([700, 300, 700]); } catch { /* ignore */ } };
  buzz();
  vibTimer = setInterval(buzz, 2000);
  return true;
}

export function stopVibration() {
  clearInterval(vibTimer);
  vibTimer = null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(0); } catch { /* ignore */ }
}
