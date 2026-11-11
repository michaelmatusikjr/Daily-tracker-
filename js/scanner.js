// Camera barcode/QR scanner. Uses the native BarcodeDetector when available
// (e.g. Chrome on Android); otherwise lazy-loads the vendored ZXing decoder.
import { h, haptic } from './ui.js';
import { icon } from './icons.js';

const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix'];
let zxingPromise = null;

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/zxing/zxing.min.js';
      s.async = true;
      s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('Decoder failed to load')));
      s.onerror = () => { zxingPromise = null; reject(new Error('Decoder failed to load')); };
      document.head.append(s);
    });
  }
  return zxingPromise;
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.includes('qr_code')) {
        const det = new window.BarcodeDetector({ formats });
        return { name: 'native', detect: async (video) => { const r = await det.detect(video); return r[0] ? { value: r[0].rawValue, format: r[0].format } : null; } };
      }
    } catch { /* fall back */ }
  }
  const Z = await loadZXing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A,
    Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.DATA_MATRIX,
  ]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const c2d = canvas.getContext('2d', { willReadFrequently: true });
  return {
    name: 'zxing',
    detect: async (video) => {
      const w = video.videoWidth, hgt = video.videoHeight;
      if (!w || !hgt) return null;
      const scale = Math.min(1, 960 / Math.max(w, hgt));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(hgt * scale);
      c2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const src = new Z.HTMLCanvasElementLuminanceSource(canvas);
        const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
        const r = reader.decodeWithState(bmp);
        const fmt = Z.BarcodeFormat[r.getBarcodeFormat()];
        return { value: r.getText(), format: String(fmt || '').toLowerCase() };
      } catch {
        return null; // NotFoundException etc. — no code in this frame
      } finally {
        reader.reset();
      }
    },
  };
}

function cameraErrorText(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera access was blocked. Allow the camera for this site in your browser or phone settings, then try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
  if (n === 'NotReadableError') return 'The camera is being used by another app.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t use the camera here (it needs HTTPS).';
  return 'The camera couldn’t be started.';
}

/**
 * Open a full-screen scanner.
 * onCode({value, format}) → return true to close, a string to show as an error and keep scanning.
 * Options: title, hint, closable (default true), manualEntry (registration only), onClose, extra (node).
 * Returns { close }.
 */
export function openScanner({ title, hint, onCode, closable = true, manualEntry = false, onClose, extra = null }) {
  let stream = null, stopped = false, busy = false, timer = null, lastErrAt = 0;
  const video = h('video.scan-video', { playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' });
  video.muted = true;
  const status = h('p.scan-status', { role: 'status', 'aria-live': 'assertive' }, 'Starting camera…');
  const frame = h('div.scan-frame', { 'aria-hidden': 'true' });
  const closeBtn = closable ? h('button.scan-close', { type: 'button', 'aria-label': 'Close scanner', onclick: () => close() }, icon('x', { size: 24 })) : null;
  const manual = manualEntry ? h('form.scan-manual', {
    onsubmit: (e) => {
      e.preventDefault();
      const v = e.target.querySelector('input').value.trim();
      if (v) handle({ value: v, format: 'manual' });
    },
  }, h('input.input', { type: 'text', placeholder: 'Or type the number under the barcode', 'aria-label': 'Code value', autocomplete: 'off', inputmode: 'text' }),
  h('button.btn.secondary', { type: 'submit' }, 'Use')) : null;
  const root = h('div.scanner', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    video, frame,
    h('div.scan-top', h('h2.scan-title', title), closeBtn),
    h('div.scan-bottom', status, hint ? h('p.scan-hint', hint) : null, manual, extra));
  document.body.append(root);
  document.body.classList.add('scanner-open');
  // Keep keyboard focus inside the scanner; Escape closes it when allowed.
  const onKey = (e) => {
    if (e.key === 'Escape' && closable) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button, input')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => (closeBtn || root.querySelector('button, input'))?.focus());
  requestAnimationFrame(() => root.classList.add('show'));

  function showError(msg) {
    status.textContent = msg;
    root.classList.remove('wrong'); void root.offsetWidth; root.classList.add('wrong');
    haptic([60, 40, 60]);
    lastErrAt = Date.now();
  }

  function handle(res) {
    const r = onCode(res);
    if (r === true) { haptic(30); close(); return; }
    showError(typeof r === 'string' ? r : 'Not recognised');
  }

  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('nomedia');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      status.textContent = 'Point the camera at the code';
      const det = await makeDetector();
      if (stopped) return;
      let lastValue = null;
      const loop = async () => {
        if (stopped) return;
        if (!busy && video.readyState >= 2) {
          busy = true;
          try {
            const r = await det.detect(video);
            // Avoid repeating the same wrong-code error every frame.
            if (r && (r.value !== lastValue || Date.now() - lastErrAt > 2000)) { lastValue = r.value; handle(r); }
          } catch { /* ignore frame errors */ }
          busy = false;
        }
        if (!stopped) timer = setTimeout(loop, 200);
      };
      loop();
    } catch (e) {
      status.textContent = e?.message === 'Decoder failed to load' ? 'The code reader couldn’t load. Check your connection once, then it works offline.' : cameraErrorText(e);
      root.classList.add('cam-error');
    }
  })();

  function close() {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('keydown', onKey, true);
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    root.classList.remove('show');
    setTimeout(() => root.remove(), 200);
    if (!document.querySelector('.scanner.show')) document.body.classList.remove('scanner-open');
    onClose?.();
  }
  return { close, root };
}
