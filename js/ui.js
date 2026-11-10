// DOM helpers and shared UI components. User text is ALWAYS set via
// textContent / attributes (never innerHTML) to prevent XSS.
import { icon } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(el, props, isSvg) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', [el.getAttribute('class'), v].filter(Boolean).join(' '));
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === null || sv === undefined) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (!isSvg && (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** h('div.card.big', {props}, ...children) */
export function h(sel, props, ...kids) {
  if (props instanceof Node || typeof props !== 'object' || props === null || Array.isArray(props)) {
    if (props !== undefined && props !== null) kids.unshift(props);
    props = {};
  }
  const [tag, ...classes] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  applyProps(el, props, false);
  append(el, kids);
  return el;
}

export function s(tag, props, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props, true);
  append(el, kids);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function iconBtn(name, label, onclick, cls = '') {
  return h(`button.icon-btn${cls ? '.' + cls : ''}`, { type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

/** Segmented control. options: [{value,label}] */
export function segmented(options, value, onChange, { label = '', small = false } = {}) {
  const wrap = h(`div.segmented${small ? '.small' : ''}`, { role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((o) => {
    const b = h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(o.value === value),
      onclick: () => {
        buttons.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        onChange(o.value);
      },
    }, o.icon ? icon(o.icon, { size: 16 }) : null, o.label);
    return b;
  });
  wrap.append(...buttons);
  return wrap;
}

/** Progress ring. pct 0..1 */
export function ring(pct, { size = 64, stroke = 7, color = 'var(--accent)', track = 'var(--ring-track)', label = null, cls = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const svg = s('svg', { class: `ring ${cls}`, width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
    s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: track, 'stroke-width': stroke }),
    s('circle', {
      class: 'ring-fg', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke,
      'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - Math.min(1, Math.max(0, pct))),
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }));
  if (label === null) return svg;
  return h('div.ring-wrap', { style: { width: size + 'px', height: size + 'px' } }, svg, h('span.ring-label', label));
}

// ---------- Toasts ----------
let toastTimer = null;
export function toast(message, { action, onAction, duration = 4500 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  clearTimeout(toastTimer);
  host.replaceChildren();
  const el = h('div.toast', { role: 'status' },
    h('span.toast-msg', message),
    action ? h('button.toast-action', {
      type: 'button',
      onclick: () => { dismiss(); onAction?.(); },
    }, action) : null);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  function dismiss() {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }
  toastTimer = setTimeout(dismiss, duration);
  return dismiss;
}

// ---------- Bottom sheets / dialogs ----------
const openSheets = [];

export function openSheet({ title, content, footer = null, onClose, cls = '' }) {
  const prevFocus = document.activeElement;
  const titleId = 'sheet-t-' + Math.random().toString(36).slice(2, 7);
  const closeBtn = iconBtn('x', 'Close', () => close());
  const panel = h(`div.sheet${cls ? '.' + cls : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div.sheet-grabber', { 'aria-hidden': 'true' }),
    h('div.sheet-head', h('h2.sheet-title', { id: titleId }, title), closeBtn),
    h('div.sheet-body', content),
    footer ? h('div.sheet-foot', footer) : null);
  const openedAt = Date.now();
  // Ignore backdrop clicks right after opening (e.g. a double-tap on the button that opened it).
  const backdrop = h('div.sheet-backdrop', { onclick: () => { if (Date.now() - openedAt > 350) close(); } });
  const root = h('div.sheet-root', backdrop, panel);
  document.body.append(root);
  document.body.classList.add('sheet-open');
  let closed = false;

  function onKey(e) {
    if (openSheets[openSheets.length - 1] !== api) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey);

  // Drag the grabber/header down to dismiss (touch).
  const head = panel.querySelector('.sheet-head');
  const grab = panel.querySelector('.sheet-grabber');
  let startY = null, dy = 0;
  const tStart = (e) => { if (e.target.closest('button')) return; startY = e.touches[0].clientY; dy = 0; panel.style.transition = 'none'; };
  const tMove = (e) => { if (startY === null) return; dy = Math.max(0, e.touches[0].clientY - startY); panel.style.transform = `translateY(${dy}px)`; };
  const tEnd = () => {
    if (startY === null) return;
    startY = null; panel.style.transition = ''; panel.style.transform = '';
    if (dy > 90) close();
  };
  for (const el of [head, grab]) {
    el.addEventListener('touchstart', tStart, { passive: true });
    el.addEventListener('touchmove', tMove, { passive: true });
    el.addEventListener('touchend', tEnd);
  }

  requestAnimationFrame(() => {
    root.classList.add('open');
    const af = panel.querySelector('[autofocus]');
    (af || panel).focus({ preventScroll: true });
  });

  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    root.classList.remove('open');
    const idx = openSheets.indexOf(api);
    if (idx >= 0) openSheets.splice(idx, 1);
    if (!openSheets.length) document.body.classList.remove('sheet-open');
    setTimeout(() => root.remove(), reducedMotion() ? 0 : 280);
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    onClose?.(result);
  }
  const api = { close, panel };
  openSheets.push(api);
  return api;
}

export const closeAllSheets = () => [...openSheets].forEach((s) => s.close());
export const isSheetOpen = () => openSheets.length > 0;

/** Choice dialog. options: [{value,label,style:'primary'|'danger'|'ghost'}]. Resolves value or null. */
export function choose(title, message, options) {
  return new Promise((resolve) => {
    let result = null;
    const btns = options.map((o) => h(`button.btn.${o.style || 'secondary'}.block`, {
      type: 'button', onclick: () => { result = o.value; sheet.close(); },
    }, o.label));
    const sheet = openSheet({
      title, cls: 'dialog',
      content: [message ? h('p.dialog-msg', message) : null, h('div.dialog-actions', btns)],
      onClose: () => resolve(result),
    });
    btns[0]?.setAttribute('autofocus', '');
  });
}

export async function confirmDialog(title, message, { ok = 'Confirm', danger = false } = {}) {
  const v = await choose(title, message, [
    { value: true, label: ok, style: danger ? 'danger' : 'primary' },
    { value: false, label: 'Cancel', style: 'ghost' },
  ]);
  return v === true;
}

// ---------- Gestures ----------
/** Tap vs long-press (and right-click) on one element. */
export function onPress(el, { tap, long, delay = 480 }) {
  let timer = null, longFired = false, sx = 0, sy = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    longFired = false; sx = e.clientX; sy = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => { longFired = true; haptic(25); long?.(); }, delay);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 12) cancel(); });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    if (!longFired) { longFired = true; long?.(); }
  });
  el.addEventListener('click', (e) => {
    if (longFired) { e.preventDefault(); longFired = false; return; }
    tap?.(e);
  });
}

/** Horizontal swipe detection (touch). */
export function onSwipe(el, { left, right, threshold = 60 }) {
  let sx = null, sy = 0, st = 0;
  el.addEventListener('touchstart', (e) => {
    // Ignore gestures that start inside form fields, drag handles, or a nested
    // .no-swipe region that has its own swipe handling (but not `el` itself).
    const blocker = e.target.closest('.no-swipe, input, textarea, select, .drag-handle');
    if (e.touches.length !== 1 || (blocker && blocker !== el)) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx === null || document.body.classList.contains('sheet-open')) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    sx = null;
    if (Date.now() - st > 700 || Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (dx < 0) left?.(); else right?.();
  });
}

/** Pointer-driven drag reordering with a handle, plus keyboard (Arrow Up/Down on the handle). */
export function makeSortable(list, { onReorder }) {
  const items = () => [...list.children].filter((c) => c.dataset.id);
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const ids = items().map((i) => i.dataset.id);
    const id = handle.closest('[data-id]').dataset.id;
    const i = ids.indexOf(id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onReorder(ids, id);
  });
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    const els = items();
    const item = handle.closest('[data-id]');
    const idx = els.indexOf(item);
    const rects = els.map((x) => x.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
    const step = rects[idx].height + gap;
    const startY = e.clientY;
    let target = idx;
    item.classList.add('dragging');
    list.classList.add('is-sorting');
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = (ev) => {
      const dy = ev.clientY - startY;
      item.style.transform = `translateY(${dy}px)`;
      const center = rects[idx].top + rects[idx].height / 2 + dy;
      target = idx;
      for (let i = idx + 1; i < els.length; i++) if (center > rects[i].top + rects[i].height / 2) target = i;
      for (let i = idx - 1; i >= 0; i--) if (center < rects[i].top + rects[i].height / 2) target = i;
      els.forEach((x, i) => {
        if (x === item) return;
        let off = 0;
        if (idx < target && i > idx && i <= target) off = -step;
        if (target < idx && i >= target && i < idx) off = step;
        x.style.transform = off ? `translateY(${off}px)` : '';
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      els.forEach((x) => { x.style.transform = ''; });
      item.classList.remove('dragging');
      list.classList.remove('is-sorting');
      if (target !== idx) {
        const ids = els.map((x) => x.dataset.id);
        const [moved] = ids.splice(idx, 1);
        ids.splice(target, 0, moved);
        haptic(15);
        onReorder(ids, moved);
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

export function emptyState(emoji, title, hint, action = null) {
  return h('div.empty', h('div.empty-art', { 'aria-hidden': 'true' }, emoji), h('p.empty-title', title), h('p.empty-hint', hint), action);
}

export function sectionHead(title, extra = null, iconName = null) {
  return h('div.section-head', h('h2.section-title', iconName ? icon(iconName, { size: 16 }) : null, title), extra);
}
