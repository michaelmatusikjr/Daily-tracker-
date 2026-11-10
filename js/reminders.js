// Making sure reminders can actually fire: permission + app setting checks,
// friendly platform-specific help, and counts for warnings.
import { getState, update } from './store.js';
import { toast } from './ui.js';
import { isIOS, isStandalone } from './pwa.js';
import { todayKey } from './dates.js';
import { isRecurring } from './logic.js';

const isAndroid = () => /android/i.test(navigator.userAgent);

/**
 * 'ok'          notifications allowed and switched on in the app
 * 'off'         permission granted but the app setting is off
 * 'default'     the browser hasn't asked yet
 * 'denied'      blocked by the user / OS
 * 'needs-install' iOS Safari tab: notifications need the Home Screen app
 * 'unsupported' no Notification API at all
 */
export function reminderStatus() {
  if (!('Notification' in window)) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  const p = Notification.permission;
  if (p === 'denied') return 'denied';
  if (p === 'default') return 'default';
  return getState().settings.notifications ? 'ok' : 'off';
}

export function blockedHelp() {
  if (isIOS()) return 'On iPhone/iPad: Settings › Notifications › Daily Tracker › Allow Notifications.';
  if (isAndroid()) return 'On Android: tap the lock icon next to the address (or long-press the app icon › App info) › Notifications › Allow.';
  return 'Click the lock/site icon in the address bar › Notifications › Allow, then reload.';
}

/** One-line explanation for a reminder that can't fire right now (null when fine). */
export function reminderProblem(status = reminderStatus()) {
  switch (status) {
    case 'denied': return `Notifications are blocked for this app – reminders won't appear. ${blockedHelp()}`;
    case 'needs-install': return 'On iPhone, reminders need Daily Tracker added to your Home Screen first.';
    case 'unsupported': return "This browser can't show notifications, so reminders won't appear.";
    case 'default': return 'Reminders need notification permission. You will be asked when you set one.';
    case 'off': return 'Notifications are off in Settings, so reminders won’t appear.';
    default: return null;
  }
}

const setNotifications = (on) => update((s) => { s.settings.notifications = on; });

/**
 * Call from the user gesture that sets a reminder. Requests permission when needed
 * and switches the app setting on. Returns the resulting status.
 */
export async function ensureReminderPermission() {
  const status = reminderStatus();
  if (status === 'ok' || status === 'denied' || status === 'unsupported' || status === 'needs-install') return status;
  if (status === 'off') {
    setNotifications(true);
    toast('Notifications turned on so your reminder can appear');
    return 'ok';
  }
  // 'default': ask now, inside the user's gesture.
  let result = 'default';
  try { result = await Notification.requestPermission(); } catch { result = Notification.permission; }
  if (result === 'granted') {
    setNotifications(true);
    toast('Notifications allowed – reminders are on');
    return 'ok';
  }
  if (result === 'denied') toast('Notifications were blocked, so reminders won’t appear', { duration: 6000 });
  return reminderStatus();
}

/** Reminders that are still relevant (could fire in the future). */
export function activeReminders(state = getState()) {
  const today = todayKey();
  const tasks = state.tasks.filter((t) => t.reminder !== null && t.time && (isRecurring(t) || (!t.done && t.date >= today)));
  const habits = state.habits.filter((h) => h.reminder && !h.archived);
  return { tasks, habits, total: tasks.length + habits.length };
}

export const canFire = () => reminderStatus() === 'ok';
