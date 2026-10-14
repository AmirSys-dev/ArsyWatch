import './env.js'; // must precede src imports — see env.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seedConfig, getConfigValue, setConfigValue } from '../src/db.js';
import { runPrune } from '../src/prune.js';
import { DAY_MS } from '../src/time.js';
import { createTelegram } from '../src/telegram.js';
import { validateIngest } from '../src/validate.js';

describe('schema and config', () => {
  test('openDb creates all eight tables and sets user_version', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
      .sort();
    assert.deepEqual(tables, [
      'ap_registry',
      'aps',
      'channels',
      'config',
      'device_hours',
      'device_tokens',
      'devices',
      'scans',
    ]);
    assert.equal(db.pragma('user_version', { simple: true }), 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'memory'); // :memory: cannot use WAL
    db.close();
  });

  test('seedConfig is idempotent and config values round-trip', () => {
    const db = openDb(':memory:');
    seedConfig(db);
    seedConfig(db); // must not overwrite or throw
    assert.equal(getConfigValue(db, 'retention.detail_days', 'x'), '7');
    setConfigValue(db, 'retention.detail_days', 21);
    assert.equal(getConfigValue(db, 'retention.detail_days', 'x'), '21');
    db.close();
  });
});

describe('prune', () => {
  function seedOldScan(db, receivedAt) {
    const info = db
      .prepare(
        'INSERT INTO scans (device, firmware, received_at, uptime_ms, reboot) VALUES (?,?,?,?,0)',
      )
      .run('arsywatch-01', '1.0.0', receivedAt, 1);
    db.prepare('INSERT INTO aps (scan_id, ssid, bssid, rssi, channel, enc) VALUES (?,?,?,?,?,?)').run(
      info.lastInsertRowid,
      'Old',
      'AA:AA:AA:AA:AA:AA',
      -70,
      6,
      'wpa2',
    );
    return Number(info.lastInsertRowid);
  }

  test('prunes detail older than the detail window, cascading to aps', () => {
    const db = openDb(':memory:');
    const now = Date.now();
    seedOldScan(db, now - 10 * DAY_MS); // older than 7 days → pruned
    seedOldScan(db, now - 1 * DAY_MS); // recent → kept

    const result = runPrune(db, { detailDays: 7, aggregateDays: 30, registryDays: 90, now });
    assert.equal(result.scans, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scans').get().n, 1);
    // Cascade removed the child aps row for the pruned scan.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM aps').get().n, 1);
    db.close();
  });

  test('keeps aggregates longer than detail', () => {
    const db = openDb(':memory:');
    const now = Date.now();
    const hourOld = now - 10 * DAY_MS;
    db.prepare('INSERT INTO device_hours (hour_bucket, mac_hash, frames) VALUES (?,?,?)').run(
      hourOld,
      'a'.repeat(64),
      5,
    );
    // detailDays 7 would delete a scan, but aggregateDays 30 keeps the aggregate.
    runPrune(db, { detailDays: 7, aggregateDays: 30, registryDays: 90, now });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM device_hours').get().n, 1);
    db.close();
  });

  test('prunes registry entries past their longer window', () => {
    const db = openDb(':memory:');
    const now = Date.now();
    db.prepare('INSERT INTO ap_registry (bssid, ssid, first_seen) VALUES (?,?,?)').run(
      'AA:AA:AA:AA:AA:AA',
      'Old',
      now - 100 * DAY_MS,
    );
    db.prepare('INSERT INTO ap_registry (bssid, ssid, first_seen) VALUES (?,?,?)').run(
      'BB:BB:BB:BB:BB:BB',
      'Recent',
      now - 10 * DAY_MS,
    );
    const result = runPrune(db, { detailDays: 7, aggregateDays: 30, registryDays: 90, now });
    assert.equal(result.registry, 1);
    db.close();
  });
});

describe('telegram', () => {
  test('is disabled without credentials', () => {
    const db = openDb(':memory:');
    const tg = createTelegram(db);
    assert.equal(tg.enabled(), false);
    db.close();
  });

  test('a recently-alerted AP is skipped (anti-spam)', async () => {
    const db = openDb(':memory:');
    const now = Date.now();
    db.prepare('INSERT INTO ap_registry (bssid, ssid, first_seen, last_alert) VALUES (?,?,?,?)').run(
      'AA:AA:AA:AA:AA:AA',
      'Recent',
      now - 1000,
      now - 60_000, // alerted 1 minute ago, cooldown is 1 hour
    );
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    process.env.TELEGRAM_CHAT_ID = 'y';
    const tg = createTelegram(db);
    // alertNewAps short-circuits on cooldown before any network call.
    const sent = await tg.alertNewAps(['AA:AA:AA:AA:AA:AA'], now);
    assert.equal(sent, 0);
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.TELEGRAM_CHAT_ID = '';
    db.close();
  });
});

describe('validateIngest edge cases', () => {
  const limits = { maxAps: 20, maxMacs: 200 };

  test('rejects a non-object body', () => {
    const r = validateIngest([], limits);
    assert.equal(r.ok, false);
  });

  test('rejects a device id with uppercase', () => {
    const r = validateIngest({ device: 'ArsyWatch', uptime_ms: 1, aps: [], macs: [] }, limits);
    assert.equal(r.ok, false);
    assert.ok(r.details.some((d) => d.path === 'device'));
  });

  test('accepts lowercase MACs and normalises them to uppercase', () => {
    const r = validateIngest(
      {
        device: 'node-1',
        uptime_ms: 1,
        aps: [{ ssid: 'x', bssid: 'aa:bb:cc:dd:ee:ff', rssi: -50, channel: 6, enc: 'wpa2' }],
        macs: ['aa:bb:cc:dd:ee:01'],
      },
      limits,
    );
    assert.equal(r.ok, true);
    assert.equal(r.value.aps[0].bssid, 'AA:BB:CC:DD:EE:FF');
    assert.deepEqual(r.value.macs, ['AA:BB:CC:DD:EE:01']);
  });

  test('rejects an SSID longer than 32 bytes', () => {
    const r = validateIngest(
      {
        device: 'node-1',
        uptime_ms: 1,
        aps: [
          { ssid: 'x'.repeat(33), bssid: 'AA:BB:CC:DD:EE:FF', rssi: -50, channel: 6, enc: 'wpa2' },
        ],
        macs: [],
      },
      limits,
    );
    assert.equal(r.ok, false);
    assert.ok(r.details.some((d) => d.path === 'aps[0].ssid'));
  });

  test('reports every invalid field, not just the first', () => {
    const r = validateIngest(
      {
        device: 'BAD',
        uptime_ms: -5,
        aps: [{ ssid: 'x', bssid: 'zz', rssi: 99, channel: 999, enc: 'nope' }],
        macs: ['not-a-mac'],
      },
      limits,
    );
    assert.equal(r.ok, false);
    assert.ok(r.details.length >= 6);
  });
});
