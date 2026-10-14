import express from 'express';
import { config } from './config.js';
import { createSseHub } from './sse.js';
import { createRateLimiter } from './auth.js';
import { createPublicRouter } from './routes/public.js';
import { createAdminRouter, adminPage } from './routes/admin.js';
import { log } from './log.js';

/**
 * Build the Express app. Kept separate from server startup so tests can drive
 * the app in-process without binding a port.
 */
export function createApp({ db, telegram }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // behind nginx: real client IP for rate limiting

  const sse = createSseHub({ maxClients: config.maxSseClients });
  const readLimiter = createRateLimiter({
    limit: config.readRateLimitPerMin,
    windowMs: 60_000,
  });

  // --- body parsing -----------------------------------------------------------
  app.use(express.json({ limit: config.bodyLimit }));

  // --- read rate limit (public GETs only; ingest has its own throttle) --------
  app.use('/api/v1', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = req.ip ?? 'unknown';
    const gate = readLimiter(key);
    res.set('X-RateLimit-Remaining', String(gate.remaining));
    if (!gate.allowed) {
      res.set('Retry-After', String(gate.retryAfterS));
      return res.status(429).json({
        error: { code: 'rate_limited', message: `Cuba lagi dalam ${gate.retryAfterS}s` },
      });
    }
    next();
  });

  // --- routes -----------------------------------------------------------------
  app.use('/api/v1', createPublicRouter({ db, sse, telegram }));
  app.use('/admin/api', createAdminRouter({ db, telegram, sse }));
  app.get('/admin', adminPage());

  app.get('/', (_req, res) => {
    res.json({ data: { service: 'arsywatch-server', api: '/api/v1/health' } });
  });

  // --- 404 --------------------------------------------------------------------
  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `Tiada laluan ${req.path}` } });
  });

  // --- error handler ----------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error: { code: 'payload_too_large', message: `Badan melebihi ${config.bodyLimit}` },
      });
    }
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'JSON tidak sah' } });
    }
    log.error('unhandled error', { path: req.path, error: err?.message ?? String(err) });
    res.status(500).json({ error: { code: 'internal_error', message: 'Ralat dalaman' } });
  });

  return { app, sse };
}
