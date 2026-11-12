import { h, segmented, toast, confirmDialog, iconBtn, choose } from '../ui.js';
import { icon } from '../icons.js';
import { getState, update, replaceState, exportPayload, validateImport, defaultState, APP_VERSION, isStorageOk, getActiveProfile, getProfiles, addProfile, replaceAllProfiles, unreadableProfiles } from '../store.js';
import { avatarEl, openProfileEditor, openProfileMenu } from '../profiles.js';
import { ctx } from '../ctx.js';
import { ACCENTS } from '../theme.js';
import { todayKey } from '../dates.js';
import { notifySupported, requestPermission, showNotification, reschedule } from '../notify.js';
import { canInstall, promptInstall, isIOS, isStandalone } from '../pwa.js';
import { showOnboarding } from '../onboarding.js';
import { ensureCategory } from '../forms.js';
import { reminderStatus, reminderProblem, activeReminders, blockedHelp } from '../reminders.js';
import { setWorkoutHabit } from '../actions.js';

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
  const profile = getActiveProfile();
  root.append(h('header.page-head.detail-head',
    iconBtn('arrowLeft', 'Back to Today', () => ctx.go('today')),
    h('div.page-head-text', h('p.eyebrow', `${profile.name}’s settings`), h('h1.page-title', 'Settings'))));

  // Profile
  root.append(group('Profile',
    h('div.set-row',
      h('div.profile-row', avatarEl(profile, 44), h('div.set-text', h('span.set-label', profile.name), h('span.set-desc', getProfiles().length > 1 ? `${getProfiles().length} profiles on this device. Settings below are ${profile.name}’s.` : 'Settings below belong to this profile.'))),
      h('div.set-actions.tight',
        h('button.btn.secondary.small', { type: 'button', onclick: () => openProfileEditor(profile) }, icon('edit', { size: 16 }), 'Edit'),
        h('button.btn.ghost.small', { type: 'button', onclick: () => openProfileMenu() }, 'Switch')))));

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

  // Workouts: units + optional habit link
  const checkHabits = st.habits.filter((x) => !x.archived && x.goal.type === 'check');
  const wh = set.workoutHabit || { habitId: null, filter: 'any' };
  const linkedOk = checkHabits.some((x) => x.id === wh.habitId);
  const habitSel = h('select.input', {
    'aria-label': 'Habit to check off when you log a workout',
    onchange: (e) => setWorkoutHabit(e.target.value || null),
  }, h('option', { value: '', selected: !linkedOk }, 'None'), checkHabits.map((x) => h('option', { value: x.id, selected: x.id === wh.habitId }, `${x.emoji} ${x.name}`)));
  root.append(group('Workouts',
    row('Weight', null, segmented([{ value: 'lb', label: 'lbs' }, { value: 'kg', label: 'kg' }], set.weightUnit, (v) => setSetting('weightUnit', v), { label: 'Weight unit', small: true })),
    row('Distance', null, segmented([{ value: 'mi', label: 'mi' }, { value: 'km', label: 'km' }], set.distanceUnit, (v) => setSetting('distanceUnit', v), { label: 'Distance unit', small: true })),
    h('p.set-desc.pad', 'Each workout keeps the unit it was logged in; everything is shown converted to these units.'),
    h('div.set-row.col',
      h('div.set-text', h('span.set-label', 'Check off a habit when I log a workout'),
        h('span.set-desc', checkHabits.length ? 'Optional. Logging a matching workout checks the habit for that day; removing the workout un-checks it unless you checked it yourself.' : 'Optional. Create a check-off habit (e.g. “Exercise”) to use this.')),
      habitSel,
      linkedOk ? segmented([{ value: 'any', label: 'Any workout' }, { value: 'strength', label: 'Strength' }, { value: 'cardio', label: 'Cardio' }], wh.filter,
        (val) => setWorkoutHabit(wh.habitId, val), { label: 'Which workouts count', small: true }) : null,
      h('p.field-hint', 'Only check-off habits can be linked. Changing the habit removes the old habit’s automatic checks; your own checks stay.'))));

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
    }, icon('bell', { size: 16 }), 'Send test')) : null));

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
    h('p.set-desc.pad', 'Everything is stored only on this device. Export saves all profiles in one file.'),
    h('div.set-actions',
      h('button.btn.secondary', { type: 'button', onclick: exportData }, icon('download', { size: 18 }), 'Export JSON'),
      h('button.btn.secondary', { type: 'button', onclick: () => fileInput.click() }, icon('upload', { size: 18 }), 'Import JSON'),
      fileInput),
    h('div.set-actions',
      h('button.btn.ghost', { type: 'button', onclick: () => showOnboarding() }, icon('sparkles', { size: 18 }), 'Show welcome tour'),
      h('button.btn.danger-ghost', { type: 'button', onclick: resetAll }, icon('trash', { size: 18 }), `Reset ${profile.name}’s data`))));

  root.append(h('footer.about',
    h('p', h('b', 'Daily Tracker'), ` · version ${APP_VERSION}`),
    h('p.muted.small', 'Works offline · No account · No tracking'),
    h('p.muted.small', 'Profiles are for convenience and aren’t private from each other.')));
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
    toast('Backup downloaded', { force: true });
  } catch {
    toast('Export failed', { force: true });
  }
}

