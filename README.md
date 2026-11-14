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
- Log any exercise you define yourself. Each exercise is **Strength** (weight × sets × reps, several lines per entry), **Bodyweight** (sets × reps, optional extra weight such as a vest, optional hold time m:ss) or **Cardio** (time and distance). New exercise names suggest a type (push-ups, sit-ups, pull-ups, chin-ups, dips, planks, burpees, lunges, crunches, wall sits, air/bodyweight squats → Bodyweight). Older strength entries that have a time keep and show it; Manage exercises suggests switching exercises with time-only or weightless entries to Bodyweight.
- Strength entries can have several lines (e.g. 225 × 3×5, then 245 × 1×3).
- Fast repeat logging: recent and most-used exercises appear as big chips; picking one pre-fills last time's values (“Last time: 225 lbs · 3×5 · Nov 10”), so a repeat is pick → Save. Steppers: ±5 lb / ±2.5 kg, ±1 set/rep. Time: cardio takes minutes (30), `25:30` (m:ss when the first number is 6 or more), `1:15` (h:mm when it's 5 or less), `1:02:03`, or `1h15m` / `25m30s`; strength takes seconds or m:ss. A live hint under the box shows how it was read (“= 25 min 30 s”); tap it to flip an ambiguous value. Sanity limits: 100 sets, 1000 reps, 2000 lb / 1000 kg, 24 h, 1000 mi/km.
- Typing a new name offers “Add ‘Squats’” with a Strength/Cardio choice. Manage exercises (rename, change type, archive, delete — delete with history offers archive instead) from the list icon on the Workouts tab.
- 🏆 personal records are derived from the history on demand, so they stay correct after edits, deletes and Undo. Ties are not records and the first-ever entry is not a record.
  - Strength: **1-rep max** (heaviest weight lifted for ≥1 rep) and **3×5 max** (heaviest weight with ≥3 sets of ≥5 reps on one day, summed across lines and entries at the same stored weight; the first 3×5 also counts once the exercise has earlier entries).
  - Bodyweight: most reps in a day / week (follows the week-start setting) / month / year, with the current period so far, and longest hold. A period record needs an earlier period to beat.
  - Cardio: fastest time at 1 mi, 2 mi, 5K, 10K, 10 mi, half marathon and marathon; an entry counts when its distance is within ±2% (no pro-rating).
  - The toast names every record the entry set, most important first, e.g. "🏆 New 3×5 max & 1-rep max: Squat 235 lbs" or "🏆 Fastest 5K: Run 24:50". Re-saving an entry without beating anything new shows the normal saved toast.
- History grouped by day with filters (All / Strength / Bodyweight / Cardio / one exercise); each exercise has a detail page with records, totals and an inline-SVG progress chart (top weight per day with 3×5 days marked, reps per day for bodyweight, distance/pace/time for cardio).
- **Units:** lbs/kg and mi/km per profile (default lbs/mi). Each workout stores the values and the unit it was logged in; everything is displayed converted to the current setting (weights rounded to 0.5, distances to 0.01), so switching units never changes history. Editing an entry keeps the original value and unit of every number you don't change, and records compare values after that same rounding, so a converted 100 kg vs 220.5 lb is a tie, not a record.
- Calendar shows 💪 on workout days; Stats has a Workouts section (workout days this week/month, strength / bodyweight / cardio split, cardio time and distance, recent records, links to each exercise's chart).
- Optional: Settings › Workouts › “Check off a habit when I log a workout” (Any / Strength / Bodyweight / Cardio). Only check-off habits can be linked. A matching workout checks the habit for that day (past days too, never future); removing the last matching workout un-checks it only if the link checked it — manual checks are never touched. Undo restores both.

**Profiles** (avatar at the top-left of Today)
- Several people can share one device. Tap the avatar to switch profiles, add one, edit name/avatar (photo — cropped and resized to 192 px on the device — or emoji/initials on a colour), open Settings, or delete a profile (double confirmation; the last profile can't be deleted).
- Each profile has completely separate data and settings (tasks, habits, journal, categories, workouts, theme, accent, units, notification preference…). Reminders fire for every profile and are prefixed with the profile's name when there is more than one.
- Profiles are a convenience, **not a lock**: anyone with the device can open any profile.
- Several open tabs stay in sync: profile list changes and edits to the profile you're viewing show up in the other tabs (if a tab's profile is deleted elsewhere, it switches to another one).

**Calendar**: a month grid that tints each day by habit completion and shows task dots and mood. Tap a day to open its agenda.

**Stats**: overview cards, a 7/30-day completion bar chart (inline SVG), per-habit completion rates, and your best day of the week.

**Item menus** (press and hold any item; right-click with a mouse; the ContextMenu key or Shift+F10 on a focused item): a bottom sheet on phones, a small popover next to the item on desktop. Destructive actions are last, in red, and every one has Undo. Moving your finger more than ~10px cancels the hold, so scrolling and swiping still work; holding a drag handle still drags. A one-time tip on Today points this out.
- **Task:** Edit · Mark done/not done · Move to tomorrow · Move to… (date picker) · Duplicate · Delete. Repeating tasks get **Skip this day** instead of Move, and Delete asks “this day / whole series”.
- **Habit** (Today and Habits): Edit · View details · Mark done/not done for that day · Archive/Unarchive · Delete (with confirm). Count habits also get Add one, Remove one and Reset today. (This replaces the old long-press-to-subtract gesture; the − button still removes one with a single tap.)
- **Workout entry:** Edit · Log again today (prefilled) · View exercise · Delete.
- **Exercise** (manage list and filter chips): Edit · View history · Archive · Delete (offers Archive instead when it has history).
- **Calendar day:** Open day · Add task on this day · Log workout on this day (not for future days).

**Settings** (profile menu › Settings, the side nav on wide screens, or `#settings`): theme (auto/light/dark), 6 accent colours, week start (Mon/Sun), 12h/24h time, workout units and the optional habit link, task categories, notifications, install button (or iOS instructions), JSON export/import with validation, reset this profile (asks twice), the welcome tour again, and the app version.

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
js/itemMenu.js          Long-press / right-click / keyboard item menus
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

Everything lives in `localStorage` on this device: `dailyTracker:profiles` holds the profile list (names, avatars, which one is active) and each profile's data is stored under `dailyTracker:data:<profileId>` (tasks, habits, categories, journal, workouts, exercises and settings). Data from before 1.3 is moved into the first profile automatically; the schema is versioned (currently v4) and older data and backups are migrated. **Export JSON** saves all profiles in one file; importing such a file replaces everything (after confirmation), while an older single-profile backup can either replace the current profile or be added as a new one. If saving fails because storage is full (e.g. many photos), a red “Not saved” banner stays at the top until a save works again. Export keeps profiles whose data can't be read as raw text (restored as-is on import), and replacing everything from a backup never deletes such a profile without a separate confirmation. If a tab still running a pre-1.3 version keeps writing the old storage key after the update, you're asked whether to merge those changes into a profile, add them as a new profile, or discard them. The merge is three-way against a copy of the data as it was moved at the update (kept for 14 days): whatever the old tab didn't change keeps its current state — so things you deleted or un-checked since the update stay that way — while the old tab's edits, additions and deletions are applied (if both sides changed the same item, the newer edit wins). When a new version is installed in another tab, this tab reloads too, but waits while a sheet is open or you're typing (“Update ready – finishing when you're done”).
