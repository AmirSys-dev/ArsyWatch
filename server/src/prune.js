import { DAY_MS } from './time.js';
import { log } from './log.js';

/**
 * Retention enforcement (docs/api.md §8.2).
 *
 * Detail tables are pruned aggressively (7 days) while hourly aggregates are
 * kept longer (30 days) so the 24h/7d device charts survive a detail prune.
 * Runs in one transaction; returns per-table deletion counts.
 */
export function runPrune(db, { detailDays, aggregateDays, registryDays, now = Date.now() }) {
  const detailCutoff = now - detailDays * DAY_MS;
  const aggregateCutoff = now - aggregateDays * DAY_MS;
  const registryCutoff = now - registryDays * DAY_MS;

  const counts = db.transaction(() => {
    // `aps` rows disappear via ON DELETE CASCADE from scans.
    const scans = db.prepare('DELETE FROM scans WHERE received_at < ?').run(detailCutoff).changes;
    const deviceHours = db
      .prepare('DELETE FROM device_hours WHERE hour_bucket < ?')
      .run(aggregateCutoff).changes;
    const devices = db
      .prepare('DELETE FROM devices WHERE last_seen < ?')
      .run(aggregateCutoff).changes;
    const registry = db
      .prepare('DELETE FROM ap_registry WHERE first_seen < ?')
      .run(registryCutoff).changes;

    return { scans, deviceHours, devices, registry };
  })();

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > 0) log.info('prune complete', counts);
  return counts;
}

/**
 * Schedule a daily prune at `hour` local time. Returns a handle with `stop()`.
 * Re-arms itself each day rather than using a fixed 24h interval, so daylight
 * saving shifts do not drift the run time.
 */
export function schedulePrune(db, { hour, detailDays, aggregateDays, registryDays }) {
  let timer = null;
  let stopped = false;

  const msUntilNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  };

  const arm = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      try {
        runPrune(db, { detailDays, aggregateDays, registryDays });
      } catch (err) {
        log.error('prune failed', { error: err.message });
      }
      arm();
    }, msUntilNext());
    if (typeof timer.unref === 'function') timer.unref();
  };

  arm();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
