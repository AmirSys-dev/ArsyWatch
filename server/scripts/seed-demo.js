/**
 * Seed synthetic scans so the dashboard can be developed before the ESP8266 is
 * wired up. Values are plausible but entirely fabricated — never ship a DB
 * seeded by this script as if it were real data.
 *
 *   npm run seed -- --hours 24 --interval 30
 */
import { openDb, seedConfig } from '../src/db.js';
import { ingestScan } from '../src/ingest.js';
import { config } from '../src/config.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const hours = arg('hours', 24);
const intervalS = arg('interval', 30);

const db = openDb();
seedConfig(db);

// A fixed cast of fake APs and devices, deterministic so re-runs are comparable.
const APS = [
  { ssid: 'HomeNet', bssid: 'A4:2B:8C:91:F3:0F', channel: 6, enc: 'wpa2', base: -48 },
  { ssid: 'HomeNet_2G', bssid: 'A4:2B:8C:91:F3:10', channel: 11, enc: 'wpa2', base: -55 },
  { ssid: 'NeighbourWiFi', bssid: '7C:10:C9:02:44:AB', channel: 6, enc: 'wpa2', base: -74 },
  { ssid: 'xfinitywifi', bssid: '7C:10:C9:02:44:AC', channel: 11, enc: 'open', base: -83 },
  { ssid: '', bssid: '9E:04:1B:77:20:03', channel: 1, enc: 'wpa3', base: -69 },
  { ssid: 'TP-Link_4F2A', bssid: 'B0:4E:26:4F:2A:11', channel: 1, enc: 'wpa2', base: -80 },
  { ssid: 'Milo_Hotspot', bssid: '34:60:F9:AA:1C:07', channel: 13, enc: 'wpa2', base: -77 },
];

const DEVICES = Array.from({ length: 60 }, (_, i) => {
  const hex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  return `D8:${hex(i)}:${hex((i * 7) % 256)}:${hex((i * 13) % 256)}:${hex((i * 29) % 256)}:${hex((i * 3) % 256)}`;
});

// Deterministic pseudo-random in [0,1) — no Math.random, so seeds are stable.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const totalScans = Math.floor((hours * 3600) / intervalS);
const end = Date.now();
const start = end - totalScans * intervalS * 1000;
const rnd = prng(20261014);

console.log(`seeding ${totalScans} scans over ${hours}h (interval ${intervalS}s)…`);

let macsTotal = 0;
for (let i = 0; i < totalScans; i++) {
  const now = start + i * intervalS * 1000;
  const hourOfDay = new Date(now).getUTCHours();

  // Diurnal shape: more devices active in the evening (18:00–23:00 UTC).
  const activity = hourOfDay >= 18 && hourOfDay <= 23 ? 1 : 0.35;

  const aps = APS.filter(() => rnd() < 0.92).map((ap) => ({
    ssid: ap.ssid,
    bssid: ap.bssid,
    channel: ap.channel,
    enc: ap.enc,
    rssi: Math.max(-95, Math.min(-30, Math.round(ap.base + (rnd() - 0.5) * 12))),
  }));

  const macCount = Math.max(1, Math.round((3 + rnd() * 22) * activity));
  const macs = [];
  for (let m = 0; m < macCount; m++) {
    macs.push(DEVICES[Math.floor(rnd() * DEVICES.length)]);
  }

  ingestScan(
    db,
    {
      device: 'arsywatch-01',
      uptime_ms: (i + 1) * intervalS * 1000,
      firmware: '0.1.0-demo',
      aps,
      macs: [...new Set(macs)],
    },
    { now, sse: null, telegram: null },
  );
  macsTotal += macs.length;
}

const scans = db.prepare('SELECT COUNT(*) AS n FROM scans').get().n;
const aps = db.prepare('SELECT COUNT(*) AS n FROM aps').get().n;
const devices = db.prepare('SELECT COUNT(*) AS n FROM devices').get().n;

console.log(
  JSON.stringify(
    { scans, aps, devices, db: config.dbPath, window_hours: hours, macs_seen: macsTotal },
    null,
    2,
  ),
);
db.close();
