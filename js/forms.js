// Bottom-sheet forms: quick add, task editor, habit editor.
import { h, openSheet, segmented, toast, iconBtn } from './ui.js';
import { icon } from './icons.js';
import { getState, update, uid } from './store.js';
import { ctx } from './ctx.js';
import { parseQuick } from './parse.js';
import { saveTask, deleteTask, saveHabit } from './actions.js';
import { PRIORITIES } from './logic.js';
import { openWorkoutForm } from './workoutForm.js';
import { reminderStatus, reminderProblem, ensureReminderPermission } from './reminders.js';
import { closeAllSheets } from './ui.js';
import { dow, fmtTime, fmtDuration, relativeLabel, weekdayLabels, isValidKey, todayKey } from './dates.js';

export const HABIT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#0ea5e9', '#64748b'];
const CATEGORY_COLORS = ['#3b82f6', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b'];
export const EMOJIS = ['✅', '💧', '🏃', '🧘', '📚', '✍️', '🥗', '🍎', '😴', '🛏️', '🦷', '💊', '🧠', '🎯', '💪', '🚶', '🚴', '🏊', '🎸', '🎨', '🧹', '🌱', '☀️', '🌙', '📵', '💰', '🙏', '❤️', '📝', '🗣️', '☕', '🚭'];

/** First user-perceived character (keeps ZWJ emoji like 👩‍💻 intact). */
function firstGrapheme(str) {
  if (!str) return '';
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)[Symbol.iterator]().next().value;
      return first ? first.segment : '';
    }
  } catch { /* fall through */ }
  const m = str.match(/^(?:\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\uFE0F|\p{EMod})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{EMod})?)*|.)/su);
  return m ? m[0] : [...str][0];
}

/** Live note under a reminder field: explains if the reminder can't fire and how to fix it. */
function reminderNotice(hasReminder) {
  const el = h('div.reminder-note', { role: 'status', 'aria-live': 'polite' });
  const refresh = () => {
    if (!hasReminder()) { el.replaceChildren(); el.hidden = true; return; }
    el.hidden = false;
    const status = reminderStatus();
    const problem = reminderProblem(status);
    if (!problem || status === 'default' || status === 'off') {
      // 'default'/'off' are fixed automatically when the reminder is chosen or saved.
      el.className = 'reminder-note ok';
      el.replaceChildren(icon('bell', { size: 15 }), h('span', 'You’ll get a notification while Daily Tracker is open or was recently used.'));
      return;
    }
    el.className = 'reminder-note warn';
    el.replaceChildren(icon('bellOff', { size: 15 }), h('span', problem,
      status === 'needs-install' ? h('button.link-btn.inline', {
        type: 'button', onclick: () => { closeAllSheets(); ctx.go('settings'); setTimeout(() => document.getElementById('set-install')?.scrollIntoView({ block: 'center' }), 350); },
      }, 'How to add it') : null));
  };
  refresh();
  return { el, refresh };
}

function field(label, control, hint = null, id = null) {
  const fid = id || 'f-' + Math.random().toString(36).slice(2, 8);
  if (control instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) control.id = fid;
  return h('div.field',
    h('label.field-label', { for: fid }, label),
    control,
    hint ? h('p.field-hint', hint) : null);
}

function groupField(label, control, hint = null) {
  return h('div.field', { role: 'group', 'aria-label': label }, h('span.field-label', label), control, hint ? h('p.field-hint', hint) : null);
}

function select(options, value, attrs = {}) {
  return h('select.input', attrs, options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));
}

function orderedDays() {
  const ws = getState().settings.weekStart;
  return Array.from({ length: 7 }, (_, i) => (ws + i) % 7);
}

export function dayChips(selected, onChange) {
  const names = weekdayLabels('short');
  const set = new Set(selected);
  const wrap = h('div.day-chips');
  for (const d of orderedDays()) {
    const b = h('button.day-chip', {
      type: 'button', 'aria-pressed': String(set.has(d)), 'aria-label': weekdayLabels('long')[d],
      onclick: () => {
        if (set.has(d)) { if (set.size > 1) set.delete(d); } else set.add(d);
        b.setAttribute('aria-pressed', String(set.has(d)));
        onChange([...set].sort());
      },
    }, names[d].slice(0, 2));
    wrap.append(b);
  }
  return wrap;
}

