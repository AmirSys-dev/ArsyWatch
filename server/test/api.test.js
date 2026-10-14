import './env.js'; // must precede src imports — see env.js
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seedConfig } from '../src/db.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

let db;
let server;
let base;
let telegramStub;

const GOOD_APS = [
  { ssid: 'HomeNet', bssid: 'A4:2B:8C:91:F3:0F', rssi: -48, channel: 6, enc: 'wpa2' },
  { ssid: 'NeighbourWiFi', bssid: '7C:10:C9:02:44:AB', rssi: -74, channel: 6, enc: 'wpa2' },
  { ssid: 'Milo_Hotspot', bssid: '34:60:F9:AA:1C:07', rssi: -77, channel: 13, enc: 'wpa2' },
];

const GOOD_MACS = ['D8:01:02:03:04:05', 'D8:0A:0B:0C:0D:0E'];

const goodBody = (overrides = {}) => ({
  device: 'arsywatch-01',
  uptime_ms: 1000,
  firmware: '1.0.0',
  aps: GOOD_APS,
  macs: GOOD_MACS,
  ...overrides,
});

async function post(path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

async function get(path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

const AUTH = { authorization: 'Bearer test-device-token' };

before(async () => {
  db = openDb(':memory:');
  seedConfig(db);
  telegramStub = {
    enabled: () => false,
    send: async () => ({ sent: false }),
    sendTest: async () => ({ sent: false, reason: 'not_configured' }),
    alertNewAps: async () => 0,
  };
  const { app } = createApp({ db, telegram: telegramStub });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Undici keeps sockets alive, so close() alone never drains. Force it.
  server?.closeAllConnections?.();
  await new Promise((resolve) => server?.close(resolve));
  db?.close();
});

beforeEach(() => {
  // Fresh data per test; keeps assertions independent.
  db.exec(
    'DELETE FROM scans; DELETE FROM aps; DELETE FROM devices; DELETE FROM device_hours; DELETE FROM channels; DELETE FROM ap_registry;',
  );
});

// ---------------------------------------------------------------- auth ------

describe('ingest auth', () => {
  test('rejects a missing token with 401', async () => {
    const res = await post('/api/v1/ingest', goodBody());
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'invalid_token');
  });

  test('rejects a wrong token with 401', async () => {
    const res = await post('/api/v1/ingest', goodBody(), { authorization: 'Bearer nope' });
    assert.equal(res.status, 401);
  });

  test('accepts the correct token with 201', async () => {
    const res = await post('/api/v1/ingest', goodBody(), AUTH);
    assert.equal(res.status, 201);
    // AUTOINCREMENT never reuses ids, so assert shape rather than an exact value.
    assert.ok(Number.isInteger(res.json.data.scan_id) && res.json.data.scan_id >= 1);
    assert.equal(res.json.data.aps_stored, 3);
    assert.equal(res.json.data.macs_stored, 2);
  });

  test('a token differing only in length is still rejected', async () => {
    // Guards the timing-safe comparison against an early length short-circuit.
    const res = await post('/api/v1/ingest', goodBody(), {
      authorization: 'Bearer test-device-token-extra',
    });
    assert.equal(res.status, 401);
  });
});

// ----------------------------------------------------------- validation ------

describe('ingest validation', () => {
  test('rejects a bad BSSID with a field-level 422', async () => {
    const body = goodBody({ aps: [{ ...GOOD_APS[0], bssid: 'not-a-mac' }] });
    const res = await post('/api/v1/ingest', body, AUTH);
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, 'validation_failed');
    assert.ok(res.json.error.details.some((d) => d.path === 'aps[0].bssid'));
  });

  test('rejects RSSI outside −100…0', async () => {
    const body = goodBody({ aps: [{ ...GOOD_APS[0], rssi: 20 }] });
    const res = await post('/api/v1/ingest', body, AUTH);
    assert.equal(res.status, 422);
    assert.ok(res.json.error.details.some((d) => d.path === 'aps[0].rssi'));
  });

  test('rejects more than 20 APs', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      ...GOOD_APS[0],
      bssid: `AA:BB:CC:DD:EE:${i.toString(16).padStart(2, '0').toUpperCase()}`,
    }));
    const res = await post('/api/v1/ingest', goodBody({ aps: many }), AUTH);
    assert.equal(res.status, 422);
    assert.ok(res.json.error.details.some((d) => d.path === 'aps'));
  });

  test('rejects an invalid enc value', async () => {
    const body = goodBody({ aps: [{ ...GOOD_APS[0], enc: 'wpa4' }] });
    const res = await post('/api/v1/ingest', body, AUTH);
    assert.equal(res.status, 422);
    assert.ok(res.json.error.details.some((d) => d.path === 'aps[0].enc'));
  });

  test('accepts an empty AP list and empty MAC list', async () => {
    const res = await post('/api/v1/ingest', goodBody({ aps: [], macs: [] }), AUTH);
    assert.equal(res.status, 201);
    assert.equal(res.json.data.aps_stored, 0);
  });

  test('malformed JSON yields 400', async () => {
    const res = await fetch(`${base}/api/v1/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: '{ not json',
    });
    assert.equal(res.status, 400);
  });
});

// -------------------------------------------------------------- storage ------

describe('ingest persistence', () => {
  test('raw MACs are never stored — only hashes', async () => {
    await post('/api/v1/ingest', goodBody(), AUTH);
    const rows = db.prepare('SELECT mac_hash FROM devices').all();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.match(row.mac_hash, /^[0-9a-f]{64}$/);
      assert.ok(!GOOD_MACS.some((m) => row.mac_hash.includes(m.replaceAll(':', ''))));
    }
  });

  test('the same MAC across scans stays one device row but bumps frame_count', async () => {
    await post('/api/v1/ingest', goodBody(), AUTH);
    await post('/api/v1/ingest', goodBody({ uptime_ms: 2000 }), AUTH);
    const count = db.prepare('SELECT COUNT(*) AS n FROM devices').get().n;
    const frames = db.prepare('SELECT MAX(frame_count) AS f FROM devices').get().f;
    assert.equal(count, 2);
    assert.equal(frames, 2);
  });

  test('new_aps reports only first-ever BSSIDs', async () => {
    const first = await post('/api/v1/ingest', goodBody(), AUTH);
    assert.equal(first.json.data.new_aps.length, 3);

    const second = await post('/api/v1/ingest', goodBody({ uptime_ms: 2000 }), AUTH);
    assert.equal(second.json.data.new_aps.length, 0);
  });

  test('uptime going backwards flags a reboot', async () => {
    await post('/api/v1/ingest', goodBody({ uptime_ms: 900_000 }), AUTH);
    const res = await post('/api/v1/ingest', goodBody({ uptime_ms: 5000 }), AUTH);
    assert.equal(res.json.data.reboot, true);
  });

  test('duplicate BSSIDs within one payload are deduped', async () => {
    const dupes = [GOOD_APS[0], GOOD_APS[0], GOOD_APS[1]];
    const res = await post('/api/v1/ingest', goodBody({ aps: dupes }), AUTH);
    assert.equal(res.status, 201);
    assert.equal(res.json.data.aps_stored, 2);
  });
});

// ------------------------------------------------------------- throttle -----

describe('ingest throttle', () => {
  test('a second immediate scan from the same device gets 429', async () => {
    // `config` snapshots env at module load, so mutate the object directly and
    // build a fresh app to pick up the new interval.
    const previous = config.ingestMinIntervalMs;
    config.ingestMinIntervalMs = 10_000;

    const { app } = createApp({ db, telegram: telegramStub });
    const s2 = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const b2 = `http://127.0.0.1:${s2.address().port}`;

    const doPost = (uptime) =>
      fetch(`${b2}/api/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...AUTH },
        body: JSON.stringify(goodBody({ uptime_ms: uptime })),
      });

    try {
      const first = await doPost(1000);
      assert.equal(first.status, 201);
      const second = await doPost(2000);
      assert.equal(second.status, 429);
      assert.ok(second.headers.get('retry-after'));
    } finally {
      config.ingestMinIntervalMs = previous;
      s2.closeAllConnections?.();
      await new Promise((resolve) => s2.close(resolve));
    }
  });
});

// ----------------------------------------------------------- read APIs ------

describe('GET /api/v1/aps', () => {
  test('returns APs sorted by signal strength, strongest first', async () => {
    await post('/api/v1/ingest', goodBody(), AUTH);
    const res = await get('/api/v1/aps?window=15m&sort=signal');
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 3);
    const rssis = res.json.data.map((a) => a.rssi);
    assert.deepEqual(rssis, [...rssis].sort((a, b) => b - a));
    assert.equal(res.json.data[0].bssid, 'A4:2B:8C:91:F3:0F');
  });

  test('rejects an unknown window', async () => {
    const res = await get('/api/v1/aps?window=99y');
    assert.equal(res.status, 422);
  });

  test('include_stale=false filters out APs older than the threshold', async () => {
    // Insert directly with an old timestamp to simulate a vanished AP.
    const old = Date.now() - 10 * 60_000;
    const info = db
      .prepare(
        'INSERT INTO scans (device, firmware, received_at, uptime_ms, reboot) VALUES (?,?,?,?,0)',
      )
      .run('arsywatch-01', '1.0.0', old, 1);
    db.prepare('INSERT INTO aps (scan_id, ssid, bssid, rssi, channel, enc) VALUES (?,?,?,?,?,?)').run(
      info.lastInsertRowid,
      'Ghost',
      'AA:AA:AA:AA:AA:AA',
      -70,
      6,
      'wpa2',
    );

    const withStale = await get('/api/v1/aps?window=15m&include_stale=true');
    const withoutStale = await get('/api/v1/aps?window=15m&include_stale=false');
    assert.equal(withStale.json.data.length, 1);
    assert.equal(withStale.json.data[0].stale, true);
    assert.equal(withoutStale.json.data.length, 0);
  });
});

describe('GET /api/v1/channels', () => {
  test('always returns channels 1-14 with a single peak', async () => {
    await post('/api/v1/ingest', goodBody(), AUTH);
    const res = await get('/api/v1/channels?window=1h');
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 14);
    assert.equal(res.json.data[0].channel, 1);
    assert.equal(res.json.data[13].channel, 14);

    const peaks = res.json.data.filter((c) => c.is_peak);
    assert.equal(peaks.length, 1);
    // Two APs on channel 6, one on 13 → channel 6 peaks.
    assert.equal(peaks[0].channel, 6);
    assert.equal(peaks[0].ap_count, 2);
    assert.equal(res.json.meta.peak_channel, 6);
  });

  test('reports zero counts for empty channels rather than omitting them', async () => {
    await post('/api/v1/ingest', goodBody(), AUTH);
    const res = await get('/api/v1/channels?window=1h');
    const ch1 = res.json.data.find((c) => c.channel === 1);
    assert.equal(ch1.ap_count, 0);
    assert.equal(ch1.is_peak, false);
  });

  test('ties on count resolve to the lower channel', async () => {
    // One AP on channel 3 and one on channel 9 — a tie at count 1.
    const body = goodBody({
      aps: [
        { ssid: 'A', bssid: 'AA:00:00:00:00:01', rssi: -60, channel: 9, enc: 'wpa2' },
        { ssid: 'B', bssid: 'AA:00:00:00:00:02', rssi: -60, channel: 3, enc: 'wpa2' },
      ],
    });
    await post('/api/v1/ingest', body, AUTH);
    const res = await get('/api/v1/channels?window=1h');
    assert.equal(res.json.meta.peak_channel, 3);
  });
});

describe('GET /api/v1/devices', () => {
  test('returns one zero-filled bucket per hour with a caveat', async () => {
    await post('/api/v1/ingest', goodBody(), AUTH);
    const res = await get('/api/v1/devices?window=24h&bucket=hour');
    assert.equal(res.status, 200);
    assert.equal(res.json.data.buckets.length, 25); // inclusive of both ends
    assert.equal(res.json.data.total_unique, 2);
    assert.ok(res.json.meta.caveat.includes('MAC unik'));
  });

  test('does not leak individual mac_hash values', async () => {
    await post('/api/v1/ingest', goodBody(), AUTH);
    const res = await get('/api/v1/devices?window=24h');
    const serialised = JSON.stringify(res.json);
    for (const mac of GOOD_MACS) {
      assert.ok(!serialised.includes(mac));
    }
    assert.ok(!/"mac_hash"/.test(serialised));
  });

  test('defaults to day buckets for a 30d window', async () => {
    const res = await get('/api/v1/devices?window=30d');
    assert.equal(res.json.meta.bucket, 'day');
  });
});

describe('GET /api/v1/health', () => {
  test('reports node_online after a recent scan', async () => {
    await post('/api/v1/ingest', goodBody(), AUTH);
    const res = await get('/api/v1/health');
    assert.equal(res.json.data.ok, true);
    assert.equal(res.json.data.node_online, true);
  });

  test('reports node offline with no scans', async () => {
    const res = await get('/api/v1/health');
    assert.equal(res.json.data.node_online, false);
    assert.equal(res.json.data.last_scan_age_s, null);
  });
});

// ---------------------------------------------------------------- admin -----

describe('admin surface', () => {
  const basic = (u, p) => ({
    authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`,
  });

  test('rejects unauthenticated access with 403', async () => {
    const res = await get('/admin/api/status');
    assert.equal(res.status, 403);
  });

  test('rejects a wrong password with 403', async () => {
    const res = await get('/admin/api/status', basic('admin', 'wrong'));
    assert.equal(res.status, 403);
  });

  test('accepts correct credentials', async () => {
    const res = await get('/admin/api/status', basic('admin', 'test-admin-pass'));
    assert.equal(res.status, 200);
    assert.ok('db' in res.json.data);
  });

  test('token rotation returns a token once and stores only its hash', async () => {
    const res = await post(
      '/admin/api/tokens',
      { device: 'arsywatch-02' },
      basic('admin', 'test-admin-pass'),
    );
    assert.equal(res.status, 201);
    const { token } = res.json.data;
    assert.ok(token && token.length > 20);

    const row = db
      .prepare('SELECT token_hash FROM device_tokens WHERE device = ?')
      .get('arsywatch-02');
    assert.ok(row);
    assert.notEqual(row.token_hash, token);
    assert.match(row.token_hash, /^[0-9a-f]{64}$/);

    // The rotated token authenticates.
    const ingest = await post('/api/v1/ingest', goodBody({ device: 'arsywatch-02' }), {
      authorization: `Bearer ${token}`,
    });
    assert.equal(ingest.status, 201);
  });

  test('retention update validates its bounds', async () => {
    const bad = await post(
      '/admin/api/retention',
      { detail_days: 0 },
      basic('admin', 'test-admin-pass'),
    );
    assert.equal(bad.status, 422);

    const good = await post(
      '/admin/api/retention',
      { detail_days: 14 },
      basic('admin', 'test-admin-pass'),
    );
    assert.equal(good.status, 200);
    assert.equal(good.json.data.detail_days, 14);
  });

  test('telegram test reports not-configured when unset', async () => {
    const res = await post('/admin/api/telegram/test', {}, basic('admin', 'test-admin-pass'));
    assert.equal(res.status, 422);
  });
});

// ------------------------------------------------------------------ 404 -----

describe('routing', () => {
  test('unknown paths return a structured 404', async () => {
    const res = await get('/api/v1/nope');
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, 'not_found');
  });
});
