// Local-date utilities. Date keys are always "YYYY-MM-DD" built from LOCAL
// components (never toISOString) so there are no UTC off-by-one bugs.
// Parsed keys are anchored at local noon, which keeps day arithmetic safe
// across DST transitions.

export const pad = (n) => String(n).padStart(2, '0');

export function toKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export const todayKey = () => toKey(new Date());

export function isValidKey(k) {
  if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  return toKey(fromKey(k)) === k;
}

export function addDays(k, n) {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function daysInMonth(y, m0) {
  return new Date(y, m0 + 1, 0).getDate();
}

export function addMonths(k, n) {
  const d = fromKey(k);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return toKey(d);
}

export const monthStart = (k) => k.slice(0, 8) + '01';

/** Day of week, 0 = Sunday. */
export const dow = (k) => fromKey(k).getDay();

/** Whole days from a to b (b - a). DST-proof via UTC of the components. */
export function diffDays(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function startOfWeek(k, weekStart = 1) {
  const off = (dow(k) - weekStart + 7) % 7;
  return addDays(k, -off);
}

/** ISO weeks start on Monday. */
export const isoWeekStart = (k) => startOfWeek(k, 1);

export function* eachDay(from, to) {
  for (let k = from; k <= to; k = addDays(k, 1)) yield k;
}

export function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export const minToTime = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

export function nowMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Date object for a local date key + "HH:MM". */
export function dateAt(k, t) {
  const [y, m, d] = k.split('-').map(Number);
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function fmtTime(t, format = '12') {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (format === '24') return `${pad(h)}:${pad(m)}`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad(m)} ${suffix}` : `${h12} ${suffix}`;
}

export function fmtDuration(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const fmt = (k, opts) => fromKey(k).toLocaleDateString(undefined, opts);
export const fmtDateLong = (k) => fmt(k, { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtDateShort = (k) => fmt(k, { month: 'short', day: 'numeric' });
export const fmtMonthYear = (k) => fmt(k, { month: 'long', year: 'numeric' });
export const weekdayShort = (k) => fmt(k, { weekday: 'short' });
export const weekdayNarrow = (k) => fmt(k, { weekday: 'narrow' });

/** Narrow/short weekday labels indexed by day-of-week (0 = Sunday). */
export function weekdayLabels(style = 'short') {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt(`2023-01-0${i + 1}`, { weekday: style }));
}

export function relativeLabel(k, today = todayKey()) {
  const d = diffDays(today, k);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return fmt(k, { weekday: 'long' });
  const sameYear = k.slice(0, 4) === today.slice(0, 4);
  return fmt(k, sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
