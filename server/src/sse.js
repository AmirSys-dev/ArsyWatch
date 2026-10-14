import { log } from './log.js';

/**
 * Server-Sent Events hub (docs/api.md §5).
 *
 * Tracks connected clients, fans out `scan` events after each ingest, and emits
 * a `heartbeat` every 25s so clients can detect a dead connection (proxies and
 * load balancers drop idle streams silently).
 */
export function createSseHub({ maxClients, heartbeatMs = 25_000 }) {
  const clients = new Set();
  let heartbeatTimer = null;

  function write(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      const ts = new Date().toISOString();
      for (const res of clients) {
        try {
          write(res, 'heartbeat', { ts });
        } catch {
          remove(res);
        }
      }
    }, heartbeatMs);
    // Do not hold the process open just for heartbeats.
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  }

  function stopHeartbeatIfIdle() {
    if (clients.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function remove(res) {
    if (!clients.delete(res)) return;
    log.debug('sse client left', { clients: clients.size });
    stopHeartbeatIfIdle();
  }

  /** Attach a new SSE client. Returns false when the cap is reached. */
  function add(req, res, hello) {
    if (clients.size >= maxClients) return false;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    write(res, 'hello', hello);

    clients.add(res);
    log.debug('sse client joined', { clients: clients.size });

    req.on('close', () => remove(res));
    startHeartbeat();
    return true;
  }

  function broadcast(event, data) {
    let delivered = 0;
    for (const res of clients) {
      try {
        write(res, event, data);
        delivered += 1;
      } catch {
        remove(res);
      }
    }
    return delivered;
  }

  function closeAll() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    for (const res of clients) {
      try {
        res.end();
      } catch {
        /* already gone */
      }
    }
    clients.clear();
  }

  return {
    add,
    broadcast,
    closeAll,
    get clientCount() {
      return clients.size;
    },
  };
}
