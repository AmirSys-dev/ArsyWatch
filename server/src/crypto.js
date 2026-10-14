import crypto from 'node:crypto';
import { config } from './config.js';

/** SHA-256 hex of a salted MAC. Raw MAC never leaves this function's caller. */
export function hashMac(mac) {
  return crypto
    .createHash('sha256')
    .update(config.macSalt)
    .update(mac.trim().toUpperCase())
    .digest('hex');
}

/** SHA-256 hex of an arbitrary string (used for device tokens at rest). */
export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed to a fixed 32 bytes first, so a length mismatch cannot
 * short-circuit before the comparison — that early-exit is the classic timing
 * oracle in naive timingSafeEqual wrappers.
 */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Cryptographically random URL-safe token for device provisioning. */
export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Timing-safe comparison against HTTP Basic credentials. */
export function checkBasicAuth(header) {
  if (!config.adminPass) return false; // locked until ADMIN_PASS is set
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return false;

  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;

  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // Both comparisons always run — no short-circuit on the password.
  const userOk = safeEqual(user, config.adminUser);
  const passOk = safeEqual(pass, config.adminPass);
  return userOk && passOk;
}
