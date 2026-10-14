import fs from 'node:fs';
import { Router } from 'express';
import { config } from '../config.js';
import { getConfigValue, setConfigValue } from '../db.js';
import { checkBasicAuth, generateToken, sha256 } from '../crypto.js';
import { runPrune } from '../prune.js';
import { log } from '../log.js';

/**
 * Admin surface (docs/api.md §6). Basic auth only, never public.
 *
 * A missing ADMIN_PASS locks the whole surface (every request 403) rather than
 * silently allowing access — failing closed.
 */
export function createAdminRouter({ db, telegram, sse }) {
  const router = Router();

  router.use((req, res, next) => {
    if (!checkBasicAuth(req.get('authorization'))) {
      res.set('WWW-Authenticate', 'Basic realm="ArsyWatch Admin", charset="UTF-8"');
      return res.status(403).json({
        error: { code: 'forbidden', message: 'Kredensial admin tidak sah' },
      });
    }
    next();
  });

  // ----------------------------------------------------------------- status ---
  router.get('/status', (_req, res) => {
    const now = Date.now();
    const last = db
      .prepare('SELECT id, device, firmware, received_at FROM scans ORDER BY id DESC LIMIT 1')
      .get();

    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(config.dbPath).size;
    } catch {
      sizeBytes = 0;
    }

    const counts = {
      scans: db.prepare('SELECT COUNT(*) AS n FROM scans').get().n,
      aps: db.prepare('SELECT COUNT(*) AS n FROM aps').get().n,
      devices: db.prepare('SELECT COUNT(*) AS n FROM devices').get().n,
      ap_registry: db.prepare('SELECT COUNT(*) AS n FROM ap_registry').get().n,
    };

    const lastSent = getConfigValue(db, 'telegram.last_sent', null);

    res.json({
      data: {
        node_online: Boolean(last) && now - last.received_at < config.staleAfterS,
        last_scan: last
          ? {
              id: last.id,
              received_at: new Date(last.received_at).toISOString(),
              age_s: Math.round((now - last.received_at) / 1000),
              device: last.device,
              firmware: last.firmware,
            }
          : null,
        db: { size_bytes: sizeBytes, ...counts },
        uptime_s: Math.round(process.uptime()),
        sse_clients: sse.clientCount,
        telegram: {
          configured: telegram.enabled(),
          last_sent: lastSent ? new Date(Number(lastSent)).toISOString() : null,
        },
        env: config.env,
      },
      meta: { generated_at: new Date(now).toISOString() },
    });
  });

  // ----------------------------------------------------------------- tokens ---
  router.get('/tokens', (_req, res) => {
    const rows = db
      .prepare('SELECT device, created_at, last_seen FROM device_tokens ORDER BY device')
      .all();
    res.json({
      data: rows.map((r) => ({
        device: r.device,
        created_at: new Date(r.created_at).toISOString(),
        last_seen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      })),
      meta: { count: rows.length },
    });
  });

  // Rotate (create or replace) a device token. The raw token is returned once.
  router.post('/tokens', (req, res) => {
    const device = req.body?.device;
    if (typeof device !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(device)) {
      return res.status(422).json({
        error: {
          code: 'validation_failed',
          message: 'device tidak sah',
          details: [{ path: 'device', issue: 'mesti padan ^[a-z0-9][a-z0-9-]{0,31}$' }],
        },
      });
    }

    const token = generateToken();
    const now = Date.now();
    db.prepare(
      `INSERT INTO device_tokens (device, token_hash, created_at, last_seen) VALUES (?, ?, ?, NULL)
       ON CONFLICT(device) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`,
    ).run(device, sha256(token), now);

    log.info('device token rotated', { device });
    res.status(201).json({
      data: { device, token, created_at: new Date(now).toISOString() },
      meta: { notice: 'Simpan token ini sekarang — ia tidak akan dipaparkan lagi.' },
    });
  });

  // -------------------------------------------------------------- retention ---
  router.get('/retention', (_req, res) => {
    res.json({
      data: {
        detail_days: Number(getConfigValue(db, 'retention.detail_days', String(config.detailDays))),
        aggregate_days: Number(
          getConfigValue(db, 'retention.aggregate_days', String(config.aggregateDays)),
        ),
        registry_days: Number(
          getConfigValue(db, 'retention.registry_days', String(config.registryDays)),
        ),
        rows: {
          scans: db.prepare('SELECT COUNT(*) AS n FROM scans').get().n,
          device_hours: db.prepare('SELECT COUNT(*) AS n FROM device_hours').get().n,
          devices: db.prepare('SELECT COUNT(*) AS n FROM devices').get().n,
          ap_registry: db.prepare('SELECT COUNT(*) AS n FROM ap_registry').get().n,
        },
      },
      meta: {},
    });
  });

  router.post('/retention', (req, res) => {
    const fields = ['detail_days', 'aggregate_days', 'registry_days'];
    const updates = {};
    for (const field of fields) {
      if (req.body?.[field] === undefined) continue;
      const n = Number(req.body[field]);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        return res.status(422).json({
          error: {
            code: 'validation_failed',
            message: `${field} tidak sah`,
            details: [{ path: field, issue: 'mesti integer 1…3650' }],
          },
        });
      }
      updates[field] = n;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(422).json({
        error: { code: 'validation_failed', message: 'Tiada field untuk dikemas kini' },
      });
    }

    for (const [field, n] of Object.entries(updates)) {
      setConfigValue(db, `retention.${field}`, n);
    }
    res.json({
      data: {
        detail_days: Number(getConfigValue(db, 'retention.detail_days', String(config.detailDays))),
        aggregate_days: Number(
          getConfigValue(db, 'retention.aggregate_days', String(config.aggregateDays)),
        ),
        registry_days: Number(
          getConfigValue(db, 'retention.registry_days', String(config.registryDays)),
        ),
      },
      meta: { updated: Object.keys(updates) },
    });
  });

  // --------------------------------------------------------------- telegram ---
  router.post('/telegram/test', async (_req, res) => {
    if (!telegram.enabled()) {
      return res.status(422).json({
        error: {
          code: 'validation_failed',
          message: 'Telegram tidak dikonfigurasikan (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)',
        },
      });
    }
    const result = await telegram.sendTest();
    res.json({ data: result, meta: {} });
  });

  // ------------------------------------------------------------------ prune ---
  router.post('/prune', (_req, res) => {
    const result = runPrune(db, {
      detailDays: Number(getConfigValue(db, 'retention.detail_days', String(config.detailDays))),
      aggregateDays: Number(
        getConfigValue(db, 'retention.aggregate_days', String(config.aggregateDays)),
      ),
      registryDays: Number(
        getConfigValue(db, 'retention.registry_days', String(config.registryDays)),
      ),
    });
    res.json({ data: { deleted: result }, meta: {} });
  });

  return router;
}

