// Tiny natural-language parser for quick add:
//   "Gym 6pm", "Call mom tomorrow 14:30", "Standup at 9 for 15m",
//   "Dentist friday 3:30pm for 1h !! #health", "Pay rent in 3 days"
//
// parseQuick(text, today, { noDate, noTime, noDuration }) — the flags let the
// quick-add preview drop a guess, which leaves those words in the title.
import { addDays, dow, pad, todayKey } from './dates.js';

const FULL_DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const SHORT_DAYS = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const DAY_WORDS = [...Object.keys(FULL_DAYS), ...Object.keys(SHORT_DAYS)];
const DATE_WORDS = ['today', 'tonight', 'tomorrow', 'tmrw', 'tmr', ...DAY_WORDS];
const CONNECTOR = /\s(at|on|by|for|@)\s*$/i;
const EVENING_WORDS = /\b(dinner|supper|drinks|movie|movies|party|date night)\b/i;
const B = '(?=[\\s,.;:!?])'; // token boundary (the working string always ends with a space)

export function parseQuick(input, today = todayKey(), opts = {}) {
  const raw = String(input || '').replace(/\s+/g, ' ').trim();
  const out = { title: '', date: null, time: null, duration: null, priority: 0, tag: null, parts: {} };
  let s = ` ${raw} `;

  const restIsEmpty = (from) => s.slice(from).replace(/[\s,.;:!?]/g, '') === '';
  const removeAt = (index, length) => {
    let before = s.slice(0, index);
    const atEnd = restIsEmpty(index + length);
    // Drop a connector word ("by", "at", "on", "for") only when it clearly belongs to the
    // removed token: the token ended the text, or the connector starts the text.
    const c = before.match(CONNECTOR);
    if (c && (atEnd || before.slice(0, c.index).trim() === '')) before = before.slice(0, c.index);
    s = before + ' ' + s.slice(index + length);
  };
  /** Remove the first match accepted by fn (fn returns false to skip a match). Returns the match. */
  const take = (re, fn) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of s.matchAll(g)) {
      if (fn(m) === false) continue;
      removeAt(m.index, m[0].length);
      return m;
    }
    return null;
  };
  const record = (key, m) => { if (m) out.parts[key] = m[0].trim(); return !!m; };

  // Priority and tag first, so trailing "#health !!" don't hide an end-of-text date.
  take(/\s(!{1,3})(?=\s)/, (m) => { out.priority = m[1].length; });
  take(/\s#(\p{L}[\p{L}\p{N}_-]{0,29})(?=[\s,.;:!?])/u, (m) => { out.tag = m[1]; });

  // Duration: "for 30m", "for 1h", "for 1.5 hours", "for 1h30m", "for 90 min"
  if (!opts.noDuration) {
    record('duration',
      take(new RegExp(`\\sfor\\s+(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hour|hours)(?:\\s*(\\d+)\\s*(?:m|min|mins|minutes?))?${B}`, 'i'), (m) => {
        out.duration = Math.round(parseFloat(m[1]) * 60) + (m[3] ? parseInt(m[3], 10) : 0);
      }) ||
      take(new RegExp(`\\sfor\\s+(\\d+)\\s*(m|min|mins|minute|minutes)${B}`, 'i'), (m) => {
        out.duration = parseInt(m[1], 10);
      }));
    if (out.duration !== null && (out.duration <= 0 || out.duration > 1440)) { out.duration = null; delete out.parts.duration; }
  }

  // Times
  const setTime = (h, m) => {
    if (h < 0 || h > 23 || m < 0 || m > 59) return false;
    out.time = `${pad(h)}:${pad(m)}`;
  };
  const pmGuess = (h) => (h >= 1 && h <= 5 ? h + 12 : h); // "3:15"/"at 3" → afternoon
  if (!opts.noTime) {
    record('time',
      // 12h: "6pm", "6 pm", "6:30 p.m.", "6p" (a bare a/p must be attached to the number)
      take(new RegExp(`\\s(?:at\\s+|@\\s*)?(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(a\\.m\\.?|p\\.m\\.?|am|pm)|([ap]))${B}`, 'i'), (m) => {
        let h = parseInt(m[1], 10);
        const min = m[2] ? parseInt(m[2], 10) : 0;
        if (h < 1 || h > 12) return false;
        const pm = (m[3] || m[4]).toLowerCase().startsWith('p');
        if (pm && h !== 12) h += 12;
        if (!pm && h === 12) h = 0;
        return setTime(h, min);
      }) ||
      // Clock with colon: "14:30", "09:30", "6:00" literal; single-digit 1–5 → pm ("3:15" → 15:15)
      take(new RegExp(`\\s(?:at\\s+|@\\s*)?(\\d{1,2}):(\\d{2})${B}`, 'i'), (m) => {
        const h = parseInt(m[1], 10);
        return setTime(m[1].length === 1 ? pmGuess(h) : h, parseInt(m[2], 10));
      }) ||
      // Dot form only right after "at" or a date word ("at 10.30", "friday 18.30"), never prices ("Pay 14.50 bill")
      take(new RegExp(`(?:\\s(?:at\\s+|@\\s*)|(?<=\\s(?:${DATE_WORDS.join('|')})\\s))(\\d{1,2})\\.(\\d{2})${B}`, 'i'), (m) => {
        const h = parseInt(m[1], 10);
        return setTime(m[1].length === 1 ? pmGuess(h) : h, parseInt(m[2], 10));
      }) ||
      take(new RegExp(`\\s(?:at\\s+|@\\s*)?(noon|midday|midnight)${B}`, 'i'), (m) => setTime(m[1].toLowerCase() === 'midnight' ? 0 : 12, 0)) ||
      take(new RegExp(`\\s(?:at|@)\\s*(\\d{1,2})${B}`, 'i'), (m) => {
        let h = parseInt(m[1], 10);
        if (h > 23) return false;
        if (h >= 6 && h <= 11 && EVENING_WORDS.test(raw)) h += 12; // "Dinner at 7" → 19:00
        else h = pmGuess(h);
        return setTime(h, 0);
      }));
  }

  // Dates ("day after tomorrow" must be checked before "tomorrow")
  if (!opts.noDate) {
    record('date',
      take(new RegExp(`\\s(?:the\\s+)?day\\s+after\\s+tomorrow${B}`, 'i'), () => { out.date = addDays(today, 2); }) ||
      take(new RegExp(`\\s(today|tonight)${B}`, 'i'), (m) => {
        out.date = today;
        if (m[1].toLowerCase() === 'tonight' && !out.time && !opts.noTime) out.time = '20:00';
      }) ||
      take(new RegExp(`\\s(tomorrow|tmrw|tmr)${B}`, 'i'), () => { out.date = addDays(today, 1); }) ||
      take(new RegExp(`\\sin\\s+(\\d{1,3})\\s+(days?|weeks?)${B}`, 'i'), (m) => {
        out.date = addDays(today, parseInt(m[1], 10) * (m[2].toLowerCase().startsWith('w') ? 7 : 1));
      }) ||
      take(new RegExp(`\\snext\\s+week${B}`, 'i'), () => { out.date = addDays(today, 7); }) ||
      take(new RegExp(`\\s(on\\s+|next\\s+)?(${DAY_WORDS.join('|')})${B}`, 'i'), (m) => {
        const word = m[2].toLowerCase();
        const prefix = (m[1] || '').trim().toLowerCase();
        const end = m.index + m[0].length;
        const atEnd = restIsEmpty(end);
        const atStart = s.slice(0, m.index).trim() === '';
        const isFull = word in FULL_DAYS;
        if (!prefix) {
          // Short forms ("sat nav", "Sun cream") only count as dates at the end of the text.
          if (!isFull && !atEnd) return false;
          // A leading full weekday is a date only with an explicit time, punctuation after it
          // ("Monday: gym"), or when it's the only word. Otherwise it's part of the title.
          if (isFull && atStart && !atEnd && !out.time && !/^[,:;.]/.test(s.slice(end))) return false;
        }
        const target = isFull ? FULL_DAYS[word] : SHORT_DAYS[word];
        let diff = (target - dow(today) + 7) % 7;
        if (prefix === 'next' && diff === 0) diff = 7;
        out.date = addDays(today, diff);
      }));
  }

  const title = s.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim().replace(/^[,.;:\s]+|[,;:\s]+$/g, '');
  out.title = title || raw;
  return out;
}
