import { config, configWarnings } from './config.js';
import { openDb, seedConfig, getConfigValue } from './db.js';
import { createApp } from './app.js';
import { createTelegram } from './telegram.js';
import { schedulePrune } from './prune.js';
import { log } from './log.js';

const db = openDb();
seedConfig(db);

const telegram = createTelegram(db);
const { app, sse } = createApp({ db, telegram });

// Surface insecure configuration loudly, but only refuse to boot in production.
const warnings = configWarnings();
for (const warning of warnings) log.warn('config', { warning });
if (config.env === 'production' && warnings.some((w) => w.startsWith('MAC_SALT'))) {
  log.error('refusing to start in production with an insecure MAC_SALT');
  process.exit(1);
}

const server = app.listen(config.port, config.host, () => {
  log.info('arsywatch-server listening', {
    port: config.port,
    host: config.host,
    env: config.env,
    db: config.dbPath,
    telegram: telegram.enabled(),
  });
});

const prune = config.pruneEnabled
  ? schedulePrune(db, {
      hour: config.pruneHour,
      detailDays: Number(getConfigValue(db, 'retention.detail_days', String(config.detailDays))),
      aggregateDays: Number(
        getConfigValue(db, 'retention.aggregate_days', String(config.aggregateDays)),
      ),
      registryDays: Number(
        getConfigValue(db, 'retention.registry_days', String(config.registryDays)),
      ),
    })
  : null;

function shutdown(signal) {
  log.info('shutting down', { signal });
  prune?.stop();
  sse.closeAll();
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  // Do not hang forever if a connection refuses to drain.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
