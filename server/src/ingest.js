import { hashMac } from './crypto.js';
import { floorToBucket } from './time.js';
import { log } from './log.js';

/**
 * Persist one scan cycle (docs/api.md §1).
 *
 * All writes happen in a single synchronous transaction so a failure leaves no
 * partial scan. Side effects that touch the network (Telegram) run after the
 * commit and never reject into the caller's request path.
 *
 * @returns the `data` object of the 201 response.
 */
export function ingestScan(db, value, { now, sse, telegram }) {
  const outcome = db.transaction((v) => {
    // --- reboot detection: uptime going backwards means the ESP restarted ---
    const prev = db
      .prepare('SELECT uptime_ms FROM scans WHERE device = ? ORDER BY id DESC LIMIT 1')
      .get(v.device);
    const reboot = prev && v.uptime_ms < prev.uptime_ms ? 1 : 0;

    const info = db
      .prepare(
        'INSERT INTO scans (device, firmware, received_at, uptime_ms, reboot) VALUES (?, ?, ?, ?, ?)',
      )
      .run(v.device, v.firmware, now, v.uptime_ms, reboot);
    const scanId = Number(info.lastInsertRowid);

    // --- access points ---
    const insertAp = db.prepare(
      'INSERT INTO aps (scan_id, ssid, bssid, rssi, channel, enc) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const ap of v.aps) {
      insertAp.run(scanId, ap.ssid, ap.bssid, ap.rssi, ap.channel, ap.enc);
    }

    // --- devices: one row per unique MAC, plus its hourly aggregate ---
    const hourBucket = floorToBucket(now, 'hour');
    const upsertDevice = db.prepare(`
      INSERT INTO devices (mac_hash, first_seen, last_seen, frame_count) VALUES (?, ?, ?, 1)
      ON CONFLICT(mac_hash) DO UPDATE SET
        last_seen   = excluded.last_seen,
        frame_count = frame_count + 1
    `);
    const upsertHour = db.prepare(`
      INSERT INTO device_hours (hour_bucket, mac_hash, frames) VALUES (?, ?, 1)
      ON CONFLICT(hour_bucket, mac_hash) DO UPDATE SET frames = frames + 1
    `);
    for (const mac of v.macs) {
      const h = hashMac(mac);
      upsertDevice.run(h, now, now);
      upsertHour.run(hourBucket, h);
    }

    // --- ap_registry: detect first-ever sightings for the new-AP alert ---
    const findRegistered = db.prepare('SELECT 1 FROM ap_registry WHERE bssid = ?');
    const insertRegistered = db.prepare(
      'INSERT OR IGNORE INTO ap_registry (bssid, ssid, first_seen) VALUES (?, ?, ?)',
    );
    const newAps = [];
    for (const ap of v.aps) {
      if (!findRegistered.get(ap.bssid)) {
        insertRegistered.run(ap.bssid, ap.ssid, now);
        newAps.push(ap.bssid);
      }
    }

    // --- channel snapshot (fast path; window queries remain authoritative) ---
    const perChannel = new Map();
    for (const ap of v.aps) {
      perChannel.set(ap.channel, (perChannel.get(ap.channel) ?? 0) + 1);
    }
    const upsertChannel = db.prepare(`
      INSERT INTO channels (channel, ap_count, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(channel) DO UPDATE SET
        ap_count = excluded.ap_count, updated_at = excluded.updated_at
    `);
    for (const [channel, count] of perChannel) upsertChannel.run(channel, count, now);

    let peakChannel = null;
    for (const [channel, count] of perChannel) {
      if (peakChannel === null || count > perChannel.get(peakChannel)) peakChannel = channel;
    }

    return {
      scanId,
      reboot: Boolean(reboot),
      newAps,
      apsStored: v.aps.length,
      macsStored: v.macs.length,
      peakChannel,
    };
  })(value);

  const receivedAt = new Date(now).toISOString();

  if (sse) {
    sse.broadcast('scan', {
      scan_id: outcome.scanId,
      received_at: receivedAt,
      ap_count: outcome.apsStored,
      unique_macs: outcome.macsStored,
      new_aps: outcome.newAps.length,
      peak_channel: outcome.peakChannel,
    });
  }

  // Fire-and-forget: a Telegram failure must never surface as an ingest error.
  if (telegram && outcome.newAps.length) {
    telegram.alertNewAps(outcome.newAps.slice(0, 20), now).catch((err) => {
      log.warn('alert dispatch failed', { error: err.message });
    });
  }

  return {
    data: {
      scan_id: outcome.scanId,
      received_at: receivedAt,
      aps_stored: outcome.apsStored,
      macs_stored: outcome.macsStored,
      new_aps: outcome.newAps.slice(0, 20),
      reboot: outcome.reboot,
    },
    meta: {},
  };
}
