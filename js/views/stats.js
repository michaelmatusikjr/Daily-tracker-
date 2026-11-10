import { h, s, segmented } from '../ui.js';
import { getState } from '../store.js';
import { ctx } from '../ctx.js';
import { dayProgress, activeHabits, streaks, completionRate, totalCompletions, habitStart } from '../logic.js';
import { todayKey, addDays, startOfWeek, fmtDateShort, weekdayNarrow, weekdayLabels, fromKey } from '../dates.js';

const pctStr = (x) => (x === null || Number.isNaN(x) ? '—' : Math.round(x * 100) + '%');

export function renderStats() {
  const st = getState();
  const today = todayKey();
  const habits = activeHabits(st);
  const root = h('div.view.view-stats');
  root.append(h('header.page-head', h('div.page-head-text', h('p.eyebrow', 'Your progress'), h('h1.page-title', 'Stats'))));

  // Overview
  const tp = dayProgress(st, today);
  const ws = startOfWeek(today, st.settings.weekStart);
  let wTotal = 0, wDone = 0;
  for (let k = ws; k <= today; k = addDays(k, 1)) { const p = dayProgress(st, k); wTotal += p.total; wDone += p.done; }
  const totalHabitDone = habits.reduce((n, hb) => n + totalCompletions(st, hb), 0);
  let longest = null;
  for (const hb of habits) {
    const sk = streaks(st, hb, today);
    if (!longest || sk.current > longest.s.current) longest = { hb, s: sk };
  }
  root.append(h('section.stat-grid',
    tile(pctStr(tp.total ? tp.pct : null), 'Today', tp.total ? `${tp.done} of ${tp.total} done` : 'Nothing planned'),
    tile(pctStr(wTotal ? wDone / wTotal : null), 'This week', wTotal ? `${wDone} of ${wTotal} so far` : 'No items yet'),
    tile(String(totalHabitDone), 'Habit check-ins', 'All time'),
    tile(longest && longest.s.current ? `🔥 ${longest.s.current}` : '—', 'Longest active streak',
      longest && longest.s.current ? `${longest.hb.emoji} ${longest.hb.name}` : 'Start one today')));

  // Bar chart
  const range = ctx.ui.statsRange;
  const days = [];
  for (let i = range - 1; i >= 0; i--) {
    const k = addDays(today, -i);
    const p = dayProgress(st, k);
    days.push({ k, pct: p.total ? p.pct : null, done: p.done, total: p.total });
  }
  const withData = days.filter((d) => d.pct !== null);
  const avg = withData.length ? withData.reduce((a, d) => a + d.pct, 0) / withData.length : null;
  root.append(h('section.card.chart-card',
    h('div.section-head',
      h('div', h('h2.section-title', 'Daily completion'), h('p.muted.small', avg === null ? 'No data yet' : `Average ${pctStr(avg)} over ${withData.length} day${withData.length === 1 ? '' : 's'} with items (last ${range} days)`)),
      segmented([{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }], range, (v) => { ctx.ui.statsRange = v; ctx.rerender(); }, { label: 'Range', small: true })),
    barChart(days, range),
    h('table.sr-only', h('caption', 'Daily completion'),
      h('tbody', days.map((d) => h('tr', h('th', { scope: 'row' }, fmtDateShort(d.k)), h('td', d.pct === null ? 'no items' : `${pctStr(d.pct)} (${d.done}/${d.total})`)))))));

  // Per-habit rates
  if (habits.length) {
    const list = h('ul.rate-list');
    for (const hb of habits) {
      const r30 = completionRate(st, hb, 30, today);
      const all = completionRate(st, hb, null, today);
      list.append(h('li.rate-row', { style: { '--c': hb.color } },
        h('span.emoji-bubble.small', { 'aria-hidden': 'true' }, hb.emoji),
        h('div.rate-main',
          h('div.rate-top', h('span.habit-name', hb.name), h('span.rate-val', pctStr(r30))),
          h('div.rate-bar', { role: 'img', 'aria-label': `${hb.name}: ${pctStr(r30)} over the last 30 days, ${pctStr(all)} all time` },
            h('span', { style: { width: `${Math.round((r30 || 0) * 100)}%` } })),
          h('span.muted.small', `All time ${pctStr(all)}`))));
    }
    root.append(h('section.card', h('div.section-head', h('h2.section-title', 'Habits · last 30 days')), list));
  }

  // Best day of week (last 12 weeks)
  const byDow = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  for (let i = 0; i < 84; i++) {
    const k = addDays(today, -i);
    const p = dayProgress(st, k);
    if (!p.total) continue;
    const d = fromKey(k).getDay();
    byDow[d].sum += p.pct; byDow[d].n++;
  }
  const order = Array.from({ length: 7 }, (_, i) => (st.settings.weekStart + i) % 7);
  const vals = order.map((d) => ({ d, v: byDow[d].n ? byDow[d].sum / byDow[d].n : null }));
  const best = vals.filter((x) => x.v !== null && x.v > 0).sort((a, b) => b.v - a.v)[0];
  const names = weekdayLabels('long');
  const short = weekdayLabels('short');
  root.append(h('section.card',
    h('div.section-head', h('div', h('h2.section-title', 'Best day of the week'),
      h('p.muted.small', best ? `You're most consistent on ${names[best.d]}s (${pctStr(best.v)})` : 'Complete a few items to see patterns'))),
    h('ul.dow-list', vals.map(({ d, v }) => h(`li.dow-row${best && best.d === d ? '.best' : ''}`,
      h('span.dow-name', short[d]),
      h('div.rate-bar', { role: 'img', 'aria-label': `${names[d]}: ${pctStr(v)}` }, h('span', { style: { width: `${Math.round((v || 0) * 100)}%` } })),
      h('span.rate-val', pctStr(v)))))));

  void habitStart;
  return root;
}

