import { h, segmented, toast, confirmDialog, iconBtn } from '../ui.js';
import { icon } from '../icons.js';
import { getState, update, replaceState, exportPayload, validateImport, defaultState, APP_VERSION, isStorageOk } from '../store.js';
import { ctx } from '../ctx.js';
import { ACCENTS } from '../theme.js';
import { todayKey } from '../dates.js';
import { notifySupported, requestPermission, showNotification, reschedule } from '../notify.js';
import { canInstall, promptInstall, isIOS, isStandalone } from '../pwa.js';
import { showOnboarding } from '../onboarding.js';
import { ensureCategory } from '../forms.js';
import { reminderStatus, reminderProblem, activeReminders, blockedHelp } from '../reminders.js';

const setSetting = (key, value, silent = false) => update((s) => { s.settings[key] = value; }, { silent });

function row(label, desc, control, cls = '') {
  return h(`div.set-row${cls}`, h('div.set-text', h('span.set-label', label), desc ? h('span.set-desc', desc) : null), control);
}

function toggle(checked, label, onChange) {
  return h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label, onclick: () => onChange(!checked) }, h('span.knob'));
}

export function renderSettings() {
  const st = getState();
  const set = st.settings;
  const root = h('div.view.view-settings');
  root.append(h('header.page-head', h('div.page-head-text', h('p.eyebrow', 'Make it yours'), h('h1.page-title', 'Settings'))));

  if (!isStorageOk()) {
    root.append(h('div.card.warn-card', icon('alert', { size: 18 }), 'Your browser is blocking storage, so changes may not be saved. Try leaving private browsing mode.'));
  }

  // Appearance
  const accents = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Accent color' },
    ACCENTS.map((a) => h('button.swatch', {
      type: 'button', role: 'radio', 'aria-checked': String(set.accent === a.id), 'aria-label': a.name, title: a.name,
      style: { '--c': a.color }, onclick: () => setSetting('accent', a.id),
    })));
  root.append(group('Appearance',
    row('Theme', null, segmented([
      { value: 'system', label: 'Auto', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' },
    ], set.theme, (v) => setSetting('theme', v), { label: 'Theme', small: true })),
    row('Accent color', null, accents, '.col')));

  // Preferences
  root.append(group('Preferences',
    row('Week starts on', null, segmented([{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }], set.weekStart, (v) => setSetting('weekStart', v), { label: 'Week starts on', small: true })),
    row('Time format', null, segmented([{ value: '12', label: '12h' }, { value: '24', label: '24h' }], set.timeFormat, (v) => setSetting('timeFormat', v), { label: 'Time format', small: true }))));

  // Categories
  const catInput = h('input.input', { type: 'text', placeholder: 'New category', maxlength: 40, 'aria-label': 'New category name' });
  root.append(group('Task categories',
    h('ul.cat-list', st.categories.map((c) => h('li.cat-item',
      h('span.dot', { style: { background: c.color } }), h('span.cat-name', c.name),
      iconBtn('trash', `Delete category ${c.name}`, async () => {
        if (!(await confirmDialog('Delete category?', `Tasks in “${c.name}” will keep existing without a category.`, { ok: 'Delete', danger: true }))) return;
        update((s) => { s.categories = s.categories.filter((x) => x.id !== c.id); s.tasks.forEach((t) => { if (t.category === c.id) t.category = null; }); });
      })))),
    h('form.inline-form', {
      onsubmit: (e) => {
        e.preventDefault();
        const v = catInput.value.trim();
        if (!v) return;
        ensureCategory(v);
        ctx.rerender();
        toast(`Category “${v}” added`);
      },
    }, catInput, h('button.btn.secondary', { type: 'submit' }, icon('plus', { size: 16 }), 'Add'))));

  // Reminders
  const rStatus = reminderStatus();
  const active = activeReminders();
  const notifOn = rStatus === 'ok';
  const count = active.total;
  const countText = `${count} reminder${count === 1 ? '' : 's'}`;
  let banner = null;
  if (count && !notifOn) {
    banner = h('div.reminder-banner.warn', { role: 'status' }, icon('bellOff', { size: 18 }),
      h('span', h('b', `${countText} won’t appear. `), reminderProblem(rStatus) || ''),
      rStatus === 'needs-install' ? h('button.link-btn.inline', { type: 'button', onclick: () => document.getElementById('set-install')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 'How to add it') : null);
  } else if (count) {
    banner = h('div.reminder-banner.ok', { role: 'status' }, icon('bell', { size: 18 }), h('span', `${countText} set. They appear while Daily Tracker is open or was recently used.`));
  }
  let notifDesc = 'Reminders fire while the app is open or was recently used. Browsers cannot guarantee reminders when the app is fully closed.';
  if (rStatus === 'needs-install') notifDesc = 'On iPhone, add the app to your Home Screen first to enable notifications.';
  else if (rStatus === 'unsupported') notifDesc = 'This browser does not support notifications.';
  else if (rStatus === 'denied') notifDesc = `Notifications are blocked for this app. ${blockedHelp()}`;
  root.append(group('Reminders',
    banner,
    row('Notifications', notifDesc, toggle(notifOn, 'Notifications', async (on) => {
      if (!on) {
        if (count && !(await confirmDialog('Turn off notifications?', `${countText} won’t fire while notifications are off.`, { ok: 'Turn off', danger: true }))) return;
        setSetting('notifications', false); reschedule(); return;
      }
      if (!notifySupported()) { toast(rStatus === 'needs-install' ? 'Add the app to your Home Screen first' : 'Notifications are not supported here'); return; }
      const p = await requestPermission();
      if (p === 'granted') { setSetting('notifications', true); reschedule(); toast('Reminders on'); }
      else { setSetting('notifications', false); toast(p === 'denied' ? 'Notifications are blocked – see the help text' : 'Permission was not granted'); }
    })),
    notifOn ? h('div.set-actions', h('button.btn.secondary.small', {
      type: 'button', onclick: async () => { const ok = await showNotification('Daily Tracker', 'Notifications are working 👍', 'test'); if (!ok) toast('Could not show a notification'); },
    }, icon('bell', { size: 16 }), 'Send test')) : null,
    h('div.set-row', h('div.set-text', h('span.set-label', 'Alarms'), h('span.set-desc', 'Wake-up alarms, Bedside mode and scan-to-stop codes.')),
      h('a.btn.secondary.small', { href: '#alarms' }, icon('alarm', { size: 16 }), 'Open'))));

  // Install
  let installCtl;
  if (isStandalone()) installCtl = row('Install app', 'Installed. You are using the app version.', h('span.badge.ok', icon('check', { size: 14 }), 'Installed'));
  else if (canInstall()) installCtl = row('Install app', 'Add Daily Tracker to your home screen. Works offline.', h('button.btn.primary.small', { type: 'button', onclick: async () => { await promptInstall(); ctx.rerender(); } }, icon('download', { size: 16 }), 'Install'));
  else if (isIOS()) {
    installCtl = h('div.set-row.col',
      h('div.set-text', h('span.set-label', 'Install on iPhone / iPad'),
        h('ol.ios-steps',
          h('li', 'Open this page in Safari.'),
          h('li', 'Tap the Share button ', icon('share', { size: 15 }), ' in the toolbar.'),
          h('li', 'Choose “Add to Home Screen”, then tap Add.'))));
  } else installCtl = row('Install app', 'Use your browser menu (“Install app” or “Add to Home screen”). The option appears once the browser allows it.', h('span.badge', icon('phone', { size: 14 }), 'Browser menu'));
  installCtl.id = 'set-install';
  root.append(group('App', installCtl));

  // Data
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => importFile(fileInput) });
  root.append(group('Your data',
    h('p.set-desc.pad', 'Everything is stored only on this device. Export a backup to move it or keep it safe.'),
    h('div.set-actions',
      h('button.btn.secondary', { type: 'button', onclick: exportData }, icon('download', { size: 18 }), 'Export JSON'),
      h('button.btn.secondary', { type: 'button', onclick: () => fileInput.click() }, icon('upload', { size: 18 }), 'Import JSON'),
      fileInput),
    h('div.set-actions',
      h('button.btn.ghost', { type: 'button', onclick: () => showOnboarding() }, icon('sparkles', { size: 18 }), 'Show welcome tour'),
      h('button.btn.danger-ghost', { type: 'button', onclick: resetAll }, icon('trash', { size: 18 }), 'Reset all data'))));

  root.append(h('footer.about',
    h('p', h('b', 'Daily Tracker'), ` · version ${APP_VERSION}`),
    h('p.muted.small', 'Works offline · No account · No tracking')));
  return root;
}