async function importFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { toast('That file is too large'); return; }
  try {
    const parsed = validateImport(JSON.parse(await file.text()));
    const counts = (d) => `${d.tasks.length} tasks, ${d.habits.length} habits and ${d.workouts.length} workouts`;
    if (parsed.kind === 'multi') {
      const names = parsed.profiles.map((p) => p.name).join(', ');
      const ok = await confirmDialog('Replace everything?',
        `This backup has ${parsed.profiles.length} profile${parsed.profiles.length === 1 ? '' : 's'} (${names}). It will replace all profiles and data on this device.`, { ok: 'Replace all', danger: true });
      if (!ok) return;
      // Profiles on this device that can't be read are never removed without a separate, explicit yes.
      const stuck = unreadableProfiles(parsed.profiles.map((p) => p.id));
      let deleteUnreadable = false;
      if (stuck.length) {
        const c = await choose('Keep unreadable profiles?',
          `${stuck.map((p) => p.name).join(', ')} can’t be read on this device (a backup copy is kept). Keep ${stuck.length === 1 ? 'it' : 'them'} next to the imported profiles?`, [
            { value: 'keep', label: 'Keep (recommended)', style: 'primary' },
            { value: 'delete', label: 'Delete permanently', style: 'danger' },
            { value: null, label: 'Cancel import', style: 'ghost' },
          ]);
        if (!c) return;
        deleteUnreadable = c === 'delete';
      }
      parsed.profiles.forEach((p) => { if (p.data) p.data.settings.onboarded = true; });
      if (!replaceAllProfiles(parsed, { deleteUnreadable })) { toast('Couldn’t import – this device’s storage is full', { force: true }); return; }
      toast('Backup imported');
      return;
    }
    // Older single-profile backup: replace the current profile or add it as a new one.
    const data = parsed.data;
    data.settings.onboarded = true;
    const profile = getActiveProfile();
    const choice = await choose('Import backup', `This backup has ${counts(data)}.`, [
      { value: 'add', label: 'Add as new profile', style: 'primary' },
      { value: 'replace', label: `Replace ${profile.name}’s data`, style: 'danger' },
      { value: null, label: 'Cancel', style: 'ghost' },
    ]);
    if (choice === 'replace') { replaceState(data); toast('Backup imported'); }
    if (choice === 'add') {
      if (addProfile({ name: 'Imported', data })) toast('Backup added as profile “Imported” – rename it from the profile menu');
      else toast('Couldn’t import – this device’s storage is full', { force: true });
    }
  } catch (e) {
    toast(e instanceof SyntaxError ? 'That file is not valid JSON' : (e.message || 'Import failed'), { duration: 6000 });
  }
}

async function resetAll() {
  const name = getActiveProfile().name;
  if (!(await confirmDialog(`Reset ${name}’s data?`, `This deletes ${name}’s tasks, habits, workouts and journal on this device. Other profiles are kept.`, { ok: 'Yes, continue', danger: true }))) return;
  if (!(await confirmDialog('Are you absolutely sure?', 'This cannot be undone. Consider exporting a backup first.', { ok: 'Delete everything', danger: true }))) return;
  const fresh = defaultState();
  fresh.settings = { ...getState().settings, onboarded: true, notifications: false, workoutHabit: { habitId: null, filter: 'any' } };
  replaceState(fresh);
  ctx.setDate(todayKey());
  toast(`${name}’s data was reset`);
}
