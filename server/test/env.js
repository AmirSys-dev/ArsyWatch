/**
 * Test environment. MUST be imported before any `../src/*` module, because
 * `config.js` snapshots `process.env` at module-evaluation time and ES module
 * imports are hoisted — so these assignments only take effect if this module is
 * evaluated first (which import-declaration order guarantees).
 */
process.env.NODE_ENV = 'test';
process.env.MAC_SALT = 'test-salt-not-for-production';
process.env.DEVICE_TOKEN = 'test-device-token';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'test-admin-pass';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_CHAT_ID = '';
process.env.INGEST_MIN_INTERVAL_MS = '0';
process.env.READ_RATE_LIMIT_PER_MIN = '10000';
process.env.DB_PATH = ':memory:';
