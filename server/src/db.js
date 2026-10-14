import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { log } from './log.js';

/**
 * Schema version is tracked with PRAGMA user_version so future migrations can
 * apply incrementally instead of dropping the database.
 */
export const SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS scans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device       TEXT    NOT NULL,
  firmware     TEXT,
  received_at  INTEGER NOT NULL,
  uptime_ms    INTEGER NOT NULL,
  reboot       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scans_received_at ON scans(received_at);
CREATE INDEX IF NOT EXISTS idx_scans_device      ON scans(device, received_at);

CREATE TABLE IF NOT EXISTS aps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id   INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  ssid      TEXT    NOT NULL,
  bssid     TEXT    NOT NULL,
  rssi      INTEGER NOT NULL,
  channel   INTEGER NOT NULL,
  enc       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aps_scan_id ON aps(scan_id);
CREATE INDEX IF NOT EXISTS idx_aps_bssid   ON aps(bssid, scan_id);
CREATE INDEX IF NOT EXISTS idx_aps_channel ON aps(channel, scan_id);

CREATE TABLE IF NOT EXISTS devices (
  mac_hash    TEXT    PRIMARY KEY,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  frame_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);

CREATE TABLE IF NOT EXISTS device_hours (
  hour_bucket INTEGER NOT NULL,
  mac_hash    TEXT    NOT NULL,
  frames      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_bucket, mac_hash)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_device_hours_bucket ON device_hours(hour_bucket);

CREATE TABLE IF NOT EXISTS channels (
  channel    INTEGER PRIMARY KEY,
  ap_count   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tokens (
  device     TEXT    PRIMARY KEY,
  token_hash TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER
);

CREATE TABLE IF NOT EXISTS ap_registry (
  bssid      TEXT    PRIMARY KEY,
  ssid       TEXT    NOT NULL,
  first_seen INTEGER NOT NULL,
  last_alert INTEGER
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  // WAL lets reads proceed during writes — required for SSE + ingest overlap.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) {
    db.exec(SCHEMA_V1);
    log.info('db migrated', { from: current, to: 1 });
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

/**
 * Seed default config rows if absent. Values live in the DB so /admin can change
 * them at runtime without a restart; environment variables remain the fallback.
 */
export function seedConfig(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  insert.run('retention.detail_days', String(config.detailDays));
  insert.run('retention.aggregate_days', String(config.aggregateDays));
  insert.run('retention.registry_days', String(config.registryDays));
  insert.run('alert.channel_threshold', String(config.channelThreshold));
  insert.run('alert.enabled', config.telegramToken && config.telegramChatId ? 'true' : 'false');
}

/** Read a config value, falling back to `fallback` when the key is absent. */
export function getConfigValue(db, key, fallback) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setConfigValue(db, key, value) {
  db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}
