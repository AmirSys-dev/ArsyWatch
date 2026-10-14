import { config } from './config.js';
import { safeEqual, sha256 } from './crypto.js';

/**
 * Verify a device bearer token.
 *
 * Two sources, checked in order:
 *  1. `device_tokens` table (hash at rest) — supports rotation via /admin.
 *  2. `DEVICE_TOKEN` env var — bootstrap fallback so a fresh install works
 *     before any token is provisioned.
 *
 * Both checks are timing-safe. Returns the device id on success, else null.
 */
export function authenticateDevice(db, authHeader, claimedDevice) {
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const candidates = db.prepare('SELECT device, token_hash FROM device_tokens').all();
  for (const row of candidates) {
    if (safeEqual(sha256(token), row.token_hash)) {
      return row.device;
    }
  }

  if (config.deviceToken && safeEqual(token, config.deviceToken)) {
    return claimedDevice ?? 'default';
  }
  return null;
}

/**
 * Fixed-window rate limiter keyed by an arbitrary string.
 * In-memory: resets on restart, which is acceptable for a single-process VPS.
 */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map(); // key -> { count, resetAt }

  return function check(key, now = Date.now()) {
    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, retryAfterS: 0 };
    }
    entry.count += 1;
    if (entry.count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterS: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    }
    return { allowed: true, remaining: limit - entry.count, retryAfterS: 0 };
  };
}

/**
 * Minimum-interval throttle for ingest: at most one request per `minIntervalMs`
 * per device (docs/api.md §0.5). Distinct from the window limiter because the
 * window is "since last request", not a fixed bucket.
 */
export function createIngestThrottle(minIntervalMs) {
  const last = new Map();
  return {
    check(device, now = Date.now()) {
      const prev = last.get(device);
      if (prev != null && now - prev < minIntervalMs) {
        return {
          allowed: false,
          retryAfterS: Math.max(1, Math.ceil((minIntervalMs - (now - prev)) / 1000)),
        };
      }
      return { allowed: true };
    },
    record(device, now = Date.now()) {
      last.set(device, now);
    },
    reset() {
      last.clear();
    },
  };
}
