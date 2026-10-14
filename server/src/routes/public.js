import { Router } from 'express';
import { config } from '../config.js';
import { getConfigValue } from '../db.js';
import { ingestScan } from '../ingest.js';
import { authenticateDevice, createIngestThrottle } from '../auth.js';
import { validateIngest, parseIntParam, parseBoolParam } from '../validate.js';
import {
  parseWindow,
  windowStart,
  autoBucket,
  bucketStarts,
  toIso,
} from '../time.js';
import { log } from '../log.js';

const CHANNEL_24 = Array.from({ length: 14 }, (_, i) => i + 1);
const SORTS = {
  signal: 'rssi DESC',
  last_seen: 'last_seen DESC',
  ssid: 'ssid ASC',
  channel: 'channel ASC',
};

export function createPublicRouter({ db, sse, telegram }) {
  const router = Router();
  const throttle = createIngestThrottle(config.ingestMinIntervalMs);

  // ---------------------------------------------------------------- ingest ---
  router.post('/ingest', (req, res) => {
    const device = authenticateDevice(db, req.get('authorization'), req.body?.device);
    if (!device) {
      return res.status(401).json({
        error: { code: 'invalid_token', message: 'Token peranti tidak sah' },
      });
    }

    const now = Date.now();
    const gate = throttle.check(device, now);
    if (!gate.allowed) {
      res.set('Retry-After', String(gate.retryAfterS));
      return res.status(429).json({
        error: { code: 'rate_limited', message: `Cuba lagi dalam ${gate.retryAfterS}s` },
      });
    }
    throttle.record(device, now);

    const parsed = validateIngest(req.body, { maxAps: config.maxAps, maxMacs: config.maxMacs });
    if (!parsed.ok) {
      return res.status(422).json({
        error: {
          code: 'validation_failed',
          message: `${parsed.details.length} field tidak sah`,
          details: parsed.details,
        },
      });
    }

    const started = Date.now();
    try {
      const result = ingestScan(db, parsed.value, { now, sse, telegram });
      result.meta.ingest_lag_ms = Date.now() - started;
      log.info('ingest ok', {
        device,
        scan_id: result.data.scan_id,
        aps: result.data.aps_stored,
        macs: result.data.macs_stored,
        new_aps: result.data.new_aps.length,
      });
      res.status(201).json(result);
    } catch (err) {
      log.error('ingest failed', { device, error: err.message });
      res.status(500).json({ error: { code: 'internal_error', message: 'Ralat menyimpan scan' } });
    }
  });

  // ------------------------------------------------------------------- aps ---
  router.get('/aps', (req, res) => {
    const window = parseWindow(req.query.window, '15m');
    if (!window) return badQuery(res, 'window');

    const sort = req.query.sort ?? 'signal';
    if (!Object.hasOwn(SORTS, sort)) return badQuery(res, 'sort');

    const limit = parseIntParam(req.query.limit, { min: 1, max: 200, fallback: 50 });
    if (limit === null) return badQuery(res, 'limit');

    const includeStale = parseBoolParam(req.query.include_stale, true);
    if (includeStale === null) return badQuery(res, 'include_stale');

    const now = Date.now();
    const since = windowStart(window, now);
    const staleAfterS = config.staleAfterS;

    const rows = db
      .prepare(
        `
        WITH ranked AS (
          SELECT a.bssid, a.ssid, a.channel, a.enc, a.rssi, s.received_at,
                 ROW_NUMBER() OVER (PARTITION BY a.bssid ORDER BY s.received_at DESC, a.id DESC) AS rn
          FROM aps a
          JOIN scans s ON s.id = a.scan_id
          WHERE s.received_at >= ?
        ),
        agg AS (
          SELECT bssid,
                 COUNT(*)         AS sightings,
                 AVG(rssi)        AS rssi_avg,
                 MIN(rssi)        AS rssi_min,
                 MAX(rssi)        AS rssi_max,
                 MIN(received_at) AS first_seen,
                 MAX(received_at) AS last_seen
          FROM ranked
          GROUP BY bssid
        )
        SELECT agg.bssid, agg.sightings, agg.rssi_avg, agg.rssi_min, agg.rssi_max,
               agg.first_seen, agg.last_seen,
               r.ssid, r.channel, r.enc, r.rssi
        FROM agg
        JOIN ranked r ON r.bssid = agg.bssid AND r.rn = 1
        ORDER BY ${SORTS[sort]}
        LIMIT ?
      `,
      )
      .all(since, limit);

    const data = rows
      .map((r) => {
        const ageS = Math.max(0, Math.round((now - r.last_seen) / 1000));
        return {
          bssid: r.bssid,
          ssid: r.ssid,
          channel: r.channel,
          enc: r.enc,
          rssi: r.rssi,
          rssi_avg: round1(r.rssi_avg),
          rssi_min: r.rssi_min,
          rssi_max: r.rssi_max,
          sightings: r.sightings,
          first_seen: toIso(r.first_seen),
          last_seen: toIso(r.last_seen),
          age_s: ageS,
          stale: ageS > staleAfterS,
        };
      })
      .filter((ap) => includeStale || !ap.stale);

    res.json({
      data,
      meta: {
        window,
        count: data.length,
        stale_after_s: staleAfterS,
        generated_at: new Date(now).toISOString(),
      },
    });
  });

  // -------------------------------------------------------------- channels ---
  router.get('/channels', (req, res) => {
    const window = parseWindow(req.query.window, '1h');
    if (!window) return badQuery(res, 'window');

    const band = req.query.band ?? 'all';
    if (!['all', '2.4', '5'].includes(band)) return badQuery(res, 'band');

    const now = Date.now();
    const since = windowStart(window, now);

    // ESP8266 is 2.4 GHz-only, so channels above 14 are never real observations.
    const bandFilter =
      band === '2.4' || band === 'all' ? 'AND a.channel BETWEEN 1 AND 14' : 'AND a.channel > 14';

    const rows = db
      .prepare(
        `
        SELECT a.channel,
               COUNT(DISTINCT a.bssid) AS ap_count,
               AVG(a.rssi)             AS avg_rssi
        FROM aps a
        JOIN scans s ON s.id = a.scan_id
        WHERE s.received_at >= ? ${bandFilter}
        GROUP BY a.channel
      `,
      )
      .all(since);

    const byChannel = new Map(rows.map((r) => [r.channel, r]));
    const channels =
      band === '5' ? rows.map((r) => r.channel).sort((a, b) => a - b) : CHANNEL_24;

    const data = channels.map((channel) => {
      const row = byChannel.get(channel);
      return {
        channel,
        ap_count: row?.ap_count ?? 0,
        avg_rssi: row?.avg_rssi == null ? null : round1(row.avg_rssi),
        is_peak: false,
      };
    });

    // Single deterministic peak: highest count, lowest channel on a tie.
    let peak = null;
    for (const entry of data) {
      if (peak === null || entry.ap_count > peak.ap_count) peak = entry;
    }
    if (peak && peak.ap_count > 0) peak.is_peak = true;

    const threshold = Number(
      getConfigValue(db, 'alert.channel_threshold', String(config.channelThreshold)),
    );

    res.json({
      data,
      meta: {
        window,
        band,
        peak_channel: peak && peak.ap_count > 0 ? peak.channel : null,
        total_aps: data.reduce((sum, e) => sum + e.ap_count, 0),
        threshold,
        generated_at: new Date(now).toISOString(),
      },
    });
  });

  // --------------------------------------------------------------- devices ---
  router.get('/devices', (req, res) => {
    const window = parseWindow(req.query.window, '24h');
    if (!window) return badQuery(res, 'window');

    let bucket = req.query.bucket;
    if (bucket != null && !['hour', 'day'].includes(bucket)) return badQuery(res, 'bucket');
    if (!bucket) bucket = autoBucket(window);

    const now = Date.now();
    const since = windowStart(window, now);

    const groupExpr = bucket === 'day' ? 'hour_bucket - (hour_bucket % 86400000)' : 'hour_bucket';

    const rows = db
      .prepare(
        `
        SELECT ${groupExpr} AS bucket,
               COUNT(DISTINCT mac_hash) AS unique_count,
               SUM(frames)              AS frames
        FROM device_hours
        WHERE hour_bucket >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      )
      .all(since);

    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    const data = bucketStarts(since, now, bucket).map((t) => {
      const row = byBucket.get(t);
      return {
        bucket: toIso(t),
        unique: row?.unique_count ?? 0,
        frames: row?.frames ?? 0,
      };
    });

    const totalUnique = db
      .prepare('SELECT COUNT(DISTINCT mac_hash) AS n FROM device_hours WHERE hour_bucket >= ?')
      .get(since).n;

    let peak = null;
    for (const entry of data) {
      if (peak === null || entry.unique > peak.unique) peak = entry;
    }

    res.json({
      data: {
        total_unique: totalUnique,
        peak: peak ? { bucket: peak.bucket, unique: peak.unique } : null,
        buckets: data,
      },
      meta: {
        window,
        bucket,
        caveat:
          'Kiraan adalah MAC unik, bukan bilangan orang. Randomisasi MAC iOS/Android boleh menaikkan kiraan.',
        generated_at: new Date(now).toISOString(),
      },
    });
  });

  // ---------------------------------------------------------------- events ---
  router.get('/events', (req, res) => {
    const lastScan = db.prepare('SELECT id FROM scans ORDER BY id DESC LIMIT 1').get();
    const attached = sse.add(req, res, {
      server_time: new Date().toISOString(),
      last_scan_id: lastScan?.id ?? null,
    });
    if (!attached) {
      res.set('Retry-After', '30');
      res.status(503).json({
        error: { code: 'rate_limited', message: 'Terlalu banyak klien langsung' },
      });
    }
  });

  // ---------------------------------------------------------------- health ---
  router.get('/health', (_req, res) => {
    const last = db.prepare('SELECT received_at FROM scans ORDER BY id DESC LIMIT 1').get();
    const ageS = last ? Math.round((Date.now() - last.received_at) / 1000) : null;
    res.json({
      data: {
        ok: true,
        node_online: ageS != null && ageS < config.staleAfterS,
        last_scan_age_s: ageS,
        sse_clients: sse.clientCount,
      },
    });
  });

  return router;
}

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

function badQuery(res, param) {
  return res.status(422).json({
    error: {
      code: 'validation_failed',
      message: `Parameter "${param}" tidak sah`,
      details: [{ path: param, issue: 'nilai tidak dibenarkan' }],
    },
  });
}