function stepper(value, min, max, onChange, label) {
  let v = value;
  const out = h('output.stepper-val', { 'aria-live': 'polite' }, String(v));
  const set = (n) => { v = Math.max(min, Math.min(max, n)); out.textContent = String(v); onChange(v); };
  return h('div.stepper', { role: 'group', 'aria-label': label },
    iconBtn('minus', 'Decrease', () => set(v - 1)), out, iconBtn('plus', 'Increase', () => set(v + 1)));
}

function swatches(colors, value, onChange, label) {
  const wrap = h('div.swatches', { role: 'radiogroup', 'aria-label': label });
  const btns = colors.map((c) => {
    const b = h('button.swatch', {
      type: 'button', role: 'radio', 'aria-checked': String(c === value), 'aria-label': c, style: { '--c': c },
      onclick: () => { btns.forEach((x) => x.setAttribute('aria-checked', String(x === b))); onChange(c); },
    });
    return b;
  });
  wrap.append(...btns);
  return wrap;
}

export function findCategory(name) {
  return getState().categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id || null;
}

/** Find a category by name (case-insensitive) or create it. Returns id. */
export function ensureCategory(name) {
  const st = getState();
  const found = st.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const id = uid();
  const color = CATEGORY_COLORS[st.categories.length % CATEGORY_COLORS.length];
  const nice = name.charAt(0).toUpperCase() + name.slice(1);
  update((s) => { s.categories.push({ id, name: nice, color }); }, { silent: true });
  return id;
}

