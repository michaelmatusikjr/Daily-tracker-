-- Daily Tracker push server schema (Cloudflare D1 / SQLite).
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,      -- random 128-bit id (base64url)
  token_hash  TEXT NOT NULL,         -- SHA-256 of the device token (the token itself is never stored)
  endpoint    TEXT NOT NULL,         -- push service URL from the browser
  p256dh      TEXT NOT NULL,         -- subscription public key
  auth        TEXT NOT NULL,         -- subscription auth secret
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  device_id TEXT NOT NULL,
  item_id   TEXT NOT NULL,
  at        INTEGER NOT NULL,        -- UTC ms
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  url       TEXT NOT NULL,
  tag       TEXT NOT NULL,
  sent_at   INTEGER,
  PRIMARY KEY (device_id, item_id)
);
CREATE INDEX IF NOT EXISTS items_due ON items (at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS rate (
  key   TEXT PRIMARY KEY,
  win   INTEGER NOT NULL,
  count INTEGER NOT NULL
);
