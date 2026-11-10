// Tiny natural-language parser for quick add:
//   "Gym 6pm", "Call mom tomorrow 14:30", "Standup at 9 for 15m",
//   "Dentist friday 3:30pm for 1h !! #health", "Pay rent in 3 days"
import { addDays, dow, pad, todayKey } from './dates.js';

const FULL_DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const SHORT_DAYS = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const CONNECTOR = /\s(at|on|by|for|@)\s*$/i;

/** Bare "at N" without am/pm: 1–5 are almost always afternoon ("at 3" → 15:00). */
function guessBareHour(h) {
  return h >= 1 && h <= 5 ? h + 12 : h;
}

export function parseQuick(input, today = todayKey()) {
  const out = { title: '', date: null, time: null, duration: null, priority: 0, tag: null };
  let s = ` ${String(input || '').replace(/\s+/g, ' ')} `;

  const removeAt = (index, length) => {
    let before = s.slice(0, index);
    // Drop a connector word that directly precedes the removed token ("Call by 5pm" → "Call").
    const c = before.match(CONNECTOR);
    if (c) before = before.slice(0, c.index);
    s = before + ' ' + s.slice(index + length);
  };
  /** Find the first match of a global regex accepted by fn (fn returns false to skip), and remove it. */
  const take = (re, fn) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of s.matchAll(g)) {
      if (fn(m) === false) continue;
      removeAt(m.index, m[0].length);
      return true;
    }
    return false;
  };
  const B = '(?=[\\s,.;!?])'; // token boundary (s always ends with a space)

  // Duration: "for 30m", "for 1h", "for 1.5 hours", "for 1h30m", "for 90 min"
  take(new RegExp(`\\sfor\\s+(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hour|hours)(?:\\s*(\\d+)\\s*(?:m|min|mins|minutes?))?${B}`, 'i'), (m) => {
    out.duration = Math.round(parseFloat(m[1]) * 60) + (m[3] ? parseInt(m[3], 10) : 0);
  }) ||
  take(new RegExp(`\\sfor\\s+(\\d+)\\s*(m|min|mins|minute|minutes)${B}`, 'i'), (m) => {
    out.duration = parseInt(m[1], 10);
  });
  if (out.duration !== null && (out.duration <= 0 || out.duration > 1440)) out.duration = null;

  // Times
  const setTime = (h, m) => {
    if (h < 0 || h > 23 || m < 0 || m > 59) return false;
    out.time = `${pad(h)}:${pad(m)}`;
  };
  take(new RegExp(`\\s(?:at\\s+|@\\s*)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?|a|p)${B}`, 'i'), (m) => {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h < 1 || h > 12) return false;
    const pm = m[3].toLowerCase().startsWith('p');
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return setTime(h, min);
  }) ||
  take(new RegExp(`\\s(at\\s+|@\\s*)?(\\d{1,2})([:.])(\\d{2})${B}`, 'i'), (m) => {
    const h = parseInt(m[2], 10);
    // "18.30" is accepted only when it can't be a price ("at 9.30" or an hour ≥ 13).
    if (m[3] === '.' && !m[1] && h < 13) return false;
    return setTime(h, parseInt(m[4], 10)); // explicit clock times are taken literally
  }) ||
  take(new RegExp(`\\s(?:at\\s+|@\\s*)?(noon|midday|midnight)${B}`, 'i'), (m) => setTime(m[1].toLowerCase() === 'midnight' ? 0 : 12, 0)) ||
  take(new RegExp(`\\s(?:at|@)\\s*(\\d{1,2})${B}`, 'i'), (m) => {
    const h = parseInt(m[1], 10);
    if (h > 23) return false;
    return setTime(guessBareHour(h), 0);
  });

  // Dates ("day after tomorrow" must be checked before "tomorrow")
  take(new RegExp(`\\s(?:the\\s+)?day\\s+after\\s+tomorrow${B}`, 'i'), () => { out.date = addDays(today, 2); }) ||
  take(new RegExp(`\\s(today|tonight)${B}`, 'i'), (m) => {
    out.date = today;
    if (m[1].toLowerCase() === 'tonight' && !out.time) out.time = '20:00';
  }) ||
  take(new RegExp(`\\s(tomorrow|tmrw|tmr)${B}`, 'i'), () => { out.date = addDays(today, 1); }) ||
  take(new RegExp(`\\sin\\s+(\\d{1,3})\\s+(days?|weeks?)${B}`, 'i'), (m) => {
    out.date = addDays(today, parseInt(m[1], 10) * (m[2].toLowerCase().startsWith('w') ? 7 : 1));
  }) ||
  take(new RegExp(`\\snext\\s+week${B}`, 'i'), () => { out.date = addDays(today, 7); }) ||
  take(new RegExp(`\\s(on\\s+|next\\s+)?(${[...Object.keys(FULL_DAYS), ...Object.keys(SHORT_DAYS)].join('|')})${B}`, 'i'), (m) => {
    const word = m[2].toLowerCase();
    const prefix = (m[1] || '').trim().toLowerCase();
    const atEnd = s.slice(m.index + m[0].length).replace(/[\s,.;!?]/g, '') === '';
    const atStart = s.slice(0, m.index).trim() === '';
    const isFull = word in FULL_DAYS;
    if (!prefix) {
      // Short forms ("sat nav", "Sun cream") only count as dates at the end of the text.
      if (!isFull && !atEnd) return false;
      // A leading full weekday reads as part of the title ("Monday meeting").
      if (isFull && atStart && !atEnd) return false;
    }
    const target = isFull ? FULL_DAYS[word] : SHORT_DAYS[word];
    let diff = (target - dow(today) + 7) % 7;
    if (prefix === 'next' && diff === 0) diff = 7;
    out.date = addDays(today, diff);
  });

  // Priority "!", "!!", "!!!" and tag "#work" (tags must start with a letter)
  take(/\s(!{1,3})(?=\s)/, (m) => { out.priority = m[1].length; });
  take(/\s#(\p{L}[\p{L}\p{N}_-]{0,29})(?=[\s,.;!?])/u, (m) => { out.tag = m[1]; });

  const title = s.replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').trim().replace(/^[,.;\s]+|[,;\s]+$/g, '');
  out.title = title || String(input || '').trim();
  return out;
}