// ---------------- Quick add ----------------
export function openQuickAdd() {
  const st = getState();
  const input = h('input.input.qa-input', {
    type: 'text', placeholder: 'Try “Gym 6pm” or “Call mom tomorrow 14:30”', autofocus: true,
    'aria-label': 'New task', enterkeyhint: 'done', autocomplete: 'off', maxlength: 200, spellcheck: 'true',
  });
  const preview = h('div.qa-preview');
  const ignore = { date: false, time: false, duration: false }; // guesses the user tapped away
  const parsed = () => {
    const p = parseQuick(input.value, todayKey(), { noDate: ignore.date, noTime: ignore.time, noDuration: ignore.duration });
    p.date = p.date || ctx.ui.date;
    return p;
  };
  const NAMES = { date: 'date', time: 'time', duration: 'duration' };
  function renderPreview() {
    if (!input.value.trim()) Object.keys(ignore).forEach((k) => { ignore[k] = false; });
    const p = parsed();
    const full = parseQuick(input.value, todayKey());
    const chip = (ic, text, cls = '') => h(`span.pchip${cls ? '.' + cls : ''}`, icon(ic, { size: 14 }), text);
    // A recognised guess is a button: tapping it drops the guess and keeps the words in the title.
    const guess = (key, ic, text) => h('button.pchip.guess', {
      type: 'button', title: `Keep “${p.parts[key]}” in the title`,
      'aria-label': `${NAMES[key]}: ${text}. Tap to keep “${p.parts[key]}” in the title instead`,
      onclick: () => { ignore[key] = true; renderPreview(); input.focus(); },
    }, icon(ic, { size: 14 }), text, icon('x', { size: 12, cls: 'pchip-x' }));
    const restore = (key) => h('button.pchip.muted.restore', {
      type: 'button', 'aria-label': `Use “${full.parts[key]}” as the ${NAMES[key]} again`,
      onclick: () => { Object.keys(ignore).forEach((k) => { if (k === key || !full.parts[k]) ignore[k] = false; }); renderPreview(); input.focus(); },
    }, icon('refresh', { size: 12 }), `“${full.parts[key]}” as ${NAMES[key]}`);
    const fmt = st.settings.timeFormat;
    const chips = [];
    chips.push(p.parts.date ? guess('date', 'calendar', relativeLabel(p.date)) : chip('calendar', relativeLabel(p.date)));
    if (p.time) chips.push(p.parts.time ? guess('time', 'clock', fmtTime(p.time, fmt)) : chip('clock', fmtTime(p.time, fmt)));
    if (p.duration) chips.push(guess('duration', 'clock', fmtDuration(p.duration)));
    if (!p.time && !p.duration) chips.push(chip('list', 'Anytime', 'muted'));
    if (p.priority) chips.push(chip('flag', PRIORITIES[p.priority].label, 'prio-' + p.priority));
    if (p.tag) chips.push(chip('tag', p.tag));
    // Offer a restore chip for every guess the full parse found but this one doesn't show.
    for (const key of Object.keys(ignore)) if (full.parts[key] && !p.parts[key]) chips.push(restore(key));
    const showTitle = input.value.trim() && p.title !== input.value.trim();
    preview.replaceChildren(...chips);
    titleLine.textContent = showTitle ? `Title: “${p.title}”` : '';
  }
  const titleLine = h('p.qa-title', { 'aria-live': 'polite' });
  input.addEventListener('input', renderPreview);
  renderPreview();

  const submit = () => {
    const raw = input.value.trim();
    if (!raw) {
      input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
      input.focus();
      return;
    }
    const p = parsed();
    const data = {
      title: p.title.slice(0, 200), date: p.date, time: p.time, duration: p.duration,
      priority: p.priority, category: p.tag ? ensureCategory(p.tag) : null,
    };
    saveTask(data);
    sheet.close();
    const where = relativeLabel(p.date);
    toast(`Added to ${where}${p.time ? ' at ' + fmtTime(p.time, st.settings.timeFormat) : ''}`,
      p.date !== ctx.ui.date ? { action: 'View', onAction: () => { ctx.setDate(p.date); ctx.go('today'); } } : {});
  };

  const form = h('form.qa-form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
    input,
    preview,
    titleLine,
    h('p.field-hint', 'Tap a guessed date or time to keep those words in the title. Understands today, tomorrow, weekdays, “6pm”, “18:00”, “at 9”, “for 30m”, “!!” priority and #tags.'),
    h('div.qa-actions',
      h('button.btn.ghost', {
        type: 'button',
        onclick: () => {
          const p = parsed();
          sheet.close();
          openTaskForm(null, {
            title: input.value.trim() ? p.title : '', date: p.date, time: p.time, duration: p.duration, priority: p.priority,
            category: p.tag ? findCategory(p.tag) : null, newCategory: p.tag && !findCategory(p.tag) ? p.tag : null,
          });
        },
      }, 'More options'),
      h('button.btn.primary', { type: 'submit' }, icon('plus', { size: 18 }), 'Add task')));

  const modeSwitch = segmented([
    { value: 'task', label: 'Task', icon: 'check' },
    { value: 'habit', label: 'Habit', icon: 'habits' },
    { value: 'workout', label: 'Workout', icon: 'dumbbell' },
  ], 'task', (v) => {
    if (v === 'habit') { sheet.close(); openHabitForm(null); }
    if (v === 'workout') { sheet.close(); openWorkoutForm(null); }
  }, { label: 'What to add' });

  const sheet = openSheet({ title: 'Quick add', content: [modeSwitch, form] });
}

