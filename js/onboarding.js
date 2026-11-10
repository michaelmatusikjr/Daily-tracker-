// First-run welcome tour: swipeable cards (scroll-snap), skippable.
import { h } from './ui.js';
import { icon } from './icons.js';
import { update, getState } from './store.js';
import { seedExamples } from './actions.js';

export function showOnboarding() {
  if (document.querySelector('.onboarding')) return;
  const prevFocus = document.activeElement;
  // On a replay of the tour, don't add examples again unless asked.
  let seed = !getState().settings.onboarded;
  const slides = [
    { art: '🗓️', title: 'Plan your day in seconds', text: 'Tap + and just type. “Gym 6pm” or “Call mom tomorrow 14:30” lands at the right time automatically.' },
    { art: '🔥', title: 'Build habits that stick', text: 'One tap to check off. Count goals like 8 glasses of water. Streaks respect your schedule, so rest days never break them.' },
    { art: '🌱', title: 'Everything stays on your device', text: 'Works offline, no account needed. Install it to your home screen for a native-app feel.', last: true },
  ];
  const track = h('div.ob-track', { tabindex: '-1' });
  const dots = h('div.ob-dots', { role: 'tablist', 'aria-label': 'Tour steps' });
  slides.forEach((sl, i) => {
    track.append(h('section.ob-slide', { 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${slides.length}` },
      h('div.ob-art', { 'aria-hidden': 'true' }, sl.art),
      h('h2.ob-title', sl.title),
      h('p.ob-text', sl.text),
      sl.last ? h('label.ob-check',
        h('input', { type: 'checkbox', checked: seed, onchange: (e) => { seed = e.target.checked; } }),
        h('span', 'Add a few example habits to start')) : null));
    dots.append(h('button.ob-dot', { type: 'button', role: 'tab', 'aria-label': `Go to step ${i + 1}`, onclick: () => goTo(i) }));
  });
  const next = h('button.btn.primary.ob-next', { type: 'button', onclick: () => (current() < slides.length - 1 ? goTo(current() + 1) : finish(true)) }, 'Next');
  const skip = h('button.btn.ghost.ob-skip', { type: 'button', onclick: () => finish(false) }, 'Skip');
  const root = h('div.onboarding', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Daily Tracker' },
    h('div.ob-panel',
      h('div.ob-top', h('span.ob-brand', icon('check', { size: 16 }), 'Daily Tracker'), skip),
      track,
      h('div.ob-foot', dots, next)));

  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  function goTo(i) {
    track.scrollTo({ left: i * track.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function sync() {
    const c = current();
    [...dots.children].forEach((d, i) => d.setAttribute('aria-selected', String(i === c)));
    next.textContent = c === slides.length - 1 ? 'Get started' : 'Next';
  }
  track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  function onKey(e) {
    if (e.key === 'Tab') {
      const f = [...root.querySelectorAll('button, input')].filter((x) => x.offsetParent !== null);
      const first = f[0], last = f[f.length - 1];
      if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key === 'Escape') finish(false);
    if (e.key === 'ArrowRight') goTo(Math.min(slides.length - 1, current() + 1));
    if (e.key === 'ArrowLeft') goTo(Math.max(0, current() - 1));
  }
  document.addEventListener('keydown', onKey);
  // Make everything behind the dialog inert so focus stays inside it.
  const behind = [...document.querySelectorAll('body > .app, body > .fab, body > .skip-link, body > #toasts')];
  behind.forEach((el) => el.setAttribute('inert', ''));
  function finish(completed) {
    behind.forEach((el) => el.removeAttribute('inert'));
    document.removeEventListener('keydown', onKey);
    root.classList.remove('show');
    setTimeout(() => root.remove(), 250);
    update((s) => { s.settings.onboarded = true; });
    if (completed && seed) seedExamples();
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.();
  }
  document.body.append(root);
  requestAnimationFrame(() => { root.classList.add('show'); sync(); next.focus(); });
}
