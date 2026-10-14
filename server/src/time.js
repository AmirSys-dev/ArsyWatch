/**
 * Window parsing and time-bucket math.
 *
 * All timestamps are epoch milliseconds (integers) in SQLite. The API layer
 * converts to ISO-8601 UTC with milliseconds at the edge — see docs/api.md §0.2.
 */

export const WINDOW_MS = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

export const WINDOW_KEYS = Object.keys(WINDOW_MS);
export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;

/** Parse a `window` query param. Returns null when unrecognised. */
export function parseWindow(value, fallback) {
  if (value == null || value === '') return fallback;
  return Object.hasOwn(WINDOW_MS, value) ? value : null;
}

export function windowStart(windowKey, now) {
  return now - WINDOW_MS[windowKey];
}

/** Floor an epoch-ms value to the start of its hour or day (UTC). */
export function floorToBucket(epochMs, bucket) {
  if (bucket === 'day') return Math.floor(epochMs / DAY_MS) * DAY_MS;
  return Math.floor(epochMs / HOUR_MS) * HOUR_MS;
}

/**
 * Bucket size for a window: hourly up to 48h, daily beyond. Matches the
 * `bucket: auto` default in docs/api.md §4.1.
 */
export function autoBucket(windowKey) {
  return WINDOW_MS[windowKey] <= 48 * HOUR_MS ? 'hour' : 'day';
}

/**
 * Every bucket start between `start` (inclusive) and `end` (exclusive).
 * Used to emit zero-filled series so charts have no gaps (docs/api.md §4.2).
 */
export function bucketStarts(start, end, bucket) {
  const size = bucket === 'day' ? DAY_MS : HOUR_MS;
  const out = [];
  for (let t = floorToBucket(start, bucket); t < end; t += size) out.push(t);
  return out;
}

export const toIso = (epochMs) => (epochMs == null ? null : new Date(epochMs).toISOString());

export const fromIso = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