function group(title, ...rows) {
  return h('section.set-group', h('h2.set-title', title), h('div.card.set-card', rows));
}

function exportData() {
  try {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `daily-tracker-backup-${todayKey()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Backup downloaded');
  } catch {
    toast('Export failed');
  }
}

async function importFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('That file is too large'); return; }
  try {
    const text = await file.text();
    const next = validateImport(JSON.parse(text));
    const ok = await confirmDialog('Replace your data?',
      `This backup has ${next.tasks.length} tasks and ${next.habits.length} habits. It will replace everything currently in the app.`, { ok: 'Import', danger: true });
    if (!ok) return;
    next.settings.onboarded = true;
    replaceState(next);
    toast('Backup imported');
  } catch (e) {
    toast(e instanceof SyntaxError ? 'That file is not valid JSON' : (e.message || 'Import failed'), { duration: 6000 });
  }
}

async function resetAll() {
  if (!(await confirmDialog('Reset all data?', 'This deletes every task, habit and journal entry on this device.', { ok: 'Yes, continue', danger: true }))) return;
  if (!(await confirmDialog('Are you absolutely sure?', 'This cannot be undone. Consider exporting a backup first.', { ok: 'Delete everything', danger: true }))) return;
  const fresh = defaultState();
  fresh.settings = { ...getState().settings, onboarded: true, notifications: false };
  replaceState(fresh);
  ctx.setDate(todayKey());
  toast('All data was reset');
}
