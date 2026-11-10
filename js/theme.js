// Theme / accent application and theme-color meta syncing.
export const ACCENTS = [
  { id: 'indigo', name: 'Indigo', color: '#5b5bd6' },
  { id: 'teal', name: 'Teal', color: '#0f9488' },
  { id: 'rose', name: 'Rose', color: '#e11d63' },
  { id: 'amber', name: 'Amber', color: '#d97706' },
  { id: 'green', name: 'Green', color: '#16a34a' },
  { id: 'blue', name: 'Blue', color: '#2563eb' },
];

const darkMq = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(settings) {
  const root = document.documentElement;
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
  syncThemeColor();
}

export function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f6f7fb';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m, i) => {
    if (i === 0) { m.setAttribute('content', bg); m.removeAttribute('media'); } else m.remove();
  });
}

darkMq.addEventListener?.('change', syncThemeColor);
