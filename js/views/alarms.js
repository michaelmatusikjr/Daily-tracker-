import { h, iconBtn, segmented, openSheet, toast, confirmDialog, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { getState, update, uid } from '../store.js';
import { ctx } from '../ctx.js';
import { fmtTime, weekdayLabels, pad } from '../dates.js';
import { nextAlarm, nextOccurrence, untilLabel, repeatLabel, missedAlarms, clearMissed, snoozeInfo, resetAlarmRuntime } from '../alarms.js';
import { TONES, previewTone, unlockAudio, stopTone } from '../audio.js';
import { openBedside } from '../alarmScreens.js';
import { openScanner } from '../scanner.js';

const msToHHMM = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function renderAlarms() {
  const st = getState();
  const fmt = st.settings.timeFormat;
  const dayNames = weekdayLabels('short');
  const n = nextAlarm();
  const root = h('div.view.view-alarms');
  root.append(h('header.page-head.detail-head',
    iconBtn('arrowLeft', 'Back to Today', () => ctx.go('today')),
    h('div.page-head-text',
      h('p.eyebrow', n ? `Next ${fmtTime(msToHHMM(n.at), fmt)} · ${untilLabel(n.at)}` : 'No alarm on'),
      h('h1.page-title', 'Alarms'))));

  for (const m of missedAlarms()) {
    root.append(h('div.card.missed-card', { role: 'alert' },
      icon('alert', { size: 20 }),
      h('div.missed-text',
        h('b', `Missed alarm at ${fmtTime(m.time, fmt)}`),
        h('span', `${m.label ? m.label + ' · ' : ''}${new Date(m.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} – the app wasn’t open.`)),
      h('button.btn.small.secondary', { type: 'button', 'aria-label': `Dismiss missed alarm at ${fmtTime(m.time, fmt)}`, onclick: () => { clearMissed(m); ctx.rerender(); } }, 'Dismiss')));
  }

  root.append(h('section.card.bedside-card',
    h('div.bedside-card-text',
      h('p.bedside-card-title', icon('moon', { size: 18 }), 'Bedside mode'),
      h('p.set-desc', 'Keep Daily Tracker open on Bedside mode for alarms to ring. Phones don’t allow web apps to ring when closed or locked – keep the phone plugged in.')),
    h('button.btn.primary', { type: 'button', onclick: () => openBedside(), disabled: !st.alarms.some((a) => a.enabled) && !n },
      icon('moon', { size: 18 }), 'Start Bedside mode')));

  if (!st.alarms.length) {
    root.append(h('section.card', emptyState('⏰', 'No alarms yet',
      'Set an alarm, then leave the app on Bedside mode overnight. You can require scanning a code to turn it off.',
      h('button.btn.primary', { type: 'button', onclick: () => openAlarmForm(null) }, icon('plus', { size: 18 }), 'New alarm'))));
  } else {
    const list = h('ul.alarm-list');
    const sorted = [...st.alarms].sort((a, b) => a.time.localeCompare(b.time));
    for (const a of sorted) {
      const sn = snoozeInfo(a.id);
      const snoozedUntil = sn && sn.until > Date.now() ? sn.until : null;
      const nextAt = a.enabled ? nextOccurrence(a) : null;
      const sub = [repeatLabel(a, dayNames)];
      if (snoozedUntil) sub.push(`Snoozed until ${fmtTime(msToHHMM(snoozedUntil), fmt)}`);
      else if (nextAt) sub.push(untilLabel(nextAt));
      list.append(h(`li.alarm-card${a.enabled ? '' : '.off'}`, { dataset: { id: a.id } },
        h('button.alarm-main', { type: 'button', onclick: () => openAlarmForm(a), 'aria-label': `Edit alarm ${fmtTime(a.time, fmt)} ${a.label}` },
          h('span.alarm-time', fmtTime(a.time, fmt)),
          h('span.alarm-meta',
            a.label ? h('span.alarm-label', a.label) : null,
            h('span.alarm-sub', sub.join(' · '),
              a.dismiss === 'scan' ? h('span.alarm-tag', { title: 'Scan a code to stop' }, icon('qr', { size: 13 }), 'Scan') : null))),
        h('button.switch', {
          type: 'button', role: 'switch', 'aria-checked': String(a.enabled), 'aria-label': `Alarm ${fmtTime(a.time, fmt)} on`,
          onclick: () => setEnabled(a.id, !a.enabled),
        }, h('span.knob'))));
    }
    root.append(h('section.section', list));
  }

  // Registered codes
  const codes = st.codes;
  root.append(h('section.set-group',
    h('h2.set-title', 'Scan-to-stop codes'),
    h('div.card.set-card',
      h('p.set-desc.pad', 'Register a QR code or barcode somewhere away from bed (e.g. a product in the bathroom). A “Scan to stop” alarm only stops when you scan it.'),
      codes.length ? h('ul.code-list', codes.map((c) => h('li.code-item',
        h('span.code-icon', { 'aria-hidden': 'true' }, icon('qr', { size: 18 })),
        h('span.code-text', h('b', c.nickname), h('small', `${prettyFormat(c.format)} · ${maskValue(c.value)}`)),
        iconBtn('trash', `Delete code ${c.nickname}`, () => deleteCode(c))))) : null,
      h('div.set-actions', h('button.btn.secondary', { type: 'button', onclick: () => registerCode() }, icon('camera', { size: 18 }), 'Register a code')))));

  if (!('Notification' in window) || Notification.permission !== 'granted') {
    root.append(h('p.hint-line', 'Tip: allow notifications in Settings to also get a notification when an alarm rings (best effort).'));
  }
  return root;
}

function setEnabled(id, on) {
  if (on) unlockAudio();
  resetAlarmRuntime(id);
  update((s) => { const a = s.alarms.find((x) => x.id === id); if (a) { a.enabled = on; if (on) a.armedAt = Date.now(); } });
  if (on) announceNext(id);
}

function announceNext(id) {
  const a = getState().alarms.find((x) => x.id === id);
  const at = a && nextOccurrence(a);
  if (!at) return;
  toast(`Alarm set for ${fmtTime(a.time, getState().settings.timeFormat)}, ${untilLabel(at)}. Keep the app on Bedside mode.`, {
    action: 'Bedside', duration: 7000, onAction: () => openBedside(),
  });
}

const prettyFormat = (f) => {
  if (!f || f === 'manual') return 'Typed code';
  if (f.includes('qr')) return 'QR code';
  return 'Barcode ' + f.replace(/_/g, '-').toUpperCase();
};
const maskValue = (v) => (v.length <= 8 ? v : `${v.slice(0, 4)}…${v.slice(-4)}`);

async function deleteCode(c) {
  const st = getState();
  const scanAlarms = st.alarms.filter((a) => a.dismiss === 'scan');
  const lastCodeLeft = st.codes.length === 1;
  // Alarms that would have no code left: locked only to this code, or "any code" when it's the last one.
  const orphaned = scanAlarms.filter((a) => (a.codeIds.length && a.codeIds.every((id) => id === c.id)) || (!a.codeIds.length && lastCodeLeft));
  const n = orphaned.length;
  const msg = n
    ? `${n} scan-to-stop alarm${n === 1 ? ' only uses' : 's only use'} this code and will switch to the normal Stop button.`
    : 'You can register it again later.';
  if (!(await confirmDialog(`Delete “${c.nickname}”?`, msg, { ok: 'Delete', danger: true }))) return;
  const orphanIds = new Set(orphaned.map((a) => a.id));
  update((s) => {
    s.codes = s.codes.filter((x) => x.id !== c.id);
    for (const a of s.alarms) {
      // Keep alarms locked to the codes that remain – never widen to "any code".
      a.codeIds = a.codeIds.filter((x) => x !== c.id);
      if (orphanIds.has(a.id)) { a.dismiss = 'normal'; a.codeIds = []; }
    }
  });
  if (n) toast(`${n} alarm${n === 1 ? '' : 's'} switched to the Stop button`);
}

/** Scan (or type) a code and save it with a nickname. Calls done(code) on success. */
export function registerCode(done) {
  let found = null;
  openScanner({
    title: 'Register a code',
    hint: 'Scan a QR code or a product barcode you’ll keep away from your bed.',
    manualEntry: true,
    onCode: (res) => {
      const dup = getState().codes.find((c) => c.value === res.value);
      if (dup) return `Already registered as “${dup.nickname}”`;
      found = res;
      return true;
    },
    onClose: () => { if (found) nameCode(found, done); },
  });
}

function nameCode(res, done) {
  const isQr = (res.format || '').includes('qr');
  const input = h('input.input', { type: 'text', maxlength: 40, value: isQr ? 'QR code' : 'Bathroom barcode', autofocus: true, 'aria-label': 'Nickname' });
  const save = () => {
    const code = { id: uid(), value: res.value.slice(0, 500), format: res.format || '', nickname: input.value.trim() || 'My code', createdAt: Date.now() };
    update((s) => { s.codes.push(code); });
    sheet.close();
    toast(`Code “${code.nickname}” registered`);
    done?.(code);
  };
  const sheet = openSheet({
    title: 'Name this code',
    content: h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); } },
      h('p.set-desc', `${prettyFormat(res.format)} · ${maskValue(res.value)}`),
      h('div.field', h('label.field-label', 'Nickname'), input)),
    footer: [h('span'), h('button.btn.primary', { type: 'button', onclick: save }, 'Save code')],
  });
}