function tile(value, label, sub) {
  return h('div.stat-card', h('span.stat-value', value), h('span.stat-label', label), sub ? h('span.stat-sub', sub) : null);
}

function barChart(days, range) {
  const mainW = document.getElementById('main')?.clientWidth || 360;
  const W = Math.round(Math.max(280, Math.min(680, mainW - 66))), H = 170, padL = 38, padB = 22, padT = 8, padR = 4;
  const iw = W - padL - padR, ih = H - padT - padB;
  const slot = iw / days.length;
  const bw = Math.max(3, Math.min(range > 7 ? 14 : 32, slot * (range > 7 ? 0.62 : 0.55)));
  const svg = s('svg', { class: 'bar-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Bar chart of daily completion for the last ${range} days` });
  for (const g of [0, 0.5, 1]) {
    const y = padT + ih * (1 - g);
    svg.append(s('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'grid' }),
      s('text', { x: padL - 6, y: y + 3, class: 'axis', 'text-anchor': 'end' }, `${g * 100}%`));
  }
  days.forEach((d, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const v = d.pct ?? 0;
    const bh = Math.max(d.pct === null ? 0 : 2, ih * v);
    const y = padT + ih - bh;
    const r = Math.min(4, bw / 2, bh);
    const path = bh > 0
      ? `M${x},${padT + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${padT + ih} Z`
      : '';
    const g = s('g', { class: 'bar-g' },
      s('title', {}, `${fmtDateShort(d.k)}: ${d.pct === null ? 'no items' : `${Math.round(v * 100)}% (${d.done}/${d.total})`}`),
      s('rect', { x: padL + slot * i, y: padT, width: slot, height: ih, class: 'hit' }),
      path ? s('path', { d: path, class: `bar${i === days.length - 1 ? ' today' : ''}${v === 1 ? ' full' : ''}` }) : s('rect', { x, y: padT + ih - 1, width: bw, height: 1, class: 'bar-empty' }));
    svg.append(g);
    const showLabel = range <= 7 || i % 5 === (days.length - 1) % 5;
    if (showLabel) {
      svg.append(s('text', { x: padL + slot * i + slot / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' },
        range <= 7 ? weekdayNarrow(d.k) : String(Number(d.k.slice(8)))));
    }
  });
  return svg;
}