/**
 * Minimal status page, mounted at `/admin` (the JSON router sits at `/admin/api`).
 * Browsable without a dashboard build — useful on the VPS before Fasa 3 ships.
 */
export function adminPage() {
  return (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="ms"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ArsyWatch · Admin</title>
<style>
  :root{--bg:#fff;--fg:#1A1E1A;--fg2:#627061;--line:rgba(120,136,119,.4);--accent:#F78522}
  *{box-sizing:border-box}
  body{margin:0;padding:clamp(1rem,4vw,2rem);background:var(--bg);color:var(--fg);
    font-family:ui-sans-serif,system-ui,"Segoe UI",sans-serif;max-width:1000px;margin:0 auto}
  h1{font-size:clamp(1.5rem,3vw,2rem);text-transform:uppercase;letter-spacing:-.02em;margin:0 0 4px}
  p.sub{color:var(--fg2);font-size:.875rem;margin:0 0 24px}
  pre{font-family:ui-monospace,"Cascadia Mono",monospace;font-variant-numeric:tabular-nums;
    border:1px solid var(--line);border-radius:20px;padding:16px;overflow:auto;font-size:.8125rem}
</style></head>
<body>
  <h1>ArsyWatch Admin</h1>
  <p class="sub">Status baca sahaja. Endpoint tulis memerlukan POST dengan Basic auth.</p>
  <pre id="out">memuatkan…</pre>
  <script>
    fetch('api/status').then(r=>r.json()).then(j=>
      document.getElementById('out').textContent = JSON.stringify(j.data,null,2)
    ).catch(e=>document.getElementById('out').textContent = 'ralat: '+e.message);
  </script>
</body></html>`);
  };
}