// ---------------- Alarm form ----------------
export function openAlarmForm(alarm) {
  const isNew = !alarm;
  const d = alarm ? JSON.parse(JSON.stringify(alarm)) : {
    time: defaultTime(), label: '', days: [1, 2, 3, 4, 5], enabled: true, tone: 'classic', gradual: true,
    snoozeMin: 10, maxSnoozes: 3, vibrate: true, dismiss: 'normal', scanSnooze: false, codeIds: [],
  };
  const st = getState();
  const time = h('input.input.alarm-time-input', { type: 'time', value: d.time, required: true, 'aria-label': 'Alarm time' });
  const label = h('input.input', { type: 'text', value: d.label, maxlength: 60, placeholder: 'Label (optional)', 'aria-label': 'Label' });

  // Repeat: presets + day chips (no days selected = once)
  const names = weekdayLabels('short'), longNames = weekdayLabels('long');
  const order = Array.from({ length: 7 }, (_, i) => (st.settings.weekStart + i) % 7);
  const days = new Set(d.days);
  const chips = h('div.day-chips');
  const presetWrap = h('div.chips.presets');
  const repeatNote = h('p.field-hint');
  const renderRepeat = () => {
    chips.replaceChildren(...order.map((i) => h('button.day-chip', {
      type: 'button', 'aria-pressed': String(days.has(i)), 'aria-label': longNames[i],
      onclick: () => { if (days.has(i)) days.delete(i); else days.add(i); renderRepeat(); },
    }, names[i].slice(0, 2))));
    const cur = [...days].sort().join();
    const presets = [['Once', ''], ['Weekdays', '1,2,3,4,5'], ['Every day', '0,1,2,3,4,5,6']];
    presetWrap.replaceChildren(...presets.map(([lbl, val]) => h('button.chip', {
      type: 'button', role: 'radio', 'aria-checked': String(cur === val),
      onclick: () => { days.clear(); if (val) val.split(',').forEach((x) => days.add(Number(x))); renderRepeat(); },
    }, lbl)));
    repeatNote.textContent = days.size ? '' : 'Rings once, then turns itself off.';
  };
  renderRepeat();

  // Tone
  const toneList = h('div.tone-list', { role: 'radiogroup', 'aria-label': 'Tone' });
  const renderTones = () => toneList.replaceChildren(...TONES.map((t) => h(`div.tone-row${d.tone === t.id ? '.selected' : ''}`,
    h('button.tone-pick', { type: 'button', role: 'radio', 'aria-checked': String(d.tone === t.id), onclick: () => { d.tone = t.id; renderTones(); } },
      h('span.radio-dot', { 'aria-hidden': 'true' }), h('span', h('b', t.name), h('small', t.desc))),
    h('button.btn.small.ghost', { type: 'button', 'aria-label': `Preview ${t.name}`, onclick: () => previewTone(t.id) }, icon('play', { size: 14 }), 'Preview'))));
  renderTones();
  const switchRow = (labelText, desc, key, disabled = false) => {
    const btn = h('button.switch', {
      type: 'button', role: 'switch', 'aria-checked': String(!!d[key]), 'aria-label': labelText, disabled,
      onclick: () => { d[key] = !d[key]; btn.setAttribute('aria-checked', String(d[key])); },
    }, h('span.knob'));
    return h('div.set-row.compact', h('div.set-text', h('span.set-label', labelText), desc ? h('span.set-desc', desc) : null), btn);
  };

  // Snooze
  const snooze = segmented([5, 10, 15].map((v) => ({ value: v, label: `${v} min` })), d.snoozeMin, (v) => { d.snoozeMin = v; }, { label: 'Snooze length', small: true });
  const maxSel = h('select.input', { 'aria-label': 'Maximum snoozes', onchange: (e) => { d.maxSnoozes = Number(e.target.value); } },
    [[0, 'No snooze'], [1, '1 time'], [2, '2 times'], [3, '3 times'], [5, '5 times'], [10, '10 times']].map(([v, l]) => h('option', { value: String(v), selected: d.maxSnoozes === v }, l)));

  // Dismiss method
  const scanBox = h('div.scan-box');
  const renderScanBox = () => {
    const codes = getState().codes;
    if (d.dismiss !== 'scan') { scanBox.replaceChildren(); return; }
    scanBox.replaceChildren(
      codes.length
        ? h('div.field', h('span.field-label', 'Codes that stop it'),
          h('div.chips', codes.map((c) => h('button.chip', {
            type: 'button', role: 'checkbox', 'aria-checked': String(!d.codeIds.length || d.codeIds.includes(c.id)),
            onclick: () => {
              const all = codes.map((x) => x.id);
              let sel = d.codeIds.length ? [...d.codeIds] : [...all];
              sel = sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id];
              if (!sel.length) return; // keep at least one
              d.codeIds = sel.length === all.length ? [] : sel;
              renderScanBox();
            },
          }, icon('qr', { size: 14 }), c.nickname))))
        : h('p.field-warn', icon('alert', { size: 16 }), 'Register a code first – scan any QR code or barcode you keep away from your bed.'),
      h('button.btn.secondary.small', { type: 'button', onclick: () => registerCode(() => renderScanBox()) }, icon('camera', { size: 16 }), 'Register a code'),
      switchRow('Allow snooze', 'Off = only scanning (or the emergency math) stops it.', 'scanSnooze'),
      h('p.field-hint', 'If the camera fails or the code is lost, hold “Emergency stop” for 3 s and solve 3 math problems.'));
  };
  const dismiss = segmented([{ value: 'normal', label: 'Stop button' }, { value: 'scan', label: 'Scan to stop', icon: 'qr' }], d.dismiss,
    (v) => { d.dismiss = v; renderScanBox(); }, { label: 'How to stop' });
  renderScanBox();

  const err = h('p.form-error', { role: 'alert' });
  const vibrateSupported = 'vibrate' in navigator;
  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    h('div.field', h('label.field-label', { for: 'alarm-time' }, 'Time'), time),
    h('div.field', h('label.field-label', { for: 'alarm-label' }, 'Label'), label),
    h('div.field', { role: 'group', 'aria-label': 'Repeat' }, h('span.field-label', 'Repeat'), presetWrap, chips, repeatNote),
    h('div.field', { role: 'group', 'aria-label': 'Sound' }, h('span.field-label', 'Sound'), toneList,
      switchRow('Gradually louder', 'Starts quiet and reaches full volume in about 45 s.', 'gradual'),
      switchRow('Vibrate', vibrateSupported ? null : 'Not supported on this device (e.g. iPhone).', 'vibrate', !vibrateSupported)),
    h('div.field', { role: 'group', 'aria-label': 'Snooze' }, h('span.field-label', 'Snooze'), snooze, maxSel),
    h('div.field', { role: 'group', 'aria-label': 'How to stop' }, h('span.field-label', 'How to stop'), dismiss, scanBox),
    h('p.field-hint', 'Alarms ring only while Daily Tracker is open – use Bedside mode overnight.'),
    err);
  time.id = 'alarm-time'; label.id = 'alarm-label';

  function save() {
    if (!/^\d{2}:\d{2}$/.test(time.value)) { err.textContent = 'Please choose a time.'; time.focus(); return; }
    if (d.dismiss === 'scan' && !getState().codes.length) { err.textContent = 'Register a code first, or choose “Stop button”.'; return; }
    unlockAudio(); // this tap lets the alarm play sound later
    stopTone();
    const data = {
      time: time.value, label: label.value.trim(), days: [...days].sort(), enabled: true, armedAt: Date.now(),
      tone: d.tone, gradual: !!d.gradual, snoozeMin: d.snoozeMin, maxSnoozes: d.maxSnoozes, vibrate: !!d.vibrate,
      dismiss: d.dismiss, scanSnooze: !!d.scanSnooze, codeIds: d.codeIds,
    };
    let id = alarm?.id;
    if (id) resetAlarmRuntime(id);
    update((s) => {
      const ex = id && s.alarms.find((x) => x.id === id);
      if (ex) Object.assign(ex, data);
      else { id = uid(); s.alarms.push({ id, createdAt: Date.now(), ...data }); }
    });
    sheet.close();
    announceNext(id);
  }

  const footer = [
    !isNew ? h('button.btn.danger-ghost', {
      type: 'button',
      onclick: async () => {
        if (!(await confirmDialog('Delete alarm?', `${fmtTime(alarm.time, st.settings.timeFormat)}${alarm.label ? ' · ' + alarm.label : ''}`, { ok: 'Delete', danger: true }))) return;
        resetAlarmRuntime(alarm.id);
        update((s) => { s.alarms = s.alarms.filter((x) => x.id !== alarm.id); });
        sheet.close();
        toast('Alarm deleted');
      },
    }, icon('trash', { size: 18 }), 'Delete') : h('span'),
    h('button.btn.primary', { type: 'button', onclick: save }, isNew ? 'Set alarm' : 'Save'),
  ];
  const sheet = openSheet({ title: isNew ? 'New alarm' : 'Edit alarm', content: form, footer, onClose: () => stopTone() });
}

function defaultTime() {
  return '07:00';
}
