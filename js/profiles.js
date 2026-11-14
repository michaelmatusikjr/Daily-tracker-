// Profile UI: avatar, profile menu, profile editor, first-open intro and photo processing.
import { h, openSheet, toast, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { getProfiles, getActiveProfile, switchProfile, addProfile, updateProfile, deleteProfile, PROFILE_COLORS } from './store.js';
import { ctx } from './ctx.js';
import { afterDataRemoved } from './push.js';

const AVATAR_EMOJIS = ['', '😀', '😎', '🦊', '🐼', '🐱', '🐶', '🦁', '🐸', '🌻', '⭐', '🚀', '⚽', '🎧', '🌈', '🍀'];

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const chars = (s) => [...s];
  return (parts.length > 1 ? chars(parts[0])[0] + chars(parts[parts.length - 1])[0] : chars(parts[0]).slice(0, 2).join('')).toUpperCase();
}

/** Round avatar: photo, emoji or initials on a colour. Decorative unless a label is given. */
export function avatarEl(profile, size = 40, label = null) {
  const a = profile?.avatar || {};
  const attrs = { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' } };
  if (label) { attrs.role = 'img'; attrs['aria-label'] = label; } else attrs['aria-hidden'] = 'true';
  if (a.type === 'photo') return h('span.avatar.photo', attrs, h('img', { src: a.data, alt: '', width: size, height: size, decoding: 'async' }));
  attrs.style.background = a.color || PROFILE_COLORS[0];
  return h('span.avatar', attrs, a.emoji ? h('span.avatar-emoji', a.emoji) : h('span.avatar-initials', initials(profile?.name)));
}

/** Center-crop + resize an image file to a ~192px JPEG data URL. Honours EXIF orientation. */
export async function processPhoto(file, size = 192) {
  if (!file) throw new Error('No file chosen.');
  if (!/^image\//.test(file.type)) throw new Error('That file isn’t an image.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is too large (max 25 MB).');
  let src, w, hgt, cleanup = () => {};
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; hgt = src.height;
    cleanup = () => src.close?.();
  } catch {
    // Fallback: <img> applies EXIF orientation itself in current browsers.
    const url = URL.createObjectURL(file);
    try {
      src = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode'));
        img.src = url;
      });
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('That image couldn’t be read.');
    }
    w = src.naturalWidth; hgt = src.naturalHeight;
    cleanup = () => URL.revokeObjectURL(url);
  }
  try {
    if (!w || !hgt) throw new Error('That image couldn’t be read.');
    const side = Math.min(w, hgt);
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, size, size);
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, (w - side) / 2, (hgt - side) / 2, side, side, 0, 0, size, size);
    let data = canvas.toDataURL('image/jpeg', 0.8);
    if (data.length > 140000) data = canvas.toDataURL('image/jpeg', 0.6);
    if (!data.startsWith('data:image/jpeg')) throw new Error('That image couldn’t be converted.');
    return data;
  } finally { cleanup(); }
}

// ---------------- Profile menu ----------------
export function openProfileMenu() {
  const profiles = getProfiles();
  const active = getActiveProfile();
  const list = h('ul.profile-list', { role: 'list' }, profiles.map((p) => h('li',
    h(`button.profile-item${p.id === active.id ? '.active' : ''}`, {
      type: 'button', 'aria-current': p.id === active.id ? 'true' : null,
      'aria-label': p.id === active.id ? `${p.name} (current profile)` : `Switch to ${p.name}`,
      onclick: () => {
        if (p.id === active.id) { sheet.close(); return; }
        sheet.close();
        if (switchProfile(p.id)) toast(`Switched to ${p.name}`);
      },
    }, avatarEl(p, 44), h('span.profile-name', p.name), p.id === active.id ? icon('check', { size: 20, cls: 'profile-check' }) : null))));
  const action = (ic, label, onclick, cls = '') => h(`button.menu-item${cls}`, { type: 'button', onclick }, icon(ic, { size: 20 }), h('span', label));
  const content = [
    list,
    h('div.menu-items',
      action('plus', 'Add profile', () => { sheet.close(); openProfileEditor(null); }),
      action('edit', `Edit ${active.name}`, () => { sheet.close(); openProfileEditor(active); }),
      action('settings', 'Settings', () => { sheet.close(); ctx.go('settings'); }),
      profiles.length > 1 ? action('trash', `Delete ${active.name}`, async () => {
        sheet.close();
        await confirmDeleteProfile(active);
      }, '.danger') : null),
    h('p.field-hint.menu-note', 'Profiles keep separate data on this device. They aren’t locked or private from each other.'),
  ];
  const sheet = openSheet({ title: 'Profiles', content });
}

