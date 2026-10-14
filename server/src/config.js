import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(here, '..');

/**
 * Minimal .env loader (no dependency). Real environment variables always win,
 * so systemd / container env overrides the file. Never throws on a missing file.
 */
function loadEnvFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(serverRoot, '.env'));

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: path.resolve(serverRoot, process.env.DB_PATH ?? './data/arsywatch.db'),

  // Ingest
  deviceToken: process.env.DEVICE_TOKEN ?? '',
  macSalt: process.env.MAC_SALT ?? '',
  ingestMinIntervalMs: num(process.env.INGEST_MIN_INTERVAL_MS, 10_000),
  maxAps: num(process.env.MAX_APS, 20),
  maxMacs: num(process.env.MAX_MACS, 200),
  bodyLimit: process.env.BODY_LIMIT ?? '64kb',

  // Read API
  readRateLimitPerMin: num(process.env.READ_RATE_LIMIT_PER_MIN, 120),
  maxSseClients: num(process.env.MAX_SSE_CLIENTS, 50),
  staleAfterS: num(process.env.STALE_AFTER_S, 90),
  channelThreshold: num(process.env.CHANNEL_THRESHOLD, 5),

  // Admin
  adminUser: process.env.ADMIN_USER ?? 'admin',
  adminPass: process.env.ADMIN_PASS ?? '',

  // Retention
  detailDays: num(process.env.RETENTION_DETAIL_DAYS, 7),
  aggregateDays: num(process.env.RETENTION_AGGREGATE_DAYS, 30),
  registryDays: num(process.env.RETENTION_REGISTRY_DAYS, 90),
  pruneHour: num(process.env.PRUNE_HOUR, 3),
  pruneEnabled: (process.env.PRUNE_ENABLED ?? 'true') !== 'false',

  // Telegram
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  alertCooldownMs: num(process.env.ALERT_COOLDOWN_MS, 3_600_000),

  env: process.env.NODE_ENV ?? 'development',
};

/**
 * Startup safety check. Returns a list of warnings; the caller decides whether
 * to log-and-continue (dev) or refuse to boot (production).
 */
export function configWarnings() {
  const warnings = [];
  const insecure = (v) => !v || v === 'change-me' || v.length < 12;

  if (insecure(config.macSalt)) {
    warnings.push(
      'MAC_SALT is unset, "change-me", or shorter than 12 chars — hashed MACs are brute-forceable (only ~2^48 MACs exist).',
    );
  }
  if (!config.deviceToken && config.env === 'production') {
    warnings.push('DEVICE_TOKEN is empty — ingest will reject everything until a token is provisioned.');
  }
  if (!config.adminPass) {
    warnings.push('ADMIN_PASS is empty — /admin/* is locked (all requests get 403). Set it to enable admin.');
  }
  if (config.telegramToken && !config.telegramChatId) {
    warnings.push('TELEGRAM_BOT_TOKEN is set but TELEGRAM_CHAT_ID is missing — alerts are disabled.');
  }
  if (config.env === 'production' && !config.telegramToken) {
    warnings.push('TELEGRAM_BOT_TOKEN is unset — US-6 alerts are disabled in production.');
  }
  return warnings;
}
