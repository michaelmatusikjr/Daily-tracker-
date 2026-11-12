// Service worker registration, update toast and install prompt handling.
import { isSheetOpen, toast } from './ui.js';

let deferredPrompt = null;
const RELOAD_KEY = 'dailyTracker:reloadedFor';

/** Is the user in the middle of something (open sheet, or a field with typed text)? */
function busy() {
  if (isSheetOpen()) return true;
  // A name typed into the welcome tour counts even after focus moves to its buttons.
  if (String(document.querySelector('.ob-name')?.value || '').trim()) return true;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return (el.textContent || '').trim() !== '';
  if (el.matches?.('input, textarea')) return String(el.value || '').trim() !== '';
  return false;
}

let pendingReload = null;
/**
 * Reload into a new version, but never while the user is typing or has a sheet open, and at most
 * once per target version per tab session (guards against a reload loop on a version mismatch).
 */
let userAskedToReload = false; // the user tapped "Reload" on the update toast in this tab

export function safeReload(target) {
  if (userAskedToReload) { window.location.reload(); return true; }
  try { if (sessionStorage.getItem(RELOAD_KEY) === target) return false; } catch { /* ignore */ }
  const go = () => {
    try { sessionStorage.setItem(RELOAD_KEY, target); } catch { /* ignore */ }
    window.location.reload();
  };
  if (!busy()) { go(); return true; }
  if (pendingReload) return true;
  toast('Update ready – finishing when you’re done', { force: true, duration: 6000 });
  pendingReload = setInterval(() => { if (!busy()) { clearInterval(pendingReload); go(); } }, 1000);
  document.addEventListener('focusout', () => setTimeout(() => { if (pendingReload && !busy()) { clearInterval(pendingReload); go(); } }, 50));
  return true;
}
const listeners = new Set();

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canInstall = () => !!deferredPrompt;
export const onInstallChange = (fn) => listeners.add(fn);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((l) => l());
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; listeners.forEach((l) => l()); });

export async function promptInstall() {
  if (!deferredPrompt) return null;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  listeners.forEach((l) => l());
  return choice?.outcome || null;
}

function showUpdateToast(worker) {
  const el = document.getElementById('update-toast');
  if (!el) return;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  el.querySelector('[data-action="reload"]').onclick = () => { userAskedToReload = true; worker.postMessage({ type: 'SKIP_WAITING' }); };
  el.querySelector('[data-action="dismiss"]').onclick = () => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); };
}

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let refreshing = false;
  // Only reload when an existing controller is replaced (an update), not on first install.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    safeReload('controller');
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(nw);
        });
      });
      // Check for updates when the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch (e) {
      console.warn('Service worker registration failed', e);
    }
  });
}
