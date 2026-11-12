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

**Workouts** (Workouts tab, or + → Workout)
- Log any exercise you define yourself. Each exercise is **Strength** (weight, sets, reps, plus an optional time box for holds like planks) or **Cardio** (time and distance). Every field is optional, but at least one must be filled; bodyweight work just leaves weight empty.
- Strength entries can have several lines (e.g. 225 × 3×5, then 245 × 1×3).
- Fast repeat logging: recent and most-used exercises appear as big chips; picking one pre-fills last time's values (“Last time: 225 lbs · 3×5 · Nov 10”), so a repeat is pick → Save. Steppers: ±5 lb / ±2.5 kg, ±1 set/rep. Time: cardio takes minutes or h:mm; strength takes seconds or m:ss.
- Typing a new name offers “Add ‘Squats’” with a Strength/Cardio choice. Manage exercises (rename, change type, archive, delete — delete with history offers archive instead) from the list icon on the Workouts tab.
- 🏆 personal records (heaviest weight, most reps at a weight, longest time; longest distance, longest time, fastest pace for cardio) are computed from the history, so they stay correct after edits and deletes. A new record gets a celebratory toast.
- History grouped by day with filters (All / Strength / Cardio / one exercise); each exercise has a detail page with records, totals and an inline-SVG progress chart (top weight per day, or distance/pace/time for cardio).
- **Units:** lbs/kg and mi/km per profile (default lbs/mi). Each workout stores the values and the unit it was logged in; everything is displayed converted to the current setting (weights rounded to 0.5, distances to 0.01), so switching units never changes history.
- Calendar shows 💪 on workout days; Stats has a Workouts section (workout days this week/month, strength vs cardio split, cardio time and distance, recent records, links to each exercise's chart).
- Optional: Settings › Workouts › “Check off a habit when I log a workout” (Any / Strength only / Cardio only). Only check-off habits can be linked. A matching workout checks the habit for that day (past days too, never future); removing the last matching workout un-checks it only if the link checked it — manual checks are never touched. Undo restores both.

**Profiles** (avatar at the top-left of Today)
- Several people can share one device. Tap the avatar to switch profiles, add one, edit name/avatar (photo — cropped and resized to 192 px on the device — or emoji/initials on a colour), open Settings, or delete a profile (double confirmation; the last profile can't be deleted).
- Each profile has completely separate data and settings (tasks, habits, journal, categories, workouts, theme, accent, units, notification preference…). Reminders fire for every profile and are prefixed with the profile's name when there is more than one.
- Profiles are a convenience, **not a lock**: anyone with the device can open any profile.

**Calendar**: a month grid that tints each day by habit completion and shows task dots and mood. Tap a day to open its agenda.

**Stats**: overview cards, a 7/30-day completion bar chart (inline SVG), per-habit completion rates, and your best day of the week.

**Settings** (profile menu › Settings, or `#settings`): theme (auto/light/dark), 6 accent colours, week start (Mon/Sun), 12h/24h time, workout units and the optional habit link, task categories, notifications, install button (or iOS instructions), JSON export/import with validation, reset this profile (asks twice), the welcome tour again, and the app version.

**Quality**
- Mobile-first with thumb-friendly 44px targets, a bottom tab bar (Today, Habits, Workouts, Calendar, Stats) on phones and a side nav on wide screens, bottom sheets, and safe-area insets for notches.
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
js/onboarding.js        First-run tour (includes the profile name for new users)
js/profiles.js          Avatar, profile menu/editor, photo resizing
js/workouts.js          Workout logic: units, time parsing, summaries, records, charts, habit link
js/workoutForm.js       Workout log form
js/reminders.js         Reminder permission checks and help text
js/views/*.js           Today, Habits, Habit detail, Workouts + exercise detail, Calendar, Stats, Settings
icons/                  SVG + PNG icons (192, 512, maskable 512, apple-touch 180)
```

## Run locally

Any static file server works. ES modules and service workers need `http://`, so opening the file directly does not work.

```bash
cd Daily-tracker-
python3 -m http.server 8080
# open http://localhost:8080
```

Service workers are allowed on `localhost`. On other hosts they require HTTPS (GitHub Pages is HTTPS).

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

When you set a reminder on a task or habit, the app makes sure it can actually appear: it asks for notification permission right then (and switches notifications on), or turns notifications on if you had switched them off. If notifications are blocked, the form explains how to allow them for your platform; on iPhone it explains that reminders need the app on the Home Screen. Reminders that can’t fire get a 🔕 badge, and Settings › Reminders summarises the situation. Turning notifications off while reminders exist asks for confirmation.

There is no push server, so reminders are scheduled **while the app is open or was used recently**. They are shown as system notifications through the service worker. Browsers may suspend background pages, so a reminder is not guaranteed if the app was fully closed. For the same reason the app has no wake-up alarms: a web app can't ring while it's closed or the phone is locked.

## Your data

Everything lives in `localStorage` on this device: `dailyTracker:profiles` holds the profile list (names, avatars, which one is active) and each profile's data is stored under `dailyTracker:data:<profileId>` (tasks, habits, categories, journal, workouts, exercises and settings). Data from before 1.3 is moved into the first profile automatically; the schema is versioned (currently v4) and older data and backups are migrated. **Export JSON** saves all profiles in one file; importing such a file replaces everything (after confirmation), while an older single-profile backup can either replace the current profile or be added as a new one. If saving fails because storage is full (e.g. many photos), the app tells you.
