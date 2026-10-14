/**
 * Structured single-line JSON logger. One line per event so `journalctl` and
 * `grep` both stay useful. Level filter via LOG_LEVEL (debug|info|warn|error).
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, message, context) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...context,
  });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  debug: (msg, ctx) => emit('debug', msg, ctx),
  info: (msg, ctx) => emit('info', msg, ctx),
  warn: (msg, ctx) => emit('warn', msg, ctx),
  error: (msg, ctx) => emit('error', msg, ctx),
};
