import { config } from './config.js';
import { log } from './log.js';

/**
 * Telegram alerting — minimal scope (US-6 reduced): new-AP alerts only.
 * Disabled by default; requires both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
 *
 * Alerts never throw into the ingest path — a Telegram outage must not fail an
 * ingest. Failures are logged and swallowed.
 */
export function createTelegram(db) {
  const enabled = () => Boolean(config.telegramToken && config.telegramChatId);

  async function send(text) {
    if (!enabled()) return { sent: false, reason: 'not_configured' };
    const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        log.warn('telegram send failed', { status: res.status, detail: detail.slice(0, 200) });
        return { sent: false, reason: `http_${res.status}` };
      }
      db.prepare(
        "INSERT INTO config (key, value) VALUES ('telegram.last_sent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(Date.now()));
      return { sent: true };
    } catch (err) {
      log.warn('telegram send error', { error: err.message });
      return { sent: false, reason: err.message };
    }
  }

  /**
   * Alert for newly-seen BSSIDs, respecting a per-AP cooldown so a flapping AP
   * cannot spam. Records `last_alert` on the registry row when an alert fires.
   */
  async function alertNewAps(bssids, now) {
    if (!enabled() || bssids.length === 0) return 0;

    const eligible = [];
    for (const bssid of bssids) {
      const row = db
        .prepare('SELECT bssid, ssid, last_alert FROM ap_registry WHERE bssid = ?')
        .get(bssid);
      if (!row) continue;
      if (row.last_alert != null && now - row.last_alert < config.alertCooldownMs) continue;
      eligible.push(row);
    }
    if (eligible.length === 0) return 0;

    const lines = eligible.map((r) => `• <code>${r.ssid || '(tersembunyi)'}</code> ${r.bssid}`);
    const text = `📡 <b>ArsyWatch</b> — ${eligible.length} AP baharu\n${lines.join('\n')}`;
    const result = await send(text);
    if (result.sent) {
      const mark = db.prepare('UPDATE ap_registry SET last_alert = ? WHERE bssid = ?');
      const tx = db.transaction((rows) => {
        for (const r of rows) mark.run(now, r.bssid);
      });
      tx(eligible);
    }
    return result.sent ? eligible.length : 0;
  }

  async function sendTest() {
    const stamp = new Date().toISOString();
    return send(`✅ <b>ArsyWatch</b> — alert ujian\nMasa pelayan: <code>${stamp}</code>`);
  }

  return { enabled, send, alertNewAps, sendTest };
}