// ---------------- Task form ----------------
export function openTaskForm(task, defaults = {}) {
  const st = getState();
  const isNew = !task;
  const d = task ? JSON.parse(JSON.stringify(task)) : {
    title: '', notes: '', date: ctx.ui.date, time: null, duration: null, priority: 0, category: null,
    reminder: null, recur: { type: 'none', days: [], interval: 2 }, ...defaults,
  };
  if (!d.recur) d.recur = { type: 'none', days: [], interval: 2 };
  // A #tag typed in quick add becomes a category only if the task is actually saved.
  const pendingCat = d.newCategory ? d.newCategory.charAt(0).toUpperCase() + d.newCategory.slice(1, 40) : null;
  delete d.newCategory;
  if (pendingCat) d.category = '__new';

  const title = h('input.input', { type: 'text', value: d.title, placeholder: 'What do you need to do?', maxlength: 200, autofocus: isNew && !d.title, required: true, autocomplete: 'off' });
  const notes = h('textarea.input', { rows: 2, placeholder: 'Notes (optional)', maxlength: 2000 }, d.notes || '');
  const date = h('input.input', { type: 'date', value: d.date, required: true });
  const time = h('input.input', { type: 'time', value: d.time || '' });
  const clearTime = h('button.btn.ghost.small', { type: 'button', onclick: () => { time.value = ''; syncTime(); } }, 'Clear');
  const duration = select([['', 'No duration'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']], d.duration || '');
  if (d.duration && ![15, 30, 45, 60, 90, 120, 180, 240].includes(d.duration)) duration.append(h('option', { value: String(d.duration), selected: true }, fmtDuration(d.duration)));
  const reminder = select([['', 'No reminder'], [0, 'At start time'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before']], d.reminder ?? '');
  const reminderField = field('Reminder', reminder);
  const timeExtras = h('div.grid-2', field('Duration', duration), reminderField);
  const taskNotice = reminderNotice(() => !!time.value && reminder.value !== '');
  // Choosing a reminder is a user gesture: ask for permission / switch notifications on right away.
  reminder.addEventListener('change', () => {
    taskNotice.refresh();
    if (reminder.value !== '') ensureReminderPermission().then(taskNotice.refresh);
  });
  function syncTime() {
    const has = !!time.value;
    reminderField.hidden = !has;
    taskNotice?.refresh();
    clearTime.hidden = !has;
  }
  time.addEventListener('input', syncTime);

  let priority = d.priority || 0;
  const prio = segmented(PRIORITIES.map((p) => ({ value: p.v, label: p.label })), priority, (v) => { priority = v; }, { label: 'Priority', small: true });
  prio.classList.add('prio-seg');

  // Categories
  let category = d.category;
  const catWrap = h('div.chips', { role: 'radiogroup', 'aria-label': 'Category' });
  function renderCats() {
    const cats = getState().categories;
    const mk = (id, name, color) => h('button.chip', {
      type: 'button', role: 'radio', 'aria-checked': String(category === id), style: color ? { '--c': color } : null,
      onclick: () => { category = id; renderCats(); },
    }, color ? h('span.dot', { style: { background: color } }) : null, name);
    catWrap.replaceChildren(...[mk(null, 'None', null), ...cats.map((c) => mk(c.id, c.name, c.color)),
      pendingCat ? mk('__new', pendingCat + ' (new)', 'var(--accent)') : null,
      h('button.chip.add', { type: 'button', onclick: addCat, 'aria-label': 'New category' }, icon('plus', { size: 14 }), 'New')].filter(Boolean));
  }
  function addCat() {
    const inp = h('input.input.cat-new', { type: 'text', maxlength: 40, placeholder: 'Category name', 'aria-label': 'New category name' });
    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      const v = inp.value.trim();
      if (v) category = ensureCategory(v);
      renderCats();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finished = true; renderCats(); }
    });
    inp.addEventListener('blur', commit);
    catWrap.lastElementChild.replaceWith(inp);
    inp.focus();
  }
  renderCats();

  // Recurrence
  const recur = { ...d.recur, days: d.recur.days?.length ? [...d.recur.days] : [dow(d.date)] };
  let daysTouched = !isNew;
  const makeDayChips = () => dayChips(recur.days, (v) => { recur.days = v; daysTouched = true; });
  date.addEventListener('change', () => {
    if (daysTouched || !isValidKey(date.value)) return;
    recur.days = [dow(date.value)];
    daysRow.replaceChildren(makeDayChips());
  });
  const recurSel = select([['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday (Mon–Fri)'], ['weekly', 'Weekly on…'], ['monthly', 'Monthly (same date)'], ['interval', 'Every N days']], recur.type);
  const daysRow = h('div.recur-extra', makeDayChips());
  const intervalInput = h('input.input.narrow', { type: 'number', min: 2, max: 365, value: recur.interval || 2, inputmode: 'numeric', 'aria-label': 'Repeat every N days' });
  const intervalRow = h('div.recur-extra.inline', h('span', 'Every'), intervalInput, h('span', 'days'));
  const syncRecur = () => {
    recur.type = recurSel.value;
    daysRow.hidden = recur.type !== 'weekly';
    intervalRow.hidden = recur.type !== 'interval';
  };
  recurSel.addEventListener('change', syncRecur);

  const err = h('p.form-error', { role: 'alert' });
  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); submit(); }, novalidate: true },
    field('Title', title),
    field('Notes', notes),
    h('div.grid-2', field('Date', date), h('div.field', h('label.field-label', { for: 'task-time' }, 'Start time ', clearTime), time)),
    timeExtras,
    taskNotice.el,
    groupField('Priority', prio),
    groupField('Category', catWrap),
    field('Repeat', recurSel),
    daysRow, intervalRow,
    err);
  time.id = 'task-time';
  syncTime(); syncRecur();

  function submit() {
    const t = title.value.trim();
    if (!t) { err.textContent = 'Please give the task a title.'; title.focus(); return; }
    if (!isValidKey(date.value)) { err.textContent = 'Please pick a valid date.'; date.focus(); return; }
    const hasTime = /^\d{2}:\d{2}$/.test(time.value);
    const data = {
      title: t, notes: notes.value.trim(), date: date.value,
      time: hasTime ? time.value : null,
      duration: duration.value ? Number(duration.value) : null,
      reminder: hasTime && reminder.value !== '' ? Number(reminder.value) : null,
      priority, category: category === '__new' ? (pendingCat ? ensureCategory(pendingCat) : null) : category,
      recur: { type: recur.type, days: recur.days, interval: Math.max(2, Math.min(365, parseInt(intervalInput.value, 10) || 2)) },
    };
    if (!isNew) data.id = task.id;
    if (data.reminder !== null && ['default', 'off'].includes(reminderStatus())) ensureReminderPermission();
    saveTask(data);
    sheet.close();
    if (isNew) toast(`Added “${t}”`);
  }

  const footer = [
    !isNew ? h('button.btn.danger-ghost', {
      type: 'button',
      onclick: async () => { const ok = await deleteTask(task.id, ctx.ui.date); if (ok) sheet.close(); },
    }, icon('trash', { size: 18 }), 'Delete') : h('span'),
    h('button.btn.primary', { type: 'button', onclick: submit }, isNew ? 'Add task' : 'Save'),
  ];
  const sheet = openSheet({ title: isNew ? 'New task' : 'Edit task', content: form, footer });
}