async function confirmDeleteProfile(p) {
  if (!(await confirmDialog(`Delete ${p.name}?`, `All of ${p.name}’s tasks, habits, workouts, journal and settings will be removed from this device.`, { ok: 'Continue', danger: true }))) return;
  if (!(await confirmDialog('Are you absolutely sure?', 'This cannot be undone. Export a backup first if you might need it.', { ok: `Delete ${p.name}`, danger: true }))) return;
  if (deleteProfile(p.id)) { toast(`Deleted ${p.name}. Switched to ${getActiveProfile().name}`); afterDataRemoved(); }
}

// ---------------- Profile editor ----------------
/** Create (profile = null) or edit a profile. intro: the first-open "who's this?" sheet. */
export function openProfileEditor(profile, { intro = false, onDone = null } = {}) {
  const isNew = !profile;
  const used = new Set(getProfiles().map((p) => p.avatar?.color));
  let avatar = profile ? { ...profile.avatar } : { type: 'emoji', emoji: '', color: PROFILE_COLORS.find((c) => !used.has(c)) || PROFILE_COLORS[0] };
  const name = h('input.input', { type: 'text', maxlength: 40, value: profile && !intro ? profile.name : '', placeholder: intro ? 'Your name' : 'Name', autofocus: true, autocomplete: 'given-name', 'aria-label': 'Name' });
  const preview = h('div.avatar-preview');
  const err = h('p.form-error', { role: 'alert' });
  const renderPreview = () => preview.replaceChildren(avatarEl({ name: name.value || profile?.name || '', avatar }, 72, 'Avatar preview'));
  name.addEventListener('input', renderPreview);

  const emojiRow = h('div.emoji-grid.avatar-emojis', { role: 'radiogroup', 'aria-label': 'Avatar emoji' });
  const colorRow = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Avatar colour' });
  const renderChoices = () => {
    emojiRow.replaceChildren(...AVATAR_EMOJIS.map((e) => h('button.emoji-btn', {
      type: 'button', role: 'radio', 'aria-checked': String(avatar.type === 'emoji' && (avatar.emoji || '') === e), 'aria-label': e || 'Initials',
      onclick: () => { avatar = { type: 'emoji', emoji: e, color: avatar.color || PROFILE_COLORS[0] }; renderChoices(); renderPreview(); },
    }, e || h('span.initials-chip', 'Aa'))));
    colorRow.replaceChildren(...PROFILE_COLORS.map((c) => h('button.swatch', {
      type: 'button', role: 'radio', 'aria-checked': String(avatar.type !== 'photo' && avatar.color === c), 'aria-label': c, style: { '--c': c },
      onclick: () => { avatar = { type: 'emoji', emoji: avatar.type === 'emoji' ? avatar.emoji : '', color: c }; renderChoices(); renderPreview(); },
    })));
  };
  renderChoices(); renderPreview();

  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Choose a photo' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    err.textContent = '';
    try {
      avatar = { type: 'photo', data: await processPhoto(f) };
      renderChoices(); renderPreview();
    } catch (e) { err.textContent = e.message || 'That image couldn’t be used.'; }
  });
  const photoBtns = h('div.set-actions',
    h('button.btn.secondary.small', { type: 'button', onclick: () => file.click() }, icon('upload', { size: 16 }), 'Choose photo'),
    file);

  const save = () => {
    const n = name.value.trim() || (intro ? 'Me' : '');
    if (!n) { err.textContent = 'Please enter a name.'; name.focus(); return; }
    let ok;
    if (isNew) ok = !!addProfile({ name: n, avatar });
    else ok = updateProfile(profile.id, { name: n, avatar });
    if (!ok) { err.textContent = 'Couldn’t save – this device’s storage is full. Try a smaller photo or remove old data.'; return; }
    sheet.close();
    if (isNew) toast(`Added ${n}. Switched to ${n}`);
    onDone?.();
  };
  const content = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    intro ? h('p.set-desc', 'Daily Tracker now supports several people on one device. What should we call you?') : null,
    h('div.profile-edit-top', preview, h('div.field', h('label.field-label', 'Name'), name)),
    h('div.field', { role: 'group', 'aria-label': 'Avatar' }, h('span.field-label', 'Avatar'), photoBtns, emojiRow, colorRow),
    err);
  const footer = [
    intro ? h('button.btn.ghost', { type: 'button', onclick: () => { updateProfile(profile.id, { name: profile.name || 'Me' }); sheet.close(); onDone?.(); } }, 'Skip') : h('span'),
    h('button.btn.primary', { type: 'button', onclick: save }, isNew ? 'Add profile' : intro ? 'Continue' : 'Save'),
  ];
  const sheet = openSheet({ title: intro ? 'Who’s this?' : isNew ? 'Add profile' : 'Edit profile', content, footer, onClose: () => { if (intro && getActiveProfile()?.introPending) updateProfile(profile.id, { name: profile.name || 'Me' }); } });
}

