// Tiny natural-language parser for quick add:
//   "Gym 6pm", "Call mom tomorrow 14:30", "Standup at 9 for 15m",
//   "Dentist friday 3:30pm for 1h !! #health", "Pay rent in 3 days"
import { addDays, dow, pad, todayKey } from './dates.js';

const WEEKDAYS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

/** Interpret an hour typed without am/pm: small numbers are most likely afternoon. */
function guessHour(h) {
  return h >= 1 && h <= 6 ? h + 12 : h;
}

export function parseQuick(input, today = todayKey()) {
  const out = { title: '', date: null, time: null, duration: null, priority: 0, tag: null };
  let s = ` ${String(input || '').replace(/\s+/g, ' ')} `;
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    if (fn(m) === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };
  const B = '(?=\\s)'; // word boundary that respects unicode titles

  // Duration: "for 30m", "for 1h", "for 1.5 hours", "for 1h30m", "for 90 min"
  take(new RegExp(`\\sfor\\s+(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hour|hours)(?:\\s*(\\d+)\\s*(?:m|min|mins|minutes?))?${B}`, 'i'), (m) => {
    out.duration = Math.round(parseFloat(m[1]) * 60) + (m[3] ? parseInt(m[3], 10) : 0);
  });
  if (!out.duration) {
    take(new RegExp(`\\sfor\\s+(\\d+)\\s*(m|min|mins|minute|minutes)${B}`, 'i'), (m) => {
      out.duration = parseInt(m[1], 10);
    });
  }
  if (out.duration !== null && (out.duration <= 0 || out.duration > 1440)) out.duration = null;

  // Times
  const setTime = (h, m) => {
    if (h < 0 || h > 23 || m < 0 || m > 59) return false;
    out.time = `${pad(h)}:${pad(m)}`;
  };
  take(new RegExp(`\\s(?:at\\s+|@\\s*)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)${B}`, 'i'), (m) => {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h < 1 || h > 12) return false;
    const pm = m[3].toLowerCase().startsWith('p');
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return setTime(h, min);
  }) ||
  take(new RegExp(`\\s(?:at\\s+|@\\s*)?(\\d{1,2}):(\\d{2})${B}`, 'i'), (m) => {
    let h = parseInt(m[1], 10);
    if (m[1].length === 1) h = guessHour(h); // "2:30" -> 14:30, "14:30"/"09:30" kept
    return setTime(h, parseInt(m[2], 10));
  }) ||
  take(new RegExp(`\\s(?:at\\s+|@\\s*)(noon|midday|midnight)${B}|\\s(noon|midday|midnight)${B}`, 'i'), (m) => {
    const w = (m[1] || m[2]).toLowerCase();
    return setTime(w === 'midnight' ? 0 : 12, 0);
  }) ||
  take(new RegExp(`\\s(?:at|@)\\s*(\\d{1,2})${B}`, 'i'), (m) => {
    const h = parseInt(m[1], 10);
    if (h > 23) return false;
    return setTime(m[1].length === 1 ? guessHour(h) : h, 0);
  });

  // Dates
  take(new RegExp(`\\s(today|tonight)${B}`, 'i'), (m) => {
    out.date = today;
    if (m[1].toLowerCase() === 'tonight' && !out.time) out.time = '20:00';
  }) ||
  take(new RegExp(`\\s(tomorrow|tmrw|tmr)${B}`, 'i'), () => { out.date = addDays(today, 1); }) ||
  take(new RegExp(`\\s(day after tomorrow)${B}`, 'i'), () => { out.date = addDays(today, 2); }) ||
  take(new RegExp(`\\sin\\s+(\\d{1,3})\\s+(days?|weeks?)${B}`, 'i'), (m) => {
    const n = parseInt(m[1], 10) * (m[2].toLowerCase().startsWith('w') ? 7 : 1);
    out.date = addDays(today, n);
  }) ||
  take(new RegExp(`\\snext\\s+week${B}`, 'i'), () => { out.date = addDays(today, 7); }) ||
  take(new RegExp(`\\s(?:on\\s+)?(next\\s+)?(${Object.keys(WEEKDAYS).join('|')})${B}`, 'i'), (m) => {
    const target = WEEKDAYS[m[2].toLowerCase()];
    let diff = (target - dow(today) + 7) % 7;
    if (m[1] && diff === 0) diff = 7;
    out.date = addDays(today, diff);
  });

  // Priority "!", "!!", "!!!" and tag "#work"
  take(/\s(!{1,3})(?=\s)/, (m) => { out.priority = m[1].length; });
  take(/\s#([\p{L}\p{N}_-]{1,30})(?=\s)/u, (m) => { out.tag = m[1]; });

  let title = s.replace(/\s+/g, ' ').trim();
  // Drop dangling connector words left behind ("Meeting at" -> "Meeting")
  title = title.replace(/\s+(at|on|for|by|@|-)$/i, '').replace(/^(at|on)\s+/i, '').trim();
  out.title = title || String(input || '').trim();
  return out;
}
