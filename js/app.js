// App bootstrap: routing, rendering, timers, PWA wiring.
import { load, subscribe, getState } from './store.js';
import { ctx } from './ctx.js';
import { h, closeAllSheets } from './ui.js';
import { icon } from './icons.js';
import { applyTheme } from './theme.js';
import { todayKey, monthStart } from './dates.js';
import { renderToday } from './views/today.js';
import { renderHabits } from './views/habits.js';
import { renderHabitDetail } from './views/habitDetail.js';
import { renderCalendar } from './views/calendar.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';
import { openQuickAdd, openHabitForm } from './forms.js';
import { showOnboarding } from './onboarding.js';
import { registerSW, onInstallChange } from './pwa.js';
import { reschedule } from './notify.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'habits', label: 'Habits', icon: 'habits' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'stats', label: 'Stats', icon: 'stats' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
const TITLES = { today: 'Today', habits: 'Habits', habit: 'Habit', calendar: 'Calendar', stats: 'Stats', settings: 'Settings' };

const main = document.getElementById('main');
const nav = document.getElementById('nav');
let lastRoute = null;
let lastToday = todayKey();

function parseRoute() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: TITLES[name] ? name : 'today', arg: arg ? decodeURIComponent(arg) : null };
}

function buildNav() {
  nav.replaceChildren(
    h('div.nav-brand', h('span.brand-mark', { 'aria-hidden': 'true' }, icon('check', { size: 16 })), h('span', 'Daily Tracker')),
    ...TABS.map((t) => h('a.nav-item', { href: '#' + t.id, dataset: { tab: t.id } },
      h('span.nav-icon', icon(t.icon, { size: 22 })), h('span.nav-label', t.label))));
}

function render() {
  const { name, arg } = parseRoute();
  const routeKey = name + '/' + (arg || '');
  const changedRoute = routeKey !== lastRoute;
  // Remember which control had focus so keyboard users keep their place.
  const fk = document.activeElement?.closest?.('[data-fk]')?.dataset.fk;
  let view;
  switch (name) {
    case 'habits': view = renderHabits(); break;
    case 'habit': view = renderHabitDetail(arg); break;
    case 'calendar': view = renderCalendar(); break;
    case 'stats': view = renderStats(); break;
    case 'settings': view = renderSettings(); break;
    default: view = renderToday();
  }
  if (changedRoute) view.classList.add('enter');
  main.replaceChildren(view);
  ctx.anim.clear();
  const activeTab = name === 'habit' ? 'habits' : name;
  nav.querySelectorAll('.nav-item').forEach((a) => {
    if (a.dataset.tab === activeTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${TITLES[name]} · Daily Tracker`;
  fab.hidden = name === 'settings';
  fab.setAttribute('aria-label', name === 'habits' || name === 'habit' ? 'New habit' : 'Quick add');
  if (changedRoute) {
    window.scrollTo(0, 0);
    if (lastRoute !== null) main.focus({ preventScroll: true });
  } else if (fk) {
    document.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
  }
  lastRoute = routeKey;
}

const fab = h('button.fab', { type: 'button', 'aria-label': 'Quick add', onclick: () => {
  const { name } = parseRoute();
  if (name === 'habits' || name === 'habit') openHabitForm(null); else openQuickAdd();
} }, icon('plus', { size: 28 }));

ctx.rerender = render;
ctx.setDate = (k) => { ctx.ui.date = k; if (parseRoute().name === 'today') render(); };
ctx.go = (route) => {
  if (location.hash === '#' + route) render(); else location.hash = '#' + route;
};

function init() {
  load();
  applyTheme(getState().settings);
  buildNav();
  document.body.append(fab);
  render();
  let lastSettings = JSON.stringify(getState().settings);
  let scheduleTimer;
  subscribe((st) => {
    const sNow = JSON.stringify(st.settings);
    if (sNow !== lastSettings) { applyTheme(st.settings); lastSettings = sNow; }
    render();
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(reschedule, 300);
  });
  window.addEventListener('hashchange', () => { closeAllSheets(); render(); });
  // Keyboard shortcut: "n" opens quick add.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !document.body.classList.contains('sheet-open') && !document.querySelector('.onboarding')) {
      e.preventDefault();
      fab.click();
    }
  });
  // Keep "now" line fresh and roll over at midnight.
  setInterval(() => {
    const t = todayKey();
    if (t !== lastToday) {
      if (ctx.ui.date === lastToday) ctx.ui.date = t;
      if (ctx.ui.calMonth === monthStart(lastToday)) ctx.ui.calMonth = monthStart(t);
      lastToday = t;
      reschedule();
    }
    if (parseRoute().name === 'today' && !document.body.classList.contains('sheet-open') && !document.activeElement?.matches?.('textarea, input')) render();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const t = todayKey();
    if (t !== lastToday) { if (ctx.ui.date === lastToday) ctx.ui.date = t; lastToday = t; }
    if (!document.body.classList.contains('sheet-open')) render();
    reschedule();
  });
  onInstallChange(() => { if (parseRoute().name === 'settings') render(); });
  reschedule();
  if (!getState().settings.onboarded) showOnboarding();
  registerSW();
}

init();
