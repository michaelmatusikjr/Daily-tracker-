// Service worker registration, update toast and install prompt handling.
let deferredPrompt = null;
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
  el.querySelector('[data-action="reload"]').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
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
    window.location.reload();
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
