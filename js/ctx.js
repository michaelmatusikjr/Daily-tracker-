// Shared UI context (view state + navigation hooks set up by app.js).
import { todayKey, monthStart } from './dates.js';

export const ctx = {
  ui: {
    date: todayKey(),
    calMonth: monthStart(todayKey()),
    detailMonth: null,
    habitsReorder: false,
    showArchived: false,
    statsRange: 7,
    journalOpen: null,
    workoutFilter: 'all',
    workoutDays: 30,
    exChart: 'primary',
  },
  /** ids of elements that should play a "just changed" animation on next render */
  anim: new Set(),
  go: (route) => { location.hash = '#' + route; },
  setDate: () => {},
  rerender: () => {},
};
