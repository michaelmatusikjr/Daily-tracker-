// Recurrence + time-zone math for reminder rules. Pure functions, no dependencies.
// occursOn() mirrors occursOn() in the app's js/logic.js (parity is unit-tested in
// test/recur.test.mjs), with the rule's `start` playing the role of the task's date.

const pad = (n) => String(n).padStart(2, '0');
export const isDateKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && keyFromUTC(utcFromKey(k)) === k;
const utcFromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const keyFromUTC = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const addDays = (k, n) => keyFromUTC(utcFromKey(k) + n * 86400000);
export const diffDays = (a, b) => Math.round((utcFromKey(b) - utcFromKey(a)) / 86400000);
export const dow = (k) => new Date(utcFromKey(k)).getUTCDay();
export const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Does an occurrence of `rule` fall on date key k? (Same rules as the app.) */
export function occursOn(rule, k) {
  const r = rule.recur || { type: 'none' };
  const start = r.type === 'none' ? rule.date : r.start;
  if (!start || k < start) return false;
  if (rule.exceptions?.includes(k)) return false;
  if (rule.until && k > rule.until) return false;
  switch (r.type) {
    case 'daily': return true;
    case 'weekdays': { const d = dow(k); return d > 0 && d < 6; }
    case 'weekly': {
      const days = r.days?.length ? r.days : [dow(start)];
      return days.includes(dow(k));
    }
    case 'monthly': {
      const startDay = Number(start.slice(8, 10));
      const [y, m, d] = k.split('-').map(Number);
      return d === Math.min(startDay, daysInMonth(y, m - 1));
    }
    case 'interval': {
      const n = Math.max(1, r.interval || 1);
      return diffDays(start, k) % n === 0;
    }
    default: return k === start;
  }
}

// ---------- Time zones (Intl only) ----------
const fmtCache = new Map();
function partsFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { partsFmt(tz); return true; } catch { return false; }
}
/** Local wall-clock fields of a UTC instant in tz. */
export function wallTime(ms, tz) {
  const p = {};
  for (const x of partsFmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { key: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, sec: Number(p.second) };
}
const offsetAt = (ms, tz) => {
  const w = wallTime(ms, tz);
  const [y, m, d] = w.key.split('-').map(Number);
  const [hh, mm] = w.hm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, w.sec) - Math.floor(ms / 1000) * 1000;
};

/**
 * UTC ms for local date k at "HH:MM" in tz.
 * Repeated local times (DST fall-back) → the first one. Nonexistent local times
 * (spring-forward gap) → the next valid minute, i.e. the moment the clocks jump.
 */
export function localToUTC(k, hm, tz) {
  const [y, m, d] = k.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const want = `${k} ${hm}`;
  const cands = [...new Set([guess - offsetAt(guess - 86400000 / 2, tz), guess - offsetAt(guess, tz), guess - offsetAt(guess + 86400000 / 2, tz)])]
    .filter((t) => { const w = wallTime(t, tz); return `${w.key} ${w.hm}` === want; })
    .sort((a, b) => a - b);
  if (cands.length) return cands[0];
  // In a gap: the first minute whose local time is after the wanted time.
  let t = guess - offsetAt(guess - 86400000 / 2, tz) - 3 * 3600000;
  for (let i = 0; i < 6 * 60; i++, t += 60000) {
    const w = wallTime(t, tz);
    if (`${w.key} ${w.hm}` > want) return t;
  }
  return guess - offsetAt(guess, tz);
}

/**
 * Next fire time strictly after `afterMs`: { at, date } (date = the occurrence's date key) or null.
 * The fire moment is local (date + offsetDays) at rule.time. Dates in rule.skipDates or in
 * `fired` (Set of date keys already sent) are skipped.
 */
export function nextFire(rule, tz, afterMs, { fired = null, horizonDays = 800 } = {}) {
  const skip = new Set(rule.skipDates || []);
  const off = rule.offsetDays || 0;
  // Occurrence date k fires on local day k + off; start scanning a little before "now" locally.
  let k = addDays(wallTime(afterMs, tz).key, -off - 1);
  const r = rule.recur || { type: 'none' };
  if (r.type === 'none') {
    if (!rule.date || skip.has(rule.date) || fired?.has(rule.date) || rule.exceptions?.includes(rule.date)) return null;
    const at = localToUTC(addDays(rule.date, off), rule.time, tz);
    return at > afterMs ? { at, date: rule.date } : null;
  }
  const start = r.start;
  if (start && k < start) k = start;
  for (let i = 0; i < horizonDays; i++, k = addDays(k, 1)) {
    if (rule.until && k > rule.until) return null;
    if (!occursOn(rule, k) || skip.has(k) || fired?.has(k)) continue;
    const at = localToUTC(addDays(k, off), rule.time, tz);
    if (at > afterMs) return { at, date: k };
  }
  return null;
}
