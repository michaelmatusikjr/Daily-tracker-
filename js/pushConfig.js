// Optional push server for reminders that arrive while the app is closed (see server/README.md).
// Leave both empty to keep the app fully local: everything push-related stays hidden.
// They can also be set (or overridden) in Settings › Reminders › Advanced, without editing code.
export const PUSH_SERVER_URL = ''; // e.g. 'https://daily-tracker-push.yourname.workers.dev'
export const VAPID_PUBLIC_KEY = ''; // the public key printed by `npm run gen-vapid`
