/**
 * Hand-rolled ingest payload validation. No dependency — the payload shape is
 * small and fixed (docs/api.md §1.2). Returns a list of { path, issue } so the
 * 422 response can point at the exact field.
 */

// Case-insensitive on input; normalised to uppercase before storage/response.
// Firmware is the only writer and always sends uppercase, but accepting both
// cases makes a hand-rolled curl during development far less frustrating.
const BSSID_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const DEVICE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export const ENC_VALUES = new Set([
  'open',
  'wep',
  'wpa',
  'wpa2',
  'wpa3',
  'wpa2/wpa3',
  'unknown',
]);

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

/**
 * @returns {{ ok: true, value: object } | { ok: false, details: Array<{path:string, issue:string}> }}
 */
export function validateIngest(body, limits) {
  const details = [];
  const push = (path, issue) => details.push({ path, issue });

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, details: [{ path: '', issue: 'badan mesti objek JSON' }] };
  }

  // --- device ---
  if (typeof body.device !== 'string' || !DEVICE_RE.test(body.device)) {
    push('device', 'mesti padan ^[a-z0-9][a-z0-9-]{0,31}$');
  }

  // --- uptime_ms ---
  if (!isInt(body.uptime_ms) || body.uptime_ms < 0) {
    push('uptime_ms', 'mesti integer ≥ 0');
  }

  // --- firmware (optional) ---
  if (body.firmware != null && typeof body.firmware !== 'string') {
    push('firmware', 'mesti string');
  }

  // --- aps ---
  if (!Array.isArray(body.aps)) {
    push('aps', 'mesti array');
  } else if (body.aps.length > limits.maxAps) {
    push('aps', `maksimum ${limits.maxAps} item (diterima ${body.aps.length})`);
  } else {
    body.aps.forEach((ap, i) => {
      const at = `aps[${i}]`;
      if (ap === null || typeof ap !== 'object' || Array.isArray(ap)) {
        push(at, 'mesti objek');
        return;
      }
      if (typeof ap.ssid !== 'string') push(`${at}.ssid`, 'mesti string');
      else if (Buffer.byteLength(ap.ssid, 'utf8') > 32) push(`${at}.ssid`, 'maksimum 32 bait');

      if (typeof ap.bssid !== 'string' || !BSSID_RE.test(ap.bssid)) {
        push(`${at}.bssid`, 'mesti MAC AA:BB:CC:DD:EE:FF');
      }
      if (!isInt(ap.rssi) || ap.rssi < -100 || ap.rssi > 0) {
        push(`${at}.rssi`, 'di luar julat −100…0');
      }
      if (!isInt(ap.channel) || ap.channel < 1 || ap.channel > 196) {
        push(`${at}.channel`, 'di luar julat 1…196');
      }
      if (typeof ap.enc !== 'string' || !ENC_VALUES.has(ap.enc)) {
        push(`${at}.enc`, `mesti salah satu daripada: ${[...ENC_VALUES].join(', ')}`);
      }
    });
  }

  // --- macs ---
  if (!Array.isArray(body.macs)) {
    push('macs', 'mesti array');
  } else if (body.macs.length > limits.maxMacs) {
    push('macs', `maksimum ${limits.maxMacs} item (diterima ${body.macs.length})`);
  } else {
    body.macs.forEach((mac, i) => {
      if (typeof mac !== 'string' || !MAC_RE.test(mac)) {
        push(`macs[${i}]`, 'mesti MAC AA:BB:CC:DD:EE:FF');
      }
    });
  }

  if (details.length) return { ok: false, details };

  // Normalise: uppercase BSSID + MAC, dedupe both lists deterministically.
  const apsByBssid = new Map();
  for (const ap of body.aps) {
    apsByBssid.set(ap.bssid.toUpperCase(), {
      ssid: ap.ssid,
      bssid: ap.bssid.toUpperCase(),
      rssi: ap.rssi,
      channel: ap.channel,
      enc: ap.enc,
    });
  }
  const macs = [...new Set(body.macs.map((m) => m.toUpperCase()))];

  return {
    ok: true,
    value: {
      device: body.device,
      uptime_ms: body.uptime_ms,
      firmware: body.firmware ?? null,
      aps: [...apsByBssid.values()],
      macs,
    },
  };
}

/** Parse and range-check a query integer. Returns null when invalid. */
export function parseIntParam(value, { min, max, fallback }) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function parseBoolParam(value, fallback) {
  if (value == null || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}
