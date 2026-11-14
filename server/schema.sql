-- Daily Tracker push server schema (Cloudflare D1 / SQLite).
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,      -- random 128-bit id (base64url)
  token_hash  TEXT NOT NULL,         -- SHA-256 of the device token (the token itself is never stored)
  endpoint    TEXT NOT NULL,         -- push service URL from the browser
  p256dh      TEXT NOT NULL,         -- subscription public key
  auth        TEXT NOT NULL,         -- subscription auth secret
  tz          TEXT NOT NULL,         -- IANA time zone of the device (for local reminder times)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
-- One row per reminder rule (a task's or habit's reminder, with its recurrence).
CREATE TABLE IF NOT EXISTS rules (
  device_id TEXT NOT NULL,
  rule_id   TEXT NOT NULL,
  def       TEXT NOT NULL,           -- validated rule JSON (title, body, url, tag, time, recur, dates…)
  next_at   INTEGER,                 -- next fire time, UTC ms (NULL: nothing left to fire)
  next_date TEXT,                    -- occurrence date of next_at (YYYY-MM-DD, the device's local date)
  PRIMARY KEY (device_id, rule_id)
);
CREATE INDEX IF NOT EXISTS rules_next ON rules (next_at) WHERE next_at IS NOT NULL;
-- Occurrences already sent (so nothing fires twice); purged after 3 days.
CREATE TABLE IF NOT EXISTS fired (
  device_id TEXT NOT NULL,
  rule_id   TEXT NOT NULL,
  date      TEXT NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (device_id, rule_id, date)
);
CREATE TABLE IF NOT EXISTS rate (
  key   TEXT PRIMARY KEY,
  win   INTEGER NOT NULL,
  count INTEGER NOT NULL
);