// ---------------- Habit form ----------------
export function openHabitForm(habit) {
  const isNew = !habit;
  const d = habit ? JSON.parse(JSON.stringify(habit)) : {
    name: '', emoji: '✅', color: HABIT_COLORS[Math.floor(Math.random() * HABIT_COLORS.length)],
    schedule: { type: 'daily', days: [1, 2, 3, 4, 5], times: 3 },
    goal: { type: 'check', target: 8, unit: '' }, timeOfDay: 'anytime', reminder: null,
  };
  if (d.goal.type !== 'count') d.goal.target = d.goal.target > 1 ? d.goal.target : 8;

  const name = h('input.input', { type: 'text', value: d.name, placeholder: 'e.g. Drink water, Read, Meditate', maxlength: 100, autofocus: isNew, autocomplete: 'off' });

  // Emoji picker
  const preview = h('span.emoji-preview', { style: { '--c': d.color }, 'aria-hidden': 'true' }, d.emoji);
  const emojiGrid = h('div.emoji-grid', { role: 'radiogroup', 'aria-label': 'Icon' });
  const custom = h('input.input.narrow', { type: 'text', maxlength: 8, placeholder: '🙂', 'aria-label': 'Custom emoji', value: EMOJIS.includes(d.emoji) ? '' : d.emoji });
  function renderEmojis() {
    emojiGrid.replaceChildren(...EMOJIS.map((e) => h('button.emoji-btn', {
      type: 'button', role: 'radio', 'aria-checked': String(e === d.emoji), 'aria-label': e,
      onclick: () => { d.emoji = e; custom.value = ''; preview.textContent = e; renderEmojis(); },
    }, e)));
  }
  custom.addEventListener('input', () => {
    const v = firstGrapheme(custom.value.trim());
    if (v) { d.emoji = v; preview.textContent = v; renderEmojis(); }
  });
  renderEmojis();

  const colors = swatches(HABIT_COLORS, d.color, (c) => { d.color = c; preview.style.setProperty('--c', c); }, 'Color');

  // Schedule
  const daysRow = h('div.recur-extra', dayChips(d.schedule.days?.length ? d.schedule.days : [1, 2, 3, 4, 5], (v) => { d.schedule.days = v; }));
  if (!d.schedule.days?.length) d.schedule.days = [1, 2, 3, 4, 5];
  const timesRow = h('div.recur-extra.inline', stepper(d.schedule.times || 3, 1, 6, (v) => { d.schedule.times = v; }, 'Times per week'), h('span', 'times per week'));
  const syncSched = () => { daysRow.hidden = d.schedule.type !== 'days'; timesRow.hidden = d.schedule.type !== 'perWeek'; };
  const sched = segmented([
    { value: 'daily', label: 'Every day' }, { value: 'days', label: 'Some days' }, { value: 'perWeek', label: 'X / week' },
  ], d.schedule.type, (v) => { d.schedule.type = v; syncSched(); }, { label: 'Schedule' });

  // Goal
  const target = h('input.input.narrow', { type: 'number', min: 1, max: 999, value: d.goal.target, inputmode: 'numeric', 'aria-label': 'Daily target' });
  const unit = h('input.input', { type: 'text', value: d.goal.unit || '', placeholder: 'unit (glasses, pages…)', maxlength: 24, 'aria-label': 'Unit' });
  const countRow = h('div.recur-extra.inline', h('span', 'Target'), target, unit);
  const syncGoal = () => { countRow.hidden = d.goal.type !== 'count'; };
  const goal = segmented([
    { value: 'check', label: 'Check off' }, { value: 'count', label: 'Count' },
  ], d.goal.type, (v) => { d.goal.type = v; syncGoal(); }, { label: 'Goal' });

  const tod = segmented([
    { value: 'anytime', label: 'Anytime' }, { value: 'morning', label: 'Morning' },
    { value: 'afternoon', label: 'Afternoon' }, { value: 'evening', label: 'Evening' },
  ], d.timeOfDay, (v) => { d.timeOfDay = v; }, { label: 'Time of day', small: true });

  const reminder = h('input.input', { type: 'time', value: d.reminder || '' });
  const habitNotice = reminderNotice(() => /^\d{2}:\d{2}$/.test(reminder.value));
  reminder.addEventListener('change', () => {
    habitNotice.refresh();
    if (reminder.value) ensureReminderPermission().then(habitNotice.refresh);
  });
  const err = h('p.form-error', { role: 'alert' });

  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); submit(); }, novalidate: true },
    h('div.habit-name-row', preview, field('Name', name)),
    groupField('Icon', h('div', emojiGrid, h('div.recur-extra.inline', h('span', 'Or type your own'), custom))),
    groupField('Color', colors),
    groupField('Schedule', h('div', sched, daysRow, timesRow)),
    groupField('Goal', h('div', goal, countRow), 'Count goals: tap to add one, tap − to remove one.'),
    groupField('Time of day', tod),
    field('Reminder', reminder, 'Optional. Reminders fire while the app is open or was recently used.'),
    habitNotice.el,
    err);
  syncSched(); syncGoal();

  function submit() {
    const n = name.value.trim();
    if (!n) { err.textContent = 'Please name your habit.'; name.focus(); return; }
    const data = {
      name: n, emoji: d.emoji || '✅', color: d.color,
      schedule: { type: d.schedule.type, days: d.schedule.days, times: d.schedule.times || 3 },
      goal: { type: d.goal.type, target: d.goal.type === 'count' ? Math.max(1, Math.min(999, parseInt(target.value, 10) || 1)) : 1, unit: unit.value.trim() },
      timeOfDay: d.timeOfDay,
      reminder: /^\d{2}:\d{2}$/.test(reminder.value) ? reminder.value : null,
    };
    if (data.reminder && ['default', 'off'].includes(reminderStatus())) ensureReminderPermission();
    if (!isNew) data.id = habit.id;
    saveHabit(data);
    sheet.close();
    if (isNew) toast(`Habit “${n}” created`);
  }

  const footer = [h('span'), h('button.btn.primary', { type: 'button', onclick: submit }, isNew ? 'Create habit' : 'Save')];
  const sheet = openSheet({ title: isNew ? 'New habit' : 'Edit habit', content: form, footer });
}

export { todayKey };
