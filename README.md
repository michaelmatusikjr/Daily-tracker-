# Daily Tracker

A calm, offline-first **daily planner + habit tracker** that runs entirely in your browser as an installable Progressive Web App (PWA). There is no account, no backend and no build step. Your data stays on your device.

## Features

**Today**
- Greeting, date, a progress ring for the day (tasks + habits), and a week strip with per-day progress.
- A timeline of timed tasks (start time + optional duration) with a live **Now** line, plus an **Anytime** list you can drag to reorder (or use arrow keys on the handle).
- One-tap completion with a small animation, plus **Undo** toasts for completions, deletions and moves.
- Unfinished tasks from earlier days show up with **Move to today** (one at a time or all at once).
- Go to the previous or next day with the arrows or by swiping, and use **Today** to jump back.
- A journal: pick a mood (5 emojis) and write a short note for each day.

**Quick add (the + button, or press `n`)**
- Type naturally: `Gym 6pm`, `Call mom tomorrow 14:30`, `Standup at 9 for 15m`, `Dentist friday 3:30pm for 1h !! #health`, `Pay rent in 3 days`.
- Understands today, tonight, tomorrow, weekday names, "next …", "in N days/weeks", `6pm`, `18:00`, `at 9`, noon and midnight, `for 30m`, `for 1h30m`, `!`/`!!`/`!!!` for priority and `#tag` for a category.
- If no date or time is recognised, the item is added as an untimed task on the day you are viewing.

**Tasks**
- Title, notes, date, start time, duration, priority (none/low/medium/high), colour-coded category, and a reminder (minutes before the start).
- Repeat options: daily, weekdays, weekly on chosen days, monthly, or every N days. Each occurrence is completed separately. When you delete a repeating task, you choose **this day only** or **whole series**.

**Habits**
- Name, emoji, colour, schedule (every day, specific weekdays, or X times per week), goal (check-off, or a count such as 8 glasses), optional reminder time, and time of day (morning, afternoon, evening, anytime).
- One-tap check, or tap +1 for count habits. Long-press, right-click or the − button removes one.
- Current 🔥 and best streaks, plus a 7-day row of dots you can tap to edit past days.
- Streaks follow the schedule: days off never break a streak, and "X per week" habits count by ISO week.
- The detail screen has a GitHub-style year heatmap, 30-day and all-time completion rates, total completions, and an editable month calendar.
- Archive, restore, reorder, and delete (with confirmation and undo).

**Calendar**: a month grid that tints each day by habit completion and shows task dots and mood. Tap a day to open its agenda.

**Stats**: overview cards, a 7/30-day completion bar chart (inline SVG), per-habit completion rates, and your best day of the week.

**Settings**: theme (auto/light/dark), 6 accent colours, week start (Mon/Sun), 12h/24h time, task categories, notifications, install button (or iOS instructions), JSON export/import with validation, reset (asks twice), the welcome tour again, and the app version.

**Quality**
- Mobile-first with thumb-friendly 44px targets, a bottom tab bar on phones and a side nav on wide screens, bottom sheets, and safe-area insets for notches.
- Semantic buttons, ARIA labels, visible focus, focus trapping in sheets, and `prefers-reduced-motion` support.
- All user text is rendered with `textContent`, never `innerHTML`.
- Date keys are built from local date parts (`YYYY-MM-DD`) and use noon-anchored arithmetic, so DST changes are safe.
- Versioned storage schema with a migration hook (`js/store.js`).

## Project structure

```
index.html              App shell
manifest.webmanifest    PWA manifest (relative start_url/scope)
sw.js                   Service worker (cache-first app shell)
css/styles.css          All styles and theme tokens
js/app.js               Bootstrap, routing, timers
js/store.js             State, persistence, schema migration, import validation
js/dates.js             Local-date utilities
js/logic.js             Recurrence, streaks, completion rates, day progress
js/parse.js             Natural-language quick-add parser
js/actions.js           State mutations (with undo)
js/forms.js             Quick add, task and habit forms
js/ui.js                DOM helpers, sheets, toasts, gestures, drag-sort
js/notify.js            In-app reminders
js/pwa.js               SW registration, update toast, install prompt
js/theme.js             Theme and accent handling
js/onboarding.js        First-run tour
js/views/*.js           Today, Habits, Habit detail, Calendar, Stats, Settings
icons/                  SVG + PNG icons (192, 512, maskable 512, apple-touch 180)
```

## Run locally

Any static file server works. ES modules and service workers need `http://`, so opening the file directly does not work.

```bash
cd Daily-tracker-
python3 -m http.server 8080
# open http://localhost:8080
```

Service workers are allowed on `localhost`. On other hosts they require HTTPS.

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. Open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then pick your branch and the `/ (root)` folder. Save.
3. After a minute the app is live at `https://<user>.github.io/Daily-tracker-/`.

All paths are relative, so the app works from any sub-path.

**When you change any file, bump `VERSION` in `sw.js`** (and `APP_VERSION` in `js/store.js` for the number shown in Settings). If you add a new file, also add it to the `SHELL` list in `sw.js`. Users then see an "Update available – Reload" toast.

## Install on your phone

- **Android (Chrome/Edge):** open the site, then tap **Install** in Settings → App (or use the browser menu → *Install app* / *Add to Home screen*).
- **iPhone/iPad (Safari):** tap the **Share** button, then **Add to Home Screen**. On iOS, notifications only work for the installed Home Screen app (iOS 16.4+).
- **Desktop (Chrome/Edge):** use the install icon in the address bar, or the button in Settings.

After the first load, the app works fully offline.

## Reminders: what to expect

There is no push server, so reminders are scheduled **while the app is open or was used recently**. They are shown as system notifications through the service worker. Browsers may suspend background pages, so a reminder is not guaranteed if the app was fully closed.

## Your data

Everything lives in `localStorage` on this device under the key `dailyTracker:data`. Use **Settings → Export JSON** for backups, or to move your data to another device with **Import JSON**.
